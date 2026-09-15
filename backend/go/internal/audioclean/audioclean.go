// Package audioclean makes pendant recordings worth transcribing.
//
// Two stages, both bundled binaries the Lambda carries:
//
//  1. DeepFilterNet3 (deep-filter) removes the noise — the open-source state
//     of the art in speech enhancement, ~5x faster than real time on a CPU —
//     with its attenuation capped so the voice keeps its body instead of
//     going "underwater".
//  2. The result is peak-normalized (the pendant records far-field and
//     quiet), then ffmpeg's silencedetect cuts the parts where nobody
//     speaks. Energy-based silence detection is unreliable on noisy audio,
//     which is exactly why it runs AFTER the denoiser: with the noise floor
//     gone, silence is actually silent, and the detector becomes close to a
//     neural VAD at none of the packaging cost.
//  3. The kept speech is high-passed, dynamically leveled, and loudness-
//     normalized to a comfortable playback target, so near and far speakers
//     come out at one proper volume.
//
// The cleaned, cut file is what Deepgram transcribes and what the app plays —
// so transcript timestamps line up with what the ear hears, and dead air is
// simply gone. The original stays untouched in S3.
package audioclean

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// Result of one cleaning pass.
type Result struct {
	// Mp3 is the cleaned, cut audio: 16 kHz mono, ready for Deepgram.
	Mp3 []byte
	// OriginalSeconds and SpeechSeconds describe what the cut kept.
	OriginalSeconds float64
	SpeechSeconds   float64
	// NoSpeech means the detector found nothing worth transcribing.
	NoSpeech bool
}

const (
	// How much of the noise deep-filter is allowed to take out.
	//
	// This has been wrong in both directions. Its own default of 100 dB —
	// suppress everything it can — thinned speech into the "underwater"
	// artifact. Backing off to 35 fixed that and left a subtler version of the
	// same problem: fricatives are broadband and noise-shaped, so s, sh, f and
	// th are exactly what a denoiser takes first, and a voice missing its
	// consonants reads as muffled even when its vowels are untouched. The
	// source does not help — the pendant records 16 kHz at 32 kbps, so there
	// is very little above 6 kHz to lose in the first place.
	//
	// 20 dB still removes about nine tenths of the noise amplitude, and what
	// it leaves is quiet enough to sit under speech rather than over it. The
	// consonants it no longer strips are put back by the presence shelf below.
	defaultAttenLimDB = "20"
	// How much to lift the consonant band afterwards. Measured against a tone
	// sweep: nothing below 2 kHz moves, 3.2 kHz gains about 2 dB and 5-7 kHz
	// about 4 — the range that carries intelligibility rather than volume.
	defaultPresenceGainDB = "4"
	// Post-denoise and peak-normalized, -35 dB held for 0.45 s is silence
	// with high confidence.
	silenceThreshold = "-35dB"
	silenceMinimum   = 0.45
	// Keep a breath around each spoken stretch, and bridge short pauses so a
	// sentence's natural rhythm survives the cut.
	padSeconds   = 0.25
	mergeSeconds = 0.5
	// Below this much total speech the recording is noise; skip Deepgram.
	minSpeechSeconds = 0.75
	// Peak-normalization staging before silence detection: without it a quiet
	// far-field recording sits entirely under the silence threshold and gets
	// archived as "no speech". The gain cap keeps a near-empty file's residue
	// from being amplified into phantom speech.
	peakTargetDB = -1.0
	maxGainDB    = 40.0
	// Denoised audio peaking below this holds nothing a person said.
	emptyPeakDB = -55.0
	// Filtergraphs stop being a good idea past this many pieces.
	maxSegments = 200
)

func attenLim() string {
	if v := os.Getenv("DEEP_FILTER_ATTEN_LIM"); v != "" {
		return v
	}
	return defaultAttenLimDB
}

func presenceGain() string {
	if v := os.Getenv("AUDIO_PRESENCE_GAIN_DB"); v != "" {
		return v
	}
	return defaultPresenceGainDB
}

// finalFilters shapes then levels: rumble out, consonants back in, and only
// then the loudness targets, so the levelling accounts for the lift rather
// than fighting it.
//
// Playback loudness is the point of the last two — far and near speakers have
// to land at one comfortable volume.
func finalFilters() string {
	return "highpass=f=70," +
		"treble=g=" + presenceGain() + ":f=3200:width_type=q:width=0.7," +
		"dynaudnorm=f=250:g=15," +
		"loudnorm=I=-16:TP=-1.5:LRA=11"
}

func ffmpeg() string {
	if v := os.Getenv("FFMPEG_PATH"); v != "" {
		return v
	}
	return "ffmpeg"
}

