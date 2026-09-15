// voiced is the voice-chat server: a long-lived process (Fargate) holding one
// WebSocket per connected app and running the whole voice pipeline behind the
// voicewire protocol. It exists as its own binary because a streaming voice
// session is exactly what Lambda cannot hold.
package main

import (
	"context"
	"log"
	"os"

	fiberws "github.com/gofiber/contrib/websocket"
	"github.com/gofiber/fiber/v2"

	"github.com/MelloB1989/mr20-pendant/backend/internal/authjwt"
	"github.com/MelloB1989/mr20-pendant/backend/internal/config"
	"github.com/MelloB1989/mr20-pendant/backend/internal/livestt"
	"github.com/MelloB1989/mr20-pendant/backend/internal/voiced"
)

func main() {
	ctx := context.Background()

	// Either the environment or Secrets Manager, whichever is set: the same
	// resolution the Lambdas use, so running this locally needs a .env and no
	// AWS account. See internal/config.
	deepgramKey, err := config.DeepgramAPIKey(ctx)
	if err != nil {
		log.Fatalf("deepgram key: %v", err)
	}
	sarvamKey, err := config.SarvamAPIKey(ctx)
	if err != nil {
		log.Fatalf("sarvam key: %v", err)
	}
	// karma's voice config reads the environment at agent construction.
	_ = os.Setenv("SARVAM_API_KEY", sarvamKey)

	app := fiber.New(fiber.Config{DisableStartupMessage: true})

	app.Get("/healthz", func(c *fiber.Ctx) error { return c.SendString("ok") })

	app.Use("/v1/voice", func(c *fiber.Ctx) error {
		if !fiberws.IsWebSocketUpgrade(c) {
			return fiber.ErrUpgradeRequired
		}
		sub, _, err := authjwt.Validate(c.Query("token"))
		if err != nil {
			return fiber.NewError(fiber.StatusUnauthorized, err.Error())
		}
		c.Locals("sub", sub)
		return c.Next()
	})
	app.Get("/v1/voice", fiberws.New(func(ws *fiberws.Conn) {
		sub, _ := ws.Locals("sub").(string)
		voiced.Handle(ws, sub, deepgramKey)
	}))

	// Live transcript. Same host and same auth, deliberately a different
	// route: it carries text in one direction and knows nothing about turns.
	app.Use("/v1/transcribe", func(c *fiber.Ctx) error {
		if !fiberws.IsWebSocketUpgrade(c) {
			return fiber.ErrUpgradeRequired
		}
		sub, _, err := authjwt.Validate(c.Query("token"))
		if err != nil {
			return fiber.NewError(fiber.StatusUnauthorized, err.Error())
		}
		c.Locals("sub", sub)
		return c.Next()
	})
	app.Get("/v1/transcribe", fiberws.New(func(ws *fiberws.Conn) {
		sub, _ := ws.Locals("sub").(string)
		livestt.Handle(ws, sub, deepgramKey)
	}))

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	log.Printf("voiced listening on :%s", port)
	log.Fatal(app.Listen(":" + port))
}
