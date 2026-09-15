package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gofiber/fiber/v2"

	"github.com/MelloB1989/mr20-pendant/backend/internal/authjwt"
	"github.com/MelloB1989/mr20-pendant/backend/internal/ddb"
	"github.com/MelloB1989/mr20-pendant/backend/internal/gitloomx"
	"github.com/MelloB1989/mr20-pendant/backend/internal/push"
	"github.com/MelloB1989/mr20-pendant/backend/internal/types"
)

/* Every store call in daemons.go goes through a variable (see the var block
   at the top of that file), so the whole daemon surface can be exercised here
   with no AWS account and no network. stub swaps one out for the length of a
   test and puts it back afterwards. */

func stub[T any](t *testing.T, target *T, replacement T) {
	t.Helper()
	original := *target
	*target = replacement
	t.Cleanup(func() { *target = original })
}

const testUser = "user_1"

// automation switches the paid tier on or off for one test: both halves of
// the gate, because both have to hold.
// noAbandonedWork is the default for a test that is not about leases or
// blocked questions: the sweep at the top of a poll finds nothing to put
// back, and there is no resumable work waiting either. Without it every
// daemon test would have to know that polling for work also releases it and
// folds in anything answered.
func noAbandonedWork(t *testing.T) {
	t.Helper()
	stub(t, &ddbExpiredWork, func(context.Context, string, time.Time) ([]ddb.Task, error) {
		return nil, nil
	})
	stub(t, &ddbReleaseWork, func(_ context.Context, task ddb.Task) (ddb.Task, error) {
		return task, nil
	})
	stub(t, &ddbBlockedWork, func(context.Context, string) ([]ddb.Task, error) {
		return nil, nil
	})
}

func automation(t *testing.T, on bool) {
	t.Helper()
	noAbandonedWork(t)
	cfg := defaultConfigOrFail(t)
	cfg.Features.Execution = on
	useConfig(t, cfg)
	stub(t, &ddbGetPlan, func(context.Context, string) (ddb.Plan, error) {
		return ddb.Plan{Plan: "act", Automation: on, Status: "active"}, nil
	})
	// A stray environment variable would override the configuration and make
	// this test lie about which half it is exercising.
	t.Setenv("EXECUTION_ENABLED", "")
}

// appRoutes stands the routes up with Clerk's middleware replaced by the
// subject it would have set. The middleware itself is the same one every
// other route carries and is tested by being that one.
func appRoutes(register func(app *fiber.App)) *fiber.App {
	app := fiber.New()
	app.Use(func(c *fiber.Ctx) error {
		c.Locals(authjwt.LocalSub, testUser)
		return c.Next()
	})
	register(app)
	return app
}

func do(t *testing.T, app *fiber.App, method, path, body string) *http.Response {
	t.Helper()
	var reader *strings.Reader
	if body == "" {
		reader = strings.NewReader("")
	} else {
		reader = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, path, reader)
	req.Header.Set("Content-Type", "application/json")
	res, err := app.Test(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	return res
}

// doAs is the daemon's half: a bearer token instead of a session.
func doAs(t *testing.T, app *fiber.App, method, path, token, body string) *http.Response {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	res, err := app.Test(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	return res
}

func decode(t *testing.T, res *http.Response, into any) {
	t.Helper()
	if err := json.NewDecoder(res.Body).Decode(into); err != nil {
		t.Fatalf("decoding the response: %v", err)
	}
}

func pairedDaemon() *ddb.Daemon {
	return &ddb.Daemon{
		DaemonID: "dmn_1", UserID: testUser, Name: "Kartik's MacBook",
		Status: ddb.DaemonOnline, RegisteredAt: "2026-09-09T09:00:00Z",
	}
}

// withDaemon stands in for daemonAuth() when a test wants a known daemon in
// context without a real token to resolve — the same shortcut appRoutes gives
// the app's half.
func withDaemon(t *testing.T, daemonID string) fiber.Handler {
	t.Helper()
	return func(c *fiber.Ctx) error {
		c.Locals(localDaemon, &ddb.Daemon{DaemonID: daemonID, UserID: testUser})
		return c.Next()
	}
}

// tokenApp stands up one daemon-token route with a known good token.
func tokenApp(t *testing.T, register func(app *fiber.App)) (*fiber.App, string) {
	t.Helper()
	const token = "a-daemon-token"
	stub(t, &ddbDaemonByToken, func(_ context.Context, presented string) (*ddb.Daemon, error) {
		if presented != token {
			return nil, nil
		}
		return pairedDaemon(), nil
	})
	app := fiber.New()
	register(app)
	return app, token
}

/* ── the switch ─────────────────────────────────────────────────────── */

// The flag moved from an environment variable to the stored configuration so
// the tier can be turned on without a deploy. The variable is kept as an
// override — set it and it wins, either way.
func TestExecutionFlagPrefersConfigurationWithAnEnvironmentOverride(t *testing.T) {
	ctx := context.Background()

	off := defaultConfigOrFail(t)
	off.Features.Execution = false
	on := off
	on.Features.Execution = true

	t.Run("configuration decides", func(t *testing.T) {
		t.Setenv("EXECUTION_ENABLED", "")
		useConfig(t, off)
		if executionEnabled(ctx) {
			t.Fatal("features.execution false must read as off")
		}
		useConfig(t, on)
		if !executionEnabled(ctx) {
			t.Fatal("features.execution true must read as on")
		}
	})

	t.Run("the variable overrides it in both directions", func(t *testing.T) {
		useConfig(t, off)
		t.Setenv("EXECUTION_ENABLED", "true")
		if !executionEnabled(ctx) {
			t.Fatal("the override must be able to switch it on")
		}
		useConfig(t, on)
		t.Setenv("EXECUTION_ENABLED", "false")
		if executionEnabled(ctx) {
			t.Fatal("the override must be able to switch it off")
		}
		// Only the word true is on. Anything else that was set on purpose is
		// a person saying "not this", however they spelled it.
		for _, raw := range []string{"1", "yes", "off", " no "} {
			t.Setenv("EXECUTION_ENABLED", raw)
			if executionEnabled(ctx) {
				t.Fatalf("EXECUTION_ENABLED=%q must not read as on", raw)
			}
		}
		t.Setenv("EXECUTION_ENABLED", " True ")
		if !executionEnabled(ctx) {
			t.Fatal("EXECUTION_ENABLED=True must read as on")
		}
	})
}

/* ── the price ──────────────────────────────────────────────────────── */

// Both gates, on every Clerk route the daemon has, and on approve.
func TestAutomationIsAPriceAndAnswers402(t *testing.T) {
	cases := []struct {
		name      string
		execution bool
		plan      bool
	}{
		{"the feature is off for everybody", false, true},
		{"the account did not buy it", true, false},
		{"neither", false, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			cfg := defaultConfigOrFail(t)
			cfg.Features.Execution = c.execution
			useConfig(t, cfg)
			t.Setenv("EXECUTION_ENABLED", "")
			stub(t, &ddbGetPlan, func(context.Context, string) (ddb.Plan, error) {
				return ddb.Plan{Automation: c.plan}, nil
			})
			stub(t, &ddbMintPairCode, func(context.Context, string) (ddb.PairCode, error) {
				t.Error("a code was minted for an account that has not paid for one")
				return ddb.PairCode{}, nil
			})
			stub(t, &ddbListDaemons, func(context.Context, string) ([]ddb.Daemon, error) {
				t.Error("the daemon list was read for an account that has not paid")
				return nil, nil
			})
			stub(t, &ddbGetTask, func(context.Context, string, string) (*ddb.Task, error) {
				return &ddb.Task{TaskID: "t_1", UserID: testUser, Status: ddb.TaskProposed}, nil
			})

			app := appRoutes(func(app *fiber.App) {
				app.Post("/daemons/code", requireAutomation(), postDaemonCode)
				app.Get("/daemons", requireAutomation(), getDaemons)
				app.Delete("/daemons/:id", requireAutomation(), deleteDaemon)
				app.Post("/tasks/:id/approve", approveTask)
			})

			for _, route := range []struct{ method, path string }{
				{"POST", "/daemons/code"},
				{"GET", "/daemons"},
				{"DELETE", "/daemons/dmn_1"},
				{"POST", "/tasks/t_1/approve"},
			} {
				res := do(t, app, route.method, route.path, "")
				if res.StatusCode != http.StatusPaymentRequired {
					t.Errorf("%s %s = %d, want 402", route.method, route.path, res.StatusCode)
				}
			}
		})
	}
}

/* ── pairing ────────────────────────────────────────────────────────── */

func TestPairCodeIsMintedForTheCallerAndSaysWhenItDies(t *testing.T) {
	automation(t, true)
	var mintedFor string
	stub(t, &ddbMintPairCode, func(_ context.Context, userID string) (ddb.PairCode, error) {
		mintedFor = userID
		return ddb.PairCode{
			Code: "K7QD2M", UserID: userID,
			ExpiresAt: time.Date(2026, 9, 9, 10, 5, 0, 0, time.UTC).Unix(),
		}, nil
	})

	app := appRoutes(func(app *fiber.App) {
		app.Post("/daemons/code", requireAutomation(), postDaemonCode)
	})
	res := do(t, app, "POST", "/daemons/code", "")
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("status = %d", res.StatusCode)
	}
	var body struct {
		Code             string `json:"code"`
		ExpiresAt        string `json:"expiresAt"`
		ExpiresInSeconds int    `json:"expiresInSeconds"`
	}
	decode(t, res, &body)
	if body.Code != "K7QD2M" {
		t.Fatalf("code = %q", body.Code)
	}
	if body.ExpiresAt != "2026-09-09T10:05:00Z" {
		t.Fatalf("expiresAt = %q — the app shows a countdown against this", body.ExpiresAt)
	}
	if body.ExpiresInSeconds != 300 {
		t.Fatalf("expiresInSeconds = %d", body.ExpiresInSeconds)
	}
	// The subject comes from the verified token, never the body.
	if mintedFor != testUser {
		t.Fatalf("minted for %q", mintedFor)
	}
}

// The claim is the one unauthenticated write: the code is the credential,
// and it is spent by being used.
func TestClaimRedeemsTheCodeOnceAndHandsTheTokenBackOnce(t *testing.T) {
	automation(t, true)
	redeemed := 0
	stub(t, &ddbRedeemPairCode, func(_ context.Context, code string) (ddb.PairCode, error) {
		redeemed++
		if redeemed > 1 {
			// What a real conditional delete does the second time.
			return ddb.PairCode{}, ddb.ErrPairCode
		}
		return ddb.PairCode{Code: code, UserID: testUser}, nil
	})
	var stored ddb.Daemon
	stub(t, &ddbPutDaemon, func(_ context.Context, d ddb.Daemon) error {
		stored = d
		return nil
	})

	app := fiber.New()
	app.Post("/daemons/claim", postDaemonClaim)

	const body = `{"code":"k7qd2m","name":"Kartik's MacBook","hostname":"kartik-mbp.local","os":"darwin/arm64","version":"karmax 0.4.1","capabilities":["claude-code","shell"]}`

	// No Authorization header at all: a daemon has no session and never will.
	res := do(t, app, "POST", "/daemons/claim", body)
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("status = %d", res.StatusCode)
	}
	var out struct {
		DaemonID string `json:"daemonId"`
		Token    string `json:"token"`
		Name     string `json:"name"`
	}
	decode(t, res, &out)
	if out.Token == "" || out.DaemonID == "" {
		t.Fatalf("claim answered %+v", out)
	}

	// The row is bound to the account the code belonged to — not to anything
	// the daemon said about itself.
	if stored.UserID != testUser {
		t.Fatalf("the daemon was bound to %q", stored.UserID)
	}
	if stored.DaemonID != out.DaemonID || stored.Name != "Kartik's MacBook" {
		t.Fatalf("stored = %+v", stored)
	}
	// Only the hash is written down, and the token is what hashes to it.
	if stored.TokenHash == out.Token {
		t.Fatal("the token itself was stored")
	}
	if stored.TokenHash != ddb.HashDaemonToken(out.Token) {
		t.Fatal("the stored hash is not this token's")
	}
	if len(stored.Capabilities) != 2 {
		t.Fatalf("capabilities = %v", stored.Capabilities)
	}

	// The same code again is refused, and refused the same way an expired or
	// invented one is: three different answers would be an oracle.
	again := do(t, app, "POST", "/daemons/claim", body)
	if again.StatusCode != http.StatusBadRequest {
		t.Fatalf("a spent code was accepted: %d", again.StatusCode)
	}
}