func deepFilter() string {
	if v := os.Getenv("DEEP_FILTER_PATH"); v != "" {
		return v
	}
	return "deep-filter"
}

func run(ctx context.Context, name string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	// deep-filter wants a writable home for its runtime scratch.
	cmd.Env = append(os.Environ(), "HOME=/tmp")
	var out bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &out
	if err := cmd.Run(); err != nil {
		tail := out.String()
		if len(tail) > 800 {
			tail = tail[len(tail)-800:]
		}
		return out.String(), fmt.Errorf("%s: %w: %s", filepath.Base(name), err, tail)
	}
	return out.String(), nil
}

type segment struct{ start, end float64 }

var (
	silenceStartRe = regexp.MustCompile(`silence_start: ([0-9.]+)`)
	silenceEndRe   = regexp.MustCompile(`silence_end: ([0-9.]+)`)
	maxVolumeRe    = regexp.MustCompile(`max_volume: (-?[0-9.]+) dB`)
)

// peakGain turns a volumedetect report into the static gain (dB) that lifts
// the file's peak to the staging target, clamped so residue in a near-empty
// file is never amplified into phantom speech. The bool is false when the
// report is unreadable or the file is effectively silent.
func peakGain(report string) (float64, bool) {
	m := maxVolumeRe.FindStringSubmatch(report)
	if m == nil {
		return 0, false
	}
	peak, err := strconv.ParseFloat(m[1], 64)
	if err != nil || peak < emptyPeakDB {
		return 0, false
	}
	gain := peakTargetDB - peak
	if gain < 0 {
		gain = 0
	}
	if gain > maxGainDB {
		gain = maxGainDB
	}
	return gain, true
}

// speechSegments inverts silencedetect's report into padded, merged speech spans.
func speechSegments(report string, total float64) []segment {
	starts := silenceStartRe.FindAllStringSubmatch(report, -1)
	ends := silenceEndRe.FindAllStringSubmatch(report, -1)

	type silence struct{ start, end float64 }
	var silences []silence
	for i, m := range starts {
		s, _ := strconv.ParseFloat(m[1], 64)
		e := total
		if i < len(ends) {
			e, _ = strconv.ParseFloat(ends[i][1], 64)
		}
		silences = append(silences, silence{s, e})
	}

	// Complement within [0, total].
	var speech []segment
	cursor := 0.0
	for _, s := range silences {
		if s.start > cursor {
			speech = append(speech, segment{cursor, s.start})
		}
		if s.end > cursor {
			cursor = s.end
		}
	}
	if cursor < total {
		speech = append(speech, segment{cursor, total})
	}

	// Pad, clamp, merge, drop slivers.
	for i := range speech {
		speech[i].start = max(0, speech[i].start-padSeconds)
		speech[i].end = min(total, speech[i].end+padSeconds)
	}
	sort.Slice(speech, func(a, b int) bool { return speech[a].start < speech[b].start })
	var merged []segment
	for _, s := range speech {
		if len(merged) > 0 && s.start-merged[len(merged)-1].end < mergeSeconds {
			if s.end > merged[len(merged)-1].end {
				merged[len(merged)-1].end = s.end
			}
			continue
		}
		merged = append(merged, s)
	}
	kept := merged[:0]
	for _, s := range merged {
		if s.end-s.start >= 0.3 {
			kept = append(kept, s)
		}
	}
	return kept
}

// wavSeconds reads the duration straight off the PCM byte count: 48 kHz mono
// s16le is 96,000 bytes a second, and the container adds a 44-byte header.
func wavSeconds(path string) (float64, error) {
	info, err := os.Stat(path)
	if err != nil {
		return 0, err
	}
	if info.Size() <= 44 {
		return 0, nil
	}
	return float64(info.Size()-44) / 96000.0, nil
}

