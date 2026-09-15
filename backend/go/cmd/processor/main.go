// Ingest pipeline: S3 upload -> SQS -> transcribe -> memory -> DynamoDB -> extractQueue.
//
// SQS delivers at least once, so every step is written to be safe to repeat.
// Failures split into retryable (returned as batch item failures, so SQS
// redelivers and eventually parks the message on the DLQ) and permanent
// (recorded on the row as failed, and acknowledged so the queue does not spin).
//
// The GitLoom ingest deliberately cannot fail the message: by that point
// Deepgram has been paid for the transcript, and a redelivery would pay again.
// A failed ingest records memoryStatus=failed and the API's /retry re-fires it.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/url"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/sqs"

	"github.com/MelloB1989/mr20-pendant/backend/internal/audioclean"
	"github.com/MelloB1989/mr20-pendant/backend/internal/config"
	"github.com/MelloB1989/mr20-pendant/backend/internal/ddb"
	"github.com/MelloB1989/mr20-pendant/backend/internal/deepgram"
	"github.com/MelloB1989/mr20-pendant/backend/internal/gitloomx"
	"github.com/MelloB1989/mr20-pendant/backend/internal/push"
	"github.com/MelloB1989/mr20-pendant/backend/internal/sarvam"
	"github.com/MelloB1989/mr20-pendant/backend/internal/types"
)

// Deepgram needs long enough to fetch the object, not to finish the job.
const audioURLTTL = 30 * time.Minute

var (
	s3Client  *s3.Client
	presign   *s3.PresignClient
	sqsClient *sqs.Client
)

func initAWS(ctx context.Context) error {
	if s3Client != nil {
		return nil
	}
	cfg, err := awsconfig.LoadDefaultConfig(ctx)
	if err != nil {
		return err
	}
	// Checksums only when the operation requires them. The SDK's default
	// integrity protections sign x-amz-checksum-mode into presigned GETs —
	// a header no plain client (Deepgram, the app's player, curl) sends, so
	// every presigned URL answered 403 SignatureDoesNotMatch.
	s3Client = s3.NewFromConfig(cfg, func(o *s3.Options) {
		o.RequestChecksumCalculation = aws.RequestChecksumCalculationWhenRequired
		o.ResponseChecksumValidation = aws.ResponseChecksumValidationWhenRequired
	})
	presign = s3.NewPresignClient(s3Client)
	sqsClient = sqs.NewFromConfig(cfg)
	return ddb.Init(ctx)
}

var keyShape = regexp.MustCompile(`^audio/([^/]+)/([^/]+)\.mp3$`)

// parseKey turns `audio/<userSub>/<recordingId>.mp3` into its parts.
func parseKey(key string) (userID, recordingID string, ok bool) {
	decoded, err := url.QueryUnescape(strings.ReplaceAll(key, "+", " "))
	if err != nil {
		return "", "", false
	}
	m := keyShape.FindStringSubmatch(decoded)
	if m == nil {
		return "", "", false
	}
	return m[1], m[2], true
}

// cleanKeyFor is where a recording's enhanced audio lives. Deterministic, so
// a reprocess (grown file, retry) overwrites rather than orphans.
func cleanKeyFor(userID, recordingID string) string {
	return "clean/" + userID + "/" + recordingID + ".mp3"
}

// alreadyProcessed reports whether ProcessorFn's own work is done for this
// recording, so a redelivered ingestQueue message never repeats ASR — not
// even onto a transcript an agent may already be extracting from.
func alreadyProcessed(status types.RecordingStatus) bool {
	switch status {
	case types.StatusTranscribed, types.StatusReady, types.StatusArchived:
		return true
	default:
		return false
	}
}

func extractQueueURL() string { return os.Getenv("EXTRACT_QUEUE_URL") }

// errEnhancementOff is the sentinel for a deliberately skipped enhancement
// pass, so processObject logs it as a choice rather than a failure.
var errEnhancementOff = errors.New("enhancement disabled by AUDIO_ENHANCE=off")

