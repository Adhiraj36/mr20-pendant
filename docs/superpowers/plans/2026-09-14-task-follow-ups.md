# The follow-up channel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a daemon running a claimed LYZN task stop and ask the person a question — mid-execution, with its real context intact — and let either the app or a comms channel answer it, so the daemon resumes the same conversation rather than starting cold or silently failing.

**Architecture:** Two systems that do not know about each other today learn one new state each. On LYZN's side (DynamoDB), the task lifecycle gains `blocked`, parked between two `executing`s, carrying a `Question` record; the LYZN task row is authoritative, because comms channels live in KARMAX and the app lives in LYZN, and a question answered entirely inside KARMAX's own comms plumbing would otherwise never reach the app. On KARMAX's side, a claimed LYZN task's execution stops being ephemeral: the harness step is keyed by a deterministic session id and a per-task working directory (both `<taskID>`-derived, so a resume days later uses the identical values), and the recipe that drives it (`desktop/resources/loops/lyzn-tasks.yaml`) learns to branch on `STATUS: blocked`, park with `await:` on `comms.message`, and clean up after itself. Every terminal outcome — done, failed, question expiry, an unpaired or stale daemon giving up its pinned tasks — runs the same three-part local cleanup (transcript, working directory, `coding_sessions` rows), with a six-hour ticker as the backstop for whatever falls through anyway.

**Tech Stack:** Go 1.x + Fiber + DynamoDB (LYZN backend), Expo/React Native + zustand (mobile), Go 1.26 + SQLite (KARMAX), YAML (the recipe).

**Spec:** `docs/superpowers/specs/2026-09-14-extraction-agent-and-follow-ups-design.md` §3 — read it, including all four amendments; this plan builds only what they decided. §1 and §2 are a separate plan.

## Global Constraints

- **Two repositories.** `/Users/0mellob/Developer/code/mr20-pendant` (LYZN backend `backend/go`, mobile app `mobile/`, and the recipe `desktop/resources/loops/lyzn-tasks.yaml`) and `/Users/0mellob/Developer/code/KARMAX` (the daemon engine). Every task below names its repo.
- **Never put `Co-Authored-By` or `Claude-Session` lines in commit messages.** Subject and body only — both repos are public.
- **Commit locally in each repo as its tasks land. Never `git push`.**
- **Every store call in the LYZN backend's `internal/api` package goes through the package's `ddb*` function variables**, never `ddb.X` directly — that is what lets every route in this plan be tested with no AWS account, following `internal/api/daemons.go`'s existing var block.
- **Session id and working directory are deterministic**, derived from the LYZN task id alone (`lyzn:<taskID>`, `lyzn-tasks/<taskID>`) — never a timestamp, PID or random suffix. A resume after however long a person takes to answer has to call with the identical values used on the first turn.
- **`ephemeral` is decided before the harness call and enforced unconditionally inside it.** There is no version of this design that runs a LYZN task's first turn cheap and upgrades it to durable after the fact — every LYZN task's first turn goes through the non-ephemeral path from the start (spec, third amendment).
- **`POST /daemons/work/:taskId/result` stays exactly as it is** — transactional, idempotent, terminal. `blocked` is a new, additive, non-terminal channel; nothing about `/result`'s contract or tests changes.
- **Cleanup is required, not assumed.** Every terminal path for a durable LYZN session (done, failed, question expiry, daemon unpair/staleness) must run the three-part cleanup (transcript, workdir, `coding_sessions` rows); the six-hour ticker is a backstop for the tail, not the primary mechanism.
- Go: `go build ./...`, `go test ./...`, `go vet ./...` clean; `gofmt -l` silent on touched files, in each repo separately.
- Mobile: `npm test && npx tsc --noEmit -p tsconfig.json` clean. No colour is ever named in a component; tone classes only.

## File Structure

| Repo | File | Responsibility |
|---|---|---|
| mr20-pendant | `backend/go/internal/ddb/tasks.go` | `TaskBlocked`, `TaskQuestion`, `Task.Question`, `BlockTask`, `AnswerQuestion` |
| mr20-pendant | `backend/go/internal/ddb/daemons.go` | `ResumeBlockedWork`, `BlockedWork`, `FailBlockedWork`, `QuestionAnswered`, `QuestionExpired`, generalised `finishWorkInput` |
| mr20-pendant | `backend/go/internal/api/daemons.go` | `POST /daemons/work/:taskId/question`, `POST /daemons/work/:taskId/answer`, `GET /daemons/sessions/expired`, `/claim`'s resume branch, `/work`'s resumable ids, unpair/stale release |
| mr20-pendant | `backend/go/internal/api/tasks.go` | `POST /tasks/:id/answer` (Clerk-authenticated) |
| mr20-pendant | `backend/go/internal/push/events.go` | `TaskQuestion` push builder, the sixth fixed event |
| mr20-pendant | `mobile/src/api/tasks.ts` | Widened `TaskStatus`, `TaskQuestion`, `tasksApi.answer` |
| mr20-pendant | `mobile/src/state/tasks.ts` | `answerQuestion` store action |
| mr20-pendant | `mobile/src/tasks/models.ts` | `isOpen` counts `blocked` |
| mr20-pendant | `mobile/src/notifications/routes.ts` | `task.question` push routing |
| mr20-pendant | `mobile/app/task/[id].tsx` | The question card and answer affordance |
| mr20-pendant | `mobile/src/design/copy.ts` | New `TASKS_COPY` keys |
| KARMAX | `internal/hostpaths/hostpaths.go` | `Resolve` — relative `working_dir` values become subdirectories of the shared root |
| KARMAX | `internal/tools/builtin/claude_code.go` | `mkdir -p` before exec; `Cleanup`; drops the unexported `removeClaudeSession` |
| KARMAX | `internal/chatlog/slug.go` | Exported `RemoveSession` |
| KARMAX | `internal/store/coding_store.go` | `DeleteCodingSessionsBySessionID`, `ListStaleCodingSessionIDs` |
| KARMAX | `pkg/loopkit/kit.go` | `HarnessSpec`, `HarnessResult`, `Kit.HarnessWith`, `Kit.HarnessForget` |
| KARMAX | `internal/runtime/loophost.go` | `loopKit.HarnessWith`, `loopKit.HarnessForget`; `Harness` now calls `HarnessWith` |
| KARMAX | `internal/runtime/wasmhost.go` | `wasmKit.HarnessWith`, `wasmKit.HarnessForget` |
| KARMAX | `internal/recipes/dryrun.go` | `DryRun.HarnessWith`, `DryRun.HarnessForget` |
| KARMAX | `internal/recipes/recipe.go` | `VerbHarnessForget`, `required` entry |
| KARMAX | `internal/recipes/run.go` | `harness:` object form (`session_id`, `working_dir`, `ephemeral`), `harness.forget`, `boolArg`, `contains` template func |
| KARMAX | `internal/recipes/describe.go` | Description for `harness.forget` |
| KARMAX | `internal/runtime/lyzntasks.go` (new) | The six-hour backstop: `pruneStaleLyznSessions` |
| KARMAX | `internal/runtime/looprun.go` | One new `case` in the existing prune ticker |
| KARMAX | `internal/connectors/lyzn/work.go` | `question`, mirroring `report` |
| KARMAX | `internal/connectors/lyzn/tools.go` | `reportWork`'s `blocked` branch; honest tool descriptions |
| mr20-pendant | `desktop/resources/loops/lyzn-tasks.yaml` | Non-ephemeral harness call, `STATUS: blocked` branch, cleanup, resumable ids |

---

# Part A — LYZN backend (mr20-pendant/backend/go)

## Task 1: `blocked` state and the question record

**Repo:** mr20-pendant

**Files:**
- Modify: `backend/go/internal/ddb/tasks.go`
- Modify: `backend/go/internal/ddb/daemons.go`
- Test: `backend/go/internal/ddb/tasks_test.go`, `backend/go/internal/ddb/daemons_test.go`

**Interfaces:**
- Consumes: `taskTransitionInput`, `applyTransition`, `s`, `userPK`, `taskStatusGSI`, `nowISO`, `unmarshalTasks` (all existing, `ddb.go`/`tasks.go`).
- Produces: `TaskBlocked TaskStatus`; `TaskQuestion` struct; `Task.Question *TaskQuestion`; `DefaultQuestionTTL time.Duration`; `BlockTask(ctx, t Task, q TaskQuestion) (Task, error)`; `AnswerQuestion(ctx, t Task, answer, answeredBy string) (Task, error)`; `QuestionAnswered(t Task) bool`; `QuestionExpired(t Task, now time.Time) bool`; `ResumeBlockedWork(ctx, t Task, daemonID string) (Task, error)`; `BlockedWork(ctx, userID string) ([]Task, error)`; `FailBlockedWork(ctx, t Task, r Receipt) (Task, Receipt, error)`. Every later task in this plan is built on these exact signatures.

- [ ] **Step 1: Write the failing tests**

In `backend/go/internal/ddb/tasks_test.go`, append:

```go
func sampleBlockedTask() Task {
	t := sampleTask()
	t.Status = TaskExecuting
	t.DaemonID = "daemon_1"
	t.ClaimedAt = "2026-09-08T11:00:00Z"
	t.LeaseUntil = "2026-09-08T11:15:00Z"
	return t
}

func TestBlockTaskGuardsOnExecutingAndSetsTheQuestion(t *testing.T) {
	task := sampleBlockedTask()
	q := TaskQuestion{
		ID: "q_1", Text: "which account should I send it from?",
		AskedBy: "daemon_1", AskedAt: "2026-09-08T11:05:00Z", ExpiresAt: "2026-09-09T11:05:00Z",
	}
	in, err := blockTaskInput(task, q, "2026-09-08T11:05:00Z")
	if err != nil {
		t.Fatal(err)
	}
	condition := aws.ToString(in.ConditionExpression)
	if !strings.Contains(condition, "attribute_exists(PK)") || !strings.Contains(condition, "#status = :from") {
		t.Fatalf("condition does not pin the starting state: %q", condition)
	}
	if got := str(t, in.ExpressionAttributeValues[":from"], ":from"); got != "executing" {
		t.Fatalf(":from = %q", got)
	}
	if got := str(t, in.ExpressionAttributeValues[":gsi"], ":gsi"); got != "TASKSTATUS#user_1#blocked" {
		t.Fatalf(":gsi = %q", got)
	}
	qAttr, ok := in.ExpressionAttributeValues[":q"].(*ddbtypes.AttributeValueMemberM)
	if !ok {
		t.Fatalf(":q is not a map attribute: %#v", in.ExpressionAttributeValues[":q"])
	}
	if got := str(t, qAttr.Value["text"], "question.text"); got != q.Text {
		t.Fatalf("question.text = %q", got)
	}
}

func TestAnswerQuestionRefusesASecondAnswer(t *testing.T) {
	task := sampleBlockedTask()
	task.Status = TaskBlocked
	task.Question = &TaskQuestion{ID: "q_1", Text: "which account?", ExpiresAt: "2026-09-09T11:05:00Z"}

	in := answerQuestionInput(task, "the work one", "app", "2026-09-08T12:00:00Z")
	condition := aws.ToString(in.ConditionExpression)
	if !strings.Contains(condition, "attribute_not_exists(#question.#answer)") {
		t.Fatalf("condition does not guard against a second answer: %q", condition)
	}
	if !strings.Contains(condition, "#status = :status") {
		t.Fatalf("condition does not pin the task to blocked: %q", condition)
	}
	if got := str(t, in.ExpressionAttributeValues[":answer"], ":answer"); got != "the work one" {
		t.Fatalf(":answer = %q", got)
	}
}

func TestQuestionAnsweredAndExpired(t *testing.T) {
	now := parseRFC3339(t, "2026-09-09T00:00:00Z")
	unanswered := Task{Status: TaskBlocked, Question: &TaskQuestion{ExpiresAt: "2026-09-08T00:00:00Z"}}
	if QuestionAnswered(unanswered) {
		t.Fatal("an empty answer must not read as answered")
	}
	if !QuestionExpired(unanswered, now) {
		t.Fatal("a past expiry with no answer must read as expired")
	}

	answered := Task{Status: TaskBlocked, Question: &TaskQuestion{ExpiresAt: "2026-09-08T00:00:00Z", Answer: "yes"}}
	if !QuestionAnswered(answered) {
		t.Fatal("a non-empty answer must read as answered")
	}
	if QuestionExpired(answered, now) {
		t.Fatal("an answer that arrived must never be treated as expired, even past the deadline")
	}

	notBlocked := Task{Status: TaskExecuting, Question: &TaskQuestion{ExpiresAt: "2026-09-08T00:00:00Z"}}
	if QuestionExpired(notBlocked, now) {
		t.Fatal("a task that is not blocked has nothing to expire")
	}
}

func parseRFC3339(t *testing.T, s string) time.Time {
	t.Helper()
	when, err := time.Parse(time.RFC3339, s)
	if err != nil {
		t.Fatal(err)
	}
	return when
}
```

Add `"time"` to the file's imports if not already present.

In `backend/go/internal/ddb/daemons_test.go`, append:

```go
func TestResumeBlockedWorkIsConditionalOnOwnership(t *testing.T) {
	task := sampleBlockedTask()
	task.Status = TaskBlocked
	in := resumeBlockedWorkInput(task, "daemon_1", "2026-09-08T13:00:00Z")
	condition := aws.ToString(in.ConditionExpression)
	if !strings.Contains(condition, "#status = :from") || !strings.Contains(condition, "daemonId = :daemonId") {
		t.Fatalf("condition does not check both status and ownership: %q", condition)
	}
	if got := str(t, in.ExpressionAttributeValues[":to"], ":to"); got != "executing" {
		t.Fatalf(":to = %q", got)
	}
}

func TestFailBlockedWorkClosesFromBlockedNotExecuting(t *testing.T) {
	task := sampleBlockedTask()
	task.Status = TaskBlocked
	receipt := Receipt{ReceiptID: "r_1", UserID: task.UserID, CreatedAt: "2026-09-08T13:00:00Z"}
	txn, err := finishWorkInput(task, receipt, []TaskStatus{TaskBlocked}, TaskFailed)
	if err != nil {
		t.Fatal(err)
	}
	update := txn.TransactItems[0].Update
	condition := aws.ToString(update.ConditionExpression)
	if !strings.Contains(condition, ":from0") {
		t.Fatalf("condition does not reference a starting state: %q", condition)
	}
	if got := str(t, update.ExpressionAttributeValues[":from0"], ":from0"); got != "blocked" {
		t.Fatalf(":from0 = %q, want blocked — FailBlockedWork must not reuse FinishWork's executing-only guard", got)
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend/go && go test ./internal/ddb/ -run 'TestBlockTask|TestAnswerQuestion|TestQuestionAnsweredAndExpired|TestResumeBlockedWork|TestFailBlockedWork' -v`
Expected: FAIL — `undefined: blockTaskInput`, `undefined: TaskQuestion`, `undefined: finishWorkInput` (wrong arity), etc.

- [ ] **Step 3: Add `blocked`, the question type, and the two writes in `tasks.go`**

In `internal/ddb/tasks.go`, extend the status block:

```go
const (
	TaskProposed  TaskStatus = "proposed"
	TaskApproved  TaskStatus = "approved"
	TaskExecuting TaskStatus = "executing"
	// TaskBlocked is a task parked mid-execution on a question for the person
	// who approved it. It sits in its own GSI1 partition
	// (TASKSTATUS#<sub>#blocked), which is what keeps releaseAbandoned's lease
	// sweep — scoped to the executing partition alone — from ever touching it:
	// a blocked task stays pinned to the daemon that asked until it is
	// answered, expires, or that daemon gives it up.
	TaskBlocked   TaskStatus = "blocked"
	TaskDone      TaskStatus = "done"
	TaskDismissed TaskStatus = "dismissed"
	TaskFailed    TaskStatus = "failed"
)

var TaskStatuses = []TaskStatus{TaskProposed, TaskApproved, TaskExecuting, TaskBlocked, TaskDone, TaskDismissed, TaskFailed}
```

Add the question type and TTL, and a field on `Task`:

```go
// DefaultQuestionTTL is how long an unanswered question holds a task before
// the expiry escape hatch fails it. A daemon may ask for less; it may not
// ask for more than a day without saying so explicitly, because the disk a
// durable session holds is the cost of every hour this stays open.
const DefaultQuestionTTL = 24 * time.Hour

// TaskQuestion is what a daemon asked when it stopped mid-task. It hangs off
// a blocked task and never appears on any other status.
type TaskQuestion struct {
	ID      string   `dynamodbav:"id" json:"id"`
	Text    string   `dynamodbav:"text" json:"text"`
	// Options, when present, makes this a choice rather than free text.
	Options []string `dynamodbav:"options,omitempty" json:"options,omitempty"`
	AskedBy string   `dynamodbav:"askedBy" json:"askedBy"`
	AskedAt string   `dynamodbav:"askedAt" json:"askedAt"`
	ExpiresAt string `dynamodbav:"expiresAt" json:"expiresAt"`
	// Answer, AnsweredAt and AnsweredBy are empty until somebody replies.
	// AnsweredBy is "app" or "comms" — which surface wrote it, not who.
	Answer     string `dynamodbav:"answer,omitempty" json:"answer,omitempty"`
	AnsweredAt string `dynamodbav:"answeredAt,omitempty" json:"answeredAt,omitempty"`
	AnsweredBy string `dynamodbav:"answeredBy,omitempty" json:"answeredBy,omitempty"`
}
```

Add `Question *TaskQuestion` to the `Task` struct, after `LeaseUntil`:

```go
	// Question is set only while Status is blocked. The LYZN row is
	// authoritative for it: comms channels live in KARMAX and the app lives
	// here, so a question answered entirely inside KARMAX's comms plumbing
	// would otherwise never reach the app at all.
	Question *TaskQuestion `dynamodbav:"question,omitempty" json:"question,omitempty"`
```

Add the two writes, after `CompleteTask`:

```go
// blockTaskInput is the conditional update that parks a task on a question.
// Pure, so the guard and the embedded question can be read in a test without
// a table.
func blockTaskInput(t Task, q TaskQuestion, now string) (*dynamodb.UpdateItemInput, error) {
	qItem, err := attributevalue.MarshalMap(q)
	if err != nil {
		return nil, err
	}
	return &dynamodb.UpdateItemInput{
		TableName: &table,
		Key:       map[string]ddbtypes.AttributeValue{"PK": s(userPK(t.UserID)), "SK": s(t.SK())},
		UpdateExpression: aws.String(
			"SET #status = :to, GSI1PK = :gsi, updatedAt = :now, #question = :q"),
		ExpressionAttributeNames: map[string]string{"#status": "status", "#question": "question"},
		ExpressionAttributeValues: map[string]ddbtypes.AttributeValue{
			":to":   s(string(TaskBlocked)),
			":gsi":  s(taskStatusGSI(t.UserID, TaskBlocked)),
			":now":  s(now),
			":q":    &ddbtypes.AttributeValueMemberM{Value: qItem},
			":from": s(string(TaskExecuting)),
		},
		ConditionExpression: aws.String("attribute_exists(PK) AND #status = :from"),
	}, nil
}

// BlockTask parks a claimed task on a question. Conditional on it still being
// executing — the same daemon that is asking is the only one that could hold
// it there, so a task somebody else already closed cannot be blocked instead.
func BlockTask(ctx context.Context, t Task, q TaskQuestion) (Task, error) {
	now := nowISO()
	input, err := blockTaskInput(t, q, now)
	if err != nil {
		return t, err
	}
	if _, err := client.UpdateItem(ctx, input); err != nil {
		var refused *ddbtypes.ConditionalCheckFailedException
		if errors.As(err, &refused) {
			return t, ErrTaskTransition
		}
		return t, err
	}
	t.Status, t.UpdatedAt, t.Question = TaskBlocked, now, &q
	return t, nil
}

// answerQuestionInput writes an answer onto an open question. It does not
// move the task's status — blocked stays blocked until the daemon it is
// pinned to resumes it — so this is the one write in this file that changes
// no partition.
func answerQuestionInput(t Task, answer, answeredBy, now string) *dynamodb.UpdateItemInput {
	return &dynamodb.UpdateItemInput{
		TableName: &table,
		Key:       map[string]ddbtypes.AttributeValue{"PK": s(userPK(t.UserID)), "SK": s(t.SK())},
		UpdateExpression: aws.String(
			"SET #question.#answer = :answer, #question.#answeredAt = :now, " +
				"#question.#answeredBy = :by, updatedAt = :now"),
		ExpressionAttributeNames: map[string]string{
			"#question": "question", "#answer": "answer",
			"#answeredAt": "answeredAt", "#answeredBy": "answeredBy",
			"#status": "status",
		},
		ExpressionAttributeValues: map[string]ddbtypes.AttributeValue{
			":answer": s(answer), ":now": s(now), ":by": s(answeredBy),
			":status": s(string(TaskBlocked)),
		},
		// Both guards matter: the task must still be blocked, and nobody may
		// have answered already — the first reply stands, whichever surface
		// it came from.
		ConditionExpression: aws.String(
			"attribute_exists(PK) AND #status = :status AND attribute_not_exists(#question.#answer)"),
	}
}

// AnswerQuestion writes a reply onto an open question. Whoever asked resumes
// on their own poll; this call never changes the task's status.
func AnswerQuestion(ctx context.Context, t Task, answer, answeredBy string) (Task, error) {
	if t.Question == nil {
		return t, ErrTaskTransition
	}
	now := nowISO()
	input := answerQuestionInput(t, answer, answeredBy, now)
	if _, err := client.UpdateItem(ctx, input); err != nil {
		var refused *ddbtypes.ConditionalCheckFailedException
		if errors.As(err, &refused) {
			return t, ErrTaskTransition
		}
		return t, err
	}
	t.UpdatedAt = now
	q := *t.Question
	q.Answer, q.AnsweredAt, q.AnsweredBy = answer, now, answeredBy
	t.Question = &q
	return t, nil
}
```

- [ ] **Step 4: Add the daemon-side reads and the expiry close in `daemons.go`**

In `internal/ddb/daemons.go`, near `LeaseExpired`:

```go
// QuestionAnswered reports whether a blocked task's question has a reply
// waiting for the daemon that asked it.
func QuestionAnswered(t Task) bool {
	return t.Status == TaskBlocked && t.Question != nil && strings.TrimSpace(t.Question.Answer) != ""
}

// QuestionExpired reports whether a blocked task's question passed its
// expiry with no answer. An answered question is never expired, even past
// the deadline: the answer arrived, and racing the clock against it would
// throw away a reply that got there in time.
func QuestionExpired(t Task, now time.Time) bool {
	if t.Status != TaskBlocked || t.Question == nil || QuestionAnswered(t) {
		return false
	}
	if t.Question.ExpiresAt == "" {
		return true
	}
	until, err := time.Parse(time.RFC3339, t.Question.ExpiresAt)
	if err != nil {
		return true
	}
	return now.After(until)
}

// blockedWorkInput reads the whole blocked partition. Small by
// construction, the same reasoning ExpiredWork rests on for executing: a
// task sits here only while pinned to one daemon awaiting one answer, so
// filtering by daemon and by answered/expired happens in Go, not in the
// query.
func blockedWorkInput(userID string, limit int32) *dynamodb.QueryInput {
	return &dynamodb.QueryInput{
		TableName:              &table,
		IndexName:              aws.String("GSI1"),
		KeyConditionExpression: aws.String("GSI1PK = :pk"),
		ExpressionAttributeValues: map[string]ddbtypes.AttributeValue{
			":pk": s(taskStatusGSI(userID, TaskBlocked)),
		},
		ScanIndexForward: aws.Bool(true),
		Limit:            &limit,
	}
}

// BlockedWork returns every blocked task on this account.
func BlockedWork(ctx context.Context, userID string) ([]Task, error) {
	out, err := client.Query(ctx, blockedWorkInput(userID, DefaultWorkLimit))
	if err != nil {
		return nil, err
	}
	return unmarshalTasks(out.Items)
}

// resumeBlockedWorkInput moves an answered blocked task back to executing.
// Conditional on ownership as well as status: a task pinned to one machine
// cannot be resumed by another, the same rule a claim enforces on an
// approved one.
func resumeBlockedWorkInput(t Task, daemonID, now string) *dynamodb.UpdateItemInput {
	return &dynamodb.UpdateItemInput{
		TableName: &table,
		Key:       map[string]ddbtypes.AttributeValue{"PK": s(userPK(t.UserID)), "SK": s(t.SK())},
		UpdateExpression: aws.String("SET #status = :to, GSI1PK = :gsi, updatedAt = :now"),
		ExpressionAttributeNames: map[string]string{"#status": "status"},
		ExpressionAttributeValues: map[string]ddbtypes.AttributeValue{
			":to": s(string(TaskExecuting)), ":gsi": s(taskStatusGSI(t.UserID, TaskExecuting)),
			":now": s(now), ":from": s(string(TaskBlocked)), ":daemonId": s(daemonID),
		},
		ConditionExpression: aws.String("attribute_exists(PK) AND #status = :from AND daemonId = :daemonId"),
	}
}

// ResumeBlockedWork puts a blocked task back to executing — the daemon it is
// pinned to picking its own question back up now that somebody answered.
func ResumeBlockedWork(ctx context.Context, t Task, daemonID string) (Task, error) {
	now := nowISO()
	if _, err := client.UpdateItem(ctx, resumeBlockedWorkInput(t, daemonID, now)); err != nil {
		var refused *ddbtypes.ConditionalCheckFailedException
		if errors.As(err, &refused) {
			return t, ErrTaskTransition
		}
		return t, err
	}
	t.Status, t.UpdatedAt = TaskExecuting, now
	return t, nil
}
```

Generalise `finishWorkInput` to take its starting states as a parameter, and update its one caller:

```go
func finishWorkInput(t Task, r Receipt, from []TaskStatus, to TaskStatus) (*dynamodb.TransactWriteItemsInput, error) {
	update, err := taskTransitionInput(t.UserID, t.SK(), from, to, map[string]string{
		"doneAt":    r.CreatedAt,
		"receiptId": r.ReceiptID,
	})
	// ... body unchanged below this line
}

func FinishWork(ctx context.Context, t Task, r Receipt, to TaskStatus) (Task, Receipt, error) {
	input, err := finishWorkInput(t, r, []TaskStatus{TaskExecuting}, to)
	// ... body unchanged below this line
}

// FailBlockedWork closes a blocked task without anyone answering — a
// question that expired, or a daemon that went away before one arrived.
// Reuses FinishWork's own transaction shape from a different starting state.
func FailBlockedWork(ctx context.Context, t Task, r Receipt) (Task, Receipt, error) {
	input, err := finishWorkInput(t, r, []TaskStatus{TaskBlocked}, TaskFailed)
	if err != nil {
		return t, r, err
	}
	if _, err := client.TransactWriteItems(ctx, input); err != nil {
		var canceled *ddbtypes.TransactionCanceledException
		if errors.As(err, &canceled) {
			for _, reason := range canceled.CancellationReasons {
				if aws.ToString(reason.Code) == "ConditionalCheckFailed" {
					return t, r, ErrTaskTransition
				}
			}
		}
		return t, r, err
	}
	extra := map[string]string{"doneAt": r.CreatedAt, "receiptId": r.ReceiptID}
	return applyTransition(t, TaskFailed, extra), r, nil
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend/go && go test ./internal/ddb/ -run 'TestBlockTask|TestAnswerQuestion|TestQuestionAnsweredAndExpired|TestResumeBlockedWork|TestFailBlockedWork' -v`
Expected: PASS, 5 tests.

- [ ] **Step 6: Run the whole backend suite**

Run: `cd backend/go && go build ./... && go test ./... && go vet ./... && gofmt -l internal/ddb/`
Expected: PASS, clean, nothing else disturbed — `FinishWork`'s existing tests (`TestFinishWorkIsOneTransactionOfTwoWrites`) must still pass unchanged, since its call to `finishWorkInput` was updated to pass the same starting state it always used.