func TestClaimNamesTheMachineWhenNobodyDid(t *testing.T) {
	automation(t, true)
	stub(t, &ddbRedeemPairCode, func(_ context.Context, code string) (ddb.PairCode, error) {
		return ddb.PairCode{Code: code, UserID: testUser}, nil
	})
	var stored ddb.Daemon
	stub(t, &ddbPutDaemon, func(_ context.Context, d ddb.Daemon) error { stored = d; return nil })

	app := fiber.New()
	app.Post("/daemons/claim", postDaemonClaim)

	do(t, app, "POST", "/daemons/claim", `{"code":"K7QD2M","hostname":"kartik-mbp.local"}`)
	if stored.Name != "kartik-mbp.local" {
		t.Fatalf("name = %q, want the hostname", stored.Name)
	}
	do(t, app, "POST", "/daemons/claim", `{"code":"K7QD2M"}`)
	if stored.Name != "LYZN daemon" {
		t.Fatalf("name = %q", stored.Name)
	}
}

/* ── the token as a credential ──────────────────────────────────────── */

func TestDaemonAuthResolvesOnlyAPairedToken(t *testing.T) {
	app, token := tokenApp(t, func(app *fiber.App) {
		app.Get("/daemons/ping", daemonAuth(), func(c *fiber.Ctx) error {
			return c.JSON(fiber.Map{"daemonId": daemonOf(c).DaemonID})
		})
	})

	if res := doAs(t, app, "GET", "/daemons/ping", "", ""); res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("no token = %d, want 401", res.StatusCode)
	}
	// A Clerk session token is not a daemon token, and this middleware never
	// asks Clerk about anything: it is one index lookup on a hash.
	clerkish := "eyJhbGciOiJSUzI1NiIsImtpZCI6Imluc18xIn0.e30.sig"
	if res := doAs(t, app, "GET", "/daemons/ping", clerkish, ""); res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("a session token = %d, want 401", res.StatusCode)
	}
	if res := doAs(t, app, "GET", "/daemons/ping", "not-a-token", ""); res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("an unknown token = %d, want 401", res.StatusCode)
	}

	res := doAs(t, app, "GET", "/daemons/ping", token, "")
	if res.StatusCode != http.StatusOK {
		t.Fatalf("the paired token = %d, want 200", res.StatusCode)
	}
	var body struct {
		DaemonID string `json:"daemonId"`
	}
	decode(t, res, &body)
	if body.DaemonID != "dmn_1" {
		t.Fatalf("resolved to %q", body.DaemonID)
	}
}

func TestBearerToken(t *testing.T) {
	if got := bearerToken("Bearer abc"); got != "abc" {
		t.Fatalf("bearerToken = %q", got)
	}
	if got := bearerToken("bearer abc"); got != "abc" {
		t.Fatalf("the scheme is case-insensitive: %q", got)
	}
	for _, header := range []string{"", "abc", "Bearer", "Bearer ", "Basic abc"} {
		if got := bearerToken(header); got != "" {
			t.Fatalf("bearerToken(%q) = %q", header, got)
		}
	}
}

/* ── the daemon list ────────────────────────────────────────────────── */

func TestDaemonListSaysWhoIsActuallyThere(t *testing.T) {
	now := time.Now().UTC()
	fresh := ddb.Daemon{DaemonID: "dmn_1", UserID: testUser, Status: ddb.DaemonOnline,
		LastHeartbeatAt: now.Add(-20 * time.Second).Format(time.RFC3339), TokenHash: "deadbeef"}
	stale := ddb.Daemon{DaemonID: "dmn_2", UserID: testUser, Status: ddb.DaemonOnline,
		LastHeartbeatAt: now.Add(-10 * time.Minute).Format(time.RFC3339)}
	never := ddb.Daemon{DaemonID: "dmn_3", UserID: testUser, Status: ddb.DaemonOnline}
	said := ddb.Daemon{DaemonID: "dmn_4", UserID: testUser, Status: ddb.DaemonOffline,
		LastHeartbeatAt: now.Format(time.RFC3339)}

	if !daemonOnline(fresh, now) {
		t.Fatal("a daemon heard from 20 seconds ago is there")
	}
	if daemonOnline(stale, now) {
		t.Fatal("a laptop that shut its lid never said offline; the clock has to")
	}
	if daemonOnline(never, now) || daemonOnline(said, now) {
		t.Fatal("a daemon that never beat, or said it was going, is not there")
	}

	automation(t, true)
	stub(t, &ddbListDaemons, func(context.Context, string) ([]ddb.Daemon, error) {
		return []ddb.Daemon{fresh, stale}, nil
	})
	app := appRoutes(func(app *fiber.App) {
		app.Get("/daemons", requireAutomation(), getDaemons)
	})
	res := do(t, app, "GET", "/daemons", "")
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", res.StatusCode)
	}
	var body struct {
		Daemons []struct {
			DaemonID     string   `json:"daemonId"`
			Online       bool     `json:"online"`
			Capabilities []string `json:"capabilities"`
		} `json:"daemons"`
	}
	decode(t, res, &body)
	if len(body.Daemons) != 2 || !body.Daemons[0].Online || body.Daemons[1].Online {
		t.Fatalf("daemons = %+v", body.Daemons)
	}
	if body.Daemons[0].Capabilities == nil {
		t.Fatal("capabilities must be an array, never null")
	}
}

/* ── the work ───────────────────────────────────────────────────────── */

func approvedTasks() []ddb.Task {
	return []ddb.Task{
		{TaskID: "rec_1-0", UserID: testUser, RecordingID: "rec_1", Text: "send Priya the deck",
			Kind: types.TaskKindMessage, Status: ddb.TaskApproved, Quote: "I'll send the deck tonight",
			CreatedAt: "2026-09-09T09:00:00Z"},
		{TaskID: "rec_1-1", UserID: testUser, RecordingID: "rec_1", Text: "book the flight",
			Kind: types.TaskKindOther, Status: ddb.TaskApproved, CreatedAt: "2026-09-09T09:00:00Z"},
	}
}

func TestWorkCarriesEnoughToActOn(t *testing.T) {
	automation(t, true)
	stub(t, &ddbApprovedWork, func(context.Context, string, int32) ([]ddb.Task, error) {
		return approvedTasks(), nil
	})
	reads := 0
	stub(t, &ddbGetRecording, func(context.Context, string, string) (*types.Recording, error) {
		reads++
		return &types.Recording{
			RecordingID: "rec_1", Title: "Dinner with Priya", Summary: "They agreed on the deck.",
			Facts: []types.Fact{{Text: "Priya is the wearer's sister", Kind: types.FactKindPerson}},
		}, nil
	})

	app, token := tokenApp(t, func(app *fiber.App) {
		app.Get("/daemons/work", daemonAuth(), getDaemonWork)
	})
	res := doAs(t, app, "GET", "/daemons/work", token, "")
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", res.StatusCode)
	}

	var body struct {
		Tasks []struct {
			TaskID      string `json:"taskId"`
			Text        string `json:"text"`
			Kind        string `json:"kind"`
			Quote       string `json:"quote"`
			DueAt       string `json:"dueAt"`
			RecordingID string `json:"recordingId"`
			Context     struct {
				Title   string       `json:"title"`
				Summary string       `json:"summary"`
				Facts   []types.Fact `json:"facts"`
			} `json:"context"`
		} `json:"tasks"`
	}
	decode(t, res, &body)
	if len(body.Tasks) != 2 {
		t.Fatalf("%d tasks", len(body.Tasks))
	}
	first := body.Tasks[0]
	if first.TaskID != "rec_1-0" || first.Text == "" || first.Kind != "message" || first.Quote == "" {
		t.Fatalf("task = %+v", first)
	}
	if first.Context.Title != "Dinner with Priya" || first.Context.Summary == "" || len(first.Context.Facts) != 1 {
		t.Fatalf("context = %+v", first.Context)
	}
	// Two promises out of one conversation must not cost two reads of it.
	if reads != 1 {
		t.Fatalf("the conversation was read %d times", reads)
	}
	// Every key present, always: the thing decoding this is a program.
	if body.Tasks[1].Context.Facts == nil {
		t.Fatal("facts must be an array, never null")
	}
}

// A daemon paired while the plan was live, on an account that has since
// stopped paying, is not making an error — it is simply handed nothing.
func TestWorkIsEmptyWhenTheAccountLostAutomation(t *testing.T) {
	automation(t, false)
	stub(t, &ddbApprovedWork, func(context.Context, string, int32) ([]ddb.Task, error) {
		t.Error("work was read for an account without automation")
		return nil, nil
	})

	app, token := tokenApp(t, func(app *fiber.App) {
		app.Get("/daemons/work", daemonAuth(), getDaemonWork)
	})
	res := doAs(t, app, "GET", "/daemons/work", token, "")
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want a plain empty list", res.StatusCode)
	}
	var body struct {
		Tasks []workItem `json:"tasks"`
	}
	decode(t, res, &body)
	if len(body.Tasks) != 0 {
		t.Fatalf("%d tasks handed to an unentitled account", len(body.Tasks))
	}
	if body.Tasks == nil {
		t.Fatal("tasks must be an array, never null")
	}
}

func TestHeartbeatCountsWhatIsWaiting(t *testing.T) {
	automation(t, true)
	var sawStatus ddb.DaemonStatus
	var sawVersion string
	stub(t, &ddbTouchDaemon, func(_ context.Context, userID, daemonID string, status ddb.DaemonStatus, version string, _ []string) error {
		if userID != testUser || daemonID != "dmn_1" {
			t.Errorf("heartbeat touched %s/%s", userID, daemonID)
		}
		sawStatus, sawVersion = status, version
		return nil
	})
	stub(t, &ddbCountApprovedWork, func(context.Context, string) (int, error) { return 3, nil })

	app, token := tokenApp(t, func(app *fiber.App) {
		app.Post("/daemons/heartbeat", daemonAuth(), postDaemonHeartbeat)
	})
	res := doAs(t, app, "POST", "/daemons/heartbeat", token, `{"status":"busy","version":"karmax 0.4.1"}`)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", res.StatusCode)
	}
	var body struct {
		OK    bool `json:"ok"`
		Tasks int  `json:"tasks"`
	}
	decode(t, res, &body)
	if !body.OK || body.Tasks != 3 {
		t.Fatalf("heartbeat = %+v", body)
	}
	if sawStatus != ddb.DaemonBusy || sawVersion != "karmax 0.4.1" {
		t.Fatalf("recorded %q / %q", sawStatus, sawVersion)
	}
}

