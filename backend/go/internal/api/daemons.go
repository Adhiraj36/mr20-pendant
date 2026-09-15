// The daemon, as an integration.
//
// The app's half — Clerk, and behind the automation price:
//
//	POST   /daemons/code      mint a six-character pairing code
//	GET    /daemons           the machines paired to this account
//	DELETE /daemons/:id       unpair one
//
// The daemon's half — no Clerk anywhere below this line:
//
//	POST /daemons/claim                     redeem a code, receive a token
//	POST /daemons/heartbeat                 I am here, and how much work is there
//	GET  /daemons/work                      approved tasks nobody has claimed
//	POST /daemons/work/:taskId/claim        take one
//	POST /daemons/work/:taskId/result       what happened, and the receipt
//
// Why it is shaped this way. KARMAX runs on somebody's own laptop and has no
// login, so it cannot hold a session and must not be handed one. Instead the
// person, signed in on their phone, mints a code; the daemon redeems it once
// and receives a bearer token of its own. From then on the token is the
// binding: it resolves to a daemon row, which names the account, and nothing
// the daemon sends is ever trusted for whose work it is asking about.
//
// Nothing is pushed at the daemon. It polls — heartbeat, then work, then a
// result per task — because a laptop behind a home router has no address we
// could reach, and a queue we cannot deliver to is a queue that lies.
//
// The receipt is the point. A task that a machine carried out while nobody
// watched is only worth anything if it prints proof, which is why the result
// writes the receipt and closes the task in one transaction and pushes
// `receipt.printed` to the phone.
package api

import (
	"context"
	"errors"
	"log"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"

	"github.com/MelloB1989/mr20-pendant/backend/internal/authjwt"
	"github.com/MelloB1989/mr20-pendant/backend/internal/ddb"
	"github.com/MelloB1989/mr20-pendant/backend/internal/gitloomx"
	"github.com/MelloB1989/mr20-pendant/backend/internal/push"
	"github.com/MelloB1989/mr20-pendant/backend/internal/types"
)

// Every store call this file makes goes through a variable, so the whole
// daemon surface — pairing, polling, claiming, the receipt — can be exercised
// with no AWS account at all. Named for what they call, so a reader can see
// at a glance which ones touch the table.
var (
	ddbMintPairCode            = ddb.MintPairCode
	ddbRedeemPairCode          = ddb.RedeemPairCode
	ddbPutDaemon               = ddb.PutDaemon
	ddbListDaemons             = ddb.ListDaemons
	ddbDeleteDaemon            = ddb.DeleteDaemon
	ddbTouchDaemon             = ddb.TouchDaemon
	ddbApprovedWork            = ddb.ApprovedWork
	ddbExpiredWork             = ddb.ExpiredWork
	ddbReleaseWork             = ddb.ReleaseWork
	ddbCountApprovedWork       = ddb.CountApprovedWork
	ddbClaimWork               = ddb.ClaimWork
	ddbFinishWork              = ddb.FinishWork
	ddbGetTask                 = ddb.GetTask
	ddbBlockTask               = ddb.BlockTask
	ddbAnswerQuestion          = ddb.AnswerQuestion
	ddbResumeBlockedWork       = ddb.ResumeBlockedWork
	ddbBlockedWork             = ddb.BlockedWork
	ddbFailBlockedWork         = ddb.FailBlockedWork
	ddbFailAnsweredBlockedWork = ddb.FailAnsweredBlockedWork
	ddbPutTask                 = ddb.PutTask
	ddbListTasks               = ddb.ListTasks
	ddbSetMemoryKey            = ddb.SetDaemonMemoryKey
	mintMemoryKey              = gitloomx.MintScopedKey
	revokeMemoryKey            = gitloomx.RevokeScopedKey
	ddbGetReceipt              = ddb.GetReceipt
	ddbGetRecording            = ddb.GetRecording
	ddbGetPlan                 = ddb.GetPlan
	ddbListPushTokens          = ddb.ListPushTokens
	ddbDeletePushToken         = ddb.DeletePushToken
	sendPush                   = push.Send
)

// registerDaemonRoutes registers both halves.
//
// All of it is registered before app.go's authenticated group, and the three
// Clerk routes carry authjwt.Middleware() explicitly for it — that group is
// mounted at "/" and would otherwise put a Clerk check in front of the
// daemon's own token routes, which is exactly the thing a daemon cannot pass.
// Same reason admin.go registers its route with the middleware by hand.
func registerDaemonRoutes(app fiber.Router) {
	// The app's half.
	app.Post("/daemons/code", authjwt.Middleware(), requireAutomation(), postDaemonCode)
	// Listing is how a person finds the machine they want gone, so it is
	// open for the same reason the delete is.
	app.Get("/daemons", authjwt.Middleware(), getDaemons)
	// Unpairing carries no automation gate on purpose. A person whose plan
	// has lapsed still owns the laptop they paired, and taking a machine's
	// access away is the one thing they must always be able to do — a
	// revocation you have to pay to perform is not a revocation.
	app.Delete("/daemons/:id", authjwt.Middleware(), deleteDaemon)

	// The daemon's half. The claim carries no credential at all — the code
	// is the credential, and it is spent by being used.
	app.Post("/daemons/claim", postDaemonClaim)
	app.Post("/daemons/heartbeat", daemonAuth(), postDaemonHeartbeat)
	app.Get("/daemons/work", daemonAuth(), getDaemonWork)
	app.Get("/daemons/sessions/expired", daemonAuth(), getDaemonExpiredSessions)
	// What this machine has done, for a window that wants to show it. Read
	// only, and scoped to the daemon's own account by the same token as the
	// rest.
	app.Get("/daemons/history", daemonAuth(), getDaemonHistory)
	// A machine's own memory credential. Minted at pairing; this is how one
	// that lost it — a reinstall, a failed mint — gets another without the
	// person pairing again.
	app.Post("/daemons/memory", daemonAuth(), postDaemonMemory)
	app.Post("/daemons/work/:taskId/claim", daemonAuth(), postDaemonWorkClaim)
	app.Post("/daemons/work/:taskId/question", daemonAuth(), postDaemonWorkQuestion)
	app.Post("/daemons/work/:taskId/answer", daemonAuth(), postDaemonWorkAnswer)
	app.Post("/daemons/work/:taskId/result", daemonAuth(), postDaemonWorkResult)
}

/* ─────────────────────────────────────────────────────────────
   Entitlement

   Execution is the paid tier. Two things have to hold: the feature has to
   be switched on for everybody (AppConfig.features.execution, so it can be
   turned on without a deploy), and this account has to have paid for a plan
   that carries automation.

   402 rather than 403, everywhere, because the second gate is a price and
   the app opens the plan chooser on it (mobile/src/api/tasks.ts).
   ───────────────────────────────────────────────────────────── */

// executionEnabled is the feature half of the gate.
//
// The stored configuration decides, so the tier can be switched on for
// everybody the moment the daemon works, without shipping a Lambda. The
// environment variable T3b left is kept as an override — set it and it wins,
// either way — which is what lets a preview stack run the whole daemon flow
// while production still has the flag down, and what lets production turn it
// off in one console edit if it goes wrong.
func executionEnabled(ctx context.Context) bool {
	if raw := strings.TrimSpace(os.Getenv("EXECUTION_ENABLED")); raw != "" {
		return strings.EqualFold(raw, "true")
	}
	return appConfig(ctx).Features.Execution
}