- [ ] **Step 7: Commit**

```bash
git add backend/go/internal/ddb/tasks.go backend/go/internal/ddb/daemons.go backend/go/internal/ddb/tasks_test.go backend/go/internal/ddb/daemons_test.go
git commit -m "tasks: a blocked state and the question that parks one there"
```

---

## Task 2: asking, and resuming once answered

**Repo:** mr20-pendant

**Files:**
- Modify: `backend/go/internal/api/daemons.go`
- Modify: `backend/go/internal/push/events.go`
- Test: `backend/go/internal/api/daemons_test.go`, `backend/go/internal/push/events_test.go` (create if absent)

**Interfaces:**
- Consumes: `ddb.TaskBlocked`, `ddb.TaskQuestion`, `ddb.BlockTask`, `ddb.ResumeBlockedWork`, `ddb.BlockedWork`, `ddb.QuestionAnswered` (Task 1); `loadDaemonTask`, `daemonOf`, `truncate`, `workItemFor`, existing test helpers `stub`, `appRoutes`, `do`, `automation`, `testUser` (`daemons_test.go`, same package).
- Produces: `POST /daemons/work/:taskId/question`; `questionFrom(c) (questionInput, error)` (consumed by nothing in this plan yet — Task 12 relies on its existence to post `text/plain`); `postDaemonWorkClaim`'s new resume branch; `getDaemonWork`'s resumable-ids extension; `push.TaskQuestion(tokens []string, taskID, text string) []Message`.

- [ ] **Step 1: Write the failing tests**

In `backend/go/internal/push/events_test.go` (new file):

```go
package push

import "testing"

func TestTaskQuestionCarriesTheTaskIdAndTheQuestionText(t *testing.T) {
	msgs := TaskQuestion([]string{"tok_1"}, "task_1", "which account should this go from?")
	if len(msgs) != 1 {
		t.Fatalf("got %d messages, want 1", len(msgs))
	}
	m := msgs[0]
	if m.Data["type"] != "task.question" || m.Data["taskId"] != "task_1" {
		t.Fatalf("data = %+v", m.Data)
	}
	if m.ChannelID != ChannelTasks || m.CategoryID != CategoryTask {
		t.Fatalf("this needs the same channel and category tasks.proposed uses")
	}
	if m.Body != "which account should this go from?" {
		t.Fatalf("body = %q, want the question itself", m.Body)
	}
}
```

In `backend/go/internal/api/daemons_test.go`, append:

```go
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
```

Check `daemons_test.go` for an existing `withDaemon(t, daemonID)` test middleware; if none exists, add one alongside `automation`/`testUser` that sets `c.Locals(localDaemon, &ddb.Daemon{DaemonID: daemonID, UserID: testUser})` and use it in place of `daemonAuth()` in these tests, the same way `appRoutes` lets other tests skip real auth.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend/go && go test ./internal/push/ ./internal/api/ -run 'TestTaskQuestion|TestPostDaemonWorkQuestion|TestPostDaemonWorkClaimResumes|TestPostDaemonWorkClaimRefuses' -v`
Expected: FAIL — `undefined: TaskQuestion` (push), `undefined: postDaemonWorkQuestion`, `undefined: questionFrom`, `undefined: ddbBlockTask`, `undefined: ddbResumeBlockedWork`.

- [ ] **Step 3: Add the push builder**

In `internal/push/events.go`, after `ReceiptPrinted`:

```go
// TaskQuestion: a claimed task stopped and needs something only the person
// can give it. The sixth fixed event — not a step toward a general feed
// model, one more entry in this file's own table.
func TaskQuestion(tokens []string, taskID, text string) []Message {
	body := strings.TrimSpace(text)
	if body == "" {
		body = "Open the task to see what it needs."
	}
	return fanOut(tokens, Message{
		Title:      "This needs an answer",
		Body:       body,
		Sound:      "default",
		Priority:   "high",
		TTL:        ttl(ttlDay),
		ChannelID:  ChannelTasks,
		CategoryID: CategoryTask,
		Data:       map[string]any{"type": "task.question", "taskId": taskID},
	})
}
```

Update the file's header comment table with `task.question`.

- [ ] **Step 4: Add the var-block indirections**

In `internal/api/daemons.go`'s var block, beside `ddbGetTask`:

```go
	ddbBlockTask         = ddb.BlockTask
	ddbAnswerQuestion    = ddb.AnswerQuestion
	ddbResumeBlockedWork = ddb.ResumeBlockedWork
	ddbBlockedWork       = ddb.BlockedWork
	ddbFailBlockedWork   = ddb.FailBlockedWork
```

- [ ] **Step 5: Write `postDaemonWorkQuestion` and `notifyTaskQuestion`**

After `postDaemonWorkClaim`:

```go
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
```

Register the route in `registerDaemonRoutes`, beside the claim:

```go
	app.Post("/daemons/work/:taskId/question", daemonAuth(), postDaemonWorkQuestion)
```

- [ ] **Step 6: Extend `postDaemonWorkClaim` and `getDaemonWork`**

In `postDaemonWorkClaim`, after the existing re-claim check:

```go
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
```

In `getDaemonWork`, fold resumable work into the same list the approved-work loop already builds:

```go
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
```

placed before the existing `idsOnly`/context-building loop, which needs no other change since it already just walks `tasks`. Add the helper after `getDaemonWork`:

```go
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
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd backend/go && go test ./internal/push/ ./internal/api/ -run 'TestTaskQuestion|TestPostDaemonWorkQuestion|TestPostDaemonWorkClaimResumes|TestPostDaemonWorkClaimRefuses' -v`
Expected: PASS, 5 tests.

- [ ] **Step 8: Run the whole backend suite**

Run: `cd backend/go && go build ./... && go test ./... && go vet ./... && gofmt -l internal/api/ internal/push/`
Expected: PASS, clean.

- [ ] **Step 9: Commit**

```bash
git add backend/go/internal/api/daemons.go backend/go/internal/push/events.go backend/go/internal/api/daemons_test.go backend/go/internal/push/events_test.go
git commit -m "daemons: a task can ask a question and resume once it is answered"
```

---

## Task 3: the escape hatches, and the comms relay

**Repo:** mr20-pendant

**Files:**
- Modify: `backend/go/internal/api/daemons.go`
- Test: `backend/go/internal/api/daemons_test.go`

**Interfaces:**
- Consumes: `ddb.BlockedWork`, `ddb.QuestionExpired`, `ddb.FailBlockedWork`, `ddb.ReceiptFromWork` (Task 1); `ddbListDaemons`, `daemonOf`, `loadDaemonTask` (existing).
- Produces: `POST /daemons/work/:taskId/answer` (daemon-authenticated); `GET /daemons/sessions/expired` (daemon-authenticated, bare JSON array — the recipe tier can only walk a JSON array of scalars, the same reason `GET /daemons/work?format=ids` exists); `deleteDaemon`'s pinned-task release; `getDaemons`' stale-daemon release.

- [ ] **Step 1: Write the failing tests**

Append to `backend/go/internal/api/daemons_test.go`:

```go
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
		app.Delete("/daemons/:id", authed(t, testUser), deleteDaemon)
	})
	res := do(t, app, "DELETE", "/daemons/d1", "")
	if res.StatusCode != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", res.StatusCode)
	}
	if !released {
		t.Fatal("unpairing must release whatever this daemon had pinned")
	}
}
```

If `daemons_test.go` has no `authed(t, userID)` helper wrapping Clerk auth for a test route, check for the equivalent already used by `TestWritingATaskRefusesEmptyTextAndTruncatesALongOne`-style tests in `tasks_test.go`/`daemons_test.go`; reuse whichever exists rather than adding a second one. Add `"io"` and `"encoding/json"` to `daemons_test.go`'s imports if either is not already there — `TestGetDaemonExpiredSessionsAnswersAnEmptyArrayNotNull` reads the raw body, and `TestGetDaemonExpiredSessionsFailsThemAndReturnsABareArrayOfIds` decodes it.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend/go && go test ./internal/api/ -run 'TestPostDaemonWorkAnswer|TestGetDaemonExpiredSessions|TestDeleteDaemonReleases' -v`
Expected: FAIL — `undefined: postDaemonWorkAnswer`, `undefined: getDaemonExpiredSessions`, unpairing calling nothing new.

- [ ] **Step 3: `POST /daemons/work/:taskId/answer`**

After `postDaemonWorkQuestion`:

```go
const maxAnswerText = 400

// postDaemonWorkAnswer is how a comms-channel reply reaches the task row —
// KARMAX's own credential, for a question it may also have delivered outside
// the app. Its counterpart on the Clerk side is answerTask
// (internal/api/tasks.go); the two are separate handlers because they carry
// different credentials, never a different outcome.
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
	}
	if err := c.BodyParser(&input); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "request body must be JSON")
	}
	answer := truncate(strings.TrimSpace(input.Answer), maxAnswerText)
	if answer == "" {
		return fiber.NewError(fiber.StatusBadRequest, "an answer needs text")
	}
	if ddb.QuestionAnswered(*task) {
		return c.JSON(fiber.Map{"task": *task})
	}

	updated, err := ddbAnswerQuestion(c.Context(), *task, answer, "comms")
	if err != nil {
		if errors.Is(err, ddb.ErrTaskTransition) {
			return fiber.NewError(fiber.StatusConflict, "this question is no longer open")
		}
		return err
	}
	return c.JSON(fiber.Map{"task": updated})
}
```

Register: `app.Post("/daemons/work/:taskId/answer", daemonAuth(), postDaemonWorkAnswer)`.

- [ ] **Step 4: The expiry sweep and the shared failure helper**

After `releaseAbandoned`:

```go
// failBlockedTask is the one place a blocked task is closed without an
// answer: the expiry sweep below, and an unpaired or long-stale daemon
// giving up its pinned tasks.
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
func releasePinnedTasks(c *fiber.Ctx, userID, daemonID, reason string) {
	blocked, err := ddbBlockedWork(c.Context(), userID)
	if err != nil {
		log.Printf("daemons: reading blocked work for %s: %v", userID, err)
		return
	}
	for _, task := range blocked {
		if task.DaemonID != daemonID {
			continue
		}
		_ = failBlockedTask(c, task, reason)
	}
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
		releasePinnedTasks(c, userID, d.DaemonID, "its laptop has not been heard from in a while")
	}
}
```

- [ ] **Step 5: Register the new route, and wire the other two sweeps into `deleteDaemon` and `getDaemons`**

Register the route in `registerDaemonRoutes`, beside the work poll:

```go
	app.Get("/daemons/sessions/expired", daemonAuth(), getDaemonExpiredSessions)
```

`postDaemonHeartbeat` is deliberately left untouched — see `getDaemonExpiredSessions`'s own comment on why this is a separate endpoint rather than a new field on the heartbeat's response.

In `deleteDaemon`, before `ddbDeleteDaemon` is called:

```go
	// Anything this machine had pinned is released before the row goes —
	// once the daemon is gone there is no path left for it to ever resume.
	releasePinnedTasks(c, user, id, "the laptop it was waiting on was unpaired")
```

In `getDaemons`, after the existing `ddbListDaemons` call:

```go
	now := time.Now().UTC()
	releaseStaleQuestions(c, authjwt.Sub(c), daemons, now)
```

placed before the existing `views := make(...)` loop (which may reuse the same `now` variable it already declares — remove the duplicate declaration if `now` already exists in that function).

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd backend/go && go test ./internal/api/ -run 'TestPostDaemonWorkAnswer|TestGetDaemonExpiredSessions|TestDeleteDaemonReleases' -v`
Expected: PASS, 4 tests.

- [ ] **Step 7: Run the whole backend suite**

Run: `cd backend/go && go build ./... && go test ./... && go vet ./... && gofmt -l internal/api/`
Expected: PASS, clean.

- [ ] **Step 8: Commit**

```bash
git add backend/go/internal/api/daemons.go backend/go/internal/api/daemons_test.go
git commit -m "daemons: a question that times out fails cleanly, and unpairing lets go"
```

---

## Task 4: the app can answer, too

**Repo:** mr20-pendant

**Files:**
- Modify: `backend/go/internal/api/tasks.go`
- Test: `backend/go/internal/api/tasks_test.go`

**Interfaces:**
- Consumes: `ddb.QuestionAnswered`, `ddb.QuestionExpired`, `ddb.AnswerQuestion` (Task 1); `loadTask`, `authjwt.Sub`, `truncate` (existing).
- Produces: `POST /tasks/:id/answer`.

- [ ] **Step 1: Write the failing tests**

Append to `backend/go/internal/api/tasks_test.go`:

```go
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend/go && go test ./internal/api/ -run TestAnswerTask -v`
Expected: FAIL — `undefined: answerTask`.

- [ ] **Step 3: Write the route**

In `internal/api/tasks.go`, register it:

```go
	app.Post("/tasks/:id/answer", answerTask)
```

and add, after `approveTask`:

```go
// answerTask writes a reply to a blocked task's question from the app side.
// Its daemon-side counterpart is postDaemonWorkAnswer
// (internal/api/daemons.go) — the same write, a different credential.
func answerTask(c *fiber.Ctx) error {
	task, err := loadTask(c)
	if err != nil {
		return err
	}
	if task.Status != ddb.TaskBlocked || task.Question == nil {
		return fiber.NewError(fiber.StatusConflict, "this task is not waiting on an answer")
	}
	if ddb.QuestionAnswered(*task) {
		// Idempotent: the first answer stands, a second tap sees it back.
		return c.JSON(fiber.Map{"task": *task})
	}

	var input struct {
		Answer string `json:"answer"`
	}
	if err := c.BodyParser(&input); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "request body must be JSON")
	}
	answer := truncate(strings.TrimSpace(input.Answer), 400)
	if answer == "" {
		return fiber.NewError(fiber.StatusBadRequest, "an answer needs text")
	}
	if ddb.QuestionExpired(*task, time.Now().UTC()) {
		return fiber.NewError(fiber.StatusConflict, "this question has expired")
	}

	updated, err := ddb.AnswerQuestion(c.Context(), *task, answer, "app")
	if err != nil {
		if errors.Is(err, ddb.ErrTaskTransition) {
			return fiber.NewError(fiber.StatusConflict, "this question is no longer open")
		}
		return err
	}
	return c.JSON(fiber.Map{"task": updated})
}
```

Update the header comment's route list with `POST /tasks/:id/answer   reply to a question a claimed task asked`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend/go && go test ./internal/api/ -run TestAnswerTask -v`
Expected: PASS, 3 tests.

