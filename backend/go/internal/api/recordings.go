// Recording routes.
//
//	POST   /recordings                    register a device file, get an upload URL
//	POST   /recordings/:id/uploaded       confirm the S3 PUT finished
//	GET    /recordings                    list, newest first
//	GET    /recordings/:id                detail, transcript inlined
//	GET    /recordings/:id/audio          presigned playback URL
//	PATCH  /recordings/:id                rename speakers (re-files memory) / title / category
//	POST   /recordings/:id/retry          re-run transcription, or re-fire the memory ingest
//	DELETE /recordings/:id                tombstone it, then remove row and objects
package api

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/sqs"
	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"

	"github.com/MelloB1989/mr20-pendant/backend/internal/authjwt"
	"github.com/MelloB1989/mr20-pendant/backend/internal/ddb"
	"github.com/MelloB1989/mr20-pendant/backend/internal/gitloomx"
	"github.com/MelloB1989/mr20-pendant/backend/internal/types"
)

const (
	uploadURLTTL   = time.Hour // BLE pulls are slow and may be queued
	playbackURLTTL = 6 * time.Hour
)

var (
	s3Client  *s3.Client
	presign   *s3.PresignClient
	sqsClient *sqs.Client
)

// retryRecording's own store calls, indirected the way daemons.go's var
// block is — so the two-leg retry (I3) can be exercised with no AWS account
// and no GitLoom call, and its ordering pinned by a test rather than trusted
// on read-through.
var (
	ddbUpdateRecording       = ddb.UpdateRecording
	gitloomxIngestTranscript = gitloomx.IngestTranscript
	gitloomxRememberFacts    = gitloomx.RememberFacts
)

