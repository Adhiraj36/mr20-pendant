// enhance runs the processor's audio-enhancement pass over local files, so
// the exact pipeline ProcessorFn applies before transcription can be heard
// and A/B-ed on a laptop without a deploy.
//
//	go run ./cmd/enhance -out ./cleaned a.mp3 b.mp3
//
// It uses the same package (internal/audioclean) and the same environment
// knobs: FFMPEG_PATH, DEEP_FILTER_PATH, DEEP_FILTER_ATTEN_LIM,
// AUDIO_PRESENCE_GAIN_DB. Output is <out>/<name>.mp3, plus one line per file
// reporting what the silence cut kept.
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/MelloB1989/mr20-pendant/backend/internal/audioclean"
)

func main() {
	out := flag.String("out", "cleaned", "directory for the enhanced files")
	flag.Parse()
	if flag.NArg() == 0 {
		fmt.Fprintln(os.Stderr, "usage: enhance [-out dir] file.mp3 ...")
		os.Exit(2)
	}
	if err := os.MkdirAll(*out, 0o755); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	failed := false
	for _, in := range flag.Args() {
		if err := one(in, *out); err != nil {
			fmt.Fprintf(os.Stderr, "%s: %v\n", in, err)
			failed = true
		}
	}
	if failed {
		os.Exit(1)
	}
}

func one(in, out string) error {
	mp3, err := os.ReadFile(in)
	if err != nil {
		return err
	}
	started := time.Now()
	res, err := audioclean.Clean(context.Background(), mp3)
	if err != nil {
		return err
	}
	name := filepath.Base(in)
	if res.NoSpeech {
		fmt.Printf("%s: no speech (%.1fs in, %.1fs kept) — nothing written\n",
			name, res.OriginalSeconds, res.SpeechSeconds)
		return nil
	}
	dst := filepath.Join(out, name)
	if err := os.WriteFile(dst, res.Mp3, 0o644); err != nil {
		return err
	}
	fmt.Printf("%s: %.1fs in, %.1fs speech kept (%.0f%%), %d KB out, %.1fs elapsed -> %s\n",
		name, res.OriginalSeconds, res.SpeechSeconds, 100*res.SpeechSeconds/res.OriginalSeconds,
		len(res.Mp3)/1024, time.Since(started).Seconds(), dst)
	return nil
}