- [ ] **Step 5: Run the whole backend suite**

Run: `cd backend/go && go build ./... && go test ./... && go vet ./... && gofmt -l internal/api/`
Expected: PASS, clean.

- [ ] **Step 6: Commit**

```bash
git add backend/go/internal/api/tasks.go backend/go/internal/api/tasks_test.go
git commit -m "tasks: the app can answer a question too"
```

---

# Part B — Mobile (mr20-pendant/mobile)

## Task 5: types, the client, the store, push routing

**Repo:** mr20-pendant

**Files:**
- Modify: `mobile/src/api/tasks.ts`
- Modify: `mobile/src/state/tasks.ts`
- Modify: `mobile/src/tasks/models.ts`
- Modify: `mobile/src/notifications/routes.ts`
- Test: `mobile/tests/tasks/models-blocked.test.ts` (new), `mobile/tests/notifications/routes-question.test.ts` (new)

**Interfaces:**
- Consumes: the `Task`/`TaskQuestion` wire shape from Tasks 1–4 (`question?: {id, text, options?, askedBy, askedAt, expiresAt, answer?, answeredAt?, answeredBy?}`); the `task.question` push payload (`{type, taskId}`) from Task 2.
- Produces: `TaskQuestion` type; widened `TaskStatus`; `tasksApi.answer(id, answer)`; store action `answerQuestion(id, answer) => Promise<{ok: boolean}>`; `isOpen` counting `blocked`; `'task.question'` in `PushType`/`PUSH_ROUTES`.

- [ ] **Step 1: Write the failing tests**

Create `mobile/tests/tasks/models-blocked.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isOpen, groupTasks } from '../../src/tasks/models';
import type { Task } from '../../src/api/tasks';

const blocked = (id: string): Task => ({
  taskId: id, userId: 'u', recordingId: '', text: 'x', kind: 'other',
  status: 'blocked', createdAt: '2026-09-14T09:00:00Z', updatedAt: '2026-09-14T09:00:00Z',
});

test('a blocked task is open — it is waiting on an answer, not settled', () => {
  assert.equal(isOpen({ status: 'blocked' }), true);
});

test('a blocked task lands in the open group, not lost', () => {
  const groups = groupTasks([blocked('t1')]);
  assert.equal(groups.open.length, 1);
  assert.equal(groups.open[0].taskId, 't1');
});
```

Create `mobile/tests/notifications/routes-question.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routeFor, isPushType } from '../../src/notifications/routes';

test('task.question routes to the task detail screen', () => {
  assert.equal(routeFor({ type: 'task.question', taskId: 'tk_1' }), '/task/tk_1');
});

test('task.question with no id routes nowhere', () => {
  assert.equal(routeFor({ type: 'task.question' }), undefined);
});

test('task.question is a recognised push type', () => {
  assert.equal(isPushType('task.question'), true);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd mobile && npm test`
Expected: FAIL — `status: 'blocked'` is not assignable to `TaskStatus`; `task.question` is not a valid `PushType`.

- [ ] **Step 3: Widen the task types and add `answer`**

In `mobile/src/api/tasks.ts`:

```ts
export type TaskStatus = 'proposed' | 'approved' | 'blocked' | 'done' | 'dismissed' | 'failed';

/** A question the daemon asked mid-task — present only while blocked. */
export interface TaskQuestion {
  id: string;
  text: string;
  /** Present only when this is a choice rather than free text. */
  options?: string[];
  askedBy: string;
  askedAt: string;
  expiresAt: string;
  answer?: string;
  answeredAt?: string;
  answeredBy?: string;
}
```

Add `question?: TaskQuestion;` to the `Task` interface, after `dueAt`. Widen `TASK_STATUSES`:

```ts
export const TASK_STATUSES: TaskStatus[] = [
  'proposed', 'approved', 'blocked', 'done', 'dismissed', 'failed',
];
```

Add to `tasksApi`:

```ts
  /**
   * Answer a blocked task's question. The daemon resumes on its own next
   * poll — this only ever writes the answer, never the task's status.
   */
  answer: (id: string, answer: string) =>
    request<{ task: Task }>('POST', `/tasks/${encodeURIComponent(id)}/answer`, { answer }),
```

- [ ] **Step 4: `isOpen` counts `blocked`**

In `mobile/src/tasks/models.ts`:

```ts
export function isOpen(task: Pick<TaskShape, 'status'>): boolean {
  return task.status === 'proposed' || task.status === 'approved' || task.status === 'blocked';
}
```

- [ ] **Step 5: Route `task.question`**

In `mobile/src/notifications/routes.ts`:

```ts
export type PushType =
  | 'recording.ready'
  | 'recording.failed'
  | 'tasks.proposed'
  | 'plan.activated'
  | 'receipt.printed'
  | 'task.question';
```

Add to `PUSH_ROUTES`:

```ts
  'task.question': (data) => {
    const taskId = id(data.taskId);
    return taskId ? `/task/${taskId}` : undefined;
  },
```

- [ ] **Step 6: The store action**

In `mobile/src/state/tasks.ts`, add to the `TasksState` interface, beside `sendToLaptop`:

```ts
  /** Answer a blocked task's question. */
  answerQuestion: (id: string, answer: string) => Promise<{ ok: boolean }>;
```

Implement it beside `dismiss`:

```ts
  async answerQuestion(id, answer) {
    const trimmed = answer.trim();
    if (!trimmed) return { ok: false };
    const before = get().tasks.find((t) => t.taskId === id);
    if (!before?.question) return { ok: false };

    if (get().fixtures) {
      const at = new Date().toISOString();
      const task: Task = {
        ...before,
        question: { ...before.question, answer: trimmed, answeredAt: at, answeredBy: 'app' },
        updatedAt: at,
      };
      set((s) => ({ tasks: replaceTask(s.tasks, task) }));
      return { ok: true };
    }

    try {
      const { task } = await tasksApi.answer(id, trimmed);
      set((s) => ({ tasks: replaceTask(s.tasks, task) }));
      return { ok: true };
    } catch (err) {
      set({ tasksError: message(err) });
      return { ok: false };
    }
  },
```

- [ ] **Step 7: Run tests and the type-check**

Run: `cd mobile && npm test && npx tsc --noEmit -p tsconfig.json`
Expected: PASS, 5 new tests; no type errors.

- [ ] **Step 8: Commit**

```bash
git add mobile/src/api/tasks.ts mobile/src/state/tasks.ts mobile/src/tasks/models.ts mobile/src/notifications/routes.ts mobile/tests/tasks/models-blocked.test.ts mobile/tests/notifications/routes-question.test.ts
git commit -m "tasks: the app knows about a blocked task and its question"
```

---

## Task 6: the answer affordance on the task detail screen

**Repo:** mr20-pendant

**Files:**
- Modify: `mobile/app/task/[id].tsx`
- Modify: `mobile/src/design/copy.ts`

**Interfaces:**
- Consumes: `useTasks((s) => s.answerQuestion)` (Task 5); `task.question` on the `Task` the screen already holds.

- [ ] **Step 1: Add the copy**

In `mobile/src/design/copy.ts`, inside `TASKS_COPY`, near `ifYouDoNothingBody`:

```ts
  /** A task parked on a question mid-execution. */
  question: 'THIS NEEDS AN ANSWER',
  answerPlaceholder: 'type your answer',
  sendAnswer: 'SEND ANSWER',
  answerSending: 'SENDING…',
  answerSent: 'Sent. Your laptop picks it up on its next check.',
  answerFailed: 'That did not send.',
  answerWaiting: 'ANSWER SENT · WAITING ON YOUR LAPTOP',
```

- [ ] **Step 2: Wire the screen**

In `mobile/app/task/[id].tsx`, add the store hook and local state beside the existing ones:

```tsx
  const answerQuestion = useTasks((s) => s.answerQuestion);
  const [answer, setAnswer] = useState('');
  const [answering, setAnswering] = useState(false);
```

Change the status derivations:

```tsx
  const blocked = task.status === 'blocked';
  const failed = task.status === 'failed';
  const settled = task.status === 'done' || task.status === 'dismissed';
```

Add the handler beside `onDismiss`:

```tsx
  const onAnswer = useCallback(async (text: string) => {
    if (!task || !text.trim() || answering) return;
    setAnswering(true);
    const outcome = await answerQuestion(task.taskId, text.trim());
    setAnswering(false);
    if (outcome.ok) {
      setAnswer('');
      toast.show(TASKS_COPY.answerSent);
    } else {
      toast.show(TASKS_COPY.answerFailed, { tone: 'error' });
    }
  }, [task, answering, answerQuestion, toast]);
```

Hide the dismiss action while blocked — a blocked task cannot be dismissed on the backend (`DismissTask` only leaves `proposed`/`approved`), so the affordance must not offer it:

```tsx
        right={settled || blocked ? undefined : (
          <TopAction label={TASKS_COPY.dismiss} tone="danger" onPress={onDismiss} />
        )}
```

Add the question card, in place of drawing nothing between the claim card and the failed card:

```tsx
        {blocked && task.question ? (
          <Card variant="carbon" className="gap-[8px]">
            <Label variant="eyebrow">{TASKS_COPY.question}</Label>
            <Txt variant="strong">{task.question.text}</Txt>
            {task.question.answer ? (
              <Label variant="tag" tone="stamp">{TASKS_COPY.answerWaiting}</Label>
            ) : null}
          </Card>
        ) : null}
```

Replace the bottom action bar's conditional (`{settled ? null : (...)}`) with a three-way branch:

```tsx
      {settled ? null : blocked && task.question && !task.question.answer ? (
        <View className="px-[20px] pt-[10px] pb-[16px] gap-[9px]">
          {task.question.options?.length ? (
            <View className="gap-[7px]">
              {task.question.options.map((option) => (
                <Button
                  key={option}
                  full
                  variant="secondary"
                  title={option}
                  busy={answering}
                  onPress={() => onAnswer(option)}
                />
              ))}
            </View>
          ) : (
            <>
              <Field
                value={answer}
                onChangeText={setAnswer}
                placeholder={TASKS_COPY.answerPlaceholder}
                multiline
                accessibilityLabel="your answer"
              />
              <Button
                full
                title={TASKS_COPY.sendAnswer}
                busy={answering}
                busyLabel={TASKS_COPY.answerSending}
                disabled={answer.trim().length === 0}
                onPress={() => onAnswer(answer)}
              />
            </>
          )}
        </View>
      ) : blocked ? null : (
        <View className="flex-row gap-[9px] px-[20px] pt-[10px] pb-[16px]">
          <Button className="flex-1" title={TASKS_COPY.markDone} busy={busy} onPress={onMarkDone} />
          <Button
            className="flex-1"
            variant="secondary"
            title={TASKS_COPY.edit}
            onPress={() => router.push(`/task/${task.taskId}/edit`)}
          />
        </View>
      )}
```

Import `Field` from `../../src/design/kit` alongside the other kit imports.

- [ ] **Step 3: Run the type-check**

Run: `cd mobile && npm test && npx tsc --noEmit -p tsconfig.json`
Expected: PASS; no type errors. This screen has no dedicated render test today (the daemon-tasks compose sheet followed the same precedent) — Task 5's `answerQuestion` store test is what exercises the behaviour this screen calls into.

- [ ] **Step 4: Commit**

```bash
git add mobile/app/task/\[id\].tsx mobile/src/design/copy.ts
git commit -m "task detail: answer the question that is blocking it"
```

---

# Part C — KARMAX

## Task 7: a per-task working directory, created on demand, and a real delete

**Repo:** KARMAX

**Files:**
- Modify: `internal/hostpaths/hostpaths.go`
- Modify: `internal/tools/builtin/claude_code.go`
- Modify: `internal/chatlog/slug.go`
- Modify: `internal/store/coding_store.go`
- Test: `internal/hostpaths/hostpaths_test.go`, `internal/chatlog/slug_test.go` (create if absent), `internal/store/coding_store_test.go` (new)

**Interfaces:**
- Consumes: nothing from this plan; builds on `hostpaths.WorkDir()`, `chatlog.Dir()`, `ClaudeCodeTool.run`'s existing `session_id`/`working_dir`/`ephemeral` input fields (all already accepted, per the spec's verified findings).
- Produces: `hostpaths.Resolve(dir string) string`; `chatlog.RemoveSession(workdir, sessionID string) error`; `(*ClaudeCodeTool).Cleanup(workingDir, sessionID string) error`; `Store.DeleteCodingSessionsBySessionID(sessionID string) error`; `Store.ListStaleCodingSessionIDs(prefix string, cutoff time.Time) ([]string, error)`. Tasks 8, 10 and 11 call these directly.

- [ ] **Step 1: Write the failing tests**

Check the top of `internal/hostpaths/hostpaths.go` for `import ("path/filepath" ...)` and for an existing `hostpaths_test.go`; append to it (or create it) with:

```go
package hostpaths

import (
	"path/filepath"
	"sync"
	"testing"
)

func TestResolve(t *testing.T) {
	t.Setenv("KARMAX_WORKDIR", filepath.Join(t.TempDir(), "root"))
	workOnce = sync.Once{} // WorkDir() memoizes; force it to read the env var above
	root := WorkDir()

	if got := Resolve(""); got != root {
		t.Fatalf("empty = %q, want the shared root %q", got, root)
	}
	if got := Resolve("/absolute/elsewhere"); got != "/absolute/elsewhere" {
		t.Fatalf("an absolute path must be used verbatim, got %q", got)
	}
	want := filepath.Join(root, "lyzn-tasks", "task-1")
	if got := Resolve("lyzn-tasks/task-1"); got != want {
		t.Fatalf("relative = %q, want %q", got, want)
	}
}
```