func TestHeartbeatFromAnUnpairedDaemonIs401(t *testing.T) {
	automation(t, true)
	stub(t, &ddbTouchDaemon, func(context.Context, string, string, ddb.DaemonStatus, string, []string) error {
		return ddb.ErrDaemonGone
	})
	app, token := tokenApp(t, func(app *fiber.App) {
		app.Post("/daemons/heartbeat", daemonAuth(), postDaemonHeartbeat)
	})
	res := doAs(t, app, "POST", "/daemons/heartbeat", token, `{}`)
	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401 so the loop stops", res.StatusCode)
	}
}

func TestHeartbeatReportsNoWorkWithoutAutomation(t *testing.T) {
	automation(t, false)
	stub(t, &ddbTouchDaemon, func(context.Context, string, string, ddb.DaemonStatus, string, []string) error { return nil })
	stub(t, &ddbCountApprovedWork, func(context.Context, string) (int, error) {
		t.Error("work was counted for an account without automation")
		return 9, nil
	})
	app, token := tokenApp(t, func(app *fiber.App) {
		app.Post("/daemons/heartbeat", daemonAuth(), postDaemonHeartbeat)
	})
	var body struct {
		Tasks int `json:"tasks"`
	}
	decode(t, doAs(t, app, "POST", "/daemons/heartbeat", token, `{}`), &body)
	if body.Tasks != 0 {
		t.Fatalf("tasks = %d — the heartbeat must agree with what a poll would hand over", body.Tasks)
	}
}

func claimApp(t *testing.T) (*fiber.App, string) {
	t.Helper()
	// A claim now also hands back the words to work from, which means it
	// reads the conversation. A test about the claim itself does not care
	// what that read says, only that it does not reach for a real table.
	stub(t, &ddbGetRecording, func(context.Context, string, string) (*types.Recording, error) {
		return nil, nil
	})
	return tokenApp(t, func(app *fiber.App) {
		app.Post("/daemons/work/:taskId/claim", daemonAuth(), postDaemonWorkClaim)
	})
}

func TestClaimIsRefusedWhenSomebodyGotThereFirst(t *testing.T) {
	task := approvedTasks()[0]
	stub(t, &ddbGetTask, func(context.Context, string, string) (*ddb.Task, error) { return &task, nil })
	stub(t, &ddbClaimWork, func(context.Context, ddb.Task, string) (ddb.Task, error) {
		return task, ddb.ErrTaskTransition
	})

	app, token := claimApp(t)
	res := doAs(t, app, "POST", "/daemons/work/rec_1-0/claim", token, "")
	if res.StatusCode != http.StatusConflict {
		t.Fatalf("status = %d, want 409", res.StatusCode)
	}
}

func TestClaimSucceedsAndIsIdempotentForItsOwnHolder(t *testing.T) {
	task := approvedTasks()[0]
	stub(t, &ddbGetTask, func(context.Context, string, string) (*ddb.Task, error) { return &task, nil })
	claims := 0
	stub(t, &ddbClaimWork, func(_ context.Context, in ddb.Task, daemonID string) (ddb.Task, error) {
		claims++
		in.Status = ddb.TaskExecuting
		in.DaemonID = daemonID
		in.ClaimedAt = "2026-09-09T11:00:00Z"
		return in, nil
	})

	app, token := claimApp(t)
	var body struct {
		Task ddb.Task `json:"task"`
	}
	decode(t, doAs(t, app, "POST", "/daemons/work/rec_1-0/claim", token, ""), &body)
	if body.Task.Status != ddb.TaskExecuting || body.Task.DaemonID != "dmn_1" {
		t.Fatalf("task = %+v", body.Task)
	}

	// A restarted loop holding the same task asks again; that is not a
	// conflict, and it must not cost a second conditional write.
	task = body.Task
	res := doAs(t, app, "POST", "/daemons/work/rec_1-0/claim", token, "")
	if res.StatusCode != http.StatusOK {
		t.Fatalf("re-claiming its own task = %d", res.StatusCode)
	}
	if claims != 1 {
		t.Fatalf("%d claims written", claims)
	}
}

func TestClaimOfSomebodyElsesTaskIs404(t *testing.T) {
	stub(t, &ddbGetTask, func(context.Context, string, string) (*ddb.Task, error) { return nil, nil })
	app, token := claimApp(t)
	if res := doAs(t, app, "POST", "/daemons/work/nope/claim", token, ""); res.StatusCode != http.StatusNotFound {
		t.Fatalf("status = %d", res.StatusCode)
	}
}

/* ── the result ─────────────────────────────────────────────────────── */

func executingTask() ddb.Task {
	t := approvedTasks()[0]
	t.Status = ddb.TaskExecuting
	t.DaemonID = "dmn_1"
	return t
}

func resultApp(t *testing.T) (*fiber.App, string) {
	t.Helper()
	return tokenApp(t, func(app *fiber.App) {
		app.Post("/daemons/work/:taskId/result", daemonAuth(), postDaemonWorkResult)
	})
}

const goodResult = `{"outcome":"success","summary":"Sent the deck to Priya.","startedAt":"2026-09-09T11:00:00Z","finishedAt":"2026-09-09T11:02:00Z","artifacts":[{"name":"deck.pdf","uri":"file:///Users/k/deck.pdf"}]}`

// The receipt prints once, the phone is told once, and a repeat of the same
// POST answers with the receipt the first one printed.
func TestResultPrintsOnceAndRepeatsItself(t *testing.T) {
	task := executingTask()
	stub(t, &ddbGetTask, func(context.Context, string, string) (*ddb.Task, error) {
		copy := task
		return &copy, nil
	})

	finishes := 0
	var printed ddb.Receipt
	stub(t, &ddbFinishWork, func(_ context.Context, in ddb.Task, r ddb.Receipt, to ddb.TaskStatus) (ddb.Task, ddb.Receipt, error) {
		finishes++
		if to != ddb.TaskDone {
			t.Errorf("a success closed the task as %q", to)
		}
		in.Status = to
		in.ReceiptID = r.ReceiptID
		in.DoneAt = r.CreatedAt
		printed = r
		task = in
		return in, r, nil
	})
	stub(t, &ddbGetReceipt, func(context.Context, string, string) (*ddb.Receipt, error) { return &printed, nil })
	stub(t, &ddbListPushTokens, func(context.Context, string) ([]types.PushToken, error) {
		return []types.PushToken{{Token: "ExponentPushToken[abc]", UserID: testUser}}, nil
	})
	var sent []push.Message
	stub(t, &sendPush, func(_ context.Context, messages []push.Message) ([]string, error) {
		sent = append(sent, messages...)
		return nil, nil
	})

	app, token := resultApp(t)
	res := doAs(t, app, "POST", "/daemons/work/rec_1-0/result", token, goodResult)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", res.StatusCode)
	}
	var body struct {
		Task    ddb.Task     `json:"task"`
		Receipt *ddb.Receipt `json:"receipt"`
	}
	decode(t, res, &body)
	if body.Task.Status != ddb.TaskDone {
		t.Fatalf("task = %+v", body.Task)
	}
	if body.Receipt == nil || body.Receipt.ReceiptID == "" || body.Receipt.Stamp != ddb.StampDone {
		t.Fatalf("receipt = %+v", body.Receipt)
	}
	if body.Task.ReceiptID != body.Receipt.ReceiptID {
		t.Fatal("the task must name the receipt that closed it")
	}

	// The phone hears about work nobody watched happen.
	if len(sent) != 1 {
		t.Fatalf("%d notifications", len(sent))
	}
	if sent[0].Data["type"] != "receipt.printed" {
		t.Fatalf("notification = %+v", sent[0].Data)
	}

	// The same POST again — a daemon that lost the reply on the way back.
	first := body.Receipt.ReceiptID
	repeat := doAs(t, app, "POST", "/daemons/work/rec_1-0/result", token, goodResult)
	if repeat.StatusCode != http.StatusOK {
		t.Fatalf("a repeat = %d", repeat.StatusCode)
	}
	decode(t, repeat, &body)
	if body.Receipt == nil || body.Receipt.ReceiptID != first {
		t.Fatalf("a repeat printed %+v", body.Receipt)
	}
	if finishes != 1 {
		t.Fatalf("%d transactions for one promise", finishes)
	}
	if len(sent) != 1 {
		t.Fatalf("a repeat notified the phone again: %d", len(sent))
	}
}

// The write itself is the guard. If the transaction is refused because
// somebody else already closed the task, the honest answer is their receipt.
func TestResultAnswersARaceWithTheReceiptThatWon(t *testing.T) {
	task := executingTask()
	won := ddb.Receipt{ReceiptID: "rcpt_won", TaskID: task.TaskID, Stamp: ddb.StampDone}
	reads := 0
	stub(t, &ddbGetTask, func(context.Context, string, string) (*ddb.Task, error) {
		reads++
		out := task
		if reads > 1 {
			out.Status = ddb.TaskDone
			out.ReceiptID = won.ReceiptID
		}
		return &out, nil
	})
	stub(t, &ddbFinishWork, func(_ context.Context, in ddb.Task, r ddb.Receipt, _ ddb.TaskStatus) (ddb.Task, ddb.Receipt, error) {
		return in, r, ddb.ErrTaskTransition
	})
	stub(t, &ddbGetReceipt, func(context.Context, string, string) (*ddb.Receipt, error) { return &won, nil })

	app, token := resultApp(t)
	res := doAs(t, app, "POST", "/daemons/work/rec_1-0/result", token, goodResult)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", res.StatusCode)
	}
	var body struct {
		Receipt *ddb.Receipt `json:"receipt"`
	}
	decode(t, res, &body)
	if body.Receipt == nil || body.Receipt.ReceiptID != "rcpt_won" {
		t.Fatalf("receipt = %+v", body.Receipt)
	}
}

// A result for a task nobody claimed is a conflict: the claim is what makes
// one daemon's run the run.
func TestResultNeedsTheTaskToHaveBeenClaimed(t *testing.T) {
	task := approvedTasks()[0]
	stub(t, &ddbGetTask, func(context.Context, string, string) (*ddb.Task, error) {
		out := task
		return &out, nil
	})
	stub(t, &ddbFinishWork, func(_ context.Context, in ddb.Task, r ddb.Receipt, _ ddb.TaskStatus) (ddb.Task, ddb.Receipt, error) {
		return in, r, ddb.ErrTaskTransition
	})

	app, token := resultApp(t)
	res := doAs(t, app, "POST", "/daemons/work/rec_1-0/result", token, goodResult)
	if res.StatusCode != http.StatusConflict {
		t.Fatalf("status = %d, want 409", res.StatusCode)
	}
}

func TestResultOfAFailureStillPrints(t *testing.T) {
	task := executingTask()
	stub(t, &ddbGetTask, func(context.Context, string, string) (*ddb.Task, error) {
		out := task
		return &out, nil
	})
	var to ddb.TaskStatus
	var receipt ddb.Receipt
	stub(t, &ddbFinishWork, func(_ context.Context, in ddb.Task, r ddb.Receipt, status ddb.TaskStatus) (ddb.Task, ddb.Receipt, error) {
		to, receipt = status, r
		in.Status = status
		in.ReceiptID = r.ReceiptID
		return in, r, nil
	})
	stub(t, &ddbListPushTokens, func(context.Context, string) ([]types.PushToken, error) { return nil, nil })

	app, token := resultApp(t)
	res := doAs(t, app, "POST", "/daemons/work/rec_1-0/result", token,
		`{"outcome":"failure","summary":"Could not reach the mail server."}`)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", res.StatusCode)
	}
	if to != ddb.TaskFailed {
		t.Fatalf("a failure closed the task as %q", to)
	}
	if receipt.Stamp != ddb.StampFailed {
		t.Fatalf("stamp = %q", receipt.Stamp)
	}
}

