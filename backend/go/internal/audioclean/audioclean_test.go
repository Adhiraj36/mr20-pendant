package audioclean

import "testing"

func total(segs []segment) float64 {
	sum := 0.0
	for _, s := range segs {
		sum += s.end - s.start
	}
	return sum
}

func TestSpeechSegmentsInvertsSilence(t *testing.T) {
	// 10 s file, silence 2..5 → speech 0..2 and 5..10, padded 0.25 s inward.
	report := "[silencedetect] silence_start: 2.000\n[silencedetect] silence_end: 5.000 | silence_duration: 3.0\n"
	segs := speechSegments(report, 10)
	if len(segs) != 2 {
		t.Fatalf("want 2 segments, got %d: %v", len(segs), segs)
	}
	if segs[0].start != 0 || segs[0].end != 2.25 {
		t.Errorf("first segment = %+v, want [0, 2.25]", segs[0])
	}
	if segs[1].start != 4.75 || segs[1].end != 10 {
		t.Errorf("second segment = %+v, want [4.75, 10]", segs[1])
	}
}

func TestSpeechSegmentsMergesShortGaps(t *testing.T) {
	// Silence 2..2.4 is only a breath: after ±0.25 padding the gap shrinks
	// under the merge threshold and the two spans become one.
	report := "silence_start: 2.000\nsilence_end: 2.400\n"
	segs := speechSegments(report, 10)
	if len(segs) != 1 {
		t.Fatalf("want 1 merged segment, got %d: %v", len(segs), segs)
	}
	if segs[0].start != 0 || segs[0].end != 10 {
		t.Errorf("merged segment = %+v, want [0, 10]", segs[0])
	}
}

func TestSpeechSegmentsAllSilence(t *testing.T) {
	// Wall-to-wall silence leaves only the padded sliver at each edge of the
	// silence span, and those are dropped as sub-0.3 s slivers.
	report := "silence_start: 0.000\nsilence_end: 10.000\n"
	segs := speechSegments(report, 10)
	if got := total(segs); got >= minSpeechSeconds {
		t.Errorf("all-silence file yields %.2fs of speech, want < %.2f", got, minSpeechSeconds)
	}
}

func TestSpeechSegmentsTrailingSilenceWithoutEnd(t *testing.T) {
	// ffmpeg omits the final silence_end when the file ends silent.
	report := "silence_start: 0.000\nsilence_end: 3.000\nsilence_start: 7.000\n"
	segs := speechSegments(report, 10)
	if len(segs) != 1 {
		t.Fatalf("want 1 segment, got %d: %v", len(segs), segs)
	}
	if segs[0].start != 2.75 || segs[0].end != 7.25 {
		t.Errorf("segment = %+v, want [2.75, 7.25]", segs[0])
	}
}

func TestSpeechSegmentsNoSilenceAtAll(t *testing.T) {
	segs := speechSegments("", 10)
	if len(segs) != 1 || segs[0].start != 0 || segs[0].end != 10 {
		t.Errorf("continuous speech should keep the whole file, got %v", segs)
	}
}

func TestPeakGainLiftsQuietAudio(t *testing.T) {
	report := "[Parsed_volumedetect_0 @ 0x1] mean_volume: -33.2 dB\n[Parsed_volumedetect_0 @ 0x1] max_volume: -21.0 dB\n"
	gain, ok := peakGain(report)
	if !ok || gain != 20.0 {
		t.Errorf("gain = %v ok=%v, want 20.0 true", gain, ok)
	}
}

func TestPeakGainClampsAndRejects(t *testing.T) {
	if gain, ok := peakGain("max_volume: -60.0 dB"); ok {
		t.Errorf("near-silent file must read as no speech, got gain %v", gain)
	}
	if gain, ok := peakGain("max_volume: -50.0 dB"); !ok || gain != maxGainDB {
		t.Errorf("gain should clamp to %v, got %v ok=%v", maxGainDB, gain, ok)
	}
	if gain, ok := peakGain("max_volume: -0.2 dB"); !ok || gain != 0 {
		t.Errorf("already-loud file needs no gain, got %v ok=%v", gain, ok)
	}
	if _, ok := peakGain("no report at all"); ok {
		t.Error("unreadable report must not produce a gain")
	}
}