Create `internal/chatlog/slug_test.go`:

```go
package chatlog

import (
	"os"
	"path/filepath"
	"testing"
)

func TestRemoveSessionDeletesTheTranscriptFile(t *testing.T) {
	workdir := t.TempDir()
	dir := Dir(workdir)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	path := filepath.Join(dir, "sess-1.jsonl")
	if err := os.WriteFile(path, []byte("{}"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}

	if err := RemoveSession(workdir, "sess-1"); err != nil {
		t.Fatalf("remove: %v", err)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("transcript still exists: %v", err)
	}
}

func TestRemoveSessionOnANonExistentFileIsNotAnError(t *testing.T) {
	if err := RemoveSession(t.TempDir(), "never-existed"); err != nil {
		t.Fatalf("removing a transcript that was never written must not error: %v", err)
	}
}
```

Create `internal/store/coding_store_test.go`:

```go
package store

import (
	"testing"
	"time"
)

func TestDeleteCodingSessionsBySessionIDRemovesEveryRowForThatSession(t *testing.T) {
	s := newTestStore(t)
	for i := 0; i < 3; i++ {
		if err := s.SaveCodingSession(StoredCodingSession{
			ID: []string{"row-0", "row-1", "row-2"}[i], ToolType: "claude_code",
			SessionID: "lyzn:task-1", AgentID: "a1", Status: "completed",
		}); err != nil {
			t.Fatalf("save: %v", err)
		}
	}
	if err := s.SaveCodingSession(StoredCodingSession{
		ID: "other", ToolType: "claude_code", SessionID: "lyzn:task-2", AgentID: "a1",
	}); err != nil {
		t.Fatalf("save other: %v", err)
	}

	if err := s.DeleteCodingSessionsBySessionID("lyzn:task-1"); err != nil {
		t.Fatalf("delete: %v", err)
	}

	left, err := s.ListCodingSessions("")
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(left) != 1 || left[0].SessionID != "lyzn:task-2" {
		t.Fatalf("got %v, want only lyzn:task-2 left", left)
	}
}

func TestListStaleCodingSessionIDsFindsOnlyThePrefixAndTheAge(t *testing.T) {
	s := newTestStore(t)
	if err := s.SaveCodingSession(StoredCodingSession{ID: "a", ToolType: "claude_code", SessionID: "lyzn:task-1", AgentID: "a1"}); err != nil {
		t.Fatal(err)
	}
	if err := s.SaveCodingSession(StoredCodingSession{ID: "b", ToolType: "claude_code", SessionID: "other:task-9", AgentID: "a1"}); err != nil {
		t.Fatal(err)
	}

	none, err := s.ListStaleCodingSessionIDs("lyzn:", time.Now().Add(-time.Hour))
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(none) != 0 {
		t.Fatalf("got %v, want nothing — both rows are fresh, the cutoff is in the past", none)
	}

	stale, err := s.ListStaleCodingSessionIDs("lyzn:", time.Now().Add(time.Hour))
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(stale) != 1 || stale[0] != "lyzn:task-1" {
		t.Fatalf("got %v, want exactly [lyzn:task-1] — the other prefix must not match", stale)
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd ~/Developer/code/KARMAX && go test ./internal/hostpaths/ ./internal/chatlog/ ./internal/store/ -run 'TestResolve|TestRemoveSession|TestDeleteCodingSessions|TestListStaleCodingSessionIDs' -v`
Expected: FAIL — `undefined: Resolve`, `undefined: RemoveSession`, `undefined: DeleteCodingSessionsBySessionID`, `undefined: ListStaleCodingSessionIDs`.

- [ ] **Step 3: `hostpaths.Resolve`**

In `internal/hostpaths/hostpaths.go`, after `WorkDir`:

```go
// Resolve turns a working_dir value into an absolute path. Empty means the
// shared default; an absolute path is used verbatim; anything else is a
// subdirectory of WorkDir() rather than a path from the process's own
// working directory, which is undefined for a daemon with no terminal.
func Resolve(dir string) string {
	if dir == "" {
		return WorkDir()
	}
	if filepath.IsAbs(dir) {
		return dir
	}
	return filepath.Join(WorkDir(), dir)
}
```

Add `"path/filepath"` to the file's imports if it is not already there.

- [ ] **Step 4: `chatlog.RemoveSession`**

In `internal/chatlog/slug.go`, after `Dir`:

```go
// RemoveSession deletes one session's transcript file — for an ephemeral
// one-off run, and for the terminal cleanup of a durable one. Removing a
// transcript that is already gone is not an error.
func RemoveSession(workdir, sessionID string) error {
	if sessionID == "" {
		return nil
	}
	err := os.Remove(filepath.Join(Dir(workdir), sessionID+".jsonl"))
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}
```

- [ ] **Step 5: The store deletes**

In `internal/store/coding_store.go`, after `UpdateCodingSessionStatus`:

```go
// DeleteCodingSessionsBySessionID removes every row for one session_id. A
// session resumed across several turns accumulates one row per turn under
// the same session_id (id is minted fresh each call), so this is the one
// delete that reclaims all of them.
func (s *Store) DeleteCodingSessionsBySessionID(sessionID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, err := s.exec(`DELETE FROM coding_sessions WHERE session_id = ?`, sessionID)
	if err != nil {
		return fmt.Errorf("delete coding sessions: %w", err)
	}
	return nil
}

// ListStaleCodingSessionIDs returns the distinct session ids matching prefix
// whose most recent row was last touched before cutoff — the six-hour
// backstop's own query.
func (s *Store) ListStaleCodingSessionIDs(prefix string, cutoff time.Time) ([]string, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	rows, err := s.query(`SELECT DISTINCT session_id FROM coding_sessions WHERE session_id LIKE ? AND updated_at < ?`,
		prefix+"%", cutoff)
	if err != nil {
		return nil, fmt.Errorf("list stale coding sessions: %w", err)
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("scan stale coding session: %w", err)
		}
		ids = append(ids, id)
	}
	return ids, nil
}
```

- [ ] **Step 6: `ClaudeCodeTool` uses `Resolve`, creates the directory, and gains `Cleanup`**

In `internal/tools/builtin/claude_code.go`'s `.run`, replace:

```go
	workingDir, _ := input["working_dir"].(string)
	if workingDir == "" {
		workingDir = hostpaths.WorkDir()
	}
```

with:

```go
	workingDir, _ := input["working_dir"].(string)
	workingDir = hostpaths.Resolve(workingDir)
	if err := os.MkdirAll(workingDir, 0o755); err != nil {
		return tools.ErrorResult(fmt.Errorf("could not create working directory %s: %w", workingDir, err)), nil
	}
```

Replace the ephemeral branch's call to the local `removeClaudeSession` with the now-exported helper, and delete `removeClaudeSession` entirely:

```go
	if ephemeral {
		chatlog.RemoveSession(workingDir, sessionID)
	} else if t.Store != nil {
```

Add, after `.run`:

```go
// Cleanup deletes a coding session's durable state: its transcript, its
// working directory, and its coding_sessions rows. The terminal moment in a
// non-ephemeral session's life — done, failed, a question that expired, or a
// daemon giving up tasks it can no longer hold — where nothing should ever
// resume into it again. Deleting a session that is already gone is not an
// error.
func (t *ClaudeCodeTool) Cleanup(workingDir, sessionID string) error {
	workingDir = hostpaths.Resolve(workingDir)
	if err := chatlog.RemoveSession(workingDir, sessionID); err != nil {
		return err
	}
	if err := os.RemoveAll(workingDir); err != nil {
		return err
	}
	if t.Store == nil || sessionID == "" {
		return nil
	}
	return t.Store.DeleteCodingSessionsBySessionID(sessionID)
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd ~/Developer/code/KARMAX && go test ./internal/hostpaths/ ./internal/chatlog/ ./internal/store/ ./internal/tools/builtin/ -run 'TestResolve|TestRemoveSession|TestDeleteCodingSessions|TestListStaleCodingSessionIDs' -v`
Expected: PASS.

- [ ] **Step 8: Run the whole suite**

Run: `cd ~/Developer/code/KARMAX && go build ./... && go test ./... && go vet ./... && gofmt -l internal/hostpaths/ internal/chatlog/ internal/store/ internal/tools/builtin/`
Expected: PASS, clean.

- [ ] **Step 9: Commit**

```bash
git add internal/hostpaths/hostpaths.go internal/chatlog/slug.go internal/store/coding_store.go internal/tools/builtin/claude_code.go internal/hostpaths/hostpaths_test.go internal/chatlog/slug_test.go internal/store/coding_store_test.go
git commit -m "claude_code: a working directory is created, not just assumed, and can be reclaimed"
```

---

## Task 8: `HarnessWith` and `HarnessForget` on `Kit`

**Repo:** KARMAX

**Files:**
- Modify: `pkg/loopkit/kit.go`
- Modify: `internal/runtime/loophost.go`
- Modify: `internal/runtime/wasmhost.go`
- Modify: `internal/recipes/dryrun.go`

**Interfaces:**
- Consumes: `builtin.ClaudeCodeTool.Execute`/`.Cleanup` (Task 7, unchanged signature already accepting `session_id`/`working_dir`/`ephemeral`).
- Produces: `loopkit.HarnessSpec{Prompt, SessionID, WorkingDir, Ephemeral}`; `loopkit.HarnessResult{Output, SessionID}`; `Kit.HarnessWith(ctx, HarnessSpec) (HarnessResult, error)`; `Kit.HarnessForget(sessionID, workingDir string) error`. Task 9's recipe verb calls both directly.

- [ ] **Step 1: Write the failing test**

`Kit` is an interface with three real implementers today (`loopKit`, `wasmKit`, `DryRun`) and no test-only fake of its own, so the failing test is a compile check: add to `internal/recipes/dryrun_test.go` (create if absent):

```go
package recipes

import (
	"context"
	"testing"

	"github.com/MelloB1989/karmax/pkg/loopkit"
)

func TestDryRunHarnessWithRecordsTheSpecAndEchoesTheSessionID(t *testing.T) {
	d := NewDryRun(loopkit.Trigger{Kind: loopkit.TriggerManual})
	res, err := d.HarnessWith(context.Background(), loopkit.HarnessSpec{
		Prompt: "do the thing", SessionID: "lyzn:t1", WorkingDir: "lyzn-tasks/t1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if res.SessionID != "lyzn:t1" {
		t.Fatalf("session id = %q, want it echoed back", res.SessionID)
	}
	if !strings.Contains(d.Report(), "lyzn:t1") {
		t.Fatalf("report does not mention the session: %s", d.Report())
	}
}

func TestDryRunHarnessForgetRecordsWithoutErroring(t *testing.T) {
	d := NewDryRun(loopkit.Trigger{Kind: loopkit.TriggerManual})
	if err := d.HarnessForget("lyzn:t1", "lyzn-tasks/t1"); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(d.Report(), "lyzn:t1") {
		t.Fatalf("report does not mention the forgotten session: %s", d.Report())
	}
}
```

Add `"strings"` to the imports.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd ~/Developer/code/KARMAX && go build ./... 2>&1 | head -20`
Expected: FAIL — `undefined: loopkit.HarnessSpec`, and once that is added, `*DryRun does not implement loopkit.Kit (missing method HarnessWith)`.

- [ ] **Step 3: Add the types and interface methods**

In `pkg/loopkit/kit.go`, after `AwaitSpec`:

```go
// HarnessSpec is a durable, resumable Harness call — everything Harness
// itself does not expose: a session identity, a working directory, and
// whether the run may be resumed at all.
type HarnessSpec struct {
	Prompt string
	// SessionID, when set, is passed as --resume/--session-id: the same
	// value used twice is what makes a later call pick the conversation
	// back up rather than starting cold. Empty behaves like Harness.
	SessionID string
	// WorkingDir, when relative, is a subdirectory of the shared work root
	// rather than a path from the daemon's own (undefined) working
	// directory. Empty uses the shared root, exactly like Harness.
	WorkingDir string
	// Ephemeral mirrors Harness's own behaviour when true: the transcript is
	// deleted the moment this call returns, and nothing is kept to resume.
	// Only a caller that wants a session to outlive one call sets it false.
	Ephemeral bool
}

// HarnessResult is what a HarnessWith call produced.
type HarnessResult struct {
	Output string
	// SessionID is the id the call actually ran under.
	SessionID string
}
```

Add to the `Kit` interface, directly below the existing `Harness` entry:

```go
	// HarnessWith is Harness with explicit control over session identity and
	// working directory, for callers that need a conversation to survive
	// past one call — a task that might ask a question and has to resume
	// with its own context once it is answered, rather than starting cold.
	HarnessWith(ctx context.Context, spec HarnessSpec) (HarnessResult, error)

	// HarnessForget deletes a durable session's transcript, working
	// directory and session records — the terminal cleanup for one started
	// via HarnessWith with Ephemeral: false. Removing a session that does
	// not exist, or was never durable, is not an error.
	HarnessForget(sessionID, workingDir string) error
```

- [ ] **Step 4: Implement in `loopKit`**

In `internal/runtime/loophost.go`, replace `Harness` and add its two siblings:

```go
func (k *loopKit) Harness(ctx context.Context, prompt string) (string, error) {
	res, err := k.HarnessWith(ctx, loopkit.HarnessSpec{Prompt: prompt, Ephemeral: true})
	if err != nil {
		return "", err
	}
	return res.Output, nil
}