// automationState answers whether this account may hand work to a daemon,
// and — when it may not — the sentence that says why.
//
// Split from the gate below because the two callers want different things
// from the same answer: an app route wants a 402 to show the user, and
// GET /daemons/work wants an empty list, because a daemon polling an account
// whose plan lapsed is not making an error.
func automationState(ctx context.Context, userID string) (bool, string, error) {
	if !executionEnabled(ctx) {
		return false, "automatic execution is not available yet", nil
	}
	plan, err := ddbGetPlan(ctx, userID)
	if err != nil {
		return false, "", err
	}
	if !plan.Automation {
		return false, "your plan does not include automatic execution", nil
	}
	return true, "", nil
}

// planView is what a machine is told about the account it serves.
//
// A daemon has never needed this: it is handed work or it is handed nothing,
// and either way the right thing to do is poll again. A *window* on somebody's
// laptop is different — when nothing arrives it has to say whether that is
// because there is nothing to do or because the plan does not carry
// automation, and those are the same empty list through every other endpoint
// here.
//
// The tier is named, not just the boolean, so the app can say "Capture does
// not include this" rather than the vaguer truth.
type planView struct {
	Tier       string `json:"tier"`
	Automation bool   `json:"automation"`
	Status     string `json:"status"`
	// Why is the sentence to show when Automation is false, and empty when it
	// is true. Never a code: the app prints it.
	Why string `json:"why"`
}

func planFor(ctx context.Context, userID string) planView {
	plan, err := ddbGetPlan(ctx, userID)
	if err != nil {
		// A plan that cannot be read is not a plan that says no. The work
		// endpoints already treat a read failure as an error rather than a
		// refusal, and a window should say the same.
		return planView{Tier: "unknown", Status: "unknown", Why: "could not read your plan just now"}
	}
	ok, why, err := automationState(ctx, userID)
	if err != nil {
		return planView{Tier: plan.Plan, Status: plan.Status, Why: "could not read your plan just now"}
	}
	return planView{Tier: plan.Plan, Automation: ok, Status: plan.Status, Why: why}
}

// automationGate is automationState as an error to send back.
func automationGate(ctx context.Context, userID string) error {
	ok, why, err := automationState(ctx, userID)
	if err != nil {
		return err
	}
	if !ok {
		return fiber.NewError(fiber.StatusPaymentRequired, why)
	}
	return nil
}

// requireAutomation is the gate as middleware, for the Clerk-authenticated
// daemon routes. The daemon's own token routes are not behind it: they are
// already bound to an account that passed this check when it paired, and a
// daemon has no plan chooser to be sent to.
func requireAutomation() fiber.Handler {
	return func(c *fiber.Ctx) error {
		if err := automationGate(c.Context(), authjwt.Sub(c)); err != nil {
			return err
		}
		return c.Next()
	}
}

/* ─────────────────────────────────────────────────────────────
   The app's half
   ───────────────────────────────────────────────────────────── */

// postDaemonCode mints the six characters a person types into their laptop.
func postDaemonCode(c *fiber.Ctx) error {
	code, err := ddbMintPairCode(c.Context(), authjwt.Sub(c))
	if err != nil {
		return err
	}
	return c.Status(fiber.StatusCreated).JSON(fiber.Map{
		"code":             code.Code,
		"expiresAt":        code.ExpiresAtISO(),
		"expiresInSeconds": int(ddb.PairCodeTTL.Seconds()),
	})
}

// heartbeatEvery is the cadence the daemon is documented to poll at, and
// daemonStaleAfter is how long the app waits before it stops calling a
// machine online. Three missed beats: a laptop that is merely busy should
// not flicker offline on the settings screen.
const (
	heartbeatEvery    = 30 * time.Second
	daemonStaleAfter  = 3 * heartbeatEvery
	maxDaemonName     = 80
	maxDaemonHostname = 120
	maxDaemonOS       = 60
	maxDaemonVersion  = 40
	maxCapabilities   = 12
	maxCapabilityName = 40
)

// daemonView is a daemon as the app sees it: the row, plus our own reading
// of whether it is actually there.
//
// The stored status is the daemon's own word and a laptop that closed its
// lid never got to say "offline", so the honest answer comes from the clock.
type daemonView struct {
	ddb.Daemon
	Online bool `json:"online"`
}

// daemonOnline is that reading, pure so it can be tested at a fixed instant.
func daemonOnline(d ddb.Daemon, now time.Time) bool {
	if d.Status == ddb.DaemonOffline {
		return false
	}
	if d.LastHeartbeatAt == "" {
		return false
	}
	beat, err := time.Parse(time.RFC3339, d.LastHeartbeatAt)
	if err != nil {
		return false
	}
	return now.Sub(beat) <= daemonStaleAfter
}

func getDaemons(c *fiber.Ctx) error {
	daemons, err := ddbListDaemons(c.Context(), authjwt.Sub(c))
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	releaseStaleQuestions(c, authjwt.Sub(c), daemons, now)
	releaseExpiredQuestionsForAccount(c, authjwt.Sub(c), now)

	views := make([]daemonView, 0, len(daemons))
	for _, d := range daemons {
		if d.Capabilities == nil {
			d.Capabilities = []string{}
		}
		views = append(views, daemonView{Daemon: d, Online: daemonOnline(d, now)})
	}
	return c.JSON(fiber.Map{"daemons": views})
}

// deleteDaemon unpairs. Deleting the row is the revocation: the token has
// nothing left to resolve to on the very next request.
func deleteDaemon(c *fiber.Ctx) error {
	user := authjwt.Sub(c)
	id := c.Params("id")

	// Read before deleting, so the memory key can go with it. A daemon whose
	// row cannot be read here still gets unpaired — it just leaves a GitLoom
	// key behind, confined to that person's own namespace and held by a
	// machine LYZN will no longer answer. That is a survivable, revocable
	// leftover, unlike what follows.
	var keyID string
	if daemons, err := ddbListDaemons(c.Context(), user); err == nil {
		for _, d := range daemons {
			if d.DaemonID == id {
				keyID = d.MemoryKeyID
			}
		}
	}

	// Anything this machine had pinned must be confirmed released before the
	// row goes. Once the daemon row is deleted, DaemonByToken can never
	// resolve that id again — the GSI it resolves through lives on that same
	// row — so a task still pinned to it becomes unreachable by every other
	// escape hatch too: postDaemonWorkAnswer and claim both require a live
	// credential naming this DaemonID, the expiry sweep only ever runs for
	// the daemon that calls it, and releaseStaleQuestions walks ListDaemons,
	// which no longer lists a deleted row. A release that cannot be confirmed
	// must refuse the unpair rather than risk stranding a task for good — the
	// person can simply try again, which a permanently stuck task cannot.
	if err := releasePinnedTasks(c, user, id, "the laptop it was waiting on was unpaired"); err != nil {
		log.Printf("daemons: could not confirm %s's pinned tasks were released, refusing to unpair: %v", id, err)
		return fiber.NewError(fiber.StatusInternalServerError,
			"could not confirm this machine's pending tasks were released; try again")
	}

	if err := ddbDeleteDaemon(c.Context(), user, id); err != nil {
		return err
	}
	if keyID != "" {
		if err := revokeMemoryKey(c.Context(), keyID); err != nil {
			log.Printf("daemons: revoking the memory key for %s: %v", id, err)
		}
	}
	return c.SendStatus(fiber.StatusNoContent)
}

/* ─────────────────────────────────────────────────────────────
   The daemon's half
   ───────────────────────────────────────────────────────────── */

// memoryGrant is a machine's own way into the memory layer.
//
// LYZN's memory is GitLoom, and a laptop carrying out somebody's work needs to
// read and write it — the assistant that does the work is useless without what
// the pendant heard. What it must never be given is this backend's key, which
// reaches every user's memory, so it gets one confined to that person's
// namespace and to nothing else on the account.
type memoryGrant struct {
	APIKey    string `json:"apiKey"`
	Namespace string `json:"namespace"`
	BaseURL   string `json:"baseUrl"`
}

