package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gofiber/fiber/v2"

	"github.com/MelloB1989/mr20-pendant/backend/internal/authjwt"
	"github.com/MelloB1989/mr20-pendant/backend/internal/ddb"
)

// Every handler in this package that prices anything reads the application
// configuration, and the real read is a DynamoDB GetItem. Standing the
// defaults in for it here is what lets the order tests run with no AWS at
// all — and it is not a fiction: the defaults are exactly what the row is
// seeded with on a fresh table.
func init() {
	loadConfig = func(context.Context) (ddb.AppConfig, error) { return ddb.DefaultConfig() }
}

func defaultConfigOrFail(t *testing.T) ddb.AppConfig {
	t.Helper()
	cfg, err := ddb.DefaultConfig()
	if err != nil {
		t.Fatalf("the built-in configuration does not parse: %v", err)
	}
	return cfg
}

// useConfig makes this the configuration for one test, cache and all.
func useConfig(t *testing.T, cfg ddb.AppConfig) {
	t.Helper()
	original := loadConfig
	loadConfig = func(context.Context) (ddb.AppConfig, error) { return cfg, nil }
	forgetConfig()
	t.Cleanup(func() {
		loadConfig = original
		forgetConfig()
	})
}

func useDefaultConfig(t *testing.T) {
	t.Helper()
	useConfig(t, defaultConfigOrFail(t))
}

func getConfigResponse(t *testing.T, ifNoneMatch string) *http.Response {
	t.Helper()
	app := fiber.New()
	registerConfigRoutes(app)
	req := httptest.NewRequest("GET", "/config", nil)
	if ifNoneMatch != "" {
		req.Header.Set("If-None-Match", ifNoneMatch)
	}
	res, err := app.Test(req)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	return res
}

// TestDefaultConfigIsTheTiersWeSell pins the seeded document: the three
// tiers at the prices lyzn.ai charges today, in paise, with the flags the
// round ships with. If this changes, something the website prints changed
// with it.
func TestDefaultConfigIsTheTiersWeSell(t *testing.T) {
	cfg := defaultConfigOrFail(t)

	if cfg.Version != 1 {
		t.Errorf("version = %d, want 1 — the seed is the first version", cfg.Version)
	}
	if cfg.UpdatedAt != "" {
		t.Errorf("updatedAt = %q, want empty — it is stamped when the row is written", cfg.UpdatedAt)
	}
	if cfg.Pricing.Currency != "INR" || !cfg.Pricing.Preorder {
		t.Errorf("pricing = %+v, want INR and a pre-order", cfg.Pricing)
	}

	want := []ddb.Tier{
		{ID: "capture", Name: "Capture", Full: 599900, Deposit: 99900, Monthly: 0, Enabled: true},
		{ID: "act", Name: "Act", Full: 899900, Deposit: 99900, Monthly: 0, Enabled: true, Badge: "Most chosen"},
		{ID: "act-pro", Name: "Act Pro", Full: 1299900, Deposit: 99900, Monthly: 49900, Enabled: true},
	}
	if len(cfg.Pricing.Tiers) != len(want) {
		t.Fatalf("tiers = %d, want %d", len(cfg.Pricing.Tiers), len(want))
	}
	for i, w := range want {
		got := cfg.Pricing.Tiers[i]
		if got.ID != w.ID || got.Name != w.Name || got.Full != w.Full ||
			got.Deposit != w.Deposit || got.Monthly != w.Monthly ||
			got.Enabled != w.Enabled || got.Badge != w.Badge {
			t.Errorf("tier %d = %+v, want %+v", i, got, w)
		}
		if len(got.Lines) == 0 {
			t.Errorf("tier %q lists nothing it includes", got.ID)
		}
	}

	if cfg.Features.Daemon || cfg.Features.WhatsApp || cfg.Features.Execution {
		t.Errorf("features = %+v; the slots ship off", cfg.Features)
	}
	if !cfg.Features.AskLyzn || !cfg.Features.DarkMode {
		t.Errorf("features = %+v; Ask lyzn and dark mode ship on", cfg.Features)
	}
	if cfg.Notifications.DigestHour != 8 {
		t.Errorf("digestHour = %d, want 8", cfg.Notifications.DigestHour)
	}
	if err := cfg.Validate(); err != nil {
		t.Errorf("the configuration we ship does not pass our own validation: %v", err)
	}
}