func TestResultValidatesWhatItWasSent(t *testing.T) {
	task := executingTask()
	stub(t, &ddbGetTask, func(context.Context, string, string) (*ddb.Task, error) {
		out := task
		return &out, nil
	})
	stub(t, &ddbFinishWork, func(_ context.Context, in ddb.Task, r ddb.Receipt, _ ddb.TaskStatus) (ddb.Task, ddb.Receipt, error) {
		t.Error("an invalid result reached the store")
		return in, r, nil
	})

	app, token := resultApp(t)
	for _, body := range []string{
		`{}`,
		`{"outcome":"done"}`,
		`{"outcome":""}`,
		`{"outcome":"success","finishedAt":"tonight"}`,
		`{"outcome":"success","startedAt":"11am"}`,
	} {
		res := doAs(t, app, "POST", "/daemons/work/rec_1-0/result", token, body)
		if res.StatusCode != http.StatusBadRequest {
			t.Errorf("%s = %d, want 400", body, res.StatusCode)
		}
	}
}

func TestCleanResultFillsInTheClock(t *testing.T) {
	// No startedAt and no claimedAt to fall back on: the clock still has to
	// come from somewhere, so start collapses onto finish.
	out, err := cleanResult(resultInput{Outcome: "SUCCESS", Summary: "  did it  "}, "")
	if err != nil {
		t.Fatal(err)
	}
	if !out.Succeeded() || out.Summary != "did it" {
		t.Fatalf("result = %+v", out)
	}
	if out.FinishedAt == "" || out.StartedAt != out.FinishedAt {
		t.Fatalf("times = %q / %q", out.StartedAt, out.FinishedAt)
	}
	if _, err := time.Parse(time.RFC3339, out.FinishedAt); err != nil {
		t.Fatalf("finishedAt is not RFC3339: %v", err)
	}

	// Artifacts with nothing in them are not artifacts.
	out, err = cleanResult(resultInput{Outcome: "failure", Artifacts: []ddb.Artifact{{}, {Name: " a "}}}, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(out.Artifacts) != 1 || out.Artifacts[0].Name != "a" {
		t.Fatalf("artifacts = %+v", out.Artifacts)
	}
}

// A daemon's text/plain reply carries no startedAt at all (see
// parseHarnessReply), which used to make every receipt print STARTED equal
// to FINISHED — the task sat claimed for a while before the harness got
// around to it. The claim time is the honest start.
func TestCleanResultFallsBackToClaimedAt(t *testing.T) {
	out, err := cleanResult(resultInput{
		Outcome:    "success",
		FinishedAt: "2026-09-14T07:54:28Z",
	}, "2026-09-14T07:54:00Z")
	if err != nil {
		t.Fatal(err)
	}
	if out.StartedAt != "2026-09-14T07:54:00Z" {
		t.Fatalf("startedAt = %q, want the claim time", out.StartedAt)
	}
	if out.StartedAt == out.FinishedAt {
		t.Fatal("STARTED collapsed onto FINISHED despite a usable claim time")
	}

	// An explicit startedAt from a JSON caller still wins over the claim.
	out, err = cleanResult(resultInput{
		Outcome:    "success",
		StartedAt:  "2026-09-14T07:50:00Z",
		FinishedAt: "2026-09-14T07:54:28Z",
	}, "2026-09-14T07:54:00Z")
	if err != nil {
		t.Fatal(err)
	}
	if out.StartedAt != "2026-09-14T07:50:00Z" {
		t.Fatalf("startedAt = %q, want the explicit value", out.StartedAt)
	}

	// A claimedAt that does not parse (unclaimed task, ClaimedAt == "") is
	// not a reason to fail the request; it just isn't usable.
	out, err = cleanResult(resultInput{
		Outcome:    "success",
		FinishedAt: "2026-09-14T07:54:28Z",
	}, "")
	if err != nil {
		t.Fatal(err)
	}
	if out.StartedAt != out.FinishedAt {
		t.Fatalf("startedAt = %q, want it to fall back to finishedAt", out.StartedAt)
	}
}

func TestPushIsNeverAllowedToFailTheResult(t *testing.T) {
	stub(t, &ddbListPushTokens, func(context.Context, string) ([]types.PushToken, error) {
		return nil, errors.New("dynamodb is having a day")
	})
	// The work is done and the receipt is written; a notification that could
	// not be sent does not undo either.
	notifyReceiptPrinted(context.Background(), testUser, ddb.Receipt{ReceiptID: "rcpt_1"})

	stub(t, &ddbListPushTokens, func(context.Context, string) ([]types.PushToken, error) {
		return []types.PushToken{{Token: "ExponentPushToken[abc]"}}, nil
	})
	stub(t, &sendPush, func(context.Context, []push.Message) ([]string, error) {
		return []string{"ExponentPushToken[abc]"}, errors.New("expo is having a day")
	})
	forgotten := 0
	stub(t, &ddbDeletePushToken, func(context.Context, string, string) error {
		forgotten++
		return nil
	})
	notifyReceiptPrinted(context.Background(), testUser, ddb.Receipt{ReceiptID: "rcpt_1"})
	if forgotten != 1 {
		t.Fatalf("a token Expo reported gone was not forgotten (%d)", forgotten)
	}
}

// A laptop that takes a promise and never comes back must not keep it.
//
// This is the failure the loop's author found: the task sits in the
// executing partition, which no poll reads, and the person is told their
// work is running when no machine is running it.
func TestAPollPutsBackWorkWhoseLeaseRanOut(t *testing.T) {
	automation(t, true)

	stranded := approvedTasks()[0]
	stranded.Status = ddb.TaskExecuting
	stranded.DaemonID = "dmn_that_died"
	stranded.LeaseUntil = time.Now().UTC().Add(-time.Minute).Format(time.RFC3339)

	stub(t, &ddbExpiredWork, func(context.Context, string, time.Time) ([]ddb.Task, error) {
		return []ddb.Task{stranded}, nil
	})
	released := 0
	stub(t, &ddbReleaseWork, func(_ context.Context, task ddb.Task) (ddb.Task, error) {
		released++
		task.Status = ddb.TaskApproved
		return task, nil
	})
	stub(t, &ddbApprovedWork, func(context.Context, string, int32) ([]ddb.Task, error) {
		// What the release just put back is what the poll now offers.
		if released == 0 {
			return nil, nil
		}
		return []ddb.Task{{
			UserID: stranded.UserID, TaskID: stranded.TaskID, Text: stranded.Text,
			Status: ddb.TaskApproved, CreatedAt: stranded.CreatedAt,
		}}, nil
	})
	stub(t, &ddbGetRecording, func(context.Context, string, string) (*types.Recording, error) {
		return nil, nil
	})

	app, token := tokenApp(t, func(app *fiber.App) {
		app.Get("/daemons/work", daemonAuth(), getDaemonWork)
	})
	res := doAs(t, app, "GET", "/daemons/work", token, "")
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", res.StatusCode)
	}
	if released != 1 {
		t.Fatalf("the stranded task was released %d times, want 1", released)
	}

	var body struct {
		Tasks []struct {
			TaskID string `json:"taskId"`
		} `json:"tasks"`
	}
	decode(t, res, &body)
	if len(body.Tasks) != 1 || body.Tasks[0].TaskID != stranded.TaskID {
		t.Fatalf("the released promise was not offered again: %+v", body.Tasks)
	}
}

// A release that loses its race is the daemon finishing at the same moment.
// That is the outcome we wanted, so the poll carries on rather than failing.
func TestAReleaseThatLosesItsRaceIsNotAnError(t *testing.T) {
	automation(t, true)
	stub(t, &ddbExpiredWork, func(context.Context, string, time.Time) ([]ddb.Task, error) {
		return []ddb.Task{{UserID: "user_1", TaskID: "t_1", Status: ddb.TaskExecuting}}, nil
	})
	stub(t, &ddbReleaseWork, func(_ context.Context, task ddb.Task) (ddb.Task, error) {
		return task, ddb.ErrTaskTransition
	})
	stub(t, &ddbApprovedWork, func(context.Context, string, int32) ([]ddb.Task, error) {
		return nil, nil
	})

	app, token := tokenApp(t, func(app *fiber.App) {
		app.Get("/daemons/work", daemonAuth(), getDaemonWork)
	})
	res := doAs(t, app, "GET", "/daemons/work", token, "")
	if res.StatusCode != http.StatusOK {
		t.Fatalf("a lost race must not cost the daemon its poll: status = %d", res.StatusCode)
	}
}

// The recipe tier speaks in strings. These three affordances are what let it
// work at all, and each one has a way of going quietly wrong.

func TestWorkCanAnswerWithABareArrayOfIds(t *testing.T) {
	automation(t, true)
	stub(t, &ddbApprovedWork, func(context.Context, string, int32) ([]ddb.Task, error) {
		return approvedTasks(), nil
	})
	reads := 0
	stub(t, &ddbGetRecording, func(context.Context, string, string) (*types.Recording, error) {
		reads++
		return nil, nil
	})

	app, token := tokenApp(t, func(app *fiber.App) {
		app.Get("/daemons/work", daemonAuth(), getDaemonWork)
	})
	res := doAs(t, app, "GET", "/daemons/work?format=ids", token, "")
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", res.StatusCode)
	}
	var ids []string
	decode(t, res, &ids)
	if len(ids) != len(approvedTasks()) {
		t.Fatalf("got %d ids, want %d", len(ids), len(approvedTasks()))
	}
	// Context is what the ids form exists to avoid reading.
	if reads != 0 {
		t.Fatalf("the ids form read %d conversations; it should read none", reads)
	}
}

func TestAHarnessReplyIsReadForItsOwnContract(t *testing.T) {
	done := parseHarnessReply("I sent the mail and cc'd Ravi.\nSTATUS: done\nSUMMARY: Sent the quote to Ravi.\n")
	if done.Outcome != "success" || done.Summary != "Sent the quote to Ravi." {
		t.Fatalf("a done reply read as %+v", done)
	}

	blocked := parseHarnessReply("STATUS: blocked\nSUMMARY: The bakery wanted an OTP.")
	if blocked.Outcome != "failure" {
		t.Fatal("blocked is not success — nothing was delivered")
	}

	// The one that matters: a harness that refuses prints prose and exits 0.
	refusal := parseHarnessReply("I'm sorry, I can't help with that.")
	if refusal.Outcome != "success" {
		// expected
	} else {
		t.Fatal("a refusal reported as success prints a receipt for work nobody did")
	}
	if refusal.Summary == "" {
		t.Fatal("the receipt must carry what it actually said")
	}

	if parseHarnessReply("").Outcome == "success" {
		t.Fatal("silence is not success")
	}
}

func TestAClaimHandsBackTheWordsToWorkFrom(t *testing.T) {
	automation(t, true)
	task := approvedTasks()[0]
	stub(t, &ddbGetTask, func(context.Context, string, string) (*ddb.Task, error) {
		copy := task
		return &copy, nil
	})
	stub(t, &ddbClaimWork, func(_ context.Context, t ddb.Task, daemonID string) (ddb.Task, error) {
		t.Status = ddb.TaskExecuting
		t.DaemonID = daemonID
		return t, nil
	})
	stub(t, &ddbGetRecording, func(context.Context, string, string) (*types.Recording, error) {
		return &types.Recording{RecordingID: task.RecordingID, Title: "Quote review with Ravi"}, nil
	})

	app, token := tokenApp(t, func(app *fiber.App) {
		app.Post("/daemons/work/:taskId/claim", daemonAuth(), postDaemonWorkClaim)
	})
	res := doAs(t, app, "POST", "/daemons/work/"+task.TaskID+"/claim", token, "")
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", res.StatusCode)
	}
	var body struct {
		Work struct {
			Text    string `json:"text"`
			Context struct {
				Title string `json:"title"`
			} `json:"context"`
		} `json:"work"`
	}
	decode(t, res, &body)
	if body.Work.Text == "" || body.Work.Context.Title != "Quote review with Ravi" {
		t.Fatalf("a caller that claimed by id alone got nothing to act on: %+v", body.Work)
	}
}

