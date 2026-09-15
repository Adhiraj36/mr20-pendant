// The application's configuration, served to anyone who asks.
//
//	GET /config   prices, tier copy, feature flags, notification schedule
//
// Public on purpose, and registered before the authenticated group in
// app.go for it: the plan chooser is the screen a signed-out visitor sees
// first, and the pre-order page on lyzn.ai has no session at all. Nothing in
// the document is a secret — it is what the website already prints.
//
// Cached three times over, deliberately. CloudFront holds it for sixty
// seconds (a cache behaviour on /config*, see backend/lib/mr20-stack.ts);
// the client is told the same by Cache-Control; and this container keeps its
// own copy for sixty seconds so a burst of cold requests is one DynamoDB
// read, not a hundred. The ETag lets a client that already has the current
// version pay nothing for asking again.
//
// The same cached read is what orders.go prices a checkout from, which is
// the point of the exercise: one document decides what a tier costs, and
// both the screen that shows the number and the code that charges it read
// the same copy of it.
package api

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/gofiber/fiber/v2"

	"github.com/MelloB1989/mr20-pendant/backend/internal/ddb"
)

func registerConfigRoutes(app fiber.Router) {
	app.Get("/config", getConfig)
}

// How long a container may answer from its own copy. The same sixty seconds
// CloudFront and the client are told, so a price change is live everywhere
// within a minute of the PUT that made it.
const configTTL = 60 * time.Second

// loadConfig indirects ddb.GetConfig behind a variable so the handler and
// the pricing path can be tested without DynamoDB.
var loadConfig = ddb.GetConfig

var (
	configMu     sync.Mutex
	configCache  ddb.AppConfig
	configLoaded time.Time
)

// appConfig returns the configuration, from this container's copy when it is
// fresh enough.
//
// It never fails. A configuration that cannot be read is answered with the
// code's own defaults, logged — because the alternative is a plan chooser
// with no plans in it and a checkout that refuses every tier, over a
// DynamoDB blip, when the right answer is sitting in the binary. The
// defaults are what the row was seeded from in the first place.
func appConfig(ctx context.Context) ddb.AppConfig {
	configMu.Lock()
	defer configMu.Unlock()

	if !configLoaded.IsZero() && time.Since(configLoaded) < configTTL {
		return configCache
	}

	cfg, err := loadConfig(ctx)
	if err != nil {
		log.Printf("config: reading the stored configuration: %v", err)
		if !configLoaded.IsZero() {
			// A copy that is a minute stale beats falling back to defaults
			// that may be a price behind.
			return configCache
		}
		fallback, ferr := ddb.DefaultConfig()
		if ferr != nil {
			// Unreachable unless defaults.go stopped being JSON, which a
			// test would have caught. Answer with the zero value rather
			// than panicking in a Lambda.
			log.Printf("config: the built-in defaults do not parse: %v", ferr)
			return ddb.AppConfig{}
		}
		return fallback
	}

	configCache, configLoaded = cfg, time.Now()
	return cfg
}

// forgetConfig drops this container's copy, so the administrator who just
// changed a price sees the change on their next read instead of up to a
// minute later. Only this container's — the others expire on their own.
func forgetConfig() {
	configMu.Lock()
	defer configMu.Unlock()
	configLoaded = time.Time{}
}

func getConfig(c *fiber.Ctx) error {
	body, err := json.Marshal(appConfig(c.Context()))
	if err != nil {
		return err
	}
	tag := etagOf(body)

	c.Set(fiber.HeaderCacheControl, "public, max-age=60")
	c.Set(fiber.HeaderETag, tag)
	if etagMatches(c.Get(fiber.HeaderIfNoneMatch), tag) {
		return c.SendStatus(fiber.StatusNotModified)
	}
	c.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSON)
	return c.Send(body)
}

// etagOf is a strong tag over the exact bytes sent, so it changes when and
// only when the response does — a version number would miss an edit that
// bumped nothing, and updatedAt would change the tag on a re-seed that
// changed no content.
func etagOf(body []byte) string {
	sum := sha256.Sum256(body)
	return `"` + hex.EncodeToString(sum[:16]) + `"`
}

// etagMatches implements If-None-Match: a comma-separated list, `*` for
// anything, and weak tags — which CloudFront and some proxies produce by
// prefixing W/ — compared on the tag itself.
func etagMatches(header, tag string) bool {
	header = strings.TrimSpace(header)
	if header == "" {
		return false
	}
	if header == "*" {
		return true
	}
	for _, candidate := range strings.Split(header, ",") {
		if strings.TrimPrefix(strings.TrimSpace(candidate), "W/") == tag {
			return true
		}
	}
	return false
}