// grantMemory mints a scoped GitLoom key for a machine and writes down which
// one it is, so it can be taken away later.
//
// Returns nil rather than an error when the account may not have one: a plan
// without automation has no machine doing work, and pairing is not the place
// to argue about it.
func grantMemory(c *fiber.Ctx, daemon ddb.Daemon) (*memoryGrant, error) {
	ok, _, err := automationState(c.Context(), daemon.UserID)
	if err != nil || !ok {
		return nil, err
	}

	name := strings.TrimSpace(daemon.Name)
	if name == "" {
		name = "LYZN machine"
	}
	key, err := mintMemoryKey(c.Context(), daemon.UserID, name)
	if err != nil {
		return nil, err
	}

	// The previous one goes as soon as its replacement exists, so a machine
	// asking twice does not leave a working key behind it.
	if daemon.MemoryKeyID != "" && daemon.MemoryKeyID != key.ID {
		if err := revokeMemoryKey(c.Context(), daemon.MemoryKeyID); err != nil {
			log.Printf("daemons: revoking the old memory key for %s: %v", daemon.DaemonID, err)
		}
	}
	if err := ddbSetMemoryKey(c.Context(), daemon.UserID, daemon.DaemonID, key.ID); err != nil {
		// The key exists and works; we simply cannot revoke it later by id.
		// Worth a line in the log and not worth failing the pairing over.
		log.Printf("daemons: recording the memory key for %s: %v", daemon.DaemonID, err)
	}

	return &memoryGrant{
		APIKey:    key.Secret,
		Namespace: key.Namespace,
		BaseURL:   gitloomx.BaseURL(),
	}, nil
}

// postDaemonMemory issues a fresh memory credential to the machine asking.
func postDaemonMemory(c *fiber.Ctx) error {
	daemon := daemonOf(c)
	grant, err := grantMemory(c, *daemon)
	if err != nil {
		log.Printf("daemons: memory for %s: %v", daemon.DaemonID, err)
		return fiber.NewError(fiber.StatusBadGateway, "could not reach the memory service just now")
	}
	if grant == nil {
		return fiber.NewError(fiber.StatusPaymentRequired, "your plan does not include automatic execution")
	}
	return c.JSON(grant)
}

type claimInput struct {
	Code         string   `json:"code"`
	Name         string   `json:"name"`
	Hostname     string   `json:"hostname"`
	OS           string   `json:"os"`
	Version      string   `json:"version"`
	Capabilities []string `json:"capabilities"`
}

// cleanCapabilities trims what a daemon says it can do down to something a
// row should hold. Advisory data: work is handed out by task status, not by
// capability, so this list is for the person reading the settings screen.
func cleanCapabilities(raw []string) []string {
	out := make([]string, 0, len(raw))
	for _, entry := range raw {
		entry = strings.TrimSpace(entry)
		if entry == "" {
			continue
		}
		out = append(out, truncate(entry, maxCapabilityName))
		if len(out) >= maxCapabilities {
			break
		}
	}
	return out
}

// postDaemonClaim is the only unauthenticated write in this file.
//
// The code is the credential. It lives five minutes, is deleted by the act of
// redeeming it, and is 30 bits of a deliberately unambiguous alphabet — so
// the window in which guessing is worth anything is five minutes wide and
// closes the moment the real daemon gets there. An unknown, expired and
// already-spent code all answer the same way on purpose: three different
// answers would make this endpoint an oracle.
func postDaemonClaim(c *fiber.Ctx) error {
	var input claimInput
	if err := c.BodyParser(&input); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "request body must be JSON")
	}

	code, err := ddbRedeemPairCode(c.Context(), input.Code)
	if err != nil {
		if errors.Is(err, ddb.ErrPairCode) {
			return fiber.NewError(fiber.StatusBadRequest, "that pairing code is not one we are waiting for")
		}
		return err
	}

	token, hash, err := ddb.NewDaemonToken()
	if err != nil {
		return err
	}

	hostname := truncate(strings.TrimSpace(input.Hostname), maxDaemonHostname)
	name := truncate(strings.TrimSpace(input.Name), maxDaemonName)
	if name == "" {
		name = hostname
	}
	if name == "" {
		name = "LYZN daemon"
	}

	daemon := ddb.Daemon{
		DaemonID:     uuid.NewString(),
		UserID:       code.UserID,
		Name:         name,
		Hostname:     hostname,
		OS:           truncate(strings.TrimSpace(input.OS), maxDaemonOS),
		Version:      truncate(strings.TrimSpace(input.Version), maxDaemonVersion),
		TokenHash:    hash,
		Status:       ddb.DaemonOnline,
		Capabilities: cleanCapabilities(input.Capabilities),
		RegisteredAt: nowISO(),
	}
	if err := ddbPutDaemon(c.Context(), daemon); err != nil {
		return err
	}

	// The one time the token exists outside the daemon's own config file.
	// It is not stored, cannot be re-read, and is not logged.
	// Memory comes with the pairing. A machine that has to ask for it
	// separately is a machine that can run for a while without it, and LYZN
	// without its memory is a worse product than LYZN that failed to pair.
	// A failure here is logged and does not fail the claim: the machine can
	// ask again on POST /daemons/memory.
	var memory *memoryGrant
	if grant, err := grantMemory(c, daemon); err != nil {
		log.Printf("daemons: memory for a new machine on %s: %v", code.UserID, err)
	} else {
		memory = grant
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{
		"daemonId":     daemon.DaemonID,
		"token":        token,
		"name":         daemon.Name,
		"registeredAt": daemon.RegisteredAt,
		"memory":       memory,
		// So a window can say what this account may do without a second call.
		// A code was minted, which means the plan carried automation a moment
		// ago; it can still lapse, which is why every later read says so too.
		"plan": planFor(c.Context(), code.UserID),
	})
}

type heartbeatInput struct {
	Status       string   `json:"status"`
	Version      string   `json:"version"`
	Capabilities []string `json:"capabilities"`
}

// postDaemonHeartbeat records that the machine is there and answers with how
// much work is waiting, so a daemon with nothing to do costs one small write
// and one counted query rather than a full work poll.
func postDaemonHeartbeat(c *fiber.Ctx) error {
	daemon := daemonOf(c)

	var input heartbeatInput
	// A heartbeat with no body at all is a heartbeat: the defaults are
	// "online" and "unchanged".
	if len(c.Body()) > 0 {
		if err := c.BodyParser(&input); err != nil {
			return fiber.NewError(fiber.StatusBadRequest, "request body must be JSON")
		}
	}

	var capabilities []string
	if input.Capabilities != nil {
		capabilities = cleanCapabilities(input.Capabilities)
	}
	err := ddbTouchDaemon(c.Context(), daemon.UserID, daemon.DaemonID,
		ddb.CoerceDaemonStatus(input.Status),
		truncate(strings.TrimSpace(input.Version), maxDaemonVersion),
		capabilities)
	if err != nil {
		if errors.Is(err, ddb.ErrDaemonGone) {
			return fiber.NewError(fiber.StatusUnauthorized, "this daemon has been unpaired")
		}
		return err
	}

	// The heartbeat sweeps too, so a task stranded by a laptop that never
	// came back is counted as waiting again even if no daemon is polling
	// for work — which is exactly the situation that stranded it.
	releaseAbandoned(c, daemon.UserID)

	waiting, err := workCount(c.Context(), daemon.UserID)
	if err != nil {
		return err
	}
	return c.JSON(fiber.Map{"ok": true, "tasks": waiting, "plan": planFor(c.Context(), daemon.UserID)})
}