// The history is the read behind a screen rather than behind a loop: a window
// wants to show what is waiting, what is running and what has already been
// done, and the work endpoint can only ever answer the first of those.
func TestHistorySeparatesWaitingRunningAndFinished(t *testing.T) {
	automation(t, true)
	stub(t, &ddbGetRecording, func(context.Context, string, string) (*types.Recording, error) {
		return &types.Recording{RecordingID: "rec_1", Title: "Dinner with Priya"}, nil
	})
	stub(t, &ddbListTasks, func(_ context.Context, _ string, status ddb.TaskStatus, _ int32, _ string) ([]ddb.Task, string, error) {
		switch status {
		case ddb.TaskApproved:
			return approvedTasks(), "", nil
		case ddb.TaskExecuting:
			return []ddb.Task{{
				TaskID: "rec_2-0", UserID: testUser, Text: "book the flight",
				Kind: types.TaskKindOther, Status: ddb.TaskExecuting,
				DaemonID: pairedDaemon().DaemonID, ClaimedAt: "2026-09-09T10:00:00Z",
				CreatedAt: "2026-09-09T09:30:00Z",
			}}, "", nil
		case ddb.TaskBlocked:
			return []ddb.Task{{
				TaskID: "rec_5-0", UserID: testUser, Text: "wire the deposit",
				Kind: types.TaskKindSpend, Status: ddb.TaskBlocked,
				DaemonID: pairedDaemon().DaemonID, ClaimedAt: "2026-09-09T09:45:00Z",
				CreatedAt: "2026-09-09T09:00:00Z",
				Question:  &ddb.TaskQuestion{ID: "q_1", Text: "which account?"},
			}}, "", nil
		case ddb.TaskDone:
			return []ddb.Task{{
				TaskID: "rec_3-0", UserID: testUser, Text: "send the quote",
				Kind: types.TaskKindMessage, Status: ddb.TaskDone,
				DaemonID: "another-laptop", ReceiptID: "rcp_1",
				DoneAt: "2026-09-09T11:00:00Z", CreatedAt: "2026-09-09T08:00:00Z",
			}}, "", nil
		case ddb.TaskFailed:
			return []ddb.Task{{
				TaskID: "rec_4-0", UserID: testUser, Text: "pay the invoice",
				Kind: types.TaskKindSpend, Status: ddb.TaskFailed,
				DaemonID: pairedDaemon().DaemonID,
				DoneAt:   "2026-09-09T12:00:00Z", CreatedAt: "2026-09-09T07:00:00Z",
				// Once blocked, then failed once its daemon gave up on it — the
				// question rides along on a finished task exactly as it does on
				// one still blocked, because nothing on the way to failed ever
				// clears it off the row.
				Question: &ddb.TaskQuestion{ID: "q_2", Text: "cancel or retry?", Answer: "retry"},
			}}, "", nil
		}
		return nil, "", nil
	})
	stub(t, &ddbGetReceipt, func(_ context.Context, _, id string) (*ddb.Receipt, error) {
		return &ddb.Receipt{ReceiptID: id, Title: "send the quote", Stamp: ddb.StampDone}, nil
	})

	app, token := tokenApp(t, func(app *fiber.App) {
		app.Get("/daemons/history", daemonAuth(), getDaemonHistory)
	})
	res := doAs(t, app, "GET", "/daemons/history", token, "")
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", res.StatusCode)
	}
	raw, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatalf("reading the response: %v", err)
	}
	// historyItem's Question carries no omitempty: a task that never had one
	// must print "question":null, not drop the key, so a client can rely on
	// the field always being there.
	if !strings.Contains(string(raw), `"taskId":"rec_2-0"`) ||
		!strings.Contains(string(raw), `"question":null`) {
		t.Fatalf("a task with no question did not print question:null: %s", raw)
	}

	type question struct {
		Text   string `json:"text"`
		Answer string `json:"answer"`
	}
	var body struct {
		Waiting []struct {
			TaskID string `json:"taskId"`
		} `json:"waiting"`
		Running []struct {
			TaskID string `json:"taskId"`
			Mine   bool   `json:"mine"`
		} `json:"running"`
		Blocked []struct {
			TaskID   string    `json:"taskId"`
			Status   string    `json:"status"`
			Question *question `json:"question"`
		} `json:"blocked"`
		Finished []struct {
			TaskID   string    `json:"taskId"`
			Status   string    `json:"status"`
			Mine     bool      `json:"mine"`
			Question *question `json:"question"`
			Receipt  *struct {
				ReceiptID string `json:"receiptId"`
			} `json:"receipt"`
		} `json:"finished"`
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		t.Fatalf("decoding the response: %v", err)
	}

	if len(body.Waiting) != 2 || len(body.Running) != 1 {
		t.Fatalf("waiting=%d running=%d", len(body.Waiting), len(body.Running))
	}
	if !body.Running[0].Mine {
		t.Fatal("a task this machine claimed did not read as its own")
	}

	if len(body.Blocked) != 1 || body.Blocked[0].TaskID != "rec_5-0" {
		t.Fatalf("blocked = %+v", body.Blocked)
	}
	if body.Blocked[0].Question == nil || body.Blocked[0].Question.Text != "which account?" {
		t.Fatalf("blocked task's question did not come through: %+v", body.Blocked[0])
	}

	// Done and failed arrive together, newest first: somebody looking at this
	// wants the last thing that happened, whichever way it went.
	if len(body.Finished) != 2 {
		t.Fatalf("%d finished", len(body.Finished))
	}
	if body.Finished[0].TaskID != "rec_4-0" || body.Finished[0].Status != "failed" {
		t.Fatalf("newest finished = %+v", body.Finished[0])
	}
	// It was blocked before it failed, and nothing on the way to failed
	// clears the question off the row — the laptop still has to show it.
	if body.Finished[0].Question == nil || body.Finished[0].Question.Answer != "retry" {
		t.Fatalf("a finished task lost the question it was once blocked on: %+v", body.Finished[0])
	}
	if body.Finished[1].Receipt == nil || body.Finished[1].Receipt.ReceiptID != "rcp_1" {
		t.Fatalf("the receipt did not come with the task: %+v", body.Finished[1])
	}
	if body.Finished[1].Question != nil {
		t.Fatalf("a task that was never blocked grew a question: %+v", body.Finished[1])
	}
	// An account can have several machines, and claiming credit for another
	// one's work would be a lie.
	if body.Finished[1].Mine {
		t.Fatal("another laptop's task read as this one's")
	}
}

// An account that has stopped paying gets four empty lists rather than a 402:
// the daemon is not the party who stopped paying, and a window that errors is
// worse than one that is honestly empty.
func TestHistoryIsEmptyWithoutAutomation(t *testing.T) {
	automation(t, false)
	app, token := tokenApp(t, func(app *fiber.App) {
		app.Get("/daemons/history", daemonAuth(), getDaemonHistory)
	})
	res := doAs(t, app, "GET", "/daemons/history", token, "")
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", res.StatusCode)
	}
	var body struct {
		Waiting  []json.RawMessage `json:"waiting"`
		Running  []json.RawMessage `json:"running"`
		Blocked  []json.RawMessage `json:"blocked"`
		Finished []json.RawMessage `json:"finished"`
	}
	decode(t, res, &body)
	if len(body.Waiting) != 0 || len(body.Running) != 0 || len(body.Blocked) != 0 || len(body.Finished) != 0 {
		t.Fatal("work was handed to an account with no automation")
	}
}

// A machine is told what the account may do, because "nothing to do" and "your
// plan does not include this" are the same empty list through every other
// endpoint on this half — and a window has to tell them apart.
func TestAMachineIsToldWhatThePlanAllows(t *testing.T) {
	automation(t, false)
	app, token := tokenApp(t, func(app *fiber.App) {
		app.Get("/daemons/history", daemonAuth(), getDaemonHistory)
	})
	res := doAs(t, app, "GET", "/daemons/history", token, "")

	var body struct {
		Plan struct {
			Tier       string `json:"tier"`
			Automation bool   `json:"automation"`
			Why        string `json:"why"`
		} `json:"plan"`
	}
	decode(t, res, &body)
	if body.Plan.Automation {
		t.Fatal("automation was reported on an account that has none")
	}
	// The sentence is what the window prints, so it has to be one.
	if body.Plan.Why == "" {
		t.Fatal("nothing said why")
	}
	if body.Plan.Tier != "act" {
		t.Fatalf("tier = %q", body.Plan.Tier)
	}
}

// memoryStubs replaces the GitLoom calls so a pairing test does not depend on
// a network, and so what was minted and revoked can be asserted.
func memoryStubs(t *testing.T) (minted *[]string, revoked *[]string) {
	t.Helper()
	mints := []string{}
	revokes := []string{}
	stub(t, &mintMemoryKey, func(_ context.Context, userID, name string) (*gitloomx.ScopedKey, error) {
		mints = append(mints, userID)
		return &gitloomx.ScopedKey{
			ID: "key_1", Secret: "gl_live_key_1_secret", Namespace: "ns-" + userID,
		}, nil
	})
	stub(t, &revokeMemoryKey, func(_ context.Context, id string) error {
		revokes = append(revokes, id)
		return nil
	})
	stub(t, &ddbSetMemoryKey, func(context.Context, string, string, string) error { return nil })
	return &mints, &revokes
}

// A machine is given its own way into the memory layer, because the assistant
// doing somebody's work is useless without what the pendant heard — and what
// it must never be given is this backend's key, which reaches everybody.
func TestPairingHandsOverAScopedMemoryKey(t *testing.T) {
	automation(t, true)
	minted, _ := memoryStubs(t)
	stub(t, &ddbRedeemPairCode, func(_ context.Context, code string) (ddb.PairCode, error) {
		return ddb.PairCode{Code: code, UserID: testUser}, nil
	})
	stub(t, &ddbPutDaemon, func(context.Context, ddb.Daemon) error { return nil })

	app := fiber.New()
	app.Post("/daemons/claim", postDaemonClaim)
	res := do(t, app, "POST", "/daemons/claim", `{"code":"K7QD2M","name":"studio"}`)

	var body struct {
		Memory *struct {
			APIKey    string `json:"apiKey"`
			Namespace string `json:"namespace"`
			BaseURL   string `json:"baseUrl"`
		} `json:"memory"`
	}
	decode(t, res, &body)
	if body.Memory == nil {
		t.Fatal("a machine paired with no way into memory")
	}
	if body.Memory.APIKey == "" || body.Memory.Namespace == "" || body.Memory.BaseURL == "" {
		t.Fatalf("memory = %+v", *body.Memory)
	}
	if len(*minted) != 1 {
		t.Fatalf("%d keys minted", len(*minted))
	}
}