// HarnessWith is Harness with a caller-chosen session and working directory.
func (k *loopKit) HarnessWith(ctx context.Context, spec loopkit.HarnessSpec) (loopkit.HarnessResult, error) {
	tool := &builtin.ClaudeCodeTool{Store: k.rt.store, AgentID: k.agentID, Namespace: k.namespace,
		MemoryMgr: k.mem, Browser: browser.Shared(k.rt.cfg.Karmax.DataDir),
		DataDir: k.rt.cfg.Karmax.DataDir}
	res, err := tool.Execute(ctx, map[string]any{
		"prompt": spec.Prompt, "session_id": spec.SessionID,
		"working_dir": spec.WorkingDir, "ephemeral": spec.Ephemeral,
	})
	if err != nil {
		return loopkit.HarnessResult{}, err
	}
	if res.IsError {
		return loopkit.HarnessResult{}, fmt.Errorf("harness: %s", res.Error)
	}
	return loopkit.HarnessResult{
		Output:    loopToolField(res, "output"),
		SessionID: loopToolField(res, "session_id"),
	}, nil
}

// HarnessForget is the terminal cleanup for a session started through
// HarnessWith — see (*builtin.ClaudeCodeTool).Cleanup.
func (k *loopKit) HarnessForget(sessionID, workingDir string) error {
	tool := &builtin.ClaudeCodeTool{Store: k.rt.store, AgentID: k.agentID, DataDir: k.rt.cfg.Karmax.DataDir}
	return tool.Cleanup(workingDir, sessionID)
}
```

- [ ] **Step 5: Implement in `wasmKit` and `DryRun`**

In `internal/runtime/wasmhost.go`, after `Harness`:

```go
func (w *wasmKit) HarnessWith(ctx context.Context, spec loopkit.HarnessSpec) (loopkit.HarnessResult, error) {
	return w.mem().HarnessWith(ctx, spec)
}

func (w *wasmKit) HarnessForget(sessionID, workingDir string) error {
	return w.mem().HarnessForget(sessionID, workingDir)
}
```

In `internal/recipes/dryrun.go`, after `Harness`:

```go
func (d *DryRun) HarnessWith(_ context.Context, spec loopkit.HarnessSpec) (loopkit.HarnessResult, error) {
	d.record("run the harness on: %s (session=%s, workdir=%s)", oneLine(spec.Prompt), spec.SessionID, spec.WorkingDir)
	return loopkit.HarnessResult{
		Output:    "[the harness output would appear here]",
		SessionID: spec.SessionID,
	}, nil
}

func (d *DryRun) HarnessForget(sessionID, workingDir string) error {
	d.record("forget the harness session %s (workdir=%s)", sessionID, workingDir)
	return nil
}
```

- [ ] **Step 6: Run the tests**

Run: `cd ~/Developer/code/KARMAX && go build ./... && go test ./internal/recipes/ -run 'TestDryRunHarness' -v`
Expected: PASS, 2 tests.

- [ ] **Step 7: Run the whole suite**

Run: `cd ~/Developer/code/KARMAX && go test ./... && go vet ./... && gofmt -l pkg/loopkit/ internal/runtime/ internal/recipes/`
Expected: PASS, clean.

- [ ] **Step 8: Commit**

```bash
git add pkg/loopkit/kit.go internal/runtime/loophost.go internal/runtime/wasmhost.go internal/recipes/dryrun.go internal/recipes/dryrun_test.go
git commit -m "loopkit: a harness call can carry a session and working directory of its own"
```

---

## Task 9: the recipe verbs — `harness:`'s object form and `harness.forget`

**Repo:** KARMAX

**Files:**
- Modify: `internal/recipes/recipe.go`
- Modify: `internal/recipes/run.go`
- Modify: `internal/recipes/describe.go`
- Test: `internal/recipes/recipes_test.go`

**Interfaces:**
- Consumes: `loopkit.HarnessSpec`, `Kit.HarnessWith`, `Kit.HarnessForget` (Task 8).
- Produces: `harness:` accepting `{text, session_id, working_dir, ephemeral}` alongside its existing plain-string form; the new verb `harness.forget: {session_id, working_dir}`; `boolArg(s string, def bool) bool`; the `contains` template function usable in any `when:`. `desktop/resources/loops/lyzn-tasks.yaml` (Task 12, in mr20-pendant) is built on exactly this contract.

- [ ] **Step 1: Write the failing tests**

Append to `internal/recipes/recipes_test.go`:

```go
// harnessRecordingKit records what HarnessWith/HarnessForget were called
// with, so a test can assert on the spec rather than only on the reply.
type harnessRecordingKit struct {
	*DryRun
	specs     []loopkit.HarnessSpec
	forgotten []string
}

func (k *harnessRecordingKit) HarnessWith(ctx context.Context, spec loopkit.HarnessSpec) (loopkit.HarnessResult, error) {
	k.specs = append(k.specs, spec)
	return k.DryRun.HarnessWith(ctx, spec)
}

func (k *harnessRecordingKit) HarnessForget(sessionID, workingDir string) error {
	k.forgotten = append(k.forgotten, sessionID+"@"+workingDir)
	return k.DryRun.HarnessForget(sessionID, workingDir)
}

func TestHarnessObjectFormCarriesSessionAndWorkdirThroughHarnessWith(t *testing.T) {
	r := mustParse(t, `
name: x
on:
  manual: true
steps:
  - harness:
      text: "do the thing"
      session_id: "lyzn:t1"
      working_dir: "lyzn-tasks/t1"
      ephemeral: "false"
    as: reply
`)
	k := &harnessRecordingKit{DryRun: NewDryRun(loopkit.Trigger{Kind: loopkit.TriggerManual})}
	if err := Run(context.Background(), r, k); err != nil {
		t.Fatal(err)
	}
	if len(k.specs) != 1 {
		t.Fatalf("got %d HarnessWith calls, want 1", len(k.specs))
	}
	got := k.specs[0]
	if got.SessionID != "lyzn:t1" || got.WorkingDir != "lyzn-tasks/t1" || got.Ephemeral {
		t.Errorf("spec = %+v, want session=lyzn:t1 workdir=lyzn-tasks/t1 ephemeral=false", got)
	}
}

func TestHarnessPlainStringFormNeverTouchesHarnessWith(t *testing.T) {
	// Every recipe that never wrote session_id/working_dir keeps calling
	// plain Harness — the common case's shape must not change.
	r := mustParse(t, "name: x\non:\n  manual: true\nsteps:\n  - harness: do the thing\n    as: reply\n")
	k := &harnessRecordingKit{DryRun: NewDryRun(loopkit.Trigger{Kind: loopkit.TriggerManual})}
	if err := Run(context.Background(), r, k); err != nil {
		t.Fatal(err)
	}
	if len(k.specs) != 0 {
		t.Fatalf("got %d HarnessWith calls, want 0", len(k.specs))
	}
}

func TestHarnessForgetCallsThroughWithBothFields(t *testing.T) {
	r := mustParse(t, `
name: x
on:
  manual: true
steps:
  - harness.forget:
      session_id: "lyzn:t1"
      working_dir: "lyzn-tasks/t1"
`)
	k := &harnessRecordingKit{DryRun: NewDryRun(loopkit.Trigger{Kind: loopkit.TriggerManual})}
	if err := Run(context.Background(), r, k); err != nil {
		t.Fatal(err)
	}
	if len(k.forgotten) != 1 || k.forgotten[0] != "lyzn:t1@lyzn-tasks/t1" {
		t.Fatalf("forgotten = %v, want one call for lyzn:t1@lyzn-tasks/t1", k.forgotten)
	}
}

func TestContainsIsAvailableInWhenConditions(t *testing.T) {
	r := mustParse(t, `
name: x
on:
  manual: true
steps:
  - when: '{{ contains .reply "STATUS: blocked" }}'
    notify: { title: "BLOCKED-BRANCH" }
    else:
      - notify: { title: "OTHER-BRANCH" }
`)
	k := NewDryRun(loopkit.Trigger{
		Kind: loopkit.TriggerManual,
		Payload: map[string]any{"reply": "STATUS: blocked\nSUMMARY: need a password"},
	})
	if err := Run(context.Background(), r, k); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(k.Report(), "BLOCKED-BRANCH") || strings.Contains(k.Report(), "OTHER-BRANCH") {
		t.Errorf("a STATUS: blocked reply did not take the contains branch:\n%s", k.Report())
	}
}

