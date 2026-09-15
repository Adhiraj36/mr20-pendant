// Package deepgram calls Nova-3 pre-recorded transcription with diarization.
//
// The audio is handed over as a presigned S3 URL rather than streamed through
// the Lambda, so a 60 MB recording costs no Lambda memory or transfer time.
package deepgram

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/MelloB1989/mr20-pendant/backend/internal/types"
)

const endpoint = "https://api.deepgram.com/v1/listen"

// Error separates what is worth another SQS delivery from what is not.
type Error struct {
	Message   string
	Retryable bool
}

func (e *Error) Error() string { return e.Message }

type dgResponse struct {
	Metadata struct {
		Duration float64  `json:"duration"`
		Models   []string `json:"models"`
	} `json:"metadata"`
	Results struct {
		Channels []struct {
			Alternatives []struct {
				Transcript string   `json:"transcript"`
				Languages  []string `json:"languages"`
			} `json:"alternatives"`
		} `json:"channels"`
		Utterances []struct {
			Speaker    int     `json:"speaker"`
			Start      float64 `json:"start"`
			End        float64 `json:"end"`
			Transcript string  `json:"transcript"`
			Confidence float64 `json:"confidence"`
		} `json:"utterances"`
	} `json:"results"`
}

var httpClient = &http.Client{Timeout: 10 * time.Minute}

// Transcribe runs one file through Deepgram. model defaults to nova-3;
// language defaults to "multi", which lets Nova-3 handle code-switching
// mid-sentence — conversations here mix English with another language.
func Transcribe(ctx context.Context, audioURL, recordingID, apiKey, model, language string) (*types.Transcript, error) {
	if model == "" {
		model = "nova-3"
	}
	if language == "" {
		language = "multi"
	}

	params := url.Values{
		"model":        {model},
		"language":     {language},
		"diarize":      {"true"},
		"utterances":   {"true"},
		"punctuate":    {"true"},
		"smart_format": {"true"},
		// The pendant records 16 kHz mono at 32 kbps; filler words are noise
		// at that bitrate and make summaries worse.
		"filler_words": {"false"},
	}

	body, err := json.Marshal(map[string]string{"url": audioURL})
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint+"?"+params.Encode(), bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Token "+apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := httpClient.Do(req)
	if err != nil {
		// Network failures are transient by definition here.
		return nil, &Error{Message: fmt.Sprintf("deepgram request: %v", err), Retryable: true}
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		detail, _ := io.ReadAll(io.LimitReader(resp.Body, 500))
		// 429 and 5xx are worth another attempt; a 400 means this file will
		// never transcribe and retrying just burns the queue.
		retryable := resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= 500
		return nil, &Error{
			Message:   fmt.Sprintf("deepgram %d: %s", resp.StatusCode, detail),
			Retryable: retryable,
		}
	}

	var payload dgResponse
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, &Error{Message: fmt.Sprintf("deepgram response decode: %v", err), Retryable: true}
	}

	utterances := make([]types.Utterance, 0, len(payload.Results.Utterances))
	for _, u := range payload.Results.Utterances {
		text := strings.TrimSpace(u.Transcript)
		if text == "" {
			continue
		}
		utterances = append(utterances, types.Utterance{
			Speaker: u.Speaker, Start: u.Start, End: u.End,
			Text: text, Confidence: u.Confidence,
		})
	}

	lang := language
	text := ""
	if len(payload.Results.Channels) > 0 && len(payload.Results.Channels[0].Alternatives) > 0 {
		alt := payload.Results.Channels[0].Alternatives[0]
		if len(alt.Languages) > 0 {
			lang = alt.Languages[0]
		}
		text = strings.TrimSpace(alt.Transcript)
	}
	// Prefer stitching the utterances: it matches what the user sees, whereas
	// the channel transcript is the undiarized run-on version.
	if len(utterances) > 0 {
		parts := make([]string, len(utterances))
		for i, u := range utterances {
			parts[i] = u.Text
		}
		text = strings.Join(parts, " ")
	}

	modelName := model
	if len(payload.Metadata.Models) > 0 {
		modelName = payload.Metadata.Models[0]
	}

	return &types.Transcript{
		RecordingID:     recordingID,
		Language:        lang,
		Text:            text,
		Utterances:      utterances,
		Model:           modelName,
		DurationSeconds: payload.Metadata.Duration,
	}, nil
}

// SpeakerCount is the number of distinct speaker indices the diarizer found.
func SpeakerCount(t *types.Transcript) int {
	seen := map[int]bool{}
	for _, u := range t.Utterances {
		seen[u.Speaker] = true
	}
	return len(seen)
}

// AsDialogue renders the diarized text in the form models read best, with the
// diarizer's anonymous speaker indices.
func AsDialogue(t *types.Transcript, maxBytes int) string {
	return AsDialogueWith(t, nil, maxBytes)
}

// DefaultDialogueBytes is the budget AsDialogue uses when the caller names none.
const DefaultDialogueBytes = 120_000

// AsDialogueWith renders the dialogue with the speakers the user has named.
//
// `speakers` maps a diarizer index, as a decimal string, to the name the user
// gave it — the same shape the recording row stores. An index with no name
// keeps "Speaker N", so a half-labelled conversation reads as half-labelled
// rather than losing the labels it has. This is what makes re-ingesting after
// a relabel worth doing at all: GitLoom cannot update a memory, so the only
// way a name reaches it is by sending the conversation again with the name
// already in it.
//
// The budget is in BYTES, not characters, because bytes are what the
// receiving end measures: GitLoom caps one ingestion at 256 KB, and an hour of
// Devanagari is three bytes to the character. A cap counted in characters is a
// cap that passes locally and 413s in Mumbai.
//
// Long conversations are trimmed from the middle — the opening and the close
// carry the topic and the decisions, the middle is elaboration — and both cut
// edges are pulled back to a rune boundary, so a trim never sends half a
// character.
func AsDialogueWith(t *types.Transcript, speakers map[string]string, maxBytes int) string {
	if maxBytes <= 0 {
		maxBytes = DefaultDialogueBytes
	}
	lines := make([]string, len(t.Utterances))
	for i, u := range t.Utterances {
		lines[i] = SpeakerLabel(u.Speaker, speakers) + ": " + u.Text
	}
	joined := strings.Join(lines, "\n")
	if len(joined) <= maxBytes {
		return joined
	}
	half := maxBytes / 2
	return trimToRuneEnd(joined[:half]) +
		"\n\n[... middle of the conversation omitted for length ...]\n\n" +
		trimToRuneStart(joined[len(joined)-half:])
}

// SpeakerLabel is what one diarized speaker is called: the name the user gave
// that index, or the anonymous label the diarizer assigned.
func SpeakerLabel(speaker int, speakers map[string]string) string {
	if name, ok := speakers[strconv.Itoa(speaker)]; ok {
		if name = strings.TrimSpace(name); name != "" {
			return name
		}
	}
	return fmt.Sprintf("Speaker %d", speaker)
}

// trimToRuneEnd drops the partial rune a byte-length cut can leave at the end.
func trimToRuneEnd(s string) string {
	for len(s) > 0 {
		r, size := utf8.DecodeLastRuneInString(s)
		if r != utf8.RuneError || size > 1 {
			break
		}
		s = s[:len(s)-1]
	}
	return s
}

// trimToRuneStart drops the continuation bytes a byte-length cut can leave at
// the start.
func trimToRuneStart(s string) string {
	for len(s) > 0 && !utf8.RuneStart(s[0]) {
		s = s[1:]
	}
	return s
}