// InitAWS dials the shared AWS clients once per container.
func InitAWS(ctx context.Context) error {
	if s3Client != nil {
		return nil
	}
	cfg, err := awsconfig.LoadDefaultConfig(ctx)
	if err != nil {
		return fmt.Errorf("aws config: %w", err)
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
	return nil
}

func bucket() string   { return os.Getenv("AUDIO_BUCKET") }
func queueURL() string { return os.Getenv("INGEST_QUEUE_URL") }

func audioKey(userSub, id string) string { return "audio/" + userSub + "/" + id + ".mp3" }

func registerRecordingRoutes(app fiber.Router) {
	app.Post("/recordings", registerRecording)
	app.Get("/recordings", listRecordings)
	app.Post("/recordings/:id/uploaded", confirmUpload)
	app.Get("/recordings/:id", recordingDetail)
	app.Get("/recordings/:id/audio", recordingAudio)
	app.Patch("/recordings/:id", patchRecording)
	app.Post("/recordings/:id/retry", retryRecording)
	app.Delete("/recordings/:id", deleteRecording)
}

// The pendant names files from its own clock as "YYYY-MM-DD HH-MM-SS", with no
// timezone. The app normally sends startedAt resolved against the phone's own
// timezone, which is the better guess; this is the fallback, resolving against
// UTC. A garbled name yields "" rather than a plausible wrong timestamp.
var deviceFileName = regexp.MustCompile(`^(\d{4})-(\d{2})-(\d{2})[ _](\d{2})-(\d{2})-(\d{2})`)

func parseDeviceFileName(name string) string {
	m := deviceFileName.FindStringSubmatch(name)
	if m == nil {
		return ""
	}
	t, err := time.Parse(time.RFC3339,
		fmt.Sprintf("%s-%s-%sT%s:%s:%sZ", m[1], m[2], m[3], m[4], m[5], m[6]))
	if err != nil {
		return ""
	}
	return t.UTC().Format(time.RFC3339)
}

func registerRecording(c *fiber.Ctx) error {
	user := authjwt.Sub(c)
	var input struct {
		DeviceFolder    string  `json:"deviceFolder"`
		DeviceFile      string  `json:"deviceFile"`
		DeviceMac       string  `json:"deviceMac"`
		StartedAt       string  `json:"startedAt"`
		DurationSeconds float64 `json:"durationSeconds"`
		SizeBytes       int64   `json:"sizeBytes"`
	}
	if err := c.BodyParser(&input); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "request body must be JSON")
	}
	if strings.TrimSpace(input.DeviceFolder) == "" || strings.TrimSpace(input.DeviceFile) == "" {
		return fiber.NewError(fiber.StatusBadRequest, "deviceFolder and deviceFile are required")
	}

	// The app dedupes locally, but a reinstall wipes its manifest. Returning
	// the existing row keeps a re-synced pendant from uploading everything twice.
	existing, err := ddb.FindByDeviceFile(c.Context(), user, input.DeviceFolder, input.DeviceFile)
	if err != nil {
		return err
	}
	if existing != nil && existing.Status != types.StatusPending {
		// Same device file, more bytes: the pendant grew the recording after
		// we captured it — a sync pass mid-recording closes the file, and the
		// device appends to it when recording resumes. That is a replacement,
		// not a duplicate: without this branch the truncated version was kept
		// forever and the growth silently never synced.
		if input.SizeBytes > existing.SizeBytes {
			patch := map[string]any{
				"status":       types.StatusPending,
				"sizeBytes":    input.SizeBytes,
				"memoryStatus": "",
				"error":        "",
			}
			if input.DurationSeconds > 0 {
				patch["durationSeconds"] = input.DurationSeconds
			}
			// An archived recording's object lives under archived/, where the
			// S3 notification does not fire — a grown file must upload back to
			// the audio/ key or its reprocessing would never trigger.
			if key := audioKey(user, existing.RecordingID); existing.AudioKey != key {
				patch["audioKey"] = key
				existing.AudioKey = key
			}
			if err := ddb.UpdateRecording(c.Context(), user, existing.StartedAt, existing.RecordingID, patch); err != nil {
				return err
			}
			existing.Status = types.StatusPending
			existing.SizeBytes = input.SizeBytes
			rec := existing
			req, err := presign.PresignPutObject(c.Context(), &s3.PutObjectInput{
				Bucket:      aws.String(bucket()),
				Key:         aws.String(rec.AudioKey),
				ContentType: aws.String("audio/mpeg"),
			}, s3.WithPresignExpires(uploadURLTTL))
			if err != nil {
				return err
			}
			return c.Status(fiber.StatusCreated).JSON(fiber.Map{
				"recording": rec, "uploadUrl": req.URL, "alreadyHave": false,
			})
		}
		return c.JSON(fiber.Map{"recording": existing, "uploadUrl": nil, "alreadyHave": true})
	}

	rec := existing
	if rec == nil {
		startedAt := ""
		if t, err := time.Parse(time.RFC3339, input.StartedAt); err == nil {
			startedAt = t.UTC().Format(time.RFC3339)
		}
		if startedAt == "" {
			startedAt = parseDeviceFileName(input.DeviceFile)
		}
		if startedAt == "" {
			startedAt = nowISO()
		}

		id := uuid.NewString()
		rec = &types.Recording{
			RecordingID:     id,
			UserID:          user,
			Status:          types.StatusPending,
			DeviceFolder:    input.DeviceFolder,
			DeviceFile:      input.DeviceFile,
			DeviceMac:       strings.ToLower(input.DeviceMac),
			StartedAt:       startedAt,
			DurationSeconds: input.DurationSeconds,
			SizeBytes:       input.SizeBytes,
			AudioKey:        audioKey(user, id),
			CreatedAt:       nowISO(),
			UpdatedAt:       nowISO(),
		}
		if err := ddb.PutRecording(c.Context(), *rec); err != nil {
			return err
		}
	}

	// No metadata on the presigned PUT: unlike the JS SDK, the Go presigner
	// signs metadata as REQUIRED HEADERS the client would have to send, and
	// the app sends only content-type — every upload since the Go port failed
	// signature validation because of exactly this. The processor never reads
	// object metadata anyway; it parses user and recording id from the key.
	req, err := presign.PresignPutObject(c.Context(), &s3.PutObjectInput{
		Bucket:      aws.String(bucket()),
		Key:         aws.String(rec.AudioKey),
		ContentType: aws.String("audio/mpeg"),
	}, s3.WithPresignExpires(uploadURLTTL))
	if err != nil {
		return err
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{
		"recording": rec, "uploadUrl": req.URL, "alreadyHave": false,
	})
}

func confirmUpload(c *fiber.Ctx) error {
	user := authjwt.Sub(c)
	rec, err := ddb.GetRecording(c.Context(), user, c.Params("id"))
	if err != nil {
		return err
	}
	if rec == nil {
		return fiber.NewError(fiber.StatusNotFound, "no such recording")
	}

	// S3 -> SQS is what actually starts processing; this only moves the UI off
	// "pending" without waiting for the queue to turn over.
	if rec.Status == types.StatusPending {
		if err := ddb.UpdateRecording(c.Context(), user, rec.StartedAt, rec.RecordingID,
			map[string]any{"status": types.StatusUploaded}); err != nil {
			return err
		}
		rec.Status = types.StatusUploaded
	}
	return c.JSON(rec)
}

