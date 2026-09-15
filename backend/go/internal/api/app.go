// Package api assembles the Fiber app: every HTTP route the backend serves,
// behind Clerk session-token middleware. It runs as one Lambda with the AWS
// Lambda Web Adapter in front, so Fiber listens on a plain port and knows
// nothing about Lambda.
package api

import (
	"context"
	"errors"
	"log"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/recover"

	"github.com/MelloB1989/mr20-pendant/backend/internal/authjwt"
	"github.com/MelloB1989/mr20-pendant/backend/internal/config"
	"github.com/MelloB1989/mr20-pendant/backend/internal/ddb"
)

// New builds the app. Called once at process start.
func New(ctx context.Context) (*fiber.App, error) {
	if err := ddb.Init(ctx); err != nil {
		return nil, err
	}
	if err := InitAWS(ctx); err != nil {
		return nil, err
	}

	app := fiber.New(fiber.Config{
		// SSE needs the response written as it is produced.
		StreamRequestBody: true,
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			var fe *fiber.Error
			if errors.As(err, &fe) {
				return c.Status(fe.Code).JSON(fiber.Map{"error": fe.Message})
			}
			// Unexpected errors are logged in full but reported as a bare 500.
			log.Printf("unhandled error path=%s err=%v", c.Path(), err)
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "internal error"})
		},
	})

	app.Use(recover.New())
	app.Use(cors.New(cors.Config{
		AllowOrigins: "*",
		AllowMethods: "GET,POST,PATCH,PUT,DELETE,OPTIONS",
		AllowHeaders: "Authorization, Content-Type",
		MaxAge:       86400,
	}))

	// Unauthenticated liveness probe, for the Function URL smoke test.
	//
	// It also says which environment answered. A preview and production are
	// the same binary on the same shape of infrastructure, and the URLs are
	// both anonymous *.lambda-url hosts, so "which one am I talking to" is
	// otherwise a question you can only answer by remembering.
	app.Get("/health", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{"ok": true, "staging": config.IsStaging()})
	})

	// Razorpay is not a signed-in user: its own HMAC over the raw body is
	// what stands in for auth here, so this is registered before — not
	// inside — the authenticated group.
	app.Post("/webhooks/razorpay", razorpayWebhook)

	/* ── round seven · remote configuration ─────────────────────────────
	   Both halves are registered here, before the authenticated group,
	   because that group is mounted at "/" and therefore covers every
	   route registered after it — which GET /config, read by a signed-out
	   plan chooser and by the pre-order page, must not be. PUT
	   /admin/config carries the same Clerk middleware explicitly and then
	   checks the caller's role (internal/api/admin.go).
	   ──────────────────────────────────────────────────────────────── */
	registerConfigRoutes(app)
	registerPublicOrderRoutes(app) // GET /orders/count — read by the landing page before any session exists.
	registerAdminRoutes(app)

	/* ── round eight · the daemon ────────────────────────────────────────
	   Both halves are registered here, before the authenticated group, for
	   the same reason the two above are: that group is mounted at "/" and
	   covers every route registered after it, and the daemon's own routes
	   carry a bearer token of their own rather than a Clerk session —
	   KARMAX has no login and cannot get one.

	   POST /daemons/claim carries no credential at all: the pairing code
	   is the credential, single-use and five minutes old, which puts it
	   beside the Razorpay webhook above rather than inside the group.

	   The three routes the *app* calls (POST /daemons/code, GET /daemons,
	   DELETE /daemons/:id) carry authjwt.Middleware() explicitly, and the
	   automation gate behind it — internal/api/daemons.go.
	   ──────────────────────────────────────────────────────────────── */
	registerDaemonRoutes(app)

	authed := app.Group("/", authjwt.Middleware())
	registerDeviceRoutes(authed)
	registerRecordingRoutes(authed)
	registerCategoryRoutes(authed)
	registerChatRoutes(authed)
	registerProfileRoutes(authed)
	registerPushRoutes(authed)
	registerOrderRoutes(authed)

	// -- round seven: tasks, receipts, memory (T3b) --------------------------
	registerTaskRoutes(authed)
	registerReceiptRoutes(authed)
	registerMemoryRoutes(authed)
	// -- end round seven ------------------------------------------------------

	return app, nil
}