func TestBoolArg(t *testing.T) {
	cases := []struct {
		in   string
		def  bool
		want bool
	}{
		{"true", false, true}, {"false", true, false},
		{"", true, true}, {"", false, false},
		{"yes", false, true}, {"nonsense", true, true},
	}
	for _, c := range cases {
		if got := boolArg(c.in, c.def); got != c.want {
			t.Errorf("boolArg(%q, %v) = %v, want %v", c.in, c.def, got, c.want)
		}
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd ~/Developer/code/KARMAX && go test ./internal/recipes/ -run 'TestHarnessObjectForm|TestHarnessPlainStringForm|TestHarnessForget|TestContainsIsAvailable|TestBoolArg' -v`
Expected: FAIL — `unknown step "harness.forget"`, `undefined: boolArg`, `function "contains" not defined`.

- [ ] **Step 3: Add the verb and its required field**

In `internal/recipes/recipe.go`:

```go
	VerbHarness       = "harness"        // a coding harness, for research and shell work
	VerbHarnessForget = "harness.forget" // release a durable harness session's disk
```

Add `VerbHarnessForget` to `verbs`, and to `required`:

```go
	VerbHarnessForget: {"session_id"},
```

- [ ] **Step 4: Extend `case VerbHarness` and add `case VerbHarnessForget`**

In `internal/recipes/run.go`:

```go
	case VerbHarness:
		p, err := text()
		if err != nil {
			return nil, err
		}
		sessionID, err := arg("session_id")
		if err != nil {
			return nil, err
		}
		workingDir, err := arg("working_dir")
		if err != nil {
			return nil, err
		}
		ephemeralRaw, err := arg("ephemeral")
		if err != nil {
			return nil, err
		}
		if sessionID == "" && workingDir == "" {
			// The common case, unchanged: nothing here writes session_id or
			// working_dir, so every existing recipe keeps calling Harness.
			return k.Step(id, func() (string, error) { return k.Harness(ctx, p) })
		}
		spec := loopkit.HarnessSpec{
			Prompt: p, SessionID: sessionID, WorkingDir: workingDir,
			Ephemeral: boolArg(ephemeralRaw, true),
		}
		return k.Step(id, func() (string, error) {
			res, err := k.HarnessWith(ctx, spec)
			return res.Output, err
		})

	case VerbHarnessForget:
		sessionID, err := arg("session_id")
		if err != nil {
			return nil, err
		}
		workingDir, err := arg("working_dir")
		if err != nil {
			return nil, err
		}
		return nil, k.Once(id, func() error { return k.HarnessForget(sessionID, workingDir) })
```

Add `boolArg` near `intArg`:

```go
// boolArg parses a rendered field the way truthy reads a 'when', but with an
// explicit default for the common case of a field being absent rather than
// present-and-false — 'ephemeral' left out of a harness: step must not read
// as false.
func boolArg(s string, def bool) bool {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "true", "1", "yes", "on":
		return true
	case "false", "0", "no", "off":
		return false
	default:
		return def
	}
}
```

Add `contains` to `render`'s template:

```go
	t, err := template.New("s").Option("missingkey=zero").
		Funcs(template.FuncMap{"contains": strings.Contains}).
		Parse(s)
```

- [ ] **Step 5: Add the description**

In `internal/recipes/describe.go`'s `verbDescriptions`:

```go
	VerbHarnessForget: "release a harness session's disk — its transcript and working directory",
```

Also add `VerbHarnessForget: "session_id: \"s1\"\n      working_dir: \"w1\""` to `parse_test.go`'s `mapForms` map (the table `TestVerbsAcceptTheirMapForm`, or whichever test iterates it) so the new verb's map-form parsing is covered the same way `VerbAwait`/`VerbSandbox` already are.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd ~/Developer/code/KARMAX && go test ./internal/recipes/ -run 'TestHarnessObjectForm|TestHarnessPlainStringForm|TestHarnessForget|TestContainsIsAvailable|TestBoolArg' -v`
Expected: PASS, 5 tests.

- [ ] **Step 7: Run the whole suite**

Run: `cd ~/Developer/code/KARMAX && go build ./... && go test ./... && go vet ./... && gofmt -l internal/recipes/`
Expected: PASS, clean. `eject.go`'s code generator does not gain cases for either verb in this task — see the plan's Self-Review.

- [ ] **Step 8: Commit**

```bash
git add internal/recipes/recipe.go internal/recipes/run.go internal/recipes/describe.go internal/recipes/recipes_test.go internal/recipes/parse_test.go
git commit -m "recipes: harness: can carry a session, and a session can be forgotten"
```

---

## Task 10: the six-hour backstop

**Repo:** KARMAX

**Files:**
- Create: `internal/runtime/lyzntasks.go`
- Modify: `internal/runtime/looprun.go`
- Test: `internal/runtime/lyzntasks_test.go` (new)

**Interfaces:**
- Consumes: `Store.ListStaleCodingSessionIDs`, `(*builtin.ClaudeCodeTool).Cleanup` (Task 7).
- Produces: `(*KarmaxRuntime).pruneStaleLyznSessions(before time.Time)`, wired into the ticker `retryWorker` already runs.

- [ ] **Step 1: Write the failing test**

Create `internal/runtime/lyzntasks_test.go`:

```go
package runtime

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/MelloB1989/karmax/internal/store"
	"go.uber.org/zap"
)

func TestPruneStaleLyznSessionsDeletesMatchingRows(t *testing.T) {
	s, err := store.New(filepath.Join(t.TempDir(), "test.db"), zap.NewNop())
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	if err := s.SaveCodingSession(store.StoredCodingSession{
		ID: "row-1", ToolType: "claude_code", SessionID: "lyzn:task-9", AgentID: "a1",
	}); err != nil {
		t.Fatalf("save lyzn row: %v", err)
	}
	if err := s.SaveCodingSession(store.StoredCodingSession{
		ID: "row-2", ToolType: "claude_code", SessionID: "other:task-1", AgentID: "a1",
	}); err != nil {
		t.Fatalf("save other row: %v", err)
	}

	rt := &KarmaxRuntime{store: s, log: zap.NewNop()}
	rt.pruneStaleLyznSessions(time.Now().Add(time.Hour)) // cutoff in the future: both rows already qualify by age

	left, err := s.ListCodingSessions("")
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(left) != 1 || left[0].SessionID != "other:task-1" {
		t.Fatalf("got %v, want only the non-lyzn row left", left)
	}
}
```

Confirm `KarmaxRuntime`'s fields are actually named `store` and `log` (grep `rt\.store\b\|rt\.log\b` in `internal/runtime/`); adjust the struct literal if the real field names differ.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd ~/Developer/code/KARMAX && go test ./internal/runtime/ -run TestPruneStaleLyznSessions -v`
Expected: FAIL — `undefined: (*KarmaxRuntime).pruneStaleLyznSessions`.

- [ ] **Step 3: Write `pruneStaleLyznSessions`**

Create `internal/runtime/lyzntasks.go`:

```go
// The six-hour backstop for LYZN task sessions.
//
// Every terminal path — done, failed, a question that expired, a daemon that
// gave up its pinned tasks — is supposed to clean up after itself already.
// This exists for what falls through anyway: the tail, not the common case.
package runtime

import (
	"path/filepath"
	"strings"
	"time"

	"github.com/MelloB1989/karmax/internal/hostpaths"
	"github.com/MelloB1989/karmax/internal/tools/builtin"
	"go.uber.org/zap"
)

// lyznSessionPrefix is the deterministic key every LYZN task's durable
// session carries.
const lyznSessionPrefix = "lyzn:"

// pruneStaleLyznSessions finds coding_sessions rows nobody reclaimed and
// cleans each one up, recomputing the transcript path and working directory
// from the task id embedded in the session id itself — no lookup table is
// needed, because the naming is deterministic by construction.
func (rt *KarmaxRuntime) pruneStaleLyznSessions(before time.Time) {
	ids, err := rt.store.ListStaleCodingSessionIDs(lyznSessionPrefix, before)
	if err != nil {
		rt.log.Warn("could not list stale LYZN task sessions", zap.Error(err))
		return
	}
	tool := &builtin.ClaudeCodeTool{Store: rt.store}
	for _, sessionID := range ids {
		taskID := strings.TrimPrefix(sessionID, lyznSessionPrefix)
		workdir := hostpaths.Resolve(filepath.Join("lyzn-tasks", taskID))
		if err := tool.Cleanup(workdir, sessionID); err != nil {
			rt.log.Warn("could not clean up a stale LYZN task session",
				zap.String("session_id", sessionID), zap.Error(err))
		}
	}
}
```

- [ ] **Step 4: Wire it into the existing ticker**

In `internal/runtime/looprun.go`'s `retryWorker`, in the `case <-prune.C:` block, after the `PruneMeter` call:

```go
		// A week, matching harness.prune's own default cutoff in spirit —
		// anything this finds already fell through done, failed, expiry and
		// unpair, so it is the tail, not the common case.
		rt.pruneStaleLyznSessions(time.Now().AddDate(0, 0, -7))
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd ~/Developer/code/KARMAX && go test ./internal/runtime/ -run TestPruneStaleLyznSessions -v`
Expected: PASS.

- [ ] **Step 6: Run the whole suite**

Run: `cd ~/Developer/code/KARMAX && go build ./... && go test ./... && go vet ./... && gofmt -l internal/runtime/`
Expected: PASS, clean.

- [ ] **Step 7: Commit**

```bash
git add internal/runtime/lyzntasks.go internal/runtime/lyzntasks_test.go internal/runtime/looprun.go
git commit -m "runtime: the six-hour sweep also reclaims stale LYZN task sessions"
```

---

## Task 11: `internal/connectors/lyzn` learns the blocked outcome

**Repo:** KARMAX

**Files:**
- Modify: `internal/connectors/lyzn/work.go`
- Modify: `internal/connectors/lyzn/tools.go`
- Test: `internal/connectors/lyzn/lyzn_test.go`

**Interfaces:**
- Consumes: `POST /daemons/work/:taskId/question` (Task 2) — this task adds no backend code; the endpoint is already caller-agnostic, exactly as Task 2 built it.
- Produces: `question(ctx, cr, taskID string, body map[string]any) (map[string]any, error)`, mirroring `report`; `reportWork`'s new `blocked` branch.

**Why this task exists, verified rather than assumed.** `internal/connectors/lyzn` is a second, live, agent-callable path to claim and report on a LYZN task — registered in `internal/runtime/runtime.go:185` via `connHost.Register(lyznconn.New())`, entirely separate from the scheduled recipe this plan otherwise builds on. Its `lyzn.work.report` tool already lists `"blocked"` as a valid `outcome` in its JSON schema, and its own description already says to "use 'blocked' or 'failed' when [the promise] was not [kept]" — but `reportWork`'s actual body, read directly rather than assumed to mirror the recipe path, never branches on the outcome before building the request. It runs `said` through one switch that maps `"done"/"success"/"completed"` to `outcomeSuccess` and everything else — `"blocked"` included, alongside `"failed"`, `"failure"` and any unrecognised word — to `outcomeFailure`, then posts that straight to `report()`, which always calls `POST /daemons/work/:taskId/result`. `/result` is terminal: `TestOnlyDoneEverPrintsAKeptPromise` (`lyzn_test.go:307-333`) encodes exactly this today, asserting `"blocked": outcomeFailure` as current, intended behaviour. A task claimed and worked through this connector rather than the recipe reports a phantom failure the moment it needs to ask something, and closes for good with no way back in, because `/result` already closed it. That is worse than an honest error: nobody investigates a failure that looks explained, and four rounds of amendments on the spec this plan implements never looked at this connector at all — which is exactly how this class of bug survives.

- [ ] **Step 1: Write the failing tests**

In `internal/connectors/lyzn/lyzn_test.go`, `TestOnlyDoneEverPrintsAKeptPromise` currently asserts `"blocked": outcomeFailure` as one of five cases sharing a single handler that does not distinguish by path. Replace it with a version that no longer includes `"blocked"` and checks the path every case actually hit, and add its own test for the case removed:

```go
func TestOnlyDoneEverPrintsAKeptPromise(t *testing.T) {
	var sent map[string]any
	var path string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path = r.URL.Path
		_ = json.NewDecoder(r.Body).Decode(&sent)
		_, _ = w.Write([]byte(`{"receipt":{"receiptId":"r-1"}}`))
	}))
	defer srv.Close()
	cr := creds(srv.URL, nil)

	for said, want := range map[string]string{
		"done":      outcomeSuccess,
		"failed":    outcomeFailure,
		"partially": outcomeFailure,
		"":          outcomeFailure,
	} {
		if _, err := reportWork(context.Background(), cr, map[string]any{
			"task_id": "t-1", "outcome": said, "summary": "what happened",
		}); err != nil {
			t.Fatalf("%q: %v", said, err)
		}
		if sent["outcome"] != want {
			t.Fatalf("%q was reported as %v, wanted %s", said, sent["outcome"], want)
		}
		if !strings.HasSuffix(path, "/result") {
			t.Fatalf("%q posted to %s, want the /result endpoint", said, path)
		}
	}
}

// The bug this catches: "blocked" is not a verdict. Reporting it through the
// same call that closes a task prints a receipt for work that has not
// stopped — a phantom failure for a task that is actually waiting on a
// human, which nobody investigates because a failure looks explained.
func TestBlockedIsAQuestionNotAVerdict(t *testing.T) {
	var sent map[string]any
	var path string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path = r.URL.Path
		_ = json.NewDecoder(r.Body).Decode(&sent)
		_, _ = w.Write([]byte(`{"task":{"taskId":"t-1","status":"blocked"}}`))
	}))
	defer srv.Close()
	cr := creds(srv.URL, nil)

	out, err := reportWork(context.Background(), cr, map[string]any{
		"task_id": "t-1", "outcome": "blocked", "summary": "need the shared account's password",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasSuffix(path, "/question") {
		t.Fatalf("posted to %s, want /question — a blocked task must not reach /result", path)
	}
	if _, wroteOutcome := sent["outcome"]; wroteOutcome {
		t.Fatalf("a blocked report must not carry an outcome — it does not close the task: %v", sent)
	}
	if sent["text"] != "need the shared account's password" {
		t.Fatalf("text = %v, want the summary carried as the question", sent["text"])
	}
	result, ok := out.(map[string]any)
	if !ok || result["blocked"] != true {
		t.Fatalf("result = %+v, want blocked: true, so the model knows the task is not closed", out)
	}
}
```

Add `"strings"` to the file's imports if it is not already there.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd ~/Developer/code/KARMAX && go test ./internal/connectors/lyzn/ -run 'TestOnlyDoneEverPrintsAKeptPromise|TestBlockedIsAQuestionNotAVerdict' -v`
Expected: FAIL — `TestBlockedIsAQuestionNotAVerdict` fails because today `path` ends in `/result` and `sent["outcome"]` is `"failure"`, not the branch this test wants.

- [ ] **Step 3: Add `question`, mirroring `report`**

In `internal/connectors/lyzn/work.go`, after `report`:

```go
// question parks a claimed task on something only the operator can answer,
// instead of closing it. Unlike report, this is not terminal: LYZN keeps the
// task pinned to this machine, and lyzn.work.claim resumes it — the same
// call already used to take the task in the first place — once the question
// has an answer.
func question(ctx context.Context, cr connectorkit.Credentials, taskID string, body map[string]any) (map[string]any, error) {
	var out map[string]any
	err := send(ctx, cr, http.MethodPost,
		"/daemons/work/"+url.PathEscape(taskID)+"/question", body, &out)
	return out, err
}
```

- [ ] **Step 4: Branch `reportWork` on `blocked` before it ever reaches the success/failure switch**

In `internal/connectors/lyzn/tools.go`, in `reportWork`, insert the branch immediately after the existing `summary == ""` check and before the outcome switch, and drop `"blocked"` from the switch's own case list:

```go
	// "blocked" is not a verdict — it is neither a promise kept nor a
	// promise broken, it is a task still open, waiting on something only
	// the operator can give it. Routing it through the same call that
	// closes a task would print a receipt for work that has not stopped.
	if said == "blocked" {
		out, err := question(ctx, cr, id, map[string]any{"text": summary})
		if err != nil {
			return nil, err
		}
		out["blocked"] = true
		return out, nil
	}

	// LYZN's wire words are "success" and "failure"; the model's are the two
	// verdicts left once blocked is handled above. Anything unrecognised is
	// a failure rather than a guess: a receipt wrongly saying "done" is the
	// one mistake a terminal report must not make.
	outcome := outcomeFailure
	switch said {
	case "done", "success", "completed":
		outcome = outcomeSuccess
	case "failed", "failure", "":
		outcome = outcomeFailure
	default:
		outcome = outcomeFailure
		summary = "reported as " + said + ": " + summary
	}
```

- [ ] **Step 5: Make the tool descriptions honest about what `blocked` now does**

Still in `tools.go`, update `lyzn.work.report`'s description:

```go
Description: "Say what happened to a claimed task. 'done' closes it and prints a receipt the operator sees on their phone. " +
	"'blocked' does not close it: it parks the task and asks the operator the question in your summary, and lyzn.work.claim " +
	"resumes it once they answer — call lyzn.work.claim again with the same task_id rather than treating it as new work. " +
	"'failed' closes it as not done. Report honestly — a receipt for work nobody did, or a task shown as failed when it is " +
	"actually waiting on a person, is worse than no receipt at all.",
```

and `lyzn.work.claim`'s, appending one sentence before the final one:

```go
Description: "Take one approved task, so no other machine runs it too. " +
	"The claim is a fifteen-minute loan: finish and report inside it, or LYZN puts the task back for someone else. " +
	"Re-claiming a task this machine already holds is fine and is how a restarted run picks up where it stopped. " +
	"A task this connector reported blocked comes back through this same call once its question has been answered. " +
	"Returns the task and the conversation it came from.",
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd ~/Developer/code/KARMAX && go test ./internal/connectors/lyzn/ -run 'TestOnlyDoneEverPrintsAKeptPromise|TestBlockedIsAQuestionNotAVerdict' -v`
Expected: PASS, 2 tests.

- [ ] **Step 7: Run the whole suite**

Run: `cd ~/Developer/code/KARMAX && go build ./... && go test ./... && go vet ./... && gofmt -l internal/connectors/lyzn/`
Expected: PASS, clean. Read `TestTheWholeSequenceFromSixCharactersToAReceipt` (`roundtrip_test.go`) before trusting it is unaffected — it should exercise only the `"done"` path end to end, but the discipline this task itself was written under is checking rather than assuming that.

- [ ] **Step 8: Commit**

```bash
git add internal/connectors/lyzn/work.go internal/connectors/lyzn/tools.go internal/connectors/lyzn/lyzn_test.go
git commit -m "connectors/lyzn: a blocked task asks a question instead of reporting a phantom failure"
```

---

# Part D — the recipe (mr20-pendant, depends on Parts A and C)

## Task 12: `lyzn-tasks.yaml` — durable, and it asks

**Repo:** mr20-pendant

**Files:**
- Modify: `desktop/resources/loops/lyzn-tasks.yaml`

**Interfaces:**
- Consumes: `POST /daemons/work/:taskId/question` (Task 2), `GET /daemons/sessions/expired` (Task 3), `harness:`'s object form and `harness.forget` (Task 9) — all must be shipped and live before this task is deployed, since a YAML recipe carries no compile-time check against either repo.

This task is data, not code: there is no failing-test cycle for a YAML file with no test harness of its own. Steps are read-verify-edit-verify instead.

- [ ] **Step 1: Confirm the daemon API contract this recipe now depends on**

```bash
curl -s https://api.lyzn.ai/daemons/sessions/expired -H "Authorization: Bearer <token>"
```

Confirm this answers a bare JSON array (`[]` on an idle account, not `{"expiredSessions":[]}` or `null`). If the route 404s, Task 3 has not shipped yet — do not proceed with this task until it has.

- [ ] **Step 2: Give the harness step a session and a working directory**

Replace the existing `- harness: | ... as: reply` step with:

```yaml
              - harness:
                  text: |
                    The person wearing a LYZN pendant promised this out loud, and has now approved it
                    in the app for you to do. Here is the task, exactly as LYZN handed it over:

                    {{ .claimed }}

                    Do it now, for real — run the commands, make the change, write the message. You
                    are on the operator's own machine, with their shell, their files, their signed-in
                    accounts and the whole karmax CLI. Do not describe what you would do.

                    If you cannot finish because you need something only they can give you — a
                    password, an account, a decision that is theirs — stop and say so rather than
                    guessing.

                    End your reply with exactly these two lines and nothing after them:
                    STATUS: done|blocked|failed
                    SUMMARY: <one sentence saying what you actually did, or what you are waiting on>
                  # Deterministic in both fields, and derived from nothing but the task id: a
                  # resume days later has to call with the exact values used on the first turn.
                  session_id: "lyzn:{{ .id }}"
                  working_dir: "lyzn-tasks/{{ .id }}"
                  # Non-ephemeral from the first turn — whether this task will need to resume
                  # is not known until it answers, and an ephemeral run deletes its own
                  # transcript before that answer arrives.
                  ephemeral: "false"
                as: reply
```

- [ ] **Step 3: Branch on `STATUS: blocked`, and clean up on every other outcome**

This step relies on `postDaemonWorkQuestion` accepting a `text/plain` body the same way `/result`'s `resultFrom` already does (Task 2's `questionFrom` helper) — the recipe cannot parse a `SUMMARY:` line out of `{{ .reply }}` itself, so the question's text is read the same way a result's summary already is, on the backend side, before this step is written.