func listRecordings(c *fiber.Ctx) error {
	user := authjwt.Sub(c)
	limit := int32(50)
	if v, err := strconv.Atoi(c.Query("limit")); err == nil && v > 0 && v <= 100 {
		limit = int32(v)
	}
	recs, cursor, err := ddb.ListRecordings(c.Context(), user, limit, c.Query("cursor"))
	if err != nil {
		return err
	}
	out := fiber.Map{"recordings": recs}
	if cursor != "" {
		out["cursor"] = cursor
	}
	return c.JSON(out)
}

func recordingDetail(c *fiber.Ctx) error {
	user := authjwt.Sub(c)
	rec, err := ddb.GetRecording(c.Context(), user, c.Params("id"))
	if err != nil {
		return err
	}
	if rec == nil {
		return fiber.NewError(fiber.StatusNotFound, "no such recording")
	}

	var transcript *types.Transcript
	if rec.TranscriptKey != "" {
		// A missing transcript object is a pipeline bug, not a client error;
		// the metadata is still worth returning.
		if t, err := fetchTranscript(c.Context(), rec.TranscriptKey); err == nil {
			transcript = t
		} else {
			log.Printf("transcript fetch failed key=%s err=%v", rec.TranscriptKey, err)
		}
	}
	return c.JSON(fiber.Map{"recording": rec, "transcript": transcript})
}

// fetchTranscript is a var — not just a func — for the same reason as the
// ddb/gitloomx block above: retryRecording's tests replace it rather than
// standing up S3.
var fetchTranscript = fetchTranscriptFromS3

func fetchTranscriptFromS3(ctx context.Context, key string) (*types.Transcript, error) {
	out, err := s3Client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(bucket()), Key: aws.String(key),
	})
	if err != nil {
		return nil, err
	}
	defer out.Body.Close()
	raw, err := io.ReadAll(out.Body)
	if err != nil {
		return nil, err
	}
	var t types.Transcript
	if err := json.Unmarshal(raw, &t); err != nil {
		return nil, err
	}
	return &t, nil
}

// recordingAudio hands out a playback URL. Playback prefers the enhanced
// audio (denoised, silence cut) whenever the pipeline produced one; ?raw=1
// asks for the untouched original instead.
func recordingAudio(c *fiber.Ctx) error {
	user := authjwt.Sub(c)
	rec, err := ddb.GetRecording(c.Context(), user, c.Params("id"))
	if err != nil {
		return err
	}
	if rec == nil || rec.AudioKey == "" {
		return fiber.NewError(fiber.StatusNotFound, "no audio for this recording")
	}

	key, variant := rec.AudioKey, "original"
	if rec.CleanKey != "" && !c.QueryBool("raw") {
		key, variant = rec.CleanKey, "enhanced"
	}
	req, err := presign.PresignGetObject(c.Context(), &s3.GetObjectInput{
		Bucket: aws.String(bucket()), Key: aws.String(key),
	}, s3.WithPresignExpires(playbackURLTTL))
	if err != nil {
		return err
	}
	return c.JSON(fiber.Map{
		"url":       req.URL,
		"expiresIn": int(playbackURLTTL.Seconds()),
		"variant":   variant,
	})
}

