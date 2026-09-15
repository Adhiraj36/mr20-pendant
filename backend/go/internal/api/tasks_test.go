package api

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/gofiber/fiber/v2"

	"github.com/MelloB1989/mr20-pendant/backend/internal/ddb"
	"github.com/MelloB1989/mr20-pendant/backend/internal/types"
)

// A client may print the two proofs it witnesses and nothing else: a task's
// receipt comes from closing the task, and its stamp is not the sender's to
// choose.
func TestPrintableReceiptKinds(t *testing.T) {
	if stampFor[ddb.ReceiptPairing] != ddb.StampReady {
		t.Fatalf("pairing stamp = %q", stampFor[ddb.ReceiptPairing])
	}
	if stampFor[ddb.ReceiptPlan] != ddb.StampUnlocked {
		t.Fatalf("plan stamp = %q", stampFor[ddb.ReceiptPlan])
	}
	for _, refused := range []ddb.ReceiptKind{ddb.ReceiptTask, ddb.ReceiptConversation, "", "anything"} {
		if _, ok := stampFor[refused]; ok {
			t.Fatalf("%q must not be printable by a client", refused)
		}
	}
}

func TestSameSpeakers(t *testing.T) {
	// Re-saving an unchanged panel must not re-file a conversation: a
	// re-ingest is a metered write and, since GitLoom cannot supersede, a
	// possible duplicate.
	if !sameSpeakers(map[string]string{"0": "Priya"}, map[string]string{"0": "Priya"}) {
		t.Fatal("identical maps must compare equal")
	}
	if sameSpeakers(map[string]string{"0": "Priya"}, map[string]string{"0": "Priya", "1": "Arjun"}) {
		t.Fatal("an added name is a change")
	}
	if sameSpeakers(map[string]string{"0": "Priya"}, map[string]string{"0": "priya"}) {
		t.Fatal("a corrected spelling is a change")
	}
	if !sameSpeakers(nil, map[string]string{}) {
		t.Fatal("empty and nil both mean unlabelled")
	}
}

func TestMemoryDialogueKeyIsVersioned(t *testing.T) {
	// v1 and v2 must both remain readable: v1 is what the anonymous memories
	// were built from, v2 what the named ones were.
	if got := memoryDialogueKey("user_1", "rec_1", 2); got != "memory/user_1/rec_1.v2.txt" {
		t.Fatalf("key = %q", got)
	}
}

/* ── a task nobody said out loud ─────────────────────────────────────── */

func TestCreatedTaskIDCannotBeMistakenForAConversationsOwn(t *testing.T) {
	// An extracted task is "<recordingId>-<index>", and something that splits
	// one on its last hyphen is a reasonable thing to have written. A UUID
	// carries four hyphens of its own, so none of them survive into the id.
	id := ownTaskID()
	if !strings.HasPrefix(id, "own_") {
		t.Fatalf("id = %q, want an own_ prefix", id)
	}
	if strings.Contains(strings.TrimPrefix(id, "own_"), "-") {
		t.Fatalf("id = %q, want no hyphens after the prefix", id)
	}
	if ownTaskID() == id {
		t.Fatal("two tasks were minted the same id")
	}
}

func TestWritingATaskRefusesEmptyTextAndTruncatesALongOne(t *testing.T) {
	automation(t, true)
	var written ddb.Task
	stub(t, &ddbPutTask, func(_ context.Context, task ddb.Task) error {
		written = task
		return nil
	})
	app := appRoutes(func(app *fiber.App) { app.Post("/tasks", createTask) })

	if res := do(t, app, "POST", "/tasks", `{"text":"   "}`); res.StatusCode != http.StatusBadRequest {
		t.Fatalf("empty text = %d, want 400", res.StatusCode)
	}

	long := strings.Repeat("x", 500)
	res := do(t, app, "POST", "/tasks", `{"text":"`+long+`"}`)
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("status = %d, want 201", res.StatusCode)
	}
	if len(written.Text) != 400 {
		t.Fatalf("text kept %d characters, want 400", len(written.Text))
	}
	if written.Kind != types.TaskKindOther {
		t.Fatalf("kind = %q, want the default", written.Kind)
	}
	if written.Status != ddb.TaskProposed {
		t.Fatalf("status = %q — a task nobody approved is not for a daemon", written.Status)
	}
	if written.RecordingID != "" || written.Quote != "" {
		t.Fatal("there was no conversation, so there is nothing to quote")
	}
}

func TestWritingAnApprovedTaskNeedsTheAutomationTier(t *testing.T) {
	automation(t, false)
	stub(t, &ddbPutTask, func(context.Context, ddb.Task) error {
		t.Error("a task was queued for an account that has not paid for one")
		return nil
	})
	app := appRoutes(func(app *fiber.App) { app.Post("/tasks", createTask) })

	res := do(t, app, "POST", "/tasks", `{"text":"run the tests","approved":true}`)
	if res.StatusCode != http.StatusPaymentRequired {
		t.Fatalf("status = %d, want 402", res.StatusCode)
	}
}

