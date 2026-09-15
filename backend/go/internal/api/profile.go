// The user's profile: a chosen name and an avatar.
//
//	GET  /profile          name + presigned avatar URL
//	PUT  /profile          {name?, avatarKey?} — avatarKey confirms an upload
//	POST /profile/avatar   presigned PUT for a new avatar image
//
// The avatar key carries a fresh uuid per upload, so a changed picture is a
// changed URL — no cache to fight — and the superseded object is deleted on
// confirmation.
package api

import (
	"fmt"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"

	"github.com/MelloB1989/mr20-pendant/backend/internal/authjwt"
	"github.com/MelloB1989/mr20-pendant/backend/internal/ddb"
)

var avatarTypes = map[string]string{
	"image/jpeg": "jpg",
	"image/png":  "png",
	"image/webp": "webp",
}

const avatarMaxBytes = 5 << 20

func registerProfileRoutes(app fiber.Router) {
	app.Get("/profile", getProfile)
	app.Put("/profile", putProfile)
	app.Post("/profile/avatar", presignAvatar)
}

func avatarPrefix(user string) string { return "profile/" + user + "/" }

func profileJSON(c *fiber.Ctx, p ddb.Profile) error {
	out := fiber.Map{"name": p.Name}
	if p.AvatarKey != "" {
		if req, err := presign.PresignGetObject(c.Context(), &s3.GetObjectInput{
			Bucket: aws.String(bucket()), Key: aws.String(p.AvatarKey),
		}, s3.WithPresignExpires(playbackURLTTL)); err == nil {
			out["avatarUrl"] = req.URL
		}
	}
	return c.JSON(out)
}

func getProfile(c *fiber.Ctx) error {
	p, err := ddb.GetProfile(c.Context(), authjwt.Sub(c))
	if err != nil {
		return err
	}
	return profileJSON(c, p)
}

func putProfile(c *fiber.Ctx) error {
	user := authjwt.Sub(c)
	var input struct {
		Name      *string `json:"name"`
		AvatarKey *string `json:"avatarKey"`
	}
	if err := c.BodyParser(&input); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "request body must be JSON")
	}
	if input.Name != nil {
		trimmed := strings.TrimSpace(truncate(*input.Name, 60))
		input.Name = &trimmed
	}
	if input.AvatarKey != nil && !strings.HasPrefix(*input.AvatarKey, avatarPrefix(user)) {
		return fiber.NewError(fiber.StatusBadRequest, "that avatar key is not yours")
	}
	if input.Name == nil && input.AvatarKey == nil {
		return fiber.NewError(fiber.StatusBadRequest, "nothing to update")
	}

	// A replaced avatar's object goes with it; the row is the only reference.
	if input.AvatarKey != nil {
		if prev, err := ddb.GetProfile(c.Context(), user); err == nil &&
			prev.AvatarKey != "" && prev.AvatarKey != *input.AvatarKey {
			_, _ = s3Client.DeleteObject(c.Context(), &s3.DeleteObjectInput{
				Bucket: aws.String(bucket()), Key: aws.String(prev.AvatarKey),
			})
		}
	}

	if err := ddb.PutProfile(c.Context(), user, input.Name, input.AvatarKey); err != nil {
		return err
	}
	p, err := ddb.GetProfile(c.Context(), user)
	if err != nil {
		return err
	}
	return profileJSON(c, p)
}

func presignAvatar(c *fiber.Ctx) error {
	user := authjwt.Sub(c)
	var input struct {
		Mime      string `json:"mime"`
		SizeBytes int64  `json:"sizeBytes"`
	}
	if err := c.BodyParser(&input); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "request body must be JSON")
	}
	ext, ok := avatarTypes[strings.ToLower(input.Mime)]
	if !ok {
		return fiber.NewError(fiber.StatusUnsupportedMediaType, "avatars are JPEG, PNG or WebP")
	}
	if input.SizeBytes <= 0 || input.SizeBytes > avatarMaxBytes {
		return fiber.NewError(fiber.StatusRequestEntityTooLarge,
			fmt.Sprintf("avatars are limited to %d MB", avatarMaxBytes>>20))
	}

	key := avatarPrefix(user) + "avatar-" + uuid.NewString() + "." + ext
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