// TestGetConfigIsPublicAndCacheable: no token, a minute of cache, and an
// ETag — this is the one document every signed-out screen needs.
func TestGetConfigIsPublicAndCacheable(t *testing.T) {
	useDefaultConfig(t)

	res := getConfigResponse(t, "")
	if res.StatusCode != fiber.StatusOK {
		t.Fatalf("status = %d, want 200", res.StatusCode)
	}
	if got := res.Header.Get("Cache-Control"); got != "public, max-age=60" {
		t.Errorf("Cache-Control = %q", got)
	}
	tag := res.Header.Get("ETag")
	if tag == "" {
		t.Fatal("no ETag")
	}

	var body ddb.AppConfig
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		t.Fatalf("body: %v", err)
	}
	if len(body.Pricing.Tiers) != 3 {
		t.Errorf("body carried %d tiers", len(body.Pricing.Tiers))
	}

	// The same ETag back means nothing to send.
	again := getConfigResponse(t, tag)
	if again.StatusCode != fiber.StatusNotModified {
		t.Errorf("If-None-Match: status = %d, want 304", again.StatusCode)
	}
	// A weak tag is the same tag; a different one is not.
	if weak := getConfigResponse(t, "W/"+tag); weak.StatusCode != fiber.StatusNotModified {
		t.Errorf("weak If-None-Match: status = %d, want 304", weak.StatusCode)
	}
	if stale := getConfigResponse(t, `"0000"`); stale.StatusCode != fiber.StatusOK {
		t.Errorf("stale If-None-Match: status = %d, want 200", stale.StatusCode)
	}
}

// TestConfigFallsBackToTheDefaults: a plan chooser with no plans in it, and
// a checkout that refuses every tier, is a worse answer to a DynamoDB blip
// than the document the row was seeded from.
func TestConfigFallsBackToTheDefaults(t *testing.T) {
	original := loadConfig
	loadConfig = func(context.Context) (ddb.AppConfig, error) {
		return ddb.AppConfig{}, errors.New("dynamodb is having a day")
	}
	forgetConfig()
	t.Cleanup(func() { loadConfig = original; forgetConfig() })

	cfg := appConfig(context.Background())
	if len(cfg.Pricing.Tiers) != 3 {
		t.Fatalf("fallback carried %d tiers, want the three we ship", len(cfg.Pricing.Tiers))
	}
	if _, ok := cfg.Tier("act"); !ok {
		t.Error("the fallback cannot price act")
	}
}

// TestConfigIsCachedPerContainer: the sixty-second copy is what keeps a
// burst of orders from being a burst of reads.
func TestConfigIsCachedPerContainer(t *testing.T) {
	reads := 0
	original := loadConfig
	loadConfig = func(context.Context) (ddb.AppConfig, error) {
		reads++
		return ddb.DefaultConfig()
	}
	forgetConfig()
	t.Cleanup(func() { loadConfig = original; forgetConfig() })

	for i := 0; i < 5; i++ {
		appConfig(context.Background())
	}
	if reads != 1 {
		t.Errorf("reads = %d, want 1", reads)
	}

	// And an admin's write drops it, so they see their own change.
	forgetConfig()
	appConfig(context.Background())
	if reads != 2 {
		t.Errorf("reads after forgetConfig = %d, want 2", reads)
	}
}

// TestConfigIsOutsideTheAuthenticatedGroup mirrors app.go's registration
// order, because that order is the whole of the guarantee: Fiber's
// app.Group("/", middleware) is a `use` at "/" that covers every route
// registered after it, so /config is public by being registered first and by
// nothing else. Move those two lines below the group and this fails — which
// is the point of writing it down here.
func TestConfigIsOutsideTheAuthenticatedGroup(t *testing.T) {
	useDefaultConfig(t)

	app := fiber.New()
	registerConfigRoutes(app)
	registerAdminRoutes(app)
	authed := app.Group("/", authjwt.Middleware())
	registerOrderRoutes(authed)

	cases := []struct {
		method, path string
		want         int
	}{
		{"GET", "/config", fiber.StatusOK},
		// Everything else still needs a token, this round's own admin route
		// included.
		{"GET", "/plan", fiber.StatusUnauthorized},
		{"PUT", "/admin/config", fiber.StatusUnauthorized},
	}
	for _, c := range cases {
		res, err := app.Test(httptest.NewRequest(c.method, c.path, nil))
		if err != nil {
			t.Fatalf("%s %s: %v", c.method, c.path, err)
		}
		if res.StatusCode != c.want {
			t.Errorf("%s %s with no token = %d, want %d", c.method, c.path, res.StatusCode, c.want)
		}
	}
}