func TestAnApprovedTaskLandsInThePartitionTheDaemonPolls(t *testing.T) {
	automation(t, true)
	var written ddb.Task
	stub(t, &ddbPutTask, func(_ context.Context, task ddb.Task) error {
		written = task
		return nil
	})
	app := appRoutes(func(app *fiber.App) { app.Post("/tasks", createTask) })

	res := do(t, app, "POST", "/tasks", `{"text":"pull main","kind":"file","approved":true}`)
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("status = %d, want 201", res.StatusCode)
	}
	// This status is the whole delivery mechanism: it is what puts the row in
	// TASKSTATUS#<sub>#approved, which is what GET /daemons/work reads.
	if written.Status != ddb.TaskApproved {
		t.Fatalf("status = %q, want approved", written.Status)
	}
	if written.UserID != testUser {
		t.Fatalf("userId = %q, want the caller", written.UserID)
	}
	if written.Kind != types.TaskKindFile {
		t.Fatalf("kind = %q, want the one that was asked for", written.Kind)
	}
}

func TestAnswerTaskWritesTheAnswerAsTheApp(t *testing.T) {
	task := ddb.Task{
		TaskID: "task_1", UserID: testUser, Status: ddb.TaskBlocked,
		Question: &ddb.TaskQuestion{ID: "q_1", Text: "which account?"},
	}
	stub(t, &ddbGetTask, func(context.Context, string, string) (*ddb.Task, error) { return &task, nil })
	var by string
	stub(t, &ddbAnswerQuestion, func(_ context.Context, t ddb.Task, answer, answeredBy string) (ddb.Task, error) {
		by = answeredBy
		t.Question.Answer = answer
		return t, nil
	})

	app := appRoutes(func(app *fiber.App) { app.Post("/tasks/:id/answer", answerTask) })
	res := do(t, app, "POST", "/tasks/task_1/answer", `{"answer":"the work one"}`)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", res.StatusCode)
	}
	if by != "app" {
		t.Fatalf("answeredBy = %q, want app", by)
	}
}

func TestAnswerTaskRefusesATaskThatIsNotBlocked(t *testing.T) {
	task := ddb.Task{TaskID: "task_1", UserID: testUser, Status: ddb.TaskExecuting}
	stub(t, &ddbGetTask, func(context.Context, string, string) (*ddb.Task, error) { return &task, nil })
	stub(t, &ddbAnswerQuestion, func(context.Context, ddb.Task, string, string) (ddb.Task, error) {
		t.Fatal("nothing should try to answer a task with no open question")
		return ddb.Task{}, nil
	})

	app := appRoutes(func(app *fiber.App) { app.Post("/tasks/:id/answer", answerTask) })
	res := do(t, app, "POST", "/tasks/task_1/answer", `{"answer":"the work one"}`)
	if res.StatusCode != http.StatusConflict {
		t.Fatalf("status = %d, want 409", res.StatusCode)
	}
}

func TestAnswerTaskIsIdempotentOnceAnswered(t *testing.T) {
	task := ddb.Task{
		TaskID: "task_1", UserID: testUser, Status: ddb.TaskBlocked,
		Question: &ddb.TaskQuestion{ID: "q_1", Answer: "already said"},
	}
	stub(t, &ddbGetTask, func(context.Context, string, string) (*ddb.Task, error) { return &task, nil })
	stub(t, &ddbAnswerQuestion, func(context.Context, ddb.Task, string, string) (ddb.Task, error) {
		t.Fatal("a second answer must not overwrite the first")
		return ddb.Task{}, nil
	})

	app := appRoutes(func(app *fiber.App) { app.Post("/tasks/:id/answer", answerTask) })
	res := do(t, app, "POST", "/tasks/task_1/answer", `{"answer":"a different one"}`)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200 — the same task read back, not an error", res.StatusCode)
	}
}

// A deliberate decision, not an oversight: this endpoint carries no
// ddb.QuestionExpired pre-check, on purpose. It converges on the same
// store-level guard postDaemonWorkAnswer uses — still blocked, nobody has
// answered — which is the single source of truth. A question past its own
// clock but not yet swept by the expiry hatch is still open, and an honest
// answer that beats an as-yet-unrun background job must be allowed to win
// that race rather than lose it to a stricter, pre-emptive check here. Once
// the sweep actually runs, ddb.FailBlockedWork's own condition refuses to
// discard an answer that landed first — this test locks in the other half:
// that this endpoint never re-adds a check that would prevent the answer
// from landing in the first place.
func TestAnswerTaskSucceedsPastTheQuestionsOwnExpiryUntilSomethingSweepsIt(t *testing.T) {
	task := ddb.Task{
		TaskID: "task_1", UserID: testUser, Status: ddb.TaskBlocked,
		Question: &ddb.TaskQuestion{
			ID: "q_1", Text: "which account?",
			ExpiresAt: time.Now().UTC().Add(-time.Hour).Format(time.RFC3339),
		},
	}
	stub(t, &ddbGetTask, func(context.Context, string, string) (*ddb.Task, error) { return &task, nil })
	answered := false
	stub(t, &ddbAnswerQuestion, func(_ context.Context, t ddb.Task, answer, answeredBy string) (ddb.Task, error) {
		answered = true
		t.Question.Answer = answer
		return t, nil
	})

	app := appRoutes(func(app *fiber.App) { app.Post("/tasks/:id/answer", answerTask) })
	res := do(t, app, "POST", "/tasks/task_1/answer", `{"answer":"the work one"}`)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200 — a question past its clock but not yet swept is still open", res.StatusCode)
	}
	if !answered {
		t.Fatal("an expiry pre-check silently refused an answer nothing has swept yet")
	}
}