// workCount is the number the heartbeat reports, and it agrees with what a
// work poll would actually hand over — including the nothing an account that
// has lost automation is handed.
func workCount(ctx context.Context, userID string) (int, error) {
	ok, _, err := automationState(ctx, userID)
	if err != nil || !ok {
		return 0, err
	}
	return ddbCountApprovedWork(ctx, userID)
}

// workContext is what the orchestrator needs to act on a promise: the
// conversation it was made in, said in three fields.
type workContext struct {
	Title   string       `json:"title"`
	Summary string       `json:"summary"`
	Facts   []types.Fact `json:"facts"`
}

// workItem is one task as the daemon receives it. Every key is present —
// no omitempty anywhere — because the thing decoding this is a program, and
// a program should not have to distinguish "absent" from "empty".
type workItem struct {
	TaskID      string         `json:"taskId"`
	Text        string         `json:"text"`
	Kind        types.TaskKind `json:"kind"`
	Quote       string         `json:"quote"`
	DueAt       string         `json:"dueAt"`
	RecordingID string         `json:"recordingId"`
	CreatedAt   string         `json:"createdAt"`
	Context     workContext    `json:"context"`
}

// getDaemonWork hands over the approved tasks nobody has claimed, oldest
// first.
//
// An account that has since lost automation gets an empty list rather than a
// 402: the daemon was paired when the plan was live, it is not the party who
// stopped paying, and there is no screen on a laptop to show a price on.
func getDaemonWork(c *fiber.Ctx) error {
	daemon := daemonOf(c)

	ok, _, err := automationState(c.Context(), daemon.UserID)
	if err != nil {
		return err
	}
	if !ok {
		return c.JSON(fiber.Map{"tasks": []workItem{}})
	}

	// Anything a laptop took and never finished comes back first, so the
	// poll that follows can offer it again. A claim is a loan.
	releaseAbandoned(c, daemon.UserID)

	tasks, err := ddbApprovedWork(c.Context(), daemon.UserID, ddb.DefaultWorkLimit)
	if err != nil {
		return err
	}
	resumable, err := resumableBlockedWork(c, daemon.UserID, daemon.DaemonID)
	if err != nil {
		return err
	}
	// Resumable work first: it was already mid-flight, and somebody is
	// waiting on the other end of the answer that unblocked it.
	tasks = append(resumable, tasks...)

	// `?format=ids` answers with a bare array of task ids.
	//
	// It exists for KARMAX's recipe tier, whose whole language can iterate a
	// JSON array of scalars and cannot reach inside an object. That is a
	// real constraint of the thing on the other end, and one query parameter
	// is a smaller price than telling every operator to install a toolchain
	// and sign a WebAssembly artifact to run their own tasks.
	idsOnly := c.Query("format") == "ids"
	ids := make([]string, 0, len(tasks))

	// One read per conversation, not per task: a conversation usually
	// contains several promises and they all carry the same context.
	contexts := map[string]workContext{}
	items := make([]workItem, 0, len(tasks))
	for _, task := range tasks {
		// The ids form is answered before any conversation is read: its
		// whole point is to be the cheap question.
		if idsOnly {
			ids = append(ids, task.TaskID)
			continue
		}
		context := workContext{Facts: []types.Fact{}}
		if task.RecordingID != "" {
			if known, seen := contexts[task.RecordingID]; seen {
				context = known
			} else {
				rec, err := ddbGetRecording(c.Context(), daemon.UserID, task.RecordingID)
				if err != nil {
					// A conversation that cannot be read is not a reason to
					// withhold the promise: the task's own text and quote
					// are enough to act on, and the daemon says so.
					log.Printf("daemons: work context for %s: %v", task.RecordingID, err)
				} else if rec != nil {
					context = workContext{Title: rec.Title, Summary: rec.Summary, Facts: rec.Facts}
					if context.Facts == nil {
						context.Facts = []types.Fact{}
					}
				}
				contexts[task.RecordingID] = context
			}
		}
		items = append(items, workItem{
			TaskID:      task.TaskID,
			Text:        task.Text,
			Kind:        task.Kind,
			Quote:       task.Quote,
			DueAt:       task.DueAt,
			RecordingID: task.RecordingID,
			CreatedAt:   task.CreatedAt,
			Context:     context,
		})
	}
	if idsOnly {
		return c.JSON(ids)
	}
	return c.JSON(fiber.Map{"tasks": items})
}

// resumableBlockedWork is this daemon's own blocked tasks whose question now
// has an answer — the other half of the queue, alongside approved work
// nobody has claimed. A blocked task pinned to a different daemon, or still
// waiting on its answer, is not offered.
func resumableBlockedWork(c *fiber.Ctx, userID, daemonID string) ([]ddb.Task, error) {
	blocked, err := ddbBlockedWork(c.Context(), userID)
	if err != nil {
		return nil, err
	}
	out := make([]ddb.Task, 0, len(blocked))
	for _, t := range blocked {
		if t.DaemonID == daemonID && ddb.QuestionAnswered(t) {
			out = append(out, t)
		}
	}
	return out, nil
}

// historyItem is one task in the account's recent execution history, with the
// receipt it printed when it has one.
type historyItem struct {
	workItem
	Status string `json:"status"`
	// Mine says this machine is the one that ran it. False for a task another
	// paired laptop took: an account can have several, and a window that
	// claimed credit for all of them would be lying.
	Mine       bool         `json:"mine"`
	DaemonID   string       `json:"daemonId"`
	ClaimedAt  string       `json:"claimedAt"`
	FinishedAt string       `json:"finishedAt"`
	Receipt    *ddb.Receipt `json:"receipt"`
	// Question rides along on every item that ever had one — a currently
	// blocked task and a finished task that was once blocked alike, since
	// none of the transitions below this ever clear it off the row. Null
	// when the task was never blocked.
	Question *ddb.TaskQuestion `json:"question"`
}

// getDaemonHistory answers with what is waiting, what is running and what has
// been finished — the three states a person watching a machine work actually
// wants to see.
//
// The daemon API has only ever handed out the next thing to do, which is all a
// loop needs and not enough for a window: "nothing waiting" and "nothing ever
// happened" look identical through that endpoint. This is the read behind a
// screen rather than behind a loop, which is why it is the one endpoint here
// that returns receipts.
func getDaemonHistory(c *fiber.Ctx) error {
	daemon := daemonOf(c)

	ok, _, err := automationState(c.Context(), daemon.UserID)
	if err != nil {
		return err
	}
	if !ok {
		return c.JSON(fiber.Map{
			"waiting": []historyItem{}, "running": []historyItem{}, "blocked": []historyItem{}, "finished": []historyItem{},
			"plan": planFor(c.Context(), daemon.UserID),
		})
	}

	limit := int32(25)
	if raw := strings.TrimSpace(c.Query("limit")); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 && n <= 100 {
			limit = int32(n)
		}
	}

	// One page per state. Each is its own GSI1 partition, so this is five
	// small queries rather than a scan with a filter.
	read := func(status ddb.TaskStatus) ([]historyItem, error) {
		tasks, _, err := ddbListTasks(c.Context(), daemon.UserID, status, limit, "")
		if err != nil {
			return nil, err
		}
		out := make([]historyItem, 0, len(tasks))
		for _, task := range tasks {
			item := historyItem{
				workItem:   workItemFor(c, daemon.UserID, task),
				Status:     string(task.Status),
				Mine:       task.DaemonID == daemon.DaemonID,
				DaemonID:   task.DaemonID,
				ClaimedAt:  task.ClaimedAt,
				FinishedAt: task.DoneAt,
				Question:   task.Question,
			}
			if task.ReceiptID != "" {
				// A receipt that cannot be read is not a reason to withhold the
				// task: the row itself already says what happened.
				if receipt, err := ddbGetReceipt(c.Context(), daemon.UserID, task.ReceiptID); err == nil {
					item.Receipt = receipt
				}
			}
			out = append(out, item)
		}
		return out, nil
	}

	waiting, err := read(ddb.TaskApproved)
	if err != nil {
		return err
	}
	running, err := read(ddb.TaskExecuting)
	if err != nil {
		return err
	}
	// Blocked is its own list rather than folded into running: a question
	// parked mid-task is a different thing for a person to look at than a
	// task quietly executing, and — unlike the other three — it can carry a
	// question already answered and simply not yet picked back up, which the
	// laptop shows as "answered, waiting to resume".
	blocked, err := read(ddb.TaskBlocked)
	if err != nil {
		return err
	}
	done, err := read(ddb.TaskDone)
	if err != nil {
		return err
	}
	failed, err := read(ddb.TaskFailed)
	if err != nil {
		return err
	}

	// Finished is done and failed together, newest first: a person looking at
	// this wants the last thing that happened, whichever way it went.
	finished := append(done, failed...)
	sort.SliceStable(finished, func(i, j int) bool {
		return finishedAt(finished[i]) > finishedAt(finished[j])
	})
	if len(finished) > int(limit) {
		finished = finished[:limit]
	}

	return c.JSON(fiber.Map{
		"waiting": waiting, "running": running, "blocked": blocked, "finished": finished,
		"plan": planFor(c.Context(), daemon.UserID),
	})
}

