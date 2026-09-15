package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v2"

	"github.com/MelloB1989/mr20-pendant/backend/internal/authjwt"
	"github.com/MelloB1989/mr20-pendant/backend/internal/ddb"
)

// TestRoleFromClaims: the role is read out of whichever shape the instance's
// JWT template put the metadata in, and anything that is not a string role
// is no role at all — never an accidental yes.
func TestRoleFromClaims(t *testing.T) {
	cases := []struct {
		name   string
		claims map[string]any
		want   string
	}{
		{"nothing", nil, ""},
		{"no metadata", map[string]any{"sub": "user_1"}, ""},
		{"clerk's own shape", map[string]any{
			"public_metadata": map[string]any{"role": "admin"},
		}, "admin"},
		{"camelCase template", map[string]any{
			"publicMetadata": map[string]any{"role": "admin"},
		}, "admin"},
		{"named metadata", map[string]any{
			"metadata": map[string]any{"role": "support"},
		}, "support"},
		{"flattened", map[string]any{"role": "admin"}, "admin"},
		{"empty role", map[string]any{
			"public_metadata": map[string]any{"role": ""},
		}, ""},
		{"role is not a string", map[string]any{
			"public_metadata": map[string]any{"role": true},
		}, ""},
		{"metadata is not an object", map[string]any{"public_metadata": "admin"}, ""},
	}
	for _, c := range cases {
		if got := roleFromClaims(c.claims); got != c.want {
			t.Errorf("%s: roleFromClaims = %q, want %q", c.name, got, c.want)
		}
	}
}

