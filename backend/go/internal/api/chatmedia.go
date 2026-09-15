// Chat attachments: images and documents the user hands to Mira.
//
// Files live under chatmedia/<sub>/<conversationId>/<uuid>.<ext>, uploaded by
// the app through a presigned PUT and read back through presigned GETs. Each
// stored chat turn carries a compact marker per attachment, so history —
// which lives in GitLoom and compacts over time — stays the single source of
// truth for what was attached where; deleting the chat deletes the prefix.
package api

import (
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"path"
	"regexp"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"

	"github.com/MelloB1989/mr20-pendant/backend/internal/authjwt"
)

// What Bedrock's Converse blocks accept, which is therefore what Mira takes.
var attachmentTypes = map[string]struct {
	ext   string
	image bool
	// Bedrock's per-file ceilings: ~5 MB images, 4.5 MB documents.
	maxBytes int64
}{
	"image/jpeg":      {"jpg", true, 5 << 20},
	"image/png":       {"png", true, 5 << 20},
	"image/gif":       {"gif", true, 5 << 20},
	"image/webp":      {"webp", true, 5 << 20},
	"application/pdf": {"pdf", false, 4_500_000},
	"text/csv":        {"csv", false, 4_500_000},
	"text/plain":      {"txt", false, 4_500_000},
	"text/markdown":   {"md", false, 4_500_000},
	"application/msword": {"doc", false, 4_500_000},
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document": {"docx", false, 4_500_000},
	"application/vnd.ms-excel": {"xls", false, 4_500_000},
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {"xlsx", false, 4_500_000},
}

const maxAttachmentsPerTurn = 4

// Attachment is one file riding a chat turn, as the app sends and receives it.
type Attachment struct {
	Key  string `json:"key"`
	Name string `json:"name"`
	Mime string `json:"mime"`
	// URL is a presigned GET, set on responses only.
	URL string `json:"url,omitempty"`
}

func chatMediaPrefix(user, convID string) string {
	return "chatmedia/" + user + "/" + convID + "/"
}

// presignChatUpload hands the app a PUT URL for one attachment.
//
//	POST /chat/attachments {conversationId, name, mime, sizeBytes}
func presignChatUpload(c *fiber.Ctx) error {
	user := authjwt.Sub(c)
	var input struct {
		ConversationID string `json:"conversationId"`
		Name           string `json:"name"`
		Mime           string `json:"mime"`
		SizeBytes      int64  `json:"sizeBytes"`
	}
	if err := c.BodyParser(&input); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "request body must be JSON")
	}
	if input.ConversationID == "" || len(input.ConversationID) > 80 {
		return fiber.NewError(fiber.StatusBadRequest, "conversationId is required")
	}
	spec, ok := attachmentTypes[strings.ToLower(input.Mime)]
	if !ok {
		return fiber.NewError(fiber.StatusUnsupportedMediaType, "Mira cannot read this file type")
	}
	if input.SizeBytes <= 0 || input.SizeBytes > spec.maxBytes {
		return fiber.NewError(fiber.StatusRequestEntityTooLarge,
			fmt.Sprintf("this file type is limited to %d MB", spec.maxBytes>>20))
	}

	key := chatMediaPrefix(user, input.ConversationID) + uuid.NewString() + "." + spec.ext
	req, err := presign.PresignPutObject(c.Context(), &s3.PutObjectInput{
		Bucket:      aws.String(bucket()),
		Key:         aws.String(key),
		ContentType: aws.String(strings.ToLower(input.Mime)),
	}, s3.WithPresignExpires(15*time.Minute))
	if err != nil {
		return err
	}
	return c.JSON(fiber.Map{"key": key, "uploadUrl": req.URL})
}

// loadAttachment pulls one uploaded attachment back as a data URL for the
// model, verifying the key belongs to this user and conversation.
func loadAttachment(ctx context.Context, user, convID string, att Attachment) (dataURL string, image bool, err error) {
	if !strings.HasPrefix(att.Key, chatMediaPrefix(user, convID)) {
		return "", false, fmt.Errorf("attachment key outside this conversation")
	}
	out, err := s3Client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(bucket()), Key: aws.String(att.Key),
	})
	if err != nil {
		return "", false, err
	}
	defer out.Body.Close()

	mime := strings.ToLower(aws.ToString(out.ContentType))
	spec, ok := attachmentTypes[mime]
	if !ok {
		return "", false, fmt.Errorf("unsupported attachment type %q", mime)
	}
	raw, err := io.ReadAll(io.LimitReader(out.Body, spec.maxBytes+1))
	if err != nil {
		return "", false, err
	}
	if int64(len(raw)) > spec.maxBytes {
		return "", false, fmt.Errorf("attachment exceeds the size limit")
	}
	return "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(raw), spec.image, nil
}

// Markers keep attachments inside the stored turn text, so GitLoom's history
// (and its compaction) carries them without a parallel store.
// Format: [[att|<key>|<name>]]
var attMarkerRe = regexp.MustCompile(`\n?\[\[att\|([^|\]]+)\|([^\]]*)\]\]`)

func attachmentMarker(att Attachment) string {
	name := strings.ReplaceAll(att.Name, "|", "-")
	name = strings.ReplaceAll(name, "]]", "")
	if name == "" {
		name = "attachment"
	}
	return "\n[[att|" + att.Key + "|" + name + "]]"
}

// parseAttachments strips markers from stored text and presigns each file
// for the app to render. Files that vanished (expired, deleted) are skipped.
func parseAttachments(ctx context.Context, text string) (clean string, atts []Attachment) {
	matches := attMarkerRe.FindAllStringSubmatch(text, -1)
	for _, m := range matches {
		key, name := m[1], m[2]
		mime := mimeForExt(path.Ext(key))
		att := Attachment{Key: key, Name: name, Mime: mime}
		req, err := presign.PresignGetObject(ctx, &s3.GetObjectInput{
			Bucket: aws.String(bucket()), Key: aws.String(key),
		}, s3.WithPresignExpires(playbackURLTTL))
		if err == nil {
			att.URL = req.URL
		}
		atts = append(atts, att)
	}
	return strings.TrimSpace(attMarkerRe.ReplaceAllString(text, "")), atts
}

func mimeForExt(ext string) string {
	ext = strings.TrimPrefix(strings.ToLower(ext), ".")
	for mime, spec := range attachmentTypes {
		if spec.ext == ext {
			return mime
		}
	}
	return "application/octet-stream"
}

// deleteChatMedia removes every attachment a conversation ever held.
func deleteChatMedia(ctx context.Context, user, convID string) {
	prefix := chatMediaPrefix(user, convID)
	var token *string
	for {
		page, err := s3Client.ListObjectsV2(ctx, &s3.ListObjectsV2Input{
			Bucket: aws.String(bucket()), Prefix: aws.String(prefix), ContinuationToken: token,
		})
		if err != nil {
			return // orphaned media is a cost nit, not a correctness bug
		}
		for _, obj := range page.Contents {
			_, _ = s3Client.DeleteObject(ctx, &s3.DeleteObjectInput{
				Bucket: aws.String(bucket()), Key: obj.Key,
			})
		}
		if page.NextContinuationToken == nil {
			return
		}
		token = page.NextContinuationToken
	}
}