// enhancementEnabled reads the AUDIO_ENHANCE switch: anything but "off"
// (case-insensitive) keeps the denoise-and-cut pass on, its default.
func enhancementEnabled() bool {
	return !strings.EqualFold(strings.TrimSpace(os.Getenv("AUDIO_ENHANCE")), "off")
}

// enqueueExtraction hands a transcribed recording to ExtractFn.
func enqueueExtraction(ctx context.Context, req types.ExtractionRequest) error {
	body, err := json.Marshal(req)
	if err != nil {
		return err
	}
	_, err = sqsClient.SendMessage(ctx, &sqs.SendMessageInput{
		QueueUrl: aws.String(extractQueueURL()), MessageBody: aws.String(string(body)),
	})
	return err
}

// commitTranscription hands the recording to ExtractFn before marking it
// transcribed, in that order deliberately. If enqueue fails, this returns
// before markTranscribed ever runs, so the row is left behind
// alreadyProcessed and a redelivered ingestQueue message retries the whole
// step — enqueue included. The reverse order is a trap: once the row reads
// StatusTranscribed, alreadyProcessed swallows the redelivery that was
// supposed to retry the failed enqueue, acknowledging the message with the
// extraction handoff never sent, and retryBlockedBy (internal/api) refuses a
// manual retry from that status — the recording is stuck forever, silently.
// A duplicate extractQueue message from a retried enqueue after a prior
// success is a safe no-op: ExtractFn's already_extracted check (68f1c8f)
// short-circuits a second extraction of the same recording.
func commitTranscription(enqueue, markTranscribed func() error) error {
	if err := enqueue(); err != nil {
		return err
	}
	return markTranscribed()
}

// archive parks a no-speech recording: the object moves under archived/, where
// a lifecycle rule expires it after 30 days, and the row keeps the new key so
// playback works until then.
func archive(ctx context.Context, rec *types.Recording, sizeBytes int64) error {
	archivedKey := "archived/" + rec.UserID + "/" + rec.RecordingID + ".mp3"
	bucket := os.Getenv("AUDIO_BUCKET")

	if _, err := s3Client.CopyObject(ctx, &s3.CopyObjectInput{
		Bucket:     &bucket,
		CopySource: aws.String(bucket + "/" + rec.AudioKey),
		Key:        &archivedKey,
	}); err != nil {
		return fmt.Errorf("archive copy: %w", err)
	}
	if _, err := s3Client.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: &bucket, Key: &rec.AudioKey,
	}); err != nil {
		// The copy landed; a stray original is a cost bug, not a data bug.
		log.Printf("archive delete failed key=%s err=%v", rec.AudioKey, err)
	}
	// A no-speech recording keeps no enhanced version — whether from this
	// pass or from a previous life of the same (since grown) device file.
	// Deleting a key that never existed is a no-op.
	cleanKey := cleanKeyFor(rec.UserID, rec.RecordingID)
	if _, err := s3Client.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: &bucket, Key: &cleanKey,
	}); err != nil {
		log.Printf("archive clean delete failed key=%s err=%v", cleanKey, err)
	}

	patch := map[string]any{
		"status":       types.StatusArchived,
		"memoryStatus": types.MemorySkipped,
		"audioKey":     archivedKey,
		"cleanKey":     "",
		"title":        "No speech detected",
		"error":        "",
	}
	if sizeBytes > 0 {
		patch["sizeBytes"] = sizeBytes
	}
	return ddb.UpdateRecording(ctx, rec.UserID, rec.StartedAt, rec.RecordingID, patch)
}