func patchRecording(c *fiber.Ctx) error {
	user := authjwt.Sub(c)
	rec, err := ddb.GetRecording(c.Context(), user, c.Params("id"))
	if err != nil {
		return err
	}
	if rec == nil {
		return fiber.NewError(fiber.StatusNotFound, "no such recording")
	}

	var input struct {
		Title      *string            `json:"title"`
		Speakers   *map[string]string `json:"speakers"`
		Tags       *[]string          `json:"tags"`
		CategoryID *string            `json:"categoryId"`
	}
	// Whether memory has to be re-filed. Decided before the write, acted on
	// after it: the names are the user's regardless of what GitLoom does with
	// them.
	relabelled := false
	if err := c.BodyParser(&input); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "request body must be JSON")
	}

	update := map[string]any{}
	if input.Title != nil {
		update["title"] = truncate(*input.Title, 200)
		rec.Title = update["title"].(string)
	}
	if input.Speakers != nil {
		speakers := map[string]string{}
		for index, name := range *input.Speakers {
			if _, err := strconv.Atoi(index); err != nil {
				return fiber.NewError(fiber.StatusBadRequest, "speaker keys must be numbers")
			}
			speakers[index] = truncate(name, 80)
		}
		relabelled = !sameSpeakers(rec.Speakers, speakers)
		update["speakers"] = speakers
		rec.Speakers = speakers
	}
	if input.Tags != nil {
		tags := *input.Tags
		if len(tags) > 20 {
			tags = tags[:20]
		}
		for i := range tags {
			tags[i] = truncate(tags[i], 40)
		}
		update["tags"] = tags
		rec.Tags = tags
	}
	if input.CategoryID != nil {
		// "" clears; anything else must be one of the user's categories, so a
		// stale client cannot write ids that no longer exist.
		if *input.CategoryID != "" {
			categories, err := ddb.GetCategories(c.Context(), user)
			if err != nil {
				return err
			}
			found := false
			for _, cat := range categories {
				if cat.ID == *input.CategoryID {
					found = true
					break
				}
			}
			if !found {
				return fiber.NewError(fiber.StatusBadRequest, "no such category")
			}
		}
		update["categoryId"] = *input.CategoryID
		rec.CategoryID = *input.CategoryID
	}

	if len(update) == 0 {
		return fiber.NewError(fiber.StatusBadRequest, "nothing to update")
	}
	if err := ddb.UpdateRecording(c.Context(), user, rec.StartedAt, rec.RecordingID, update); err != nil {
		return err
	}
	if relabelled {
		reingest(c, user, rec)
	}
	return c.JSON(rec)
}

// sameSpeakers reports whether two speaker maps say the same thing, so
// re-saving an unchanged panel does not re-file a conversation.
func sameSpeakers(a, b map[string]string) bool {
	if len(a) != len(b) {
		return false
	}
	for index, name := range a {
		if b[index] != name {
			return false
		}
	}
	return true
}

// reingest re-files a conversation's memories under the names the user just
// gave its speakers.
//
// This is the only correction GitLoom allows. There is no update-by-id, no
// delete-by-source and no metadata to edit — the sole mutation primitive is
// ingesting more text — so a relabel means sending the same conversation
// again, with "Speaker 1" replaced by "Priya" throughout. Whether that
// supersedes the anonymous memories or sits beside them is not something the
// vendor states, which is why this stores the version and the exact dialogue
// it sent rather than claiming the old ones are gone: the detail screen says
// REMEMBERED · v2, and that is the honest claim ([GL_SUPERSEDE]).
//
// Best-effort and synchronous. A failure records memoryStatus=failed, which
// POST /recordings/:id/retry can re-fire, and never fails the rename — the
// names are the user's edit and they are already saved.
func reingest(c *fiber.Ctx, user string, rec *types.Recording) {
	if rec.TranscriptKey == "" {
		return
	}
	transcript, err := fetchTranscript(c.Context(), rec.TranscriptKey)
	if err != nil {
		log.Printf("re-ingest: transcript unreadable recordingId=%s err=%v", rec.RecordingID, err)
		return
	}

	dialogue, err := gitloomx.IngestTranscript(c.Context(), user, rec.RecordingID, rec.StartedAt, transcript, rec.Speakers)
	if err != nil {
		log.Printf("re-ingest failed recordingId=%s err=%v", rec.RecordingID, err)
		if err := ddb.UpdateRecording(c.Context(), user, rec.StartedAt, rec.RecordingID,
			map[string]any{"memoryStatus": types.MemoryFailed}); err != nil {
			log.Printf("re-ingest: status write failed recordingId=%s err=%v", rec.RecordingID, err)
		}
		rec.MemoryStatus = types.MemoryFailed
		return
	}
	if dialogue == "" {
		// Too little was said to carry a fact; nothing was sent, so nothing
		// was re-filed and the version must not move.
		return
	}

	version := rec.MemoryIngestVersion + 1
	if version < 2 {
		// A conversation ingested before versions were recorded is at v1,
		// whatever its row says.
		version = 2
	}
	key := memoryDialogueKey(user, rec.RecordingID, version)
	if _, err := s3Client.PutObject(c.Context(), &s3.PutObjectInput{
		Bucket: aws.String(bucket()), Key: aws.String(key),
		Body:        strings.NewReader(dialogue),
		ContentType: aws.String("text/plain; charset=utf-8"),
	}); err != nil {
		log.Printf("re-ingest: dialogue store failed recordingId=%s err=%v", rec.RecordingID, err)
		key = ""
	}

	patch := map[string]any{
		"memoryStatus":        types.MemoryIngested,
		"memoryIngestVersion": version,
		"memorySpeakers":      rec.Speakers,
	}
	if key != "" {
		patch["memoryDialogueKey"] = key
	}
	if err := ddb.UpdateRecording(c.Context(), user, rec.StartedAt, rec.RecordingID, patch); err != nil {
		log.Printf("re-ingest: row update failed recordingId=%s err=%v", rec.RecordingID, err)
		return
	}
	rec.MemoryStatus = types.MemoryIngested
	rec.MemoryIngestVersion = version
	rec.MemorySpeakers = rec.Speakers
	if key != "" {
		rec.MemoryDialogueKey = key
	}
}