// Clean runs the full pass. Any failure is the caller's cue to fall back to
// the original audio — enhancement must never cost a transcript.
func Clean(ctx context.Context, mp3 []byte) (*Result, error) {
	dir, err := os.MkdirTemp("/tmp", "clean-*")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(dir)

	in := filepath.Join(dir, "in.mp3")
	if err := os.WriteFile(in, mp3, 0o600); err != nil {
		return nil, err
	}

	// Decode to the 48 kHz mono WAV DeepFilterNet expects.
	wav48 := filepath.Join(dir, "in48.wav")
	if _, err := run(ctx, ffmpeg(), "-y", "-i", in, "-ar", "48000", "-ac", "1",
		"-c:a", "pcm_s16le", wav48); err != nil {
		return nil, fmt.Errorf("decode: %w", err)
	}

	// Denoise, with the attenuation cap that keeps speech sounding like
	// speech, and delay compensation so nothing shifts against the clock.
	// deep-filter writes <output-dir>/<input name>.
	outDir := filepath.Join(dir, "df")
	if err := os.Mkdir(outDir, 0o700); err != nil {
		return nil, err
	}
	if _, err := run(ctx, deepFilter(), "-D", "-a", attenLim(), "-o", outDir, wav48); err != nil {
		return nil, fmt.Errorf("denoise: %w", err)
	}
	clean48 := filepath.Join(outDir, "in48.wav")
	if _, err := os.Stat(clean48); err != nil {
		return nil, fmt.Errorf("denoise: no output file: %w", err)
	}

	total, err := wavSeconds(clean48)
	if err != nil || total == 0 {
		return nil, fmt.Errorf("denoised audio is unreadable: %w", err)
	}

	// Measure the denoised peak. volumedetect only MEASURES, and the gain it
	// yields has to exist before anything can apply it, so it stays its own
	// pass. The peak feeds two things: the no-speech guard just below, and the
	// staging gain used by the silence pass and the final encode.
	volReport, err := run(ctx, ffmpeg(), "-i", clean48, "-af", "volumedetect", "-f", "null", "-")
	if err != nil {
		return nil, fmt.Errorf("volumedetect: %w", err)
	}
	gain, audible := peakGain(volReport)
	if !audible {
		// The denoiser left essentially nothing: nobody spoke.
		return &Result{OriginalSeconds: total, NoSpeech: true}, nil
	}

	// Stage the level, then detect silence — in ONE pass. The pendant records
	// far-field and quiet, and against an absolute threshold a quiet file reads
	// as all silence; peak-normalizing first makes the -35 dB threshold mean the
	// same thing for every recording. The gain is applied in-line
	// (volume,silencedetect) rather than by writing a normalized wav and
	// detecting on it: `volume` is a linear, time-invariant gain, so detecting
	// on the gained stream is identical to detecting on a gained-then-quantized
	// wav, save a 16-bit quantization step that sits ~60 dB under the threshold.
	report, err := run(ctx, ffmpeg(), "-i", clean48,
		"-af", fmt.Sprintf("volume=%.1fdB,silencedetect=noise=%s:d=%v", gain, silenceThreshold, silenceMinimum),
		"-f", "null", "-")
	if err != nil {
		return nil, fmt.Errorf("silencedetect: %w", err)
	}

	segments := speechSegments(report, total)
	speech := 0.0
	for _, s := range segments {
		speech += s.end - s.start
	}

	result := &Result{OriginalSeconds: total, SpeechSeconds: speech}
	if speech < minSpeechSeconds {
		result.NoSpeech = true
		return result, nil
	}

	// One encoder pass: trim every speech span, stitch, then polish — rumble
	// high-passed away, near and far speakers leveled, loudness normalized to
	// a comfortable playback target — and encode at the pendant's own 16 kHz.
	// Leveling runs after the cut so dead air never skews the measurement.
	//
	// The input is the denoised clean48; the staging gain the silence pass used
	// is re-applied here, right after the stitch, so the encoder sees exactly
	// what the old separate norm48 held. `volume` is linear and time-invariant,
	// so it commutes with the cut — gaining the stitched speech equals gaining
	// the whole file first (the old norm48) then cutting — which lets us feed
	// clean48 directly and skip writing and re-reading a normalized wav.
	if len(segments) > maxSegments {
		segments = segments[:maxSegments]
	}
	var graph strings.Builder
	for i, s := range segments {
		fmt.Fprintf(&graph, "[0]atrim=start=%.3f:end=%.3f,asetpts=N/SR/TB[s%d];", s.start, s.end, i)
	}
	for i := range segments {
		fmt.Fprintf(&graph, "[s%d]", i)
	}
	fmt.Fprintf(&graph, "concat=n=%d:v=0:a=1[cat];[cat]volume=%.1fdB,%s[out]", len(segments), gain, finalFilters())

	outMp3 := filepath.Join(dir, "out.mp3")
	if _, err := run(ctx, ffmpeg(), "-y", "-i", clean48,
		"-filter_complex", graph.String(), "-map", "[out]",
		// 64k rather than 48k: the source is a 32 kbps original, and a
		// second lossy pass at close to its bitrate spends its error budget
		// on exactly the high-frequency detail this pipeline just restored.
		"-ar", "16000", "-c:a", "libmp3lame", "-b:a", "64k", outMp3); err != nil {
		return nil, fmt.Errorf("cut+encode: %w", err)
	}

	cleaned, err := os.ReadFile(outMp3)
	if err != nil {
		return nil, err
	}
	result.Mp3 = cleaned
	return result, nil
}

func min(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}
func max(a, b float64) float64 {
	if a > b {
		return a
	}
	return b
}