// An account with no automation has no machine doing work, and pairing is not
// the place to argue about it — the claim succeeds and simply carries nothing.
func TestNoMemoryKeyWithoutAutomation(t *testing.T) {
	automation(t, false)
	minted, _ := memoryStubs(t)
	stub(t, &ddbRedeemPairCode, func(_ context.Context, code string) (ddb.PairCode, error) {
		return ddb.PairCode{Code: code, UserID: testUser}, nil
	})
	stub(t, &ddbPutDaemon, func(context.Context, ddb.Daemon) error { return nil })

	app := fiber.New()
	app.Post("/daemons/claim", postDaemonClaim)
	res := do(t, app, "POST", "/daemons/claim", `{"code":"K7QD2M"}`)
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("status = %d", res.StatusCode)
	}
	var body struct {
		Memory *json.RawMessage `json:"memory"`
	}
	decode(t, res, &body)
	if body.Memory != nil && string(*body.Memory) != "null" {
		t.Fatalf("memory handed to an account with no automation: %s", string(*body.Memory))
	}
	if len(*minted) != 0 {
		t.Fatal("a key was minted for an account that may not have one")
	}
}

// Unpairing takes the memory key with it. Revocation is the point of storing
// its id at all.
func TestUnpairingRevokesTheMemoryKey(t *testing.T) {
	_, revoked := memoryStubs(t)
	stub(t, &ddbListDaemons, func(context.Context, string) ([]ddb.Daemon, error) {
		d := *pairedDaemon()
		d.MemoryKeyID = "key_1"
		return []ddb.Daemon{d}, nil
	})
	stub(t, &ddbBlockedWork, func(context.Context, string) ([]ddb.Task, error) { return nil, nil })
	deleted := 0
	stub(t, &ddbDeleteDaemon, func(context.Context, string, string) error { deleted++; return nil })

	app := fiber.New()
	app.Delete("/daemons/:id", func(c *fiber.Ctx) error { return deleteDaemon(c) })
	req := httptest.NewRequest("DELETE", "/daemons/"+pairedDaemon().DaemonID, nil)
	if _, err := app.Test(req, -1); err != nil {
		t.Fatal(err)
	}
	if deleted != 1 {
		t.Fatalf("the daemon row was deleted %d times", deleted)
	}
	if len(*revoked) != 1 || (*revoked)[0] != "key_1" {
		t.Fatalf("revoked = %v", *revoked)
	}
}

/* ── the question ───────────────────────────────────────────────────── */

func TestPostDaemonWorkQuestionBlocksAnExecutingTaskAndNotifies(t *testing.T) {
	task := ddb.Task{
		TaskID: "task_1", UserID: testUser, Status: ddb.TaskExecuting,
		DaemonID: "d1", CreatedAt: "2026-09-08T10:00:00Z",
	}
	stub(t, &ddbGetTask, func(context.Context, string, string) (*ddb.Task, error) { return &task, nil })
	var blocked ddb.Task
	stub(t, &ddbBlockTask, func(_ context.Context, t ddb.Task, q ddb.TaskQuestion) (ddb.Task, error) {
		t.Status, t.Question = ddb.TaskBlocked, &q
		blocked = t
		return t, nil
	})
	var sent []push.Message
	stub(t, &sendPush, func(_ context.Context, msgs []push.Message) ([]string, error) {
		sent = append(sent, msgs...)
		return nil, nil
	})
	stub(t, &ddbListPushTokens, func(context.Context, string) ([]types.PushToken, error) {
		return []types.PushToken{{Token: "tok_1"}}, nil
	})

	app := appRoutes(func(app *fiber.App) {
		app.Post("/daemons/work/:taskId/question", withDaemon(t, "d1"), postDaemonWorkQuestion)
	})
	res := do(t, app, "POST", "/daemons/work/task_1/question", `{"text":"which account?"}`)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", res.StatusCode)
	}
	if blocked.Question == nil || blocked.Question.Text != "which account?" {
		t.Fatalf("question = %+v", blocked.Question)
	}
	if len(sent) != 1 || sent[0].Data["taskId"] != "task_1" {
		t.Fatalf("did not notify the phone: %+v", sent)
	}
}

func TestPostDaemonWorkQuestionReadsTextPlainAsTheHarnessDoesForResult(t *testing.T) {
	task := ddb.Task{
		TaskID: "task_1", UserID: testUser, Status: ddb.TaskExecuting,
		DaemonID: "d1", CreatedAt: "2026-09-08T10:00:00Z",
	}
	stub(t, &ddbGetTask, func(context.Context, string, string) (*ddb.Task, error) { return &task, nil })
	var blocked ddb.Task
	stub(t, &ddbBlockTask, func(_ context.Context, t ddb.Task, q ddb.TaskQuestion) (ddb.Task, error) {
		t.Status, t.Question = ddb.TaskBlocked, &q
		blocked = t
		return t, nil
	})
	stub(t, &ddbListPushTokens, func(context.Context, string) ([]types.PushToken, error) { return nil, nil })

	app := appRoutes(func(app *fiber.App) {
		app.Post("/daemons/work/:taskId/question", withDaemon(t, "d1"), postDaemonWorkQuestion)
	})
	req, _ := http.NewRequest("POST", "/daemons/work/task_1/question",
		strings.NewReader("STATUS: blocked\nSUMMARY: need the shared account's password"))
	req.Header.Set("Content-Type", "text/plain")
	res, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", res.StatusCode)
	}
	if blocked.Question == nil || blocked.Question.Text != "need the shared account's password" {
		t.Fatalf("question = %+v, want just the SUMMARY sentence, not the whole reply", blocked.Question)
	}
}

func TestPostDaemonWorkClaimResumesAnAnsweredBlockedTaskOfItsOwn(t *testing.T) {
	answered := ddb.Task{
		TaskID: "task_1", UserID: testUser, Status: ddb.TaskBlocked, DaemonID: "d1",
		Question: &ddb.TaskQuestion{ID: "q_1", Text: "which account?", Answer: "the work one"},
	}
	stub(t, &ddbGetTask, func(context.Context, string, string) (*ddb.Task, error) { return &answered, nil })
	var resumedWith string
	stub(t, &ddbResumeBlockedWork, func(_ context.Context, t ddb.Task, daemonID string) (ddb.Task, error) {
		resumedWith = daemonID
		t.Status = ddb.TaskExecuting
		return t, nil
	})

	app := appRoutes(func(app *fiber.App) {
		app.Post("/daemons/work/:taskId/claim", withDaemon(t, "d1"), postDaemonWorkClaim)
	})
	res := do(t, app, "POST", "/daemons/work/task_1/claim", "")
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", res.StatusCode)
	}
	if resumedWith != "d1" {
		t.Fatalf("resumed as %q, want d1", resumedWith)
	}
}

func TestPostDaemonWorkClaimRefusesToResumeAnUnansweredBlockedTask(t *testing.T) {
	unanswered := ddb.Task{
		TaskID: "task_1", UserID: testUser, Status: ddb.TaskBlocked, DaemonID: "d1",
		Question: &ddb.TaskQuestion{ID: "q_1", Text: "which account?"},
	}
	stub(t, &ddbGetTask, func(context.Context, string, string) (*ddb.Task, error) { return &unanswered, nil })
	stub(t, &ddbResumeBlockedWork, func(context.Context, ddb.Task, string) (ddb.Task, error) {
		t.Fatal("nothing should try to resume a task nobody answered")
		return ddb.Task{}, nil
	})

	app := appRoutes(func(app *fiber.App) {
		app.Post("/daemons/work/:taskId/claim", withDaemon(t, "d1"), postDaemonWorkClaim)
	})
	res := do(t, app, "POST", "/daemons/work/task_1/claim", "")
	if res.StatusCode != http.StatusConflict {
		t.Fatalf("status = %d, want 409", res.StatusCode)
	}
}

/* ── the escape hatches ─────────────────────────────────────────────── */

func TestPostDaemonWorkAnswerWritesTheAnswerOnce(t *testing.T) {
	task := ddb.Task{
		TaskID: "task_1", UserID: testUser, Status: ddb.TaskBlocked, DaemonID: "d1",
		Question: &ddb.TaskQuestion{ID: "q_1", Text: "which account?"},
	}
	stub(t, &ddbGetTask, func(context.Context, string, string) (*ddb.Task, error) { return &task, nil })
	var got string
	stub(t, &ddbAnswerQuestion, func(_ context.Context, t ddb.Task, answer, by string) (ddb.Task, error) {
		got = by
		t.Question.Answer = answer
		return t, nil
	})

	app := appRoutes(func(app *fiber.App) {
		app.Post("/daemons/work/:taskId/answer", withDaemon(t, "d1"), postDaemonWorkAnswer)
	})
	res := do(t, app, "POST", "/daemons/work/task_1/answer", `{"answer":"the work one"}`)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", res.StatusCode)
	}
	if got != "comms" {
		t.Fatalf("answeredBy = %q, want comms — this endpoint is the daemon's own credential", got)
	}
}

// The laptop's own Tasks screen answers over this same daemon-token route,
// not answerTask's Clerk one — it has no session, only the paired token — so
// "by" is how its reply is told apart from a comms-channel one in the receipt
// and the task detail screen.
func TestPostDaemonWorkAnswerRecordsDesktopWhenAsked(t *testing.T) {
	task := ddb.Task{
		TaskID: "task_1", UserID: testUser, Status: ddb.TaskBlocked, DaemonID: "d1",
		Question: &ddb.TaskQuestion{ID: "q_1", Text: "which account?"},
	}
	stub(t, &ddbGetTask, func(context.Context, string, string) (*ddb.Task, error) { return &task, nil })
	var got string
	stub(t, &ddbAnswerQuestion, func(_ context.Context, t ddb.Task, answer, by string) (ddb.Task, error) {
		got = by
		t.Question.Answer = answer
		return t, nil
	})

	app := appRoutes(func(app *fiber.App) {
		app.Post("/daemons/work/:taskId/answer", withDaemon(t, "d1"), postDaemonWorkAnswer)
	})
	res := do(t, app, "POST", "/daemons/work/task_1/answer", `{"answer":"the work one","by":"desktop"}`)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", res.StatusCode)
	}
	if got != "desktop" {
		t.Fatalf("answeredBy = %q, want desktop", got)
	}
}

// Anything other than the two known surfaces is refused outright, the same
// way cleanResult refuses an outcome it does not recognise — a typo in "by"
// must not silently fall back to "comms" and misattribute the reply.
func TestPostDaemonWorkAnswerRefusesAnUnknownBy(t *testing.T) {
	task := ddb.Task{
		TaskID: "task_1", UserID: testUser, Status: ddb.TaskBlocked, DaemonID: "d1",
		Question: &ddb.TaskQuestion{ID: "q_1", Text: "which account?"},
	}
	stub(t, &ddbGetTask, func(context.Context, string, string) (*ddb.Task, error) { return &task, nil })
	called := false
	stub(t, &ddbAnswerQuestion, func(_ context.Context, task ddb.Task, answer, by string) (ddb.Task, error) {
		called = true
		return task, nil
	})

	app := appRoutes(func(app *fiber.App) {
		app.Post("/daemons/work/:taskId/answer", withDaemon(t, "d1"), postDaemonWorkAnswer)
	})
	res := do(t, app, "POST", "/daemons/work/task_1/answer", `{"answer":"the work one","by":"phone"}`)
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", res.StatusCode)
	}
	if called {
		t.Fatal("an unknown by must be refused before the write")
	}
}

