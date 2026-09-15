// Administration: the one route that changes what everybody else reads.
//
//	PUT /admin/config   replace the application configuration
//
// Who is allowed. The route carries the same Clerk middleware every other
// route does — it is registered with it explicitly rather than inside the
// authenticated group, because app.go's group is mounted at "/" and only
// covers what is registered after it, and GET /config has to be registered
// before that to stay public. So both halves of §2.4's remote config live in
// one block there, and this file says what the extra check is.
//
// The extra check is a role. `public_metadata.role == "admin"`, set in the
// Clerk dashboard: nothing in this API can grant it, which is the property
// worth having. It is read from the session token when the instance's JWT
// template puts it there — signed, free, no round trip — and asked of Clerk
// directly when it does not. Anything else is 403.
//
// What may be sent. The whole document, validated by ddb.AppConfig.Validate
// before a byte is stored; `version` and `updatedAt` in the request are
// ignored, because they are the store's to set. The reply is what was
// actually written.
package api

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"time"

	"github.com/gofiber/fiber/v2"

	"github.com/MelloB1989/mr20-pendant/backend/internal/authjwt"
	"github.com/MelloB1989/mr20-pendant/backend/internal/clerkmeta"
	"github.com/MelloB1989/mr20-pendant/backend/internal/ddb"
)

func registerAdminRoutes(app fiber.Router) {
	app.Put("/admin/config", authjwt.Middleware(), putAdminConfig)
}

// The claim names a Clerk JWT template can carry the metadata object under.
// `public_metadata` is what Clerk's own `{{user.public_metadata}}` shortcut
// is usually named; the other two are what instances configured by hand end
// up with often enough to be worth reading.
var metadataClaims = []string{"public_metadata", "publicMetadata", "metadata"}

// roleFromClaims digs the role out of a verified token. Pure.
//
// Returns "" when the token says nothing about a role — which is not a
// refusal, only an absence: the caller asks Clerk next.
func roleFromClaims(claims map[string]any) string {
	if claims == nil {
		return ""
	}
	for _, name := range metadataClaims {
		metadata, ok := claims[name].(map[string]any)
		if !ok {
			continue
		}
		if role, ok := metadata[clerkmeta.KeyRole].(string); ok && role != "" {
			return role
		}
	}
	// A template may also flatten it to a single claim.
	role, _ := claims[clerkmeta.KeyRole].(string)
	return role
}

// clerkRole indirects the Clerk fetch behind a variable, so a test can
// exercise the fallback without a secret key or a network.
var clerkRole = clerkmeta.Role

// requireAdmin returns nil when the caller may change the configuration, and
// the error to send back when they may not.
func requireAdmin(c *fiber.Ctx) error {
	user := authjwt.Sub(c)
	role := roleFromClaims(authjwt.Claims(c))

	if role == "" {
		// The token does not carry it. Ask Clerk, briefly — a slow answer
		// is a refusal, not a hung request.
		ctx, cancel := context.WithTimeout(c.Context(), clerkCallTimeout)
		defer cancel()
		fetched, err := clerkRole(ctx, user)
		if err != nil {
			log.Printf("admin: could not read the role of %s from Clerk: %v", user, err)
			return fiber.NewError(fiber.StatusForbidden, "administrators only")
		}
		role = fetched
	}

	if role != clerkmeta.RoleAdmin {
		return fiber.NewError(fiber.StatusForbidden, "administrators only")
	}
	return nil
}

// How long any call to Clerk from a request path may take. Clerk is never
// the thing a user is waiting for here — it is a check on one side and a
// copy of an entitlement on the other — so it gets a short leash.
const clerkCallTimeout = 5 * time.Second

func putAdminConfig(c *fiber.Ctx) error {
	if err := requireAdmin(c); err != nil {
		return err
	}

	var next ddb.AppConfig
	if err := json.Unmarshal(c.Body(), &next); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "request body must be a JSON AppConfig")
	}

	stored, err := putConfig(c.Context(), next)
	if err != nil {
		// Validate's messages are written for whoever sent the document, so
		// they are handed back as they are. PutConfig validates before it
		// touches the table, so asking the same question again is how a
		// refused document is told apart from a failed write.
		if verr := next.Validate(); verr != nil {
			return fiber.NewError(fiber.StatusBadRequest, verr.Error())
		}
		// Somebody else saved between this caller's read and their write.
		// Nothing is wrong with either document; one of them has to be
		// rebased on the other.
		if errors.Is(err, ddb.ErrConfigConflict) {
			return fiber.NewError(fiber.StatusConflict, err.Error())
		}
		return err
	}

	// This container's copy is a minute stale the moment the write lands.
	forgetConfig()
	log.Printf("admin: %s stored configuration version %d", authjwt.Sub(c), stored.Version)
	return c.JSON(stored)
}

// putConfig indirects ddb.PutConfig for the same reason loadConfig does.
var putConfig = ddb.PutConfig