// ingestOnce runs the whole-dialogue GitLoom ingest, but only when rec does
// not already carry an outcome for it. A redelivered ingestQueue message
// reaches processObject with a fresh GetRecordingByID read, so if an
// earlier attempt got far enough to persist memoryStatus (the interim write
// right after this call returns, in processObject) before something later
// failed — the SendMessage inside commitTranscription, say — this guard is
// what stops the retry from re-sending the whole dialogue: GitLoom has no
// delete and no supersede at the pinned SDK version, so a second ingest is
// a permanent duplicate, not merely wasted work.
func ingestOnce(
	ctx context.Context, rec *types.Recording, transcript *types.Transcript,
	ingest func(ctx context.Context, userID, recordingID, startedAt string, t *types.Transcript, speakers map[string]string) (string, error),
) (types.MemoryStatus, string) {
	if rec.MemoryStatus == types.MemoryIngested || rec.MemoryStatus == types.MemoryFailed {
		log.Printf("gitloom ingest already attempted, not resending recordingId=%s status=%s", rec.RecordingID, rec.MemoryStatus)
		return rec.MemoryStatus, ""
	}
	dialogue, err := ingest(ctx, rec.UserID, rec.RecordingID, rec.StartedAt, transcript, rec.Speakers)
	if err != nil {
		log.Printf("gitloom ingest failed recordingId=%s err=%v", rec.RecordingID, err)
		return types.MemoryFailed, ""
	}
	return types.MemoryIngested, dialogue
}