In `lyzn-tasks.yaml`, replace the `- when: "{{ .reply }}" http: ... /result ... else: [...]` step. The engine's only nesting primitive is a step's own `else:` list — there is no way to carry two `when:` fields on one step — so the three-way branch (blocked / normal result / empty reply) is written as an "else if" chain, the outer `when:` testing for `blocked` and its `else:` holding the original reply-driven step unchanged in shape:

```yaml
              - when: '{{ contains .reply "STATUS: blocked" }}'
                http:
                  method: POST
                  url: "https://api.lyzn.ai/daemons/work/{{ .id }}/question"
                  header.Authorization: "Bearer {{ .token }}"
                  header.Content-Type: text/plain
                  body: "{{ .reply }}"
                else:
                  - when: "{{ .reply }}"
                    http:
                      method: POST
                      url: "https://api.lyzn.ai/daemons/work/{{ .id }}/result"
                      header.Authorization: "Bearer {{ .token }}"
                      header.Content-Type: text/plain
                      body: "{{ .reply }}"
                    as: needsyou
                    else:
                      - http:
                          method: POST
                          url: "https://api.lyzn.ai/daemons/work/{{ .id }}/result"
                          header.Authorization: "Bearer {{ .token }}"
                          header.Content-Type: application/json
                          body: '{"outcome":"failure","summary":"the coding harness returned nothing"}'
                      - notify:
                          title: "LYZN task went nowhere"
                          body: >
                            The coding harness returned nothing for a task you
                            approved. KARMAX's log has the run.
                  # Reached whenever the task just closed for good — a
                  # printed result, or the empty-reply failure right above —
                  # and never for a blocked one, which took the outer branch
                  # and skips this entirely. Nothing should ever resume into
                  # this session again, so its disk goes now rather than
                  # waiting for the six-hour backstop to find it.
                  - harness.forget:
                      session_id: "lyzn:{{ .id }}"
                      working_dir: "lyzn-tasks/{{ .id }}"
```

An empty `.reply` can never contain the substring `"STATUS: blocked"`, so the outer `when` is false whenever the inner one would also need to be checked — there is no case where both conditions could disagree about whether `.reply` was empty. The final `- when: "{{ .needsyou }}" notify: ...` step later in the file is untouched: `needsyou` is bound only inside the /result sub-branch, so it renders `<no value>` (falsy) whenever the blocked branch was taken instead, and the "this needs you" notification for a blocked task comes from the push notification `notifyTaskQuestion` sends (Task 2), not from this recipe.

- [ ] **Step 4: Resume a blocked-and-answered task, and forget it once it closes for good**

The recipe's existing claim step already sends every id from `GET /daemons/work?format=ids` through `POST /daemons/work/{{ .id }}/claim` — Task 2 made that endpoint itself branch on whether the task is `approved` (claim) or `blocked`-and-answered (resume), and Task 2 made `GET /daemons/work?format=ids` include both kinds of id in the same array. So the claim step, the harness step, and the STATUS branch above need no separate "resume" path in the YAML at all: a resumed task's `{{ .claimed }}` is the same task, its `session_id`/`working_dir` are the same deterministic values, and `--resume` (not `--session-id`) is chosen automatically inside `ClaudeCodeTool.run` because `HarnessWith` is called with a non-empty `SessionID`. Confirm this by re-reading Task 2's `postDaemonWorkClaim` and Task 9's `case VerbHarness` before writing anything new here — there is nothing new to write.

- [ ] **Step 5: Reclaim disk for tasks that expired without an answer**

`k.HTTP` (and therefore this recipe's `http:` verb) returns a response body as a plain string — `{{ .claimed }}` is used as a whole JSON blob elsewhere in this file precisely because the template engine has no way to reach into a bound field of a JSON *object*. `GET /daemons/sessions/expired` sidesteps that by answering a bare JSON *array* instead (Task 3), which `foreach`'s `in:` already knows how to read directly (`foreachItems` parses a rendered string as a JSON array of scalars) — the same mechanism `{{ .ids }}` already relies on for the claim loop above.

After the work-poll step (`GET /daemons/work?format=ids`, bound `as: ids`), add a second read and its own foreach:

```yaml
        - when: "{{ .token }}"
          http:
            url: https://api.lyzn.ai/daemons/sessions/expired
            header.Authorization: "Bearer {{ .token }}"
          as: expired

        - when: "{{ .expired }}"
          foreach:
            as: expired_id
            in: "{{ .expired }}"
            steps:
              - harness.forget:
                  session_id: "lyzn:{{ .expired_id }}"
                  working_dir: "lyzn-tasks/{{ .expired_id }}"
```

`"[]"` renders falsy under this engine's `truthy()` (it is in `truthy`'s own literal list), so an idle account with nothing expired costs one HTTP call and no `foreach` iterations — the same shape the existing `{{ .ids }}` check already has.

- [ ] **Step 6: Update the recipe's own header comment**

The "WHAT IT STILL NEEDS" block at the top of the file lists the three daemon-API additions round eight needed. Add a fourth line naming this round's additions: `/daemons/work/:id/question`, `/daemons/work/:id/answer`, `GET /daemons/sessions/expired`, and the `harness:`/`harness.forget` recipe verbs — so the file continues to say honestly what it depends on.

- [ ] **Step 7: Commit**

```bash
git add desktop/resources/loops/lyzn-tasks.yaml
git commit -m "lyzn-tasks: durable sessions, a question when it needs one, and cleanup when it is over"
```

---

## Self-Review

**Spec coverage** (§3's numbered "what this plan must cover" list):

1. `blocked` state + `releaseAbandoned` untouched → Task 1 (state, transitions), verified in Task 1's own text that `releaseAbandoned`/`ExpiredWork` only ever read the `executing` GSI1 partition, so `blocked` (a different partition) is already outside their reach by construction — no code change was needed to make that true, only to confirm it.
2. The question record → Task 1 (`TaskQuestion`).
3. `/question` (daemon) + answer endpoint (app) → Task 2 (`/question`), Task 4 (`/tasks/:id/answer`). The daemon-side comms-answer relay (`/daemons/work/:taskId/answer`) is additional, in Task 3.
4. `task.question` push + mobile routing + answer affordance → Task 2 (push builder), Task 5 (routing, store), Task 6 (screen).
5. Recipe changes (park with `await:`, branch on `STATUS: blocked`, session id + workdir, non-ephemeral) → Task 12. The `await: event: comms.message` step is **not included** in Task 12 as written — see the gap below.
6. Plumbing — `loopKit.Harness`/`VerbHarness` carry session id, working dir, ephemeral flag; `mkdir -p` → Task 7 (`mkdir -p`, `Resolve`), Task 8 (`HarnessWith`/`HarnessForget` on `Kit`), Task 9 (the recipe verb).
7. Comms correlation, `reply_to_id` first, fallback, disambiguation → **deferred**, not built in this plan — see Self-Review's named gap below. Task 11 is now the `internal/connectors/lyzn` fix described there, unrelated to comms.
8. Cleanup wired to every terminal outcome + the six-hour backstop → Task 7 (`Cleanup`, the delete), Task 12 Step 3 (done/failed), Task 12 Step 5 (expiry), Task 3 (unpair/stale release on the backend side — the KARMAX-side disk for that case is reclaimed only by the backstop, see below), Task 10 (the backstop itself).
9. Escape hatches (expiry fails the task; unpaired/stale daemon releases pinned tasks) → Task 1 (`FailBlockedWork`, `QuestionExpired`), Task 3 (`releaseExpiredQuestions`, `releasePinnedTasks`, `releaseStaleQuestions`).

**Placeholder scan:** every task's code is complete and compiles against the types the earlier tasks in this plan define. The two places this plan deliberately does **not** hand over finished code are named explicitly, in-line, rather than glossed over — see the two entries directly below. (An earlier draft of Task 12 hedged on two mechanical details — whether the recipe engine has a JSON-encoding template helper, and how to read a nested field out of a bound HTTP response — instead of resolving them; both are now resolved directly: `postDaemonWorkQuestion` accepts `text/plain` exactly as `/result` already does, removing the need for JSON encoding inside a `when:`/`body:` template at all, and the expiry list is its own endpoint answering a bare JSON array, which is the one shape this template engine can already consume via `foreach`'s existing `in:` parsing — not a new capability.)

**Type consistency:** `ddb.TaskQuestion` (backend, Task 1) and `TaskQuestion` (mobile, Task 5) carry the same field set and names (`id`/`text`/`options`/`askedBy`/`askedAt`/`expiresAt`/`answer`/`answeredAt`/`answeredBy`), so the wire shape needs no translation layer. `loopkit.HarnessSpec`/`HarnessResult` (KARMAX, Task 8) are consumed with the identical field names in Task 9's recipe verb and nowhere else. `lyzn:<taskID>` / `lyzn-tasks/<taskID>` are the two literal, deterministic strings used consistently across Task 9 (the verb plumbing), Task 10 (the backstop's own reverse-derivation via `strings.TrimPrefix`), and Task 12 (the recipe's own templates) — nowhere are these derived a third, different way. Task 11's `{"text": summary}` body matches `questionFrom`'s JSON path in Task 2 exactly (it never uses the `text/plain` path Task 12 needs, since a connector calling Go can build JSON directly rather than working around a template language that cannot).

**Named gaps, not invented resolutions:**

- **`internal/connectors/lyzn`'s report path is fixed (Task 11); its session continuity is not.** KARMAX has a registered connector (`internal/connectors/lyzn`, wired in `internal/runtime/runtime.go:185` via `connHost.Register(lyznconn.New())`) exposing `lyzn.work.list`/`lyzn.work.claim`/`lyzn.work.report`/`lyzn.status` as agent-callable tools — a second, independent path to claim and report on a LYZN task, entirely separate from the scheduled recipe the spec's four amendments investigated. Task 11 stops it from reporting a phantom failure on `blocked` by routing that outcome to `/question` instead of `/result`, so both paths now report honestly, and `lyzn.work.claim` resumes an answered one for free (the backend's `/claim` resume branch, Task 2, is caller-agnostic). What Task 11 does **not** give this path is the recipe path's other half: a deterministic, per-task Claude Code session (`HarnessWith`, Tasks 8–9). An agent-driven claim runs inside whatever conversation the operator was already having, so "resuming" a blocked task through this connector re-claims the LYZN row correctly but does not, by itself, hand the model back its own prior context the way `--resume` on a durable session does. Building that is unscoped follow-up work this task does not attempt, because the spec never examined this connector and doing so would mean inventing a second session-continuity mechanism the spec does not describe.
- **Comms correlation (`reply_to_id`, fallback, disambiguation) is deferred to its own spec, not built here.** Building the correlation machinery — the open-question store, the resolver, the bus subscriber — before anything populates the open-question table, and before an answer relay has a credential to reach the daemon's bearer token with, would produce exactly the dead code this codebase already has an example of: Slack's interactive Approve/Reject implementation and the `EventApprovalDecision` it publishes are fully written and completely unreachable today — nothing calls `PostApproval`, nothing subscribes to it. That is what half a feature looks like a year later. The three holes this plan's research surfaced — which channel a question goes to, what triggers delivery, and how a bus subscriber (with no LYZN credential of its own) gets a resolved answer to the daemon's bearer token — are real design questions belonging to a comms-follow-up spec of their own, not to this plan.
- **`await: event: comms.message` is not implemented as its own recipe step.** Comms correlation being deferred in its entirety (above) is exactly why: a `await:` step parked on `comms.message` inside `lyzn-tasks.yaml` would wake on every unrelated comms message and have nothing reliable to do when it did, with no open-question table to check and no credential to answer with even if it could resolve one. Task 12 instead relies entirely on the ordinary two-minute poll cycle (via `/claim`'s resume branch and `GET /daemons/work`'s resumable ids, both built in Task 2) as the guaranteed resumption path, and does not add the `await:` step the spec's decision names. This is the one piece of "what this plan must cover" item 5 not built as literally specified — the alternative, an `await:` step with no correlated event to wake it meaningfully, would have been decoration, not the real thing — and it is deliberately left as the starting point for the comms-follow-up spec above, not a stand-in for it.
- **`eject.go`'s code generator does not gain cases for `harness:`'s object form or `harness.forget`.** Consistent with the file's own existing state — many verbs already lack an `emitStep` case — so this is not a new gap, but it means a recipe using either new capability, if ejected to a Workflow, would silently drop that step exactly as several existing verbs already do. Not fixed here; flagged so it is not mistaken for new breakage introduced by this plan.