// The daemon-side counterpart of the same deliberate choice in answerTask
// (internal/api/tasks.go): no ddb.QuestionExpired pre-check here either. Both
// converge on ddb.AnswerQuestion's own conditional — still blocked, nobody
// has answered — so a comms reply that beats the expiry sweep to the write
// still lands rather than losing to a stricter check this handler never had.
func TestPostDaemonWorkAnswerSucceedsPastTheQuestionsOwnExpiryUntilSomethingSweepsIt(t *testing.T) {
	task := ddb.Task{
		TaskID: "task_1", UserID: testUser, Status: ddb.TaskBlocked, DaemonID: "d1",
		Question: &ddb.TaskQuestion{
			ID: "q_1", Text: "which account?",
			ExpiresAt: time.Now().UTC().Add(-time.Hour).Format(time.RFC3339),
		},
	}
	stub(t, &ddbGetTask, func(context.Context, string, string) (*ddb.Task, error) { return &task, nil })
	answered := false
	stub(t, &ddbAnswerQuestion, func(_ context.Context, t ddb.Task, answer, by string) (ddb.Task, error) {
		answered = true
		t.Question.Answer = answer
		return t, nil
	})

	app := appRoutes(func(app *fiber.App) {
		app.Post("/daemons/work/:taskId/answer", withDaemon(t, "d1"), postDaemonWorkAnswer)
	})
	res := do(t, app, "POST", "/daemons/work/task_1/answer", `{"answer":"the work one"}`)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200 — a question past its clock but not yet swept is still open", res.StatusCode)
	}
	if !answered {
		t.Fatal("an expiry pre-check silently refused an answer nothing has swept yet")
	}
}

func TestGetDaemonExpiredSessionsFailsThemAndReturnsABareArrayOfIds(t *testing.T) {
	past := time.Now().UTC().Add(-time.Hour).Format(time.RFC3339)
	expired := ddb.Task{
		TaskID: "task_1", UserID: testUser, Status: ddb.TaskBlocked, DaemonID: "d1",
		Question: &ddb.TaskQuestion{ID: "q_1", ExpiresAt: past},
	}
	stub(t, &ddbBlockedWork, func(context.Context, string) ([]ddb.Task, error) {
		return []ddb.Task{expired}, nil
	})
	var failedWith ddb.Task
	stub(t, &ddbFailBlockedWork, func(_ context.Context, t ddb.Task, r ddb.Receipt) (ddb.Task, ddb.Receipt, error) {
		failedWith = t
		t.Status = ddb.TaskFailed
		return t, r, nil
	})

	app := appRoutes(func(app *fiber.App) {
		app.Get("/daemons/sessions/expired", withDaemon(t, "d1"), getDaemonExpiredSessions)
	})
	res := do(t, app, "GET", "/daemons/sessions/expired", "")
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", res.StatusCode)
	}
	if failedWith.TaskID != "task_1" {
		t.Fatal("the expired question was never failed")
	}
	// A recipe can only walk a JSON array of scalars — the whole reason
	// GET /daemons/work?format=ids exists — so this answers bare, not
	// wrapped in an object the way most of this file's endpoints do.
	var ids []string
	if err := json.NewDecoder(res.Body).Decode(&ids); err != nil {
		t.Fatal(err)
	}
	if len(ids) != 1 || ids[0] != "task_1" {
		t.Fatalf("ids = %v, want [task_1]", ids)
	}
}

func TestGetDaemonExpiredSessionsAnswersAnEmptyArrayNotNull(t *testing.T) {
	stub(t, &ddbBlockedWork, func(context.Context, string) ([]ddb.Task, error) { return nil, nil })

	app := appRoutes(func(app *fiber.App) {
		app.Get("/daemons/sessions/expired", withDaemon(t, "d1"), getDaemonExpiredSessions)
	})
	res := do(t, app, "GET", "/daemons/sessions/expired", "")
	body, _ := io.ReadAll(res.Body)
	// "null" is falsy in the recipe engine's own vocabulary, same as "[]" —
	// both work for {{ when .expired }}, but an explicit empty array is the
	// honest answer to "nothing is here" rather than an accident of encoding.
	if strings.TrimSpace(string(body)) != "[]" {
		t.Fatalf("body = %q, want []", body)
	}
}

// A daemon that explicitly unpairs releases what it holds immediately
// (deleteDaemon). A daemon that simply goes dark and never comes back never
// calls that endpoint, so releaseStaleQuestions — riding an ordinary
// GET /daemons — is the only other way out of a pinned question. This is
// one of just two hatches for a daemon that is gone for good; the other is
// the expiry sweep, which only ever runs for the daemon that calls it.
func TestGetDaemonsReleasesATaskPinnedToADaemonGoneDarkForOverADay(t *testing.T) {
	stub(t, &ddbListDaemons, func(context.Context, string) ([]ddb.Daemon, error) {
		return []ddb.Daemon{{
			DaemonID: "d_gone", UserID: testUser, Status: ddb.DaemonOnline,
			LastHeartbeatAt: time.Now().UTC().Add(-49 * time.Hour).Format(time.RFC3339),
		}}, nil
	})
	pinned := ddb.Task{TaskID: "task_1", UserID: testUser, Status: ddb.TaskBlocked, DaemonID: "d_gone"}
	stub(t, &ddbBlockedWork, func(context.Context, string) ([]ddb.Task, error) {
		return []ddb.Task{pinned}, nil
	})
	var failedWith ddb.Task
	stub(t, &ddbFailBlockedWork, func(_ context.Context, task ddb.Task, r ddb.Receipt) (ddb.Task, ddb.Receipt, error) {
		failedWith = task
		return ddb.Task{Status: ddb.TaskFailed}, r, nil
	})

	app := appRoutes(func(app *fiber.App) {
		app.Get("/daemons", getDaemons)
	})
	res := do(t, app, "GET", "/daemons", "")
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", res.StatusCode)
	}
	if failedWith.TaskID != "task_1" {
		t.Fatal("a task pinned to a daemon silent for more than 48 hours was never released")
	}
}

// staleDaemonQuestionWindow is deliberately much longer than the online dot:
// a laptop closed for ten minutes has not abandoned the question it asked,
// and releasing one that fast would strand an honest answer on its way.
func TestGetDaemonsLeavesATaskAloneWhileItsDaemonIsMerelyOffline(t *testing.T) {
	stub(t, &ddbListDaemons, func(context.Context, string) ([]ddb.Daemon, error) {
		return []ddb.Daemon{{
			DaemonID: "d_offline", UserID: testUser, Status: ddb.DaemonOffline,
			LastHeartbeatAt: time.Now().UTC().Add(-10 * time.Minute).Format(time.RFC3339),
		}}, nil
	})
	pinned := ddb.Task{TaskID: "task_1", UserID: testUser, Status: ddb.TaskBlocked, DaemonID: "d_offline"}
	stub(t, &ddbBlockedWork, func(context.Context, string) ([]ddb.Task, error) {
		return []ddb.Task{pinned}, nil
	})
	stub(t, &ddbFailBlockedWork, func(context.Context, ddb.Task, ddb.Receipt) (ddb.Task, ddb.Receipt, error) {
		t.Fatal("a laptop closed for ten minutes has not abandoned the question it asked")
		return ddb.Task{}, ddb.Receipt{}, nil
	})

	app := appRoutes(func(app *fiber.App) {
		app.Get("/daemons", getDaemons)
	})
	res := do(t, app, "GET", "/daemons", "")
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", res.StatusCode)
	}
}

// I2: releaseExpiredQuestions (the per-daemon sweep) only ever runs from
// GET /daemons/sessions/expired, which only the shipped lyzn-tasks.yaml
// recipe polls. The KARMAX connector posts /daemons/heartbeat on its own
// schedule regardless, so a daemon whose recipe is disabled or simply older
// than this fix keeps looking perfectly healthy — recent heartbeat, no
// staleness — while a question it asked sails past its own expiresAt with
// nobody ever enforcing it. getDaemons already sweeps staleness on every
// app open (the test above); this proves it now sweeps expiry too, for a
// daemon that is not stale at all.
func TestGetDaemonsSweepsAnExpiredQuestionEvenWhenItsDaemonIsHealthy(t *testing.T) {
	stub(t, &ddbListDaemons, func(context.Context, string) ([]ddb.Daemon, error) {
		return []ddb.Daemon{{
			DaemonID: "d_healthy", UserID: testUser, Status: ddb.DaemonOnline,
			LastHeartbeatAt: time.Now().UTC().Add(-30 * time.Second).Format(time.RFC3339),
		}}, nil
	})
	pinned := ddb.Task{
		TaskID: "task_1", UserID: testUser, Status: ddb.TaskBlocked, DaemonID: "d_healthy",
		Question: &ddb.TaskQuestion{ID: "q_1", ExpiresAt: time.Now().UTC().Add(-time.Hour).Format(time.RFC3339)},
	}
	stub(t, &ddbBlockedWork, func(context.Context, string) ([]ddb.Task, error) {
		return []ddb.Task{pinned}, nil
	})
	var failedWith ddb.Task
	stub(t, &ddbFailBlockedWork, func(_ context.Context, task ddb.Task, r ddb.Receipt) (ddb.Task, ddb.Receipt, error) {
		failedWith = task
		return ddb.Task{Status: ddb.TaskFailed}, r, nil
	})

	app := appRoutes(func(app *fiber.App) {
		app.Get("/daemons", getDaemons)
	})
	res := do(t, app, "GET", "/daemons", "")
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", res.StatusCode)
	}
	if failedWith.TaskID != "task_1" {
		t.Fatal("an expired question was left standing because its daemon's heartbeat looked healthy — " +
			"the recipe that would otherwise enforce expiresAt need not even be running")
	}
}

// A blocked question that has not yet expired must survive an ordinary
// GET /daemons — the sweep this adds must not become a second way to fail
// work early.
func TestGetDaemonsLeavesAnUnexpiredQuestionAlone(t *testing.T) {
	stub(t, &ddbListDaemons, func(context.Context, string) ([]ddb.Daemon, error) {
		return []ddb.Daemon{{
			DaemonID: "d_healthy", UserID: testUser, Status: ddb.DaemonOnline,
			LastHeartbeatAt: time.Now().UTC().Add(-30 * time.Second).Format(time.RFC3339),
		}}, nil
	})
	pinned := ddb.Task{
		TaskID: "task_1", UserID: testUser, Status: ddb.TaskBlocked, DaemonID: "d_healthy",
		Question: &ddb.TaskQuestion{ID: "q_1", ExpiresAt: time.Now().UTC().Add(time.Hour).Format(time.RFC3339)},
	}
	stub(t, &ddbBlockedWork, func(context.Context, string) ([]ddb.Task, error) {
		return []ddb.Task{pinned}, nil
	})
	stub(t, &ddbFailBlockedWork, func(context.Context, ddb.Task, ddb.Receipt) (ddb.Task, ddb.Receipt, error) {
		t.Fatal("a question with an hour left on its clock must not be failed")
		return ddb.Task{}, ddb.Receipt{}, nil
	})

	app := appRoutes(func(app *fiber.App) {
		app.Get("/daemons", getDaemons)
	})
	res := do(t, app, "GET", "/daemons", "")
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", res.StatusCode)
	}
}

func TestDeleteDaemonReleasesWhateverItHadPinned(t *testing.T) {
	pinned := ddb.Task{TaskID: "task_1", UserID: testUser, Status: ddb.TaskBlocked, DaemonID: "d1"}
	stub(t, &ddbListDaemons, func(context.Context, string) ([]ddb.Daemon, error) {
		return []ddb.Daemon{{DaemonID: "d1", UserID: testUser}}, nil
	})
	stub(t, &ddbBlockedWork, func(context.Context, string) ([]ddb.Task, error) {
		return []ddb.Task{pinned}, nil
	})
	var released bool
	stub(t, &ddbFailBlockedWork, func(context.Context, ddb.Task, ddb.Receipt) (ddb.Task, ddb.Receipt, error) {
		released = true
		return ddb.Task{Status: ddb.TaskFailed}, ddb.Receipt{}, nil
	})
	stub(t, &ddbDeleteDaemon, func(context.Context, string, string) error { return nil })

	app := appRoutes(func(app *fiber.App) {
		app.Delete("/daemons/:id", deleteDaemon)
	})
	res := do(t, app, "DELETE", "/daemons/d1", "")
	if res.StatusCode != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", res.StatusCode)
	}
	if !released {
		t.Fatal("unpairing must release whatever this daemon had pinned")
	}
}