// memoryDialogueKey is where the exact text of one ingestion is kept. Same
// shape the processor writes, versioned so v1 and v2 both remain readable.
func memoryDialogueKey(userID, recordingID string, version int) string {
	return fmt.Sprintf("memory/%s/%s.v%d.txt", userID, recordingID, version)
}

// truncate caps s at n runes — not n bytes — cutting only on a rune
// boundary, so the result is always valid UTF-8.
//
// A plain s[:n] byte slice can stop mid-codepoint on non-ASCII text (a
// 3-byte Devanagari rune, say): 500 bytes of it is only 168 runes, so a
// question over ~167 characters was stored cut mid-codepoint, and printed a
// mangled tail on the task screen, in the push body, and to whatever the
// daemon read back as the answer it should act on. See
// internal/apply/validate.go's truncate and internal/enrich/enrich.go's own
// copy, which had and fixed the identical bug on the extracted and Bedrock
// paths — this is this package's own copy, reached by maxQuestionText and
// maxAnswerText once this branch started routing daemon- and user-authored
// text through it too.
func truncate(s string, n int) string {
	if n <= 0 {
		return ""
	}
	count := 0
	for i := range s {
		if count == n {
			return s[:i]
		}
		count++
	}
	return s
}

// retryBlockedBy names why a recording's audio cannot be re-queued right
// now, or "" when retryRecording may proceed. A transcribed recording is
// mid-extraction, not idle — re-enqueuing to ingestQueue would re-run ASR
// on a transcript ExtractFn or its fallback may already be working from.
func retryBlockedBy(status types.RecordingStatus) string {
	switch status {
	case types.StatusProcessing:
		return "this recording is already being processed"
	case types.StatusTranscribed:
		return "this recording is already extracting"
	case types.StatusReady:
		return "this recording already has a transcript"
	default:
		return ""
	}
}