func processObject(ctx context.Context, key string, sizeBytes int64) error {
	userID, recordingID, ok := parseKey(key)
	if !ok {
		log.Printf("ignoring object with unexpected key shape key=%s", key)
		return nil
	}

	rec, err := ddb.GetRecordingByID(ctx, recordingID)
	if err != nil {
		return err
	}
	if rec == nil {
		log.Printf("no recording row for uploaded object key=%s", key)
		return nil
	}
	if rec.UserID != userID {
		// The presigned URL is scoped to one prefix, so this should be impossible.
		log.Printf("object path does not match the row owner key=%s", key)
		return nil
	}
	if alreadyProcessed(rec.Status) {
		log.Printf("already processed, skipping redelivery recordingId=%s status=%s", recordingID, rec.Status)
		return nil
	}

	if err := ddb.UpdateRecording(ctx, userID, rec.StartedAt, recordingID,
		map[string]any{"status": types.StatusProcessing, "error": ""}); err != nil {
		return err
	}

	bucket := os.Getenv("AUDIO_BUCKET")

	// Enhance before transcribing: DeepFilterNet strips the noise, then the
	// silent stretches are cut. The result is stored as its own object — it
	// is what the app plays and what Deepgram hears, so transcript timestamps
	// line up with the audio and Deepgram never bills for dead air. This is
	// strictly best-effort: any failure falls back to the untouched original,
	// because enhancement must never cost a transcript.
	//
	// AUDIO_ENHANCE=off skips the pass entirely — the engines hear the
	// original and the app plays it — for A/B-ing transcript quality against
	// the enhancement without a redeploy of the binaries. Timestamps stay
	// consistent either way: whatever the engines heard is what is played.
	cleanKey := ""
	obj, err := s3Client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: &bucket, Key: &rec.AudioKey,
	})
	if err != nil {
		return err
	}
	original, err := io.ReadAll(obj.Body)
	obj.Body.Close()
	if err != nil {
		return err
	}

	var cleaned *audioclean.Result
	cleanErr := errEnhancementOff
	if enhancementEnabled() {
		cleaned, cleanErr = audioclean.Clean(ctx, original)
	}
	switch {
	case cleanErr == errEnhancementOff:
		log.Printf("enhancement off, transcribing the original recordingId=%s", recordingID)
	case cleanErr != nil:
		log.Printf("enhancement failed, transcribing the original recordingId=%s err=%v",
			recordingID, cleanErr)
	case cleaned.NoSpeech:
		// The detector heard nothing worth keeping; skip Deepgram entirely.
		log.Printf("no speech after enhancement recordingId=%s originalSeconds=%.1f",
			recordingID, cleaned.OriginalSeconds)
		return archive(ctx, rec, sizeBytes)
	default:
		cleanKey = cleanKeyFor(userID, recordingID)
		if _, err := s3Client.PutObject(ctx, &s3.PutObjectInput{
			Bucket: &bucket, Key: &cleanKey,
			Body: bytes.NewReader(cleaned.Mp3), ContentType: aws.String("audio/mpeg"),
		}); err != nil {
			return err
		}
		log.Printf("enhanced recordingId=%s originalSeconds=%.1f speechSeconds=%.1f",
			recordingID, cleaned.OriginalSeconds, cleaned.SpeechSeconds)
	}

	transcribeKey := rec.AudioKey
	transcribeBytes := original
	if cleanKey != "" {
		transcribeKey = cleanKey
		transcribeBytes = cleaned.Mp3
	}
	signed, err := presign.PresignGetObject(ctx, &s3.GetObjectInput{
		Bucket: &bucket, Key: &transcribeKey,
	}, s3.WithPresignExpires(audioURLTTL))
	if err != nil {
		return err
	}

	apiKey, err := config.DeepgramAPIKey(ctx)
	if err != nil {
		return err
	}

	// Two engines hear the same audio in parallel. Deepgram is required — it
	// carries the diarization and timestamps everything downstream is built
	// on. Sarvam (strong on Indian languages and code-switching) is a second
	// opinion on the words alone, and strictly best-effort.
	var (
		sarvamText string
		sarvamErr  error
		sarvamWG   sync.WaitGroup
	)
	sarvamWG.Add(1)
	go func() {
		defer sarvamWG.Done()
		key, err := config.SarvamAPIKey(ctx)
		if err != nil {
			sarvamErr = err
			return
		}
		sarvamText, sarvamErr = sarvam.Transcribe(ctx, transcribeBytes, key)
	}()

	transcript, err := deepgram.Transcribe(ctx, signed.URL, recordingID, apiKey,
		os.Getenv("DEEPGRAM_MODEL"), os.Getenv("DEEPGRAM_LANGUAGE"))
	sarvamWG.Wait()
	if err != nil {
		return err
	}

	// The correction pass moved out of this Lambda entirely — ExtractFn runs
	// it now, or ApplyFn's Bedrock fallback does — but the second engine's
	// reading is decided here, while Sarvam's response is still in hand, and
	// travels with the transcript as data instead of costing a second round
	// trip later.
	if sarvamErr != nil {
		log.Printf("sarvam unavailable, extraction will see one engine only recordingId=%s err=%v",
			recordingID, sarvamErr)
	} else if strings.TrimSpace(transcript.Text) != "" {
		transcript.AltText = sarvamText
	}

	// Nothing was said: diarization returns no utterances for silence or noise.
	if strings.TrimSpace(transcript.Text) == "" {
		return archive(ctx, rec, sizeBytes)
	}

	transcriptKey := "transcripts/" + userID + "/" + recordingID + ".json"
	body, err := json.Marshal(transcript)
	if err != nil {
		return err
	}
	if _, err := s3Client.PutObject(ctx, &s3.PutObjectInput{
		Bucket: &bucket, Key: &transcriptKey,
		Body: strings.NewReader(string(body)), ContentType: aws.String("application/json"),
	}); err != nil {
		return err
	}

	// The category list travels with the extraction request: ExtractFn has
	// no DynamoDB access, deliberately, so the names it can offer the agent
	// have to be read here, once, rather than queried from the agent's own
	// container. Only names — resolving a chosen name back to an id is
	// ApplyFn's job (enrich.ResolveCategory), same as it already was.
	categories, err := ddb.GetCategories(ctx, userID)
	if err != nil {
		log.Printf("categories read failed, extraction will offer none recordingId=%s err=%v", recordingID, err)
		categories = nil
	}
	categoryNames := make([]string, len(categories))
	for i, cat := range categories {
		categoryNames[i] = cat.Name
	}

	// GitLoom's own extraction reads the transcript alone and needs nothing
	// the agent produces next — best-effort by design, matching what this
	// call always was: a paid-for transcript must never turn into a retried
	// SQS message over a GitLoom outage. ingestOnce's own guard is what
	// keeps that send from running twice on the same recording — see its
	// doc comment and the interim write just below.
	memoryStatus, dialogue := ingestOnce(ctx, rec, transcript, gitloomx.IngestWithRetry)

	memoryVersion, memoryKey := rec.MemoryIngestVersion, rec.MemoryDialogueKey
	if dialogue != "" {
		memoryVersion = 1
		memoryKey = memoryDialogueKey(userID, recordingID, memoryVersion)
		if _, err := s3Client.PutObject(ctx, &s3.PutObjectInput{
			Bucket: &bucket, Key: &memoryKey,
			Body:        strings.NewReader(dialogue),
			ContentType: aws.String("text/plain; charset=utf-8"),
		}); err != nil {
			log.Printf("memory dialogue store failed recordingId=%s err=%v", recordingID, err)
			memoryVersion, memoryKey = 0, ""
		}
	}

	if memoryStatus != rec.MemoryStatus {
		// Bound the window: persist the outcome — and, when the dialogue
		// upload above succeeded, the key that points at it — in its own
		// write, immediately, while status is still StatusProcessing.
		// Everything below this line can still fail and cause a
		// redelivery (the SendMessage inside commitTranscription,
		// chiefly); an unguarded window here used to mean that failure
		// re-ran this whole function from the top, including a second
		// whole-dialogue GitLoom ingest — permanently duplicated, since
		// GitLoom has no delete or supersede at the pinned SDK version.
		// With this write landed, the next attempt's fresh
		// GetRecordingByID read sees the outcome on rec.MemoryStatus, and
		// ingestOnce's own guard stops it from resending.
		interim := map[string]any{"memoryStatus": memoryStatus}
		if memoryVersion > 0 {
			interim["memoryIngestVersion"] = memoryVersion
			interim["memoryDialogueKey"] = memoryKey
			interim["memorySpeakers"] = rec.Speakers
		}
		if err := ddb.UpdateRecording(ctx, userID, rec.StartedAt, recordingID, interim); err != nil {
			log.Printf("memoryStatus interim write failed recordingId=%s err=%v", recordingID, err)
		}
	}

	patch := map[string]any{
		"status":        types.StatusTranscribed,
		"cleanKey":      cleanKey,
		"transcriptKey": transcriptKey,
		"speakerCount":  deepgram.SpeakerCount(transcript),
		"memoryStatus":  memoryStatus,
		"error":         "",
	}
	if memoryVersion > 0 {
		patch["memoryIngestVersion"] = memoryVersion
		patch["memoryDialogueKey"] = memoryKey
		patch["memorySpeakers"] = rec.Speakers
	}
	if transcript.DurationSeconds > 0 {
		patch["durationSeconds"] = transcript.DurationSeconds
	}
	if sizeBytes > 0 {
		patch["sizeBytes"] = sizeBytes
	}
	extractionReq := types.ExtractionRequest{
		UserID: userID, RecordingID: recordingID, StartedAt: rec.StartedAt,
		TranscriptKey: transcriptKey, Speakers: rec.Speakers, Categories: categoryNames,
	}
	if err := commitTranscription(
		func() error { return enqueueExtraction(ctx, extractionReq) },
		func() error { return ddb.UpdateRecording(ctx, userID, rec.StartedAt, recordingID, patch) },
	); err != nil {
		return err
	}

	log.Printf("transcribed recordingId=%s seconds=%d speakers=%d utterances=%d memory=%s",
		recordingID, int(transcript.DurationSeconds), deepgram.SpeakerCount(transcript),
		len(transcript.Utterances), memoryStatus)

	return nil
}