// The critical case: once the daemon row is gone, DaemonByToken can never
// resolve that id again, so any task still pinned to it becomes unreachable
// by every other escape hatch too. A read that fails here must refuse the
// unpair rather than let a transient DynamoDB error strand a task for good —
// the person can retry the unpair; nothing can retry a task nobody can ever
// reach again.
func TestDeleteDaemonRefusesToUnpairWhenReleaseCannotBeConfirmed(t *testing.T) {
	stub(t, &ddbListDaemons, func(context.Context, string) ([]ddb.Daemon, error) {
		return []ddb.Daemon{{DaemonID: "d1", UserID: testUser}}, nil
	})
	stub(t, &ddbBlockedWork, func(context.Context, string) ([]ddb.Task, error) {
		return nil, errors.New("dynamodb is having a day")
	})
	deleted := 0
	stub(t, &ddbDeleteDaemon, func(context.Context, string, string) error { deleted++; return nil })

	app := appRoutes(func(app *fiber.App) {
		app.Delete("/daemons/:id", deleteDaemon)
	})
	res := do(t, app, "DELETE", "/daemons/d1", "")
	if res.StatusCode == http.StatusNoContent {
		t.Fatal("the unpair succeeded with no way to confirm its pinned tasks were released")
	}
	if deleted != 0 {
		t.Fatal("the daemon row was destroyed before its pinned tasks were confirmed released")
	}
}

// A genuine failure to release one of this daemon's own pinned tasks — not a
// race it simply lost to something else moving the task on first — must
// refuse the unpair the same way an unreadable blocked-work list does.
func TestDeleteDaemonRefusesToUnpairWhenAReleaseWriteFails(t *testing.T) {
	pinned := ddb.Task{TaskID: "task_1", UserID: testUser, Status: ddb.TaskBlocked, DaemonID: "d1"}
	stub(t, &ddbListDaemons, func(context.Context, string) ([]ddb.Daemon, error) {
		return []ddb.Daemon{{DaemonID: "d1", UserID: testUser}}, nil
	})
	stub(t, &ddbBlockedWork, func(context.Context, string) ([]ddb.Task, error) {
		return []ddb.Task{pinned}, nil
	})
	stub(t, &ddbFailBlockedWork, func(context.Context, ddb.Task, ddb.Receipt) (ddb.Task, ddb.Receipt, error) {
		return ddb.Task{}, ddb.Receipt{}, errors.New("dynamodb is having a day")
	})
	deleted := 0
	stub(t, &ddbDeleteDaemon, func(context.Context, string, string) error { deleted++; return nil })

	app := appRoutes(func(app *fiber.App) {
		app.Delete("/daemons/:id", deleteDaemon)
	})
	res := do(t, app, "DELETE", "/daemons/d1", "")
	if res.StatusCode == http.StatusNoContent {
		t.Fatal("the unpair succeeded even though releasing its pinned task failed")
	}
	if deleted != 0 {
		t.Fatal("the daemon row was destroyed with a pinned task not confirmed released")
	}
}

// ddbFailBlockedWork's own guardUnanswered condition returns ErrTaskTransition
// for two entirely different reasons: the task genuinely left blocked on its
// own (nothing left to release), or it is still blocked but its question was
// just answered (still very much needing release — just not this way). Only
// a re-read tells them apart, which is the whole point of this pair of
// tests.
//
// This one is the harmless race: the task moved on by itself (say, another
// sweep already closed it), so failBlockedTask's ErrTaskTransition must not
// be treated as a reason to refuse the unpair, and nothing further should be
// attempted on a task that is no longer this daemon's problem.
func TestDeleteDaemonStillUnpairsWhenAPinnedTaskAlreadyMovedOnItsOwn(t *testing.T) {
	pinned := ddb.Task{TaskID: "task_1", UserID: testUser, Status: ddb.TaskBlocked, DaemonID: "d1"}
	stub(t, &ddbListDaemons, func(context.Context, string) ([]ddb.Daemon, error) {
		return []ddb.Daemon{{DaemonID: "d1", UserID: testUser}}, nil
	})
	stub(t, &ddbBlockedWork, func(context.Context, string) ([]ddb.Task, error) {
		return []ddb.Task{pinned}, nil
	})
	stub(t, &ddbFailBlockedWork, func(context.Context, ddb.Task, ddb.Receipt) (ddb.Task, ddb.Receipt, error) {
		return ddb.Task{}, ddb.Receipt{}, ddb.ErrTaskTransition
	})
	stub(t, &ddbGetTask, func(_ context.Context, _, taskID string) (*ddb.Task, error) {
		fresh := pinned
		fresh.Status = ddb.TaskDone // left blocked on its own, in between the list read and the fail attempt
		return &fresh, nil
	})
	answeredCalls := 0
	stub(t, &ddbFailAnsweredBlockedWork, func(context.Context, ddb.Task, ddb.Receipt) (ddb.Task, ddb.Receipt, error) {
		answeredCalls++
		return ddb.Task{}, ddb.Receipt{}, nil
	})
	deleted := 0
	stub(t, &ddbDeleteDaemon, func(context.Context, string, string) error { deleted++; return nil })

	app := appRoutes(func(app *fiber.App) {
		app.Delete("/daemons/:id", deleteDaemon)
	})
	res := do(t, app, "DELETE", "/daemons/d1", "")
	if res.StatusCode != http.StatusNoContent {
		t.Fatalf("status = %d, want 204 — a lost race is not a reason to refuse the unpair", res.StatusCode)
	}
	if deleted != 1 {
		t.Fatal("the daemon row was never deleted")
	}
	if answeredCalls != 0 {
		t.Fatal("a task that left blocked on its own must not also be closed as an answered one")
	}
}

// This is C1: the task did NOT leave blocked on its own — the re-read still
// shows it blocked, which (since guardUnanswered's only two conditions are
// "still blocked" and "not yet answered") can only mean its question was
// answered in the window between the blocked-work read and the fail attempt.
// Before this fix, releasePinnedTasks treated that exactly like the
// already-moved-on case above and let the unpair proceed — deleteDaemon then
// deleted the only row DaemonByToken could ever resolve this id through
// again, stranding the task: still blocked, still pinned to a daemon that no
// longer exists, answered, and unreachable by every other hatch (claim and
// answer both need a live credential naming this daemon; the expiry sweep
// only walks the calling daemon's own ids; QuestionExpired is false for an
// answered question; the staleness sweep walks ListDaemons, which no longer
// lists it).
//
// Run this test against the pre-fix releasePinnedTasks (which only checked
// errors.Is(err, ddb.ErrTaskTransition) and moved on) and it fails: the
// unpair still reports 204, but ddbFailAnsweredBlockedWork — the only write
// that can still close this task with its answer intact — is never called.
func TestDeleteDaemonClosesAStillBlockedAnsweredTaskBeforeUnpairing(t *testing.T) {
	pinned := ddb.Task{
		TaskID: "task_1", UserID: testUser, Status: ddb.TaskBlocked, DaemonID: "d1",
		Question: &ddb.TaskQuestion{ID: "q_1", Text: "which account?"},
	}
	stub(t, &ddbListDaemons, func(context.Context, string) ([]ddb.Daemon, error) {
		return []ddb.Daemon{{DaemonID: "d1", UserID: testUser}}, nil
	})
	stub(t, &ddbBlockedWork, func(context.Context, string) ([]ddb.Task, error) {
		return []ddb.Task{pinned}, nil
	})
	stub(t, &ddbFailBlockedWork, func(context.Context, ddb.Task, ddb.Receipt) (ddb.Task, ddb.Receipt, error) {
		// FailBlockedWork's own guard refused: the question was answered
		// after the blocked-work list was read.
		return ddb.Task{}, ddb.Receipt{}, ddb.ErrTaskTransition
	})
	stub(t, &ddbGetTask, func(_ context.Context, _, taskID string) (*ddb.Task, error) {
		fresh := pinned
		answer := "the work one"
		fresh.Question = &ddb.TaskQuestion{ID: "q_1", Text: "which account?", Answer: answer}
		return &fresh, nil // still blocked
	})
	var answeredTask ddb.Task
	answeredCalls := 0
	stub(t, &ddbFailAnsweredBlockedWork, func(_ context.Context, task ddb.Task, _ ddb.Receipt) (ddb.Task, ddb.Receipt, error) {
		answeredCalls++
		answeredTask = task
		return ddb.Task{}, ddb.Receipt{}, nil
	})
	deleted := 0
	stub(t, &ddbDeleteDaemon, func(context.Context, string, string) error { deleted++; return nil })

	app := appRoutes(func(app *fiber.App) {
		app.Delete("/daemons/:id", deleteDaemon)
	})
	res := do(t, app, "DELETE", "/daemons/d1", "")
	if res.StatusCode != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", res.StatusCode)
	}
	if answeredCalls != 1 {
		t.Fatal("a task still blocked with a landed answer must be closed as answered, not silently left pinned")
	}
	if answeredTask.TaskID != "task_1" || answeredTask.Question == nil || answeredTask.Question.Answer != "the work one" {
		t.Fatalf("the wrong task (or a stale copy of it) was closed: %+v", answeredTask)
	}
	if deleted != 1 {
		t.Fatal("the daemon row was never deleted")
	}
}

// If even the answered-close fails outright (not a race, a real error), the
// unpair must refuse exactly like every other confirmed-release failure —
// deleting the daemon row here is what makes the task unreachable for good.
func TestDeleteDaemonRefusesToUnpairWhenTheAnsweredCloseFails(t *testing.T) {
	pinned := ddb.Task{
		TaskID: "task_1", UserID: testUser, Status: ddb.TaskBlocked, DaemonID: "d1",
		Question: &ddb.TaskQuestion{ID: "q_1", Text: "which account?"},
	}
	stub(t, &ddbListDaemons, func(context.Context, string) ([]ddb.Daemon, error) {
		return []ddb.Daemon{{DaemonID: "d1", UserID: testUser}}, nil
	})
	stub(t, &ddbBlockedWork, func(context.Context, string) ([]ddb.Task, error) {
		return []ddb.Task{pinned}, nil
	})
	stub(t, &ddbFailBlockedWork, func(context.Context, ddb.Task, ddb.Receipt) (ddb.Task, ddb.Receipt, error) {
		return ddb.Task{}, ddb.Receipt{}, ddb.ErrTaskTransition
	})
	stub(t, &ddbGetTask, func(_ context.Context, _, taskID string) (*ddb.Task, error) {
		fresh := pinned
		fresh.Question = &ddb.TaskQuestion{ID: "q_1", Text: "which account?", Answer: "the work one"}
		return &fresh, nil
	})
	stub(t, &ddbFailAnsweredBlockedWork, func(context.Context, ddb.Task, ddb.Receipt) (ddb.Task, ddb.Receipt, error) {
		return ddb.Task{}, ddb.Receipt{}, errors.New("dynamodb is having a day")
	})
	deleted := 0
	stub(t, &ddbDeleteDaemon, func(context.Context, string, string) error { deleted++; return nil })

	app := appRoutes(func(app *fiber.App) {
		app.Delete("/daemons/:id", deleteDaemon)
	})
	res := do(t, app, "DELETE", "/daemons/d1", "")
	if res.StatusCode == http.StatusNoContent {
		t.Fatal("the unpair succeeded even though closing the answered task failed")
	}
	if deleted != 0 {
		t.Fatal("the daemon row was destroyed with a pinned, answered task not confirmed released")
	}
}