// putAdminConfigAs runs the handler with a caller who carries these claims,
// skipping the Clerk middleware (which is the same one every other route
// uses and is tested by being the same one).
func putAdminConfigAs(t *testing.T, claims map[string]any, body string) *http.Response {
	t.Helper()
	app := fiber.New()
	app.Put("/admin/config", func(c *fiber.Ctx) error {
		c.Locals(authjwt.LocalSub, "user_1")
		c.Locals(authjwt.LocalClaims, claims)
		return putAdminConfig(c)
	})
	req := httptest.NewRequest("PUT", "/admin/config", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	res, err := app.Test(req)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	return res
}

func adminClaims() map[string]any {
	return map[string]any{"public_metadata": map[string]any{"role": "admin"}}
}

// refuseClerk stands in for the Clerk lookup with something that must not be
// reached — a token that already carries the role should cost no round trip.
func refuseClerk(t *testing.T) {
	t.Helper()
	original := clerkRole
	clerkRole = func(context.Context, string) (string, error) {
		t.Error("Clerk was asked for a role the token already carried")
		return "", errors.New("unreachable")
	}
	t.Cleanup(func() { clerkRole = original })
}

func stubPutConfig(t *testing.T, stored *ddb.AppConfig) {
	t.Helper()
	original := putConfig
	putConfig = func(ctx context.Context, next ddb.AppConfig) (ddb.AppConfig, error) {
		if err := next.Validate(); err != nil {
			return ddb.AppConfig{}, err
		}
		next.Version = next.Version + 1
		next.UpdatedAt = "2026-09-08T00:00:00Z"
		*stored = next
		return next, nil
	}
	t.Cleanup(func() { putConfig = original })
}

func TestAdminConfigNeedsTheAdminRole(t *testing.T) {
	useDefaultConfig(t)
	var stored ddb.AppConfig
	stubPutConfig(t, &stored)

	body, err := json.Marshal(defaultConfigOrFail(t))
	if err != nil {
		t.Fatal(err)
	}

	t.Run("no role in the token and none at Clerk", func(t *testing.T) {
		original := clerkRole
		clerkRole = func(context.Context, string) (string, error) { return "", nil }
		t.Cleanup(func() { clerkRole = original })

		res := putAdminConfigAs(t, map[string]any{"sub": "user_1"}, string(body))
		if res.StatusCode != fiber.StatusForbidden {
			t.Fatalf("status = %d, want 403", res.StatusCode)
		}
	})

	t.Run("some other role", func(t *testing.T) {
		refuseClerk(t)
		claims := map[string]any{"public_metadata": map[string]any{"role": "support"}}
		res := putAdminConfigAs(t, claims, string(body))
		if res.StatusCode != fiber.StatusForbidden {
			t.Fatalf("status = %d, want 403", res.StatusCode)
		}
	})

	t.Run("Clerk cannot be reached", func(t *testing.T) {
		// A role we cannot confirm is a role the caller does not have.
		original := clerkRole
		clerkRole = func(context.Context, string) (string, error) {
			return "", errors.New("clerk is down")
		}
		t.Cleanup(func() { clerkRole = original })

		res := putAdminConfigAs(t, nil, string(body))
		if res.StatusCode != fiber.StatusForbidden {
			t.Fatalf("status = %d, want 403", res.StatusCode)
		}
	})

	t.Run("the role is in the token", func(t *testing.T) {
		refuseClerk(t)
		res := putAdminConfigAs(t, adminClaims(), string(body))
		if res.StatusCode != fiber.StatusOK {
			t.Fatalf("status = %d, want 200", res.StatusCode)
		}
		if len(stored.Pricing.Tiers) != 3 {
			t.Errorf("stored %d tiers", len(stored.Pricing.Tiers))
		}
	})

	t.Run("the role is only at Clerk", func(t *testing.T) {
		asked := 0
		original := clerkRole
		clerkRole = func(context.Context, string) (string, error) {
			asked++
			return "admin", nil
		}
		t.Cleanup(func() { clerkRole = original })

		res := putAdminConfigAs(t, map[string]any{"sub": "user_1"}, string(body))
		if res.StatusCode != fiber.StatusOK {
			t.Fatalf("status = %d, want 200", res.StatusCode)
		}
		if asked != 1 {
			t.Errorf("Clerk was asked %d times, want once", asked)
		}
	})
}

// TestAdminConfigRefusesABadDocument: the validation message is what the
// sender gets back, and nothing is stored.
func TestAdminConfigRefusesABadDocument(t *testing.T) {
	useDefaultConfig(t)
	refuseClerk(t)

	var stored ddb.AppConfig
	stubPutConfig(t, &stored)

	broken := defaultConfigOrFail(t)
	for i := range broken.Pricing.Tiers {
		broken.Pricing.Tiers[i].Enabled = false
	}
	body, err := json.Marshal(broken)
	if err != nil {
		t.Fatal(err)
	}

	res := putAdminConfigAs(t, adminClaims(), string(body))
	if res.StatusCode != fiber.StatusBadRequest {
		t.Fatalf("status = %d, want 400", res.StatusCode)
	}
	if stored.Version != 0 {
		t.Error("a document that does not validate was stored anyway")
	}

	if res := putAdminConfigAs(t, adminClaims(), "not json"); res.StatusCode != fiber.StatusBadRequest {
		t.Errorf("unparseable body: status = %d, want 400", res.StatusCode)
	}
}

// TestAdminConfigReportsALostRace: two people saving at once is neither a bad
// document nor a broken backend, and answering 500 would send the second one
// looking for an outage that is not there.
func TestAdminConfigReportsALostRace(t *testing.T) {
	useDefaultConfig(t)
	refuseClerk(t)

	original := putConfig
	putConfig = func(context.Context, ddb.AppConfig) (ddb.AppConfig, error) {
		return ddb.AppConfig{}, fmt.Errorf("%w: re-read GET /config and try again", ddb.ErrConfigConflict)
	}
	t.Cleanup(func() { putConfig = original })

	body, err := json.Marshal(defaultConfigOrFail(t))
	if err != nil {
		t.Fatal(err)
	}
	res := putAdminConfigAs(t, adminClaims(), string(body))
	if res.StatusCode != fiber.StatusConflict {
		t.Fatalf("status = %d, want 409", res.StatusCode)
	}
}