// memoryDialogueKey is where the exact text one ingestion sent is kept.
// Versioned, because a speaker relabel sends the conversation again and both
// sends have to remain readable — v1 is what the anonymous memories were built
// from, v2 what the named ones were.
func memoryDialogueKey(userID, recordingID string, version int) string {
	return fmt.Sprintf("memory/%s/%s.v%d.txt", userID, recordingID, version)
}

// pushTokens reads the user's installations, or none if they cannot be read.
func pushTokens(ctx context.Context, userID string) []string {
	rows, err := ddb.ListPushTokens(ctx, userID)
	if err != nil {
		log.Printf("push: could not read tokens userId=%s err=%v", userID, err)
		return nil
	}
	tokens := make([]string, 0, len(rows))
	for _, row := range rows {
		tokens = append(tokens, row.Token)
	}
	return tokens
}

// deliver sends and forgets the installations Expo says are gone.
func deliver(ctx context.Context, userID string, messages []push.Message) {
	if len(messages) == 0 {
		return
	}
	dead, err := push.Send(ctx, messages)
	if err != nil {
		log.Printf("push: send failed userId=%s err=%v", userID, err)
	}
	// Expo has confirmed these installations are gone; keep the table honest.
	for _, token := range dead {
		if err := ddb.DeletePushToken(ctx, userID, token); err != nil {
			log.Printf("push: could not forget stale token err=%v", err)
		}
	}
}