// finishedAt is what a finished task is sorted by, falling back through the
// timestamps a row is guaranteed to have.
func finishedAt(h historyItem) string {
	if h.FinishedAt != "" {
		return h.FinishedAt
	}
	if h.ClaimedAt != "" {
		return h.ClaimedAt
	}
	return h.CreatedAt
}

// releaseAbandoned puts back every task whose lease has run out.
//
// It is best-effort on purpose: this runs at the top of a poll, and a
// release that fails must not cost the daemon the work it could still do.
// A task released by one poll is simply released by the next. A conditional
// refusal is not even a failure — it means the daemon that held it finished
// while we were looking, which is the outcome we wanted anyway.
func releaseAbandoned(c *fiber.Ctx, userID string) {
	stale, err := ddbExpiredWork(c.Context(), userID, time.Now().UTC())
	if err != nil {
		log.Printf("daemons: reading held work for %s: %v", userID, err)
		return
	}
	for _, task := range stale {
		if _, err := ddbReleaseWork(c.Context(), task); err != nil {
			if !errors.Is(err, ddb.ErrTaskTransition) {
				log.Printf("daemons: releasing %s: %v", task.TaskID, err)
			}
			continue
		}
		log.Printf("daemons: %s went back on the queue — its lease ran out", task.TaskID)
	}
}

// failBlockedTask is the ordinary way a blocked task is closed without an
// answer: the expiry sweep below, and the first attempt an unpaired or
// long-stale daemon makes at giving up its pinned tasks. It refuses — via
// ddbFailBlockedWork's own guardUnanswered condition — the one case that is
// not this: a question that was just answered. See failAnsweredBlockedTask
// for that case, and releasePinnedTasks for how the two are told apart.
func failBlockedTask(c *fiber.Ctx, task ddb.Task, reason string) error {
	now := nowISO()
	receipt := ddb.ReceiptFromWork(task, ddb.Daemon{DaemonID: task.DaemonID},
		ddb.WorkResult{Outcome: "failure", Summary: reason, StartedAt: task.ClaimedAt, FinishedAt: now},
		uuid.NewString(), now)
	if _, _, err := ddbFailBlockedWork(c.Context(), task, receipt); err != nil {
		if !errors.Is(err, ddb.ErrTaskTransition) {
			log.Printf("daemons: failing %s: %v", task.TaskID, err)
		}
		return err
	}
	log.Printf("daemons: %s failed — %s", task.TaskID, reason)
	return nil
}

// failAnsweredBlockedTask is releasePinnedTasks' second attempt: reached only
// after failBlockedTask has already been refused and a re-read shows the
// task is still blocked, which — because ddbFailBlockedWork's only two
// conditions are "still blocked" and "not yet answered" — can only mean the
// question was answered in between. The daemon this task is pinned to is
// going away regardless (that is why releasePinnedTasks was called at all),
// so the answer has nowhere left to be resumed; this closes the task with it
// still visible on the row, rather than leaving it blocked and unreachable.
func failAnsweredBlockedTask(c *fiber.Ctx, task ddb.Task, reason string) error {
	now := nowISO()
	receipt := ddb.ReceiptFromWork(task, ddb.Daemon{DaemonID: task.DaemonID},
		ddb.WorkResult{Outcome: "failure", Summary: reason, StartedAt: task.ClaimedAt, FinishedAt: now},
		uuid.NewString(), now)
	if _, _, err := ddbFailAnsweredBlockedWork(c.Context(), task, receipt); err != nil {
		if !errors.Is(err, ddb.ErrTaskTransition) {
			log.Printf("daemons: failing answered %s: %v", task.TaskID, err)
		}
		return err
	}
	log.Printf("daemons: %s failed — %s (question had just been answered)", task.TaskID, reason)
	return nil
}

// releaseExpiredQuestions fails every blocked task this daemon holds whose
// question passed its own expiry with no answer, and returns their ids — the
// daemon's own signal, on its next poll, to reclaim whatever local session
// each one was holding. Best-effort, like releaseAbandoned: a failure here
// costs a log line, because the same sweep runs again next poll.
func releaseExpiredQuestions(c *fiber.Ctx, userID, daemonID string) []string {
	blocked, err := ddbBlockedWork(c.Context(), userID)
	if err != nil {
		log.Printf("daemons: reading blocked work for %s: %v", userID, err)
		return nil
	}
	now := time.Now().UTC()
	var released []string
	for _, task := range blocked {
		if task.DaemonID != daemonID || !ddb.QuestionExpired(task, now) {
			continue
		}
		if err := failBlockedTask(c, task, "nobody answered before the question expired"); err == nil {
			released = append(released, task.TaskID)
		}
	}
	return released
}

// releaseExpiredQuestionsForAccount is releaseExpiredQuestions' other half:
// it sweeps every daemon on the account, not just one.
//
// releaseExpiredQuestions only ever runs from GET /daemons/sessions/expired,
// which only the shipped lyzn-tasks.yaml recipe polls — the KARMAX connector
// posts /daemons/heartbeat on its own schedule, independent of that recipe.
// A laptop whose recipe is disabled, edited, or simply older than this fix
// keeps its heartbeat fresh regardless, so releaseStaleQuestions' 48-hour
// window never opens and question.expiresAt is never enforced at all — the
// field is decorative unless that one recipe happens to be the thing
// polling. getDaemons already runs releaseStaleQuestions on every app open;
// this rides the same request to sweep expiry too, so an expired question
// gets closed the moment anyone next opens the app, whether or not the
// recipe that would otherwise notice it is even running.
//
// Best-effort, the same as releaseStaleQuestions: a failure here costs a log
// line inside failBlockedTask, and the next GET /daemons tries again.
func releaseExpiredQuestionsForAccount(c *fiber.Ctx, userID string, now time.Time) {
	blocked, err := ddbBlockedWork(c.Context(), userID)
	if err != nil {
		log.Printf("daemons: reading blocked work for %s: %v", userID, err)
		return
	}
	for _, task := range blocked {
		if !ddb.QuestionExpired(task, now) {
			continue
		}
		_ = failBlockedTask(c, task, "nobody answered before the question expired")
	}
}

