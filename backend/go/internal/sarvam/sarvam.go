// Package sarvam is a second, independent ear on every recording.
//
// Sarvam's saaras models are strong on Indian languages and code-switching —
// exactly the speech this pendant hears — so its reading of the words is used
// to correct the Deepgram transcript (see enrich.MergeTranscripts). Only the
// words: diarization and timestamps stay with the Deepgram base.
//
// Sarvam's sync endpoint takes at most 30 seconds of audio per request and
// its batch API is a multi-minute job queue, so the audio is split into
// sub-30-second chunks with the bundled ffmpeg and transcribed concurrently.
package sarvam

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	endpoint = "https://api.sarvam.ai/speech-to-text"
	// Chunks stay comfortably under the endpoint's 30-second ceiling.
	chunkSeconds = 28
	concurrency  = 4
)

func model() string {
	if v := os.Getenv("SARVAM_MODEL"); v != "" {
		return v
	}
	return "saaras:v3"
}

func language() string {
	if v := os.Getenv("SARVAM_LANGUAGE"); v != "" {
		return v
	}
	return "unknown" // auto-detect; conversations here code-switch freely
}

var httpClient = &http.Client{Timeout: 90 * time.Second}

// Transcribe runs the whole file through Sarvam and returns the stitched
// plain-text transcript. Any failure fails the whole call — the caller treats
// Sarvam as best-effort and falls back to the Deepgram transcript alone.
func Transcribe(ctx context.Context, audio []byte, apiKey string) (string, error) {
	dir, err := os.MkdirTemp("/tmp", "sarvam-*")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(dir)

	in := filepath.Join(dir, "in.mp3")
	if err := os.WriteFile(in, audio, 0o600); err != nil {
		return "", err
	}

	chunks, err := split(ctx, in, dir)
	if err != nil {
		return "", fmt.Errorf("chunk: %w", err)
	}

	texts := make([]string, len(chunks))
	errs := make([]error, len(chunks))
	sem := make(chan struct{}, concurrency)
	var wg sync.WaitGroup
	for i, chunk := range chunks {
		wg.Add(1)
		go func(i int, chunk string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			texts[i], errs[i] = transcribeChunk(ctx, chunk, apiKey)
		}(i, chunk)
	}
	wg.Wait()

	var parts []string
	for i, err := range errs {
		if err != nil {
			return "", fmt.Errorf("chunk %d/%d: %w", i+1, len(chunks), err)
		}
		if t := strings.TrimSpace(texts[i]); t != "" {
			parts = append(parts, t)
		}
	}
	return strings.Join(parts, " "), nil
}

// split cuts the audio into 16 kHz mono chunks under the request ceiling.
func split(ctx context.Context, in, dir string) ([]string, error) {
	ffmpeg := os.Getenv("FFMPEG_PATH")
	if ffmpeg == "" {
		ffmpeg = "ffmpeg"
	}
	pattern := filepath.Join(dir, "chunk-%03d.mp3")
	cmd := exec.CommandContext(ctx, ffmpeg, "-y", "-i", in,
		"-ar", "16000", "-ac", "1", "-c:a", "libmp3lame", "-b:a", "32k",
		"-f", "segment", "-segment_time", fmt.Sprint(chunkSeconds), pattern)
	var out bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &out
	if err := cmd.Run(); err != nil {
		tail := out.String()
		if len(tail) > 400 {
			tail = tail[len(tail)-400:]
		}
		return nil, fmt.Errorf("ffmpeg: %w: %s", err, tail)
	}
	chunks, err := filepath.Glob(filepath.Join(dir, "chunk-*.mp3"))
	if err != nil || len(chunks) == 0 {
		return nil, fmt.Errorf("no chunks produced: %w", err)
	}
	sort.Strings(chunks)
	return chunks, nil
}

func transcribeChunk(ctx context.Context, path, apiKey string) (string, error) {
	// One retry: a single throttled chunk should not discard the whole file.
	text, err := postChunk(ctx, path, apiKey)
	if err == nil {
		return text, nil
	}
	select {
	case <-time.After(2 * time.Second):
	case <-ctx.Done():
		return "", ctx.Err()
	}
	return postChunk(ctx, path, apiKey)
}

func postChunk(ctx context.Context, path, apiKey string) (string, error) {
	audio, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}

	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	part, err := form.CreateFormFile("file", filepath.Base(path))
	if err != nil {
		return "", err
	}
	if _, err := part.Write(audio); err != nil {
		return "", err
	}
	_ = form.WriteField("model", model())
	_ = form.WriteField("language_code", language())
	if err := form.Close(); err != nil {
		return "", err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, &body)
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", form.FormDataContentType())
	req.Header.Set("api-subscription-key", apiKey)

	resp, err := httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return "", err
	}
	if resp.StatusCode != http.StatusOK {
		msg := string(raw)
		if len(msg) > 300 {
			msg = msg[:300]
		}
		return "", fmt.Errorf("sarvam %d: %s", resp.StatusCode, msg)
	}

	var parsed struct {
		Transcript string `json:"transcript"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return "", fmt.Errorf("unparseable sarvam response: %w", err)
	}
	return parsed.Transcript, nil
}