// notifyFailed says so when a recording will not be arriving. Silence here is
// what makes a user think the pendant is broken.
func notifyFailed(ctx context.Context, userID, recordingID, reason string) {
	tokens := pushTokens(ctx, userID)
	if len(tokens) == 0 {
		return
	}
	deliver(ctx, userID, push.RecordingFailed(tokens, recordingID, reason))
}

// markFailed records a permanent failure on the row so the app can show why.
func markFailed(ctx context.Context, key, reason string) {
	_, recordingID, ok := parseKey(key)
	if !ok {
		return
	}
	rec, err := ddb.GetRecordingByID(ctx, recordingID)
	if err != nil || rec == nil {
		return
	}
	if len(reason) > 500 {
		reason = reason[:500]
	}
	if err := ddb.UpdateRecording(ctx, rec.UserID, rec.StartedAt, rec.RecordingID,
		map[string]any{"status": types.StatusFailed, "error": reason}); err != nil {
		log.Printf("markFailed failed: %v", err)
		return
	}
	notifyFailed(ctx, rec.UserID, rec.RecordingID, reason)
}

type s3Notification struct {
	Event   string `json:"Event"`
	Records []struct {
		S3 struct {
			Object struct {
				Key  string `json:"key"`
				Size int64  `json:"size"`
			} `json:"object"`
		} `json:"s3"`
	} `json:"Records"`
}

func handle(ctx context.Context, event events.SQSEvent) (events.SQSEventResponse, error) {
	if err := initAWS(ctx); err != nil {
		return events.SQSEventResponse{}, err
	}

	var failures []events.SQSBatchItemFailure
	for _, record := range event.Records {
		var payload s3Notification
		if err := json.Unmarshal([]byte(record.Body), &payload); err != nil {
			log.Printf("unparseable message id=%s err=%v", record.MessageId, err)
			continue // acknowledged: redelivery cannot fix a bad payload
		}
		// S3 posts a test event when the notification is first configured.
		if payload.Event == "s3:TestEvent" || len(payload.Records) == 0 {
			continue
		}

		for _, s3Record := range payload.Records {
			key := s3Record.S3.Object.Key
			if key == "" {
				continue
			}
			err := processObject(ctx, key, s3Record.S3.Object.Size)
			if err == nil {
				continue
			}

			var dgErr *deepgram.Error
			if errors.As(err, &dgErr) && !dgErr.Retryable {
				log.Printf("permanent failure, not retrying key=%s err=%v", key, err)
				markFailed(ctx, key, dgErr.Message)
				continue // acknowledged: retrying would fail identically
			}

			log.Printf("retryable failure key=%s err=%v", key, err)
			failures = append(failures, events.SQSBatchItemFailure{ItemIdentifier: record.MessageId})
			break
		}
	}
	return events.SQSEventResponse{BatchItemFailures: failures}, nil
}

func main() { lambda.Start(handle) }