// getDaemonExpiredSessions sweeps, then answers a bare array of the ids it
// just failed — the same shape GET /daemons/work?format=ids uses, because
// the recipe tier that reads this can only walk a JSON array of scalars.
// This is its own endpoint rather than a field on the heartbeat's response
// for exactly that reason: a bare array and an object cannot both be the
// heartbeat's answer, and internal/connectors/lyzn's beat() already parses
// the heartbeat as {ok, tasks} — a second caller with a different shape in
// mind must not have to touch it.
func getDaemonExpiredSessions(c *fiber.Ctx) error {
	daemon := daemonOf(c)
	released := releaseExpiredQuestions(c, daemon.UserID, daemon.DaemonID)
	if released == nil {
		released = []string{}
	}
	return c.JSON(released)
}

// releasePinnedTasks fails every task pinned to one daemon that is about to
// stop existing, or has not been heard from in a long while — the unpair and
// staleness escape hatches. reason is what the receipt says happened.
//
// It reports an error whenever it cannot be sure every task pinned to this
// daemon was actually released: the read failed, or a release attempt failed
// for a reason other than the task having genuinely moved on. That last part
// takes a second step now: failBlockedTask's own guardUnanswered condition
// returns ErrTaskTransition both when the task truly left blocked on its own
// (nothing to release) *and* when it is still blocked but was just
// answered — a case this must not wave through, because deleteDaemon is
// about to delete the only row DaemonByToken can ever resolve this id
// through again, which would stop every other escape hatch (claim, answer,
// both sweeps) from ever reaching it. A re-read tells the two apart: gone
// from blocked means released; still blocked means answered, and gets
// closed the other way, by failAnsweredBlockedTask, before this may report
// success. deleteDaemon uses that success to decide whether the unpair may
// proceed; releaseStaleQuestions, which runs best-effort on every daemon
// list read, logs a failure here and moves on the same way it always has.
func releasePinnedTasks(c *fiber.Ctx, userID, daemonID, reason string) error {
	blocked, err := ddbBlockedWork(c.Context(), userID)
	if err != nil {
		log.Printf("daemons: reading blocked work for %s: %v", userID, err)
		return err
	}
	for _, task := range blocked {
		if task.DaemonID != daemonID {
			continue
		}
		if err := failBlockedTask(c, task, reason); err != nil {
			if !errors.Is(err, ddb.ErrTaskTransition) {
				return err
			}
			fresh, gerr := ddbGetTask(c.Context(), userID, task.TaskID)
			if gerr != nil {
				log.Printf("daemons: re-reading %s to confirm release: %v", task.TaskID, gerr)
				return gerr
			}
			if fresh == nil || fresh.Status != ddb.TaskBlocked {
				// Left blocked on its own between the list read and the fail
				// attempt — already released, nothing more to do.
				continue
			}
			// Still blocked: the only way failBlockedTask's guard refuses a
			// task that has not moved is that its question was just
			// answered. Close it the way that does not discard the answer.
			if aerr := failAnsweredBlockedTask(c, *fresh, reason); aerr != nil && !errors.Is(aerr, ddb.ErrTaskTransition) {
				return aerr
			}
		}
	}
	return nil
}

// staleDaemonQuestionWindow is deliberately much longer than
// daemonStaleAfter (the 90-second "online dot"): a laptop closed for a long
// weekend has not abandoned the question it asked, and releasing one that
// fast would strand an honest answer that was on its way.
const staleDaemonQuestionWindow = 48 * time.Hour

// releaseStaleQuestions is the other half of "an unpaired or stale daemon
// releases its pinned tasks": a daemon that never explicitly unpaired but
// has gone dark for staleDaemonQuestionWindow is, for a pinned question's
// purposes, gone. There is no ticker on this side of the process — only
// Lambda invocations — so this rides whichever request happens to ask what
// machines the account has.
func releaseStaleQuestions(c *fiber.Ctx, userID string, daemons []ddb.Daemon, now time.Time) {
	for _, d := range daemons {
		if d.LastHeartbeatAt == "" {
			continue
		}
		beat, err := time.Parse(time.RFC3339, d.LastHeartbeatAt)
		if err != nil || now.Sub(beat) < staleDaemonQuestionWindow {
			continue
		}
		// Best-effort, like releaseAbandoned: this rides an ordinary daemon
		// list read, and a release that fails here costs a log line — the
		// next read of this account's daemons tries again. Unlike the unpair
		// hatch, nothing destroys the row this failure would need to survive.
		_ = releasePinnedTasks(c, userID, d.DaemonID, "its laptop has not been heard from in a while")
	}
}

// loadDaemonTask reads one task inside the account the token is bound to. A
// task id from another account is a 404, exactly as it is for a person.
func loadDaemonTask(c *fiber.Ctx) (*ddb.Task, error) {
	daemon := daemonOf(c)
	task, err := ddbGetTask(c.Context(), daemon.UserID, c.Params("taskId"))
	if err != nil {
		return nil, err
	}
	if task == nil {
		return nil, fiber.NewError(fiber.StatusNotFound, "no such task")
	}
	return task, nil
}

// workItemFor is the claim's second answer: the same shape the poll hands
// over, for a caller that took the task by id alone. A recipe asks for ids,
// claims one, and needs the words to work from — this is where it gets them.
func workItemFor(c *fiber.Ctx, userID string, task ddb.Task) workItem {
	context := workContext{Facts: []types.Fact{}}
	if task.RecordingID != "" {
		if rec, err := ddbGetRecording(c.Context(), userID, task.RecordingID); err == nil && rec != nil {
			context = workContext{Title: rec.Title, Summary: rec.Summary, Facts: rec.Facts}
			if context.Facts == nil {
				context.Facts = []types.Fact{}
			}
		}
	}
	return workItem{
		TaskID: task.TaskID, Text: task.Text, Kind: task.Kind, Quote: task.Quote,
		DueAt: task.DueAt, RecordingID: task.RecordingID, CreatedAt: task.CreatedAt,
		Context: context,
	}
}

// postDaemonWorkClaim takes a task off the queue: approved → executing,
// conditional, so the second daemon to reach for the same promise is told
// 409 rather than running it a second time.
func postDaemonWorkClaim(c *fiber.Ctx) error {
	daemon := daemonOf(c)
	task, err := loadDaemonTask(c)
	if err != nil {
		return err
	}

	// A daemon re-claiming what it already holds — a restarted loop with the
	// task still in hand — is not a conflict.
	if task.Status == ddb.TaskExecuting && task.DaemonID == daemon.DaemonID {
		return c.JSON(fiber.Map{"task": *task})
	}

	// A blocked task pinned to this daemon, now answered, resumes rather
	// than being claimed fresh: it was never released, so there is nothing
	// here for a different machine to have raced for.
	if task.Status == ddb.TaskBlocked {
		if task.DaemonID != daemon.DaemonID {
			return fiber.NewError(fiber.StatusConflict, "this task is pinned to a different machine")
		}
		if !ddb.QuestionAnswered(*task) {
			return fiber.NewError(fiber.StatusConflict, "nobody has answered this task's question yet")
		}
		resumed, err := ddbResumeBlockedWork(c.Context(), *task, daemon.DaemonID)
		if err != nil {
			if errors.Is(err, ddb.ErrTaskTransition) {
				return fiber.NewError(fiber.StatusConflict, "this task is not waiting to be resumed")
			}
			return err
		}
		return c.JSON(fiber.Map{"task": resumed, "work": workItemFor(c, daemon.UserID, resumed)})
	}

	claimed, err := ddbClaimWork(c.Context(), *task, daemon.DaemonID)
	if err != nil {
		if errors.Is(err, ddb.ErrTaskTransition) {
			return fiber.NewError(fiber.StatusConflict, "this task is not waiting to be claimed")
		}
		return err
	}
	return c.JSON(fiber.Map{"task": claimed, "work": workItemFor(c, daemon.UserID, claimed)})
}

