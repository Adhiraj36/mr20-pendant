// Drains the dead-letter queues so a recording that exhausted its retries —
// in ProcessorFn or in ApplyFn — shows as failed in the app instead of
// sitting stuck forever.
package main

import (
	"context"
	"encoding/json"
	"log"
	"net/url"
	"os"
	"regexp"
	"strings"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"

	"github.com/MelloB1989/mr20-pendant/backend/internal/ddb"
	"github.com/MelloB1989/mr20-pendant/backend/internal/types"
)

var keyShape = regexp.MustCompile(`^audio/[^/]+/([^/]+)\.mp3$`)

// fail marks one recording failed, sharing the message both DLQs end in.
func fail(ctx context.Context, recordingID, reason string) {
	rec, err := ddb.GetRecordingByID(ctx, recordingID)
	if err != nil || rec == nil || rec.Status == types.StatusReady {
		return
	}
	if err := ddb.UpdateRecording(ctx, rec.UserID, rec.StartedAt, rec.RecordingID, map[string]any{
		"status": types.StatusFailed, "error": reason,
	}); err != nil {
		log.Printf("could not mark failed recordingId=%s err=%v", rec.RecordingID, err)
		return
	}
	log.Printf("marked failed from DLQ recordingId=%s", rec.RecordingID)
}

func handleIngestDlq(ctx context.Context, body string) {
	var payload struct {
		Records []struct {
			S3 struct {
				Object struct {
					Key string `json:"key"`
				} `json:"object"`
			} `json:"s3"`
		} `json:"Records"`
	}
	if err := json.Unmarshal([]byte(body), &payload); err != nil {
		log.Printf("could not reap ingest DLQ message err=%v", err)
		return
	}
	for _, s3Record := range payload.Records {
		decoded, err := url.QueryUnescape(strings.ReplaceAll(s3Record.S3.Object.Key, "+", " "))
		if err != nil {
			continue
		}
		m := keyShape.FindStringSubmatch(decoded)
		if m == nil {
			continue
		}
		fail(ctx, m[1], "transcription failed repeatedly; the audio is safe and can be retried")
	}
}

func handleApplyDlq(ctx context.Context, body string) {
	var req types.ExtractionRequest
	if err := json.Unmarshal([]byte(body), &req); err != nil || req.RecordingID == "" {
		log.Printf("could not reap apply DLQ message err=%v", err)
		return
	}
	fail(ctx, req.RecordingID, "extraction and its fallback both failed repeatedly; the transcript is safe and can be retried")
}

func handle(ctx context.Context, event events.SQSEvent) error {
	if err := ddb.Init(ctx); err != nil {
		return err
	}
	applyDlqARN := os.Getenv("APPLY_DLQ_ARN")
	for _, record := range event.Records {
		if applyDlqARN != "" && record.EventSourceARN == applyDlqARN {
			handleApplyDlq(ctx, record.Body)
			continue
		}
		handleIngestDlq(ctx, record.Body)
	}
	return nil
}

func main() { lambda.Start(handle) }
