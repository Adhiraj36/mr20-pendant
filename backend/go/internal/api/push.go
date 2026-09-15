// Push registration routes.
//
//	POST   /push/tokens        register (or refresh) this installation's token
//	DELETE /push/tokens/:token forget it
//
// The app re-registers on every launch. That is deliberate: a token can be
// reissued by the OS at any time, and a put costs the same as the read it
// would take to find out whether one was needed.
package api

import (
	"net/url"
	"strings"

	"github.com/gofiber/fiber/v2"

	"github.com/MelloB1989/mr20-pendant/backend/internal/authjwt"
	"github.com/MelloB1989/mr20-pendant/backend/internal/ddb"
	"github.com/MelloB1989/mr20-pendant/backend/internal/types"
)

func registerPushRoutes(app fiber.Router) {
	app.Post("/push/tokens", registerPushToken)
	app.Delete("/push/tokens/:token", forgetPushToken)
}

type pushTokenInput struct {
	Token    string `json:"token"`
	Platform string `json:"platform"`
}

func registerPushToken(c *fiber.Ctx) error {
	user := authjwt.Sub(c)
	var input pushTokenInput
	if err := c.BodyParser(&input); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "request body must be JSON")
	}

	token := strings.TrimSpace(input.Token)
	// Shape-checked rather than merely non-empty: a token that is not Expo's
	// would be stored, tried on every recording, and rejected forever.
	if !strings.HasPrefix(token, "ExponentPushToken[") && !strings.HasPrefix(token, "ExpoPushToken[") {
		return fiber.NewError(fiber.StatusBadRequest, "token must be an Expo push token")
	}

	platform := strings.ToLower(strings.TrimSpace(input.Platform))
	if platform != "ios" && platform != "android" {
		platform = ""
	}

	record := types.PushToken{
		UserID:       user,
		Token:        token,
		Platform:     platform,
		RegisteredAt: nowISO(),
	}
	if err := ddb.PutPushToken(c.Context(), record); err != nil {
		return err
	}
	return c.JSON(record)
}

func forgetPushToken(c *fiber.Ctx) error {
	user := authjwt.Sub(c)
	token, err := url.PathUnescape(c.Params("token"))
	if err != nil || strings.TrimSpace(token) == "" {
		return fiber.NewError(fiber.StatusBadRequest, "token is required")
	}
	if err := ddb.DeletePushToken(c.Context(), user, token); err != nil {
		return err
	}
	return c.SendStatus(fiber.StatusNoContent)
}