const (
	maxQuestionText      = 500
	maxQuestionOptions   = 6
	maxQuestionOptionLen = 60
)

type questionInput struct {
	Text             string   `json:"text"`
	Options          []string `json:"options"`
	ExpiresInSeconds int      `json:"expiresInSeconds"`
}

// questionFrom mirrors resultFrom (above, in this same file): JSON for a
// normal caller, or the harness's own text/plain reply, parsed the same way
// parseHarnessReply already reads a result — so a blocked task's question is
// the model's own SUMMARY sentence, not the whole STATUS/SUMMARY-framed
// blob. This is what lets the recipe post its raw {{ .reply }} straight
// through with no string-splitting of its own (Task 12).
func questionFrom(c *fiber.Ctx) (questionInput, error) {
	if !strings.HasPrefix(strings.ToLower(strings.TrimSpace(string(c.Request().Header.ContentType()))), "text/plain") {
		var input questionInput
		if err := c.BodyParser(&input); err != nil {
			return input, fiber.NewError(fiber.StatusBadRequest, "request body must be JSON, or text/plain carrying the harness's reply")
		}
		return input, nil
	}
	return questionInput{Text: parseHarnessReply(string(c.Body())).Summary}, nil
}

// cleanQuestionOptions trims and caps what a daemon offers as choices — the
// same shape cleanCapabilities already uses for a different list.
func cleanQuestionOptions(raw []string) []string {
	out := make([]string, 0, len(raw))
	for _, entry := range raw {
		entry = strings.TrimSpace(entry)
		if entry == "" {
			continue
		}
		out = append(out, truncate(entry, maxQuestionOptionLen))
		if len(out) >= maxQuestionOptions {
			break
		}
	}
	return out
}

// postDaemonWorkQuestion parks a claimed task on a question instead of
// closing it. Unlike /result this is not terminal: the task stays pinned to
// this daemon (releaseAbandoned never sees it — it only ever reads the
// executing partition), and the only way out is an answer or the question's
// own expiry.
func postDaemonWorkQuestion(c *fiber.Ctx) error {
	daemon := daemonOf(c)
	task, err := loadDaemonTask(c)
	if err != nil {
		return err
	}
	if task.Status != ddb.TaskExecuting || task.DaemonID != daemon.DaemonID {
		return fiber.NewError(fiber.StatusConflict, "this task is not yours to block")
	}

	input, err := questionFrom(c)
	if err != nil {
		return err
	}
	text := truncate(strings.TrimSpace(input.Text), maxQuestionText)
	if text == "" {
		return fiber.NewError(fiber.StatusBadRequest, "a question needs text")
	}
	ttl := ddb.DefaultQuestionTTL
	if input.ExpiresInSeconds > 0 {
		ttl = time.Duration(input.ExpiresInSeconds) * time.Second
	}
	now := time.Now().UTC()
	q := ddb.TaskQuestion{
		ID:        uuid.NewString(),
		Text:      text,
		Options:   cleanQuestionOptions(input.Options),
		AskedBy:   daemon.DaemonID,
		AskedAt:   now.Format(time.RFC3339),
		ExpiresAt: now.Add(ttl).Format(time.RFC3339),
	}

	updated, err := ddbBlockTask(c.Context(), *task, q)
	if err != nil {
		if errors.Is(err, ddb.ErrTaskTransition) {
			return fiber.NewError(fiber.StatusConflict, "this task is not executing")
		}
		return err
	}
	notifyTaskQuestion(c.Context(), daemon.UserID, updated)
	return c.JSON(fiber.Map{"task": updated})
}

// notifyTaskQuestion tells the phone something is waiting on an answer.
// Best-effort, like notifyReceiptPrinted: the question is asked whether or
// not Expo is reachable.
func notifyTaskQuestion(ctx context.Context, userID string, t ddb.Task) {
	if t.Question == nil {
		return
	}
	tokens, err := ddbListPushTokens(ctx, userID)
	if err != nil {
		log.Printf("daemons: reading push tokens: %v", err)
		return
	}
	addresses := make([]string, 0, len(tokens))
	for _, token := range tokens {
		addresses = append(addresses, token.Token)
	}
	if len(addresses) == 0 {
		return
	}
	dead, err := sendPush(ctx, push.TaskQuestion(addresses, t.TaskID, t.Question.Text))
	if err != nil {
		log.Printf("daemons: sending task.question: %v", err)
	}
	for _, token := range dead {
		if err := ddbDeletePushToken(ctx, userID, token); err != nil {
			log.Printf("daemons: forgetting a dead push token: %v", err)
		}
	}
}

const maxAnswerText = 400

// postDaemonWorkAnswer is how a reply reaches the task row over the daemon's
// own credential rather than Clerk's — a comms-channel answer KARMAX may have
// delivered outside the app, or now the laptop's own Tasks screen answering
// the question it just showed. "by" says which; its counterpart on the Clerk
// side is answerTask (internal/api/tasks.go), which always writes "app" —
// three surfaces, one write.
func postDaemonWorkAnswer(c *fiber.Ctx) error {
	daemon := daemonOf(c)
	task, err := loadDaemonTask(c)
	if err != nil {
		return err
	}
	if task.Status != ddb.TaskBlocked || task.DaemonID != daemon.DaemonID {
		return fiber.NewError(fiber.StatusConflict, "this task is not waiting on an answer from your account")
	}

	var input struct {
		Answer string `json:"answer"`
		By     string `json:"by"`
	}
	if err := c.BodyParser(&input); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "request body must be JSON")
	}
	answer := truncate(strings.TrimSpace(input.Answer), maxAnswerText)
	if answer == "" {
		return fiber.NewError(fiber.StatusBadRequest, "an answer needs text")
	}
	// Empty stays "comms": the comms channel has been posting here with no
	// "by" at all since before the desktop app existed, and that silence
	// must keep meaning what it always meant.
	by := strings.TrimSpace(input.By)
	if by == "" {
		by = "comms"
	} else if by != "desktop" && by != "comms" {
		return fiber.NewError(fiber.StatusBadRequest, `by must be "desktop" or "comms"`)
	}
	if ddb.QuestionAnswered(*task) {
		return c.JSON(fiber.Map{"task": *task})
	}

	updated, err := ddbAnswerQuestion(c.Context(), *task, answer, by)
	if err != nil {
		if errors.Is(err, ddb.ErrTaskTransition) {
			return fiber.NewError(fiber.StatusConflict, "this question is no longer open")
		}
		return err
	}
	return c.JSON(fiber.Map{"task": updated})
}

// resultFrom reads a result as JSON, or as the harness's own reply.
//
// A recipe cannot compose JSON — it has no way to build an object from a
// string it holds. What it does have is the harness's whole answer, which
// ends in the two lines the loop's prompt demanded:
//
//	STATUS: done | blocked | failed
//	SUMMARY: <one sentence>
//
// So a `text/plain` body is accepted and parsed for that contract. It is
// deliberately strict: an answer with no STATUS line is a failure with the
// reply as its summary, never a success, because a harness that refuses or
// wanders off prints prose and exits zero, and reporting that as done would
// print a receipt for work nobody did.
func resultFrom(c *fiber.Ctx) (resultInput, error) {
	if !strings.HasPrefix(strings.ToLower(strings.TrimSpace(string(c.Request().Header.ContentType()))), "text/plain") {
		var input resultInput
		if err := c.BodyParser(&input); err != nil {
			return input, fiber.NewError(fiber.StatusBadRequest, "request body must be JSON, or text/plain carrying the harness's reply")
		}
		return input, nil
	}
	return parseHarnessReply(string(c.Body())), nil
}