// retryRecording re-runs what failed. For a failed transcription the audio is
// still in S3, so it re-enqueues, shaped as an S3 event so the processor takes
// exactly the fresh-upload path. For a ready recording whose memory ingest
// failed — the whole-dialogue send, the distilled-facts send, or both, since
// they are independent GitLoom calls at different pipeline stages — it
// re-fires only the ingest(s) that failed, from what is already stored.
//
// The facts branch resends rec.Facts rather than re-running extraction:
// ApplyFn's finishApply writes factsMemoryStatus and facts in the same
// UpdateRecording call, so whenever factsMemoryStatus reads failed, rec.Facts
// is exactly the set that attempt tried and failed to send — never stale,
// and re-running extraction to reproduce it would risk a different set than
// what actually failed.
func retryRecording(c *fiber.Ctx) error {
	user := authjwt.Sub(c)
	rec, err := ddbGetRecording(c.Context(), user, c.Params("id"))
	if err != nil {
		return err
	}
	if rec == nil {
		return fiber.NewError(fiber.StatusNotFound, "no such recording")
	}

	if rec.Status == types.StatusReady && (rec.MemoryStatus == types.MemoryFailed || rec.FactsMemoryStatus == types.MemoryFailed) {
		// Each leg is its own GitLoom call, and I3 is exactly this: the row
		// used to persist only after *both* succeeded, so a deterministic
		// GitLoom 4xx on the second leg threw the first leg's own success
		// away — the handler returned 502 before memoryStatus=ingested ever
		// reached the table, and every subsequent tap re-ran the whole
		// dialogue through gitloomxIngestTranscript again, permanently: there
		// is no delete or supersede at the pinned SDK version to undo a
		// duplicate ingest. Writing the row the moment each leg lands, before
		// touching the next one, is what makes a retry retry only the leg
		// that actually still needs it.
		if rec.MemoryStatus == types.MemoryFailed {
			transcript, err := fetchTranscript(c.Context(), rec.TranscriptKey)
			if err != nil {
				return fiber.NewError(fiber.StatusConflict, "the stored transcript could not be read")
			}
			if _, err := gitloomxIngestTranscript(c.Context(), user, rec.RecordingID, rec.StartedAt, transcript, rec.Speakers); err != nil {
				return fiber.NewError(fiber.StatusBadGateway, "the memory store did not accept the transcript")
			}
			if err := ddbUpdateRecording(c.Context(), user, rec.StartedAt, rec.RecordingID,
				map[string]any{"memoryStatus": types.MemoryIngested}); err != nil {
				return err
			}
			rec.MemoryStatus = types.MemoryIngested
		}
		if rec.FactsMemoryStatus == types.MemoryFailed {
			if err := gitloomxRememberFacts(c.Context(), user, rec.RecordingID, rec.StartedAt, rec.Facts); err != nil {
				return fiber.NewError(fiber.StatusBadGateway, "the memory store did not accept the facts")
			}
			if err := ddbUpdateRecording(c.Context(), user, rec.StartedAt, rec.RecordingID,
				map[string]any{"factsMemoryStatus": types.MemoryIngested}); err != nil {
				return err
			}
			rec.FactsMemoryStatus = types.MemoryIngested
		}
		return c.JSON(rec)
	}

	if rec.AudioKey == "" {
		return fiber.NewError(fiber.StatusBadRequest, "this recording has no audio to transcribe")
	}
	if reason := retryBlockedBy(rec.Status); reason != "" {
		return fiber.NewError(fiber.StatusConflict, reason)
	}

	if err := ddbUpdateRecording(c.Context(), user, rec.StartedAt, rec.RecordingID,
		map[string]any{"status": types.StatusUploaded, "error": ""}); err != nil {
		return err
	}

	payload, err := json.Marshal(map[string]any{
		"Records": []map[string]any{{
			"s3": map[string]any{
				"bucket": map[string]any{"name": bucket()},
				"object": map[string]any{"key": rec.AudioKey, "size": rec.SizeBytes},
			},
		}},
	})
	if err != nil {
		return err
	}
	if _, err := sqsClient.SendMessage(c.Context(), &sqs.SendMessageInput{
		QueueUrl: aws.String(queueURL()), MessageBody: aws.String(string(payload)),
	}); err != nil {
		return err
	}

	rec.Status = types.StatusUploaded
	rec.Error = ""
	return c.JSON(rec)
}

func deleteRecording(c *fiber.Ctx) error {
	user := authjwt.Sub(c)
	rec, err := ddb.GetRecording(c.Context(), user, c.Params("id"))
	if err != nil {
		return err
	}
	if rec == nil {
		return fiber.NewError(fiber.StatusNotFound, "no such recording")
	}

	// The tombstone goes first, and it is the part that outlives everything
	// else here. Deleting a recording used to remove the audio, the transcript
	// and the row while everything GitLoom extracted from it stayed in the
	// user's namespace answering retrieval — there is no delete endpoint for a
	// memory, so there was nothing to call. The tombstone is what memory
	// search filters against from now on, and what a manual erasure request to
	// GitLoom would be built from ([GL_ERASE]).
	if err := ddb.PutTombstone(c.Context(), user, ddb.Tombstone{
		RecordingID: rec.RecordingID,
		Title:       rec.Title,
		StartedAt:   rec.StartedAt,
		Reason:      "deleted by the user",
		CreatedAt:   nowISO(),
	}); err != nil {
		return err
	}

	keys := []string{rec.AudioKey, rec.CleanKey, rec.TranscriptKey, rec.MemoryDialogueKey}
	for _, key := range keys {
		if key == "" {
			continue
		}
		if _, err := s3Client.DeleteObject(c.Context(), &s3.DeleteObjectInput{
			Bucket: aws.String(bucket()), Key: aws.String(key),
		}); err != nil {
			return err
		}
	}
	if err := ddb.DeleteRecording(c.Context(), user, rec.StartedAt, rec.RecordingID); err != nil {
		return err
	}
	return c.SendStatus(fiber.StatusNoContent)
}