// parseHarnessReply is the contract, pure so it can be tested without a body.
func parseHarnessReply(reply string) resultInput {
	status, summary := "", ""
	for _, line := range strings.Split(reply, "\n") {
		trimmed := strings.TrimSpace(line)
		switch {
		case strings.HasPrefix(strings.ToUpper(trimmed), "STATUS:"):
			status = strings.ToLower(strings.TrimSpace(trimmed[len("STATUS:"):]))
		case strings.HasPrefix(strings.ToUpper(trimmed), "SUMMARY:"):
			summary = strings.TrimSpace(trimmed[len("SUMMARY:"):])
		}
	}
	if summary == "" {
		// No summary line: keep the tail of what it did say, so the receipt
		// carries something a person can read rather than an empty row.
		summary = strings.TrimSpace(reply)
		if len(summary) > maxResultSummary {
			summary = summary[len(summary)-maxResultSummary:]
		}
	}
	outcome := "failure"
	if status == "done" {
		outcome = "success"
	}
	return resultInput{Outcome: outcome, Summary: summary, FinishedAt: time.Now().UTC().Format(time.RFC3339)}
}

type resultInput struct {
	Outcome    string         `json:"outcome"`
	Summary    string         `json:"summary"`
	StartedAt  string         `json:"startedAt"`
	FinishedAt string         `json:"finishedAt"`
	Artifacts  []ddb.Artifact `json:"artifacts"`
}

const (
	maxResultSummary = 1000
	maxArtifactName  = 120
	maxArtifactURI   = 400
	maxArtifactsSent = 24
)

// postDaemonWorkResult closes the task and prints the receipt in one write.
//
// Idempotent, and it has to be: a daemon that posted a result and lost the
// reply on the way back will post it again, and the answer to that is the
// receipt the first one printed — not a second receipt for one promise. The
// transaction's condition is what enforces it; this handler only recognises
// the refusal and reads back what already happened.
func postDaemonWorkResult(c *fiber.Ctx) error {
	daemon := daemonOf(c)
	task, err := loadDaemonTask(c)
	if err != nil {
		return err
	}

	input, err := resultFrom(c)
	if err != nil {
		return err
	}
	result, err := cleanResult(input, task.ClaimedAt)
	if err != nil {
		return err
	}

	// Already closed: answer with what was printed then.
	if task.Status == ddb.TaskDone || task.Status == ddb.TaskFailed {
		return alreadyFinished(c, *task)
	}

	receiptID := uuid.NewString()
	receipt := ddb.ReceiptFromWork(*task, *daemon, result, receiptID, result.FinishedAt)
	to := ddb.TaskFailed
	if result.Succeeded() {
		to = ddb.TaskDone
	}

	updated, printed, err := ddbFinishWork(c.Context(), *task, receipt, to)
	if err != nil {
		if errors.Is(err, ddb.ErrTaskTransition) {
			// Either somebody else closed it — in which case the honest
			// answer is their receipt — or it was never claimed.
			fresh, ferr := ddbGetTask(c.Context(), daemon.UserID, task.TaskID)
			if ferr == nil && fresh != nil && (fresh.Status == ddb.TaskDone || fresh.Status == ddb.TaskFailed) {
				return alreadyFinished(c, *fresh)
			}
			return fiber.NewError(fiber.StatusConflict, "this task is not being executed; claim it first")
		}
		return err
	}

	notifyReceiptPrinted(c.Context(), daemon.UserID, printed)
	return c.JSON(fiber.Map{"task": updated, "receipt": printed})
}

// alreadyFinished answers a repeated result with the receipt the first one
// printed.
func alreadyFinished(c *fiber.Ctx, task ddb.Task) error {
	if task.ReceiptID == "" {
		return c.JSON(fiber.Map{"task": task, "receipt": nil})
	}
	receipt, err := ddbGetReceipt(c.Context(), task.UserID, task.ReceiptID)
	if err != nil {
		return err
	}
	return c.JSON(fiber.Map{"task": task, "receipt": receipt})
}

// cleanResult validates what the daemon reported and fills in what it left
// out. The outcome is the one field with no default: a run that will not say
// whether it worked has not reported a result.
//
// claimedAt is the task's own ClaimedAt, passed in because a text/plain
// harness reply carries no startedAt at all (see parseHarnessReply): the
// claim time is the honest start, and only when it too is unusable does the
// finish time stand in for it.
func cleanResult(input resultInput, claimedAt string) (ddb.WorkResult, error) {
	outcome := strings.ToLower(strings.TrimSpace(input.Outcome))
	if outcome != "success" && outcome != "failure" {
		return ddb.WorkResult{}, fiber.NewError(fiber.StatusBadRequest, `outcome must be "success" or "failure"`)
	}
	if len(input.Artifacts) > maxArtifactsSent {
		return ddb.WorkResult{}, fiber.NewError(fiber.StatusBadRequest, "that is more artifacts than a receipt can carry")
	}

	finishedAt, err := instantOr(input.FinishedAt, nowISO())
	if err != nil {
		return ddb.WorkResult{}, fiber.NewError(fiber.StatusBadRequest, "finishedAt must be an RFC3339 timestamp")
	}
	startedAt, err := instantOr(input.StartedAt, "")
	if err != nil {
		return ddb.WorkResult{}, fiber.NewError(fiber.StatusBadRequest, "startedAt must be an RFC3339 timestamp")
	}
	if startedAt == "" {
		if claimed, err := instantOr(claimedAt, ""); err == nil && claimed != "" {
			startedAt = claimed
		} else {
			startedAt = finishedAt
		}
	}

	artifacts := make([]ddb.Artifact, 0, len(input.Artifacts))
	for _, artifact := range input.Artifacts {
		artifact.Name = truncate(strings.TrimSpace(artifact.Name), maxArtifactName)
		artifact.URI = truncate(strings.TrimSpace(artifact.URI), maxArtifactURI)
		if artifact.Name == "" && artifact.URI == "" {
			continue
		}
		artifacts = append(artifacts, artifact)
	}

	return ddb.WorkResult{
		Outcome:    outcome,
		Summary:    truncate(strings.TrimSpace(input.Summary), maxResultSummary),
		StartedAt:  startedAt,
		FinishedAt: finishedAt,
		Artifacts:  artifacts,
	}, nil
}

// instantOr validates an optional timestamp, falling back to a default.
func instantOr(raw, fallback string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return fallback, nil
	}
	when, err := time.Parse(time.RFC3339, raw)
	if err != nil {
		return "", err
	}
	return when.UTC().Format(time.RFC3339), nil
}

// notifyReceiptPrinted tells the phone that something was carried out while
// nobody was watching — the one notification this whole round is for.
//
// Best-effort, and deliberately unable to fail the request: the work is done
// and the receipt is written whether or not Expo was reachable.
func notifyReceiptPrinted(ctx context.Context, userID string, r ddb.Receipt) {
	tokens, err := ddbListPushTokens(ctx, userID)
	if err != nil {
		log.Printf("daemons: reading push tokens: %v", err)
		return
	}
	addresses := make([]string, 0, len(tokens))
	for _, token := range tokens {
		addresses = append(addresses, token.Token)
	}
	if len(addresses) == 0 {
		return
	}

	dead, err := sendPush(ctx, push.ReceiptPrinted(addresses, r.ReceiptID, r.TaskID, r.Title))
	if err != nil {
		log.Printf("daemons: sending receipt.printed: %v", err)
	}
	for _, token := range dead {
		if err := ddbDeletePushToken(ctx, userID, token); err != nil {
			log.Printf("daemons: forgetting a dead push token: %v", err)
		}
	}
}
