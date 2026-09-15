# Sending tasks to the LYZN desktop daemon — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a person — and then the assistant — put a task on their paired laptop without having said it out loud to a pendant first.

**Architecture:** A task reaches a daemon purely by holding `status=approved`, which is the partition `GET /daemons/work` polls. So the whole feature is a new *origin* for task rows: one `POST /tasks` route and one `mintTask` function both callers share, plus the two surfaces that call it. Part A (Tasks 1–3) is working software on its own. Part B (Tasks 4–8) teaches karma's Bedrock path to carry tool calls so the assistant can reach the same function.

**Tech Stack:** Go 1.x + Fiber + DynamoDB (backend), Go + AWS SDK v2 `bedrockruntime` (karma), Expo/React Native + zustand + NativeWind (mobile), `node --test` over compiled TS (mobile tests).

**Spec:** `docs/superpowers/specs/2026-09-11-daemon-tasks-design.md`

## Global Constraints

- Task ids for a task with no recording: `own_` + 32 hex characters, **no hyphens after the prefix** — extracted ids are `<recordingID>-<index>` and a client splitting on the last hyphen must not be misled.
- `text` is trimmed and truncated to **400** characters, via the existing `truncate` helper (`internal/api/recordings.go:520`).
- `kind` goes through `types.CoerceTaskKind`, defaulting to `other`.
- Creating an **approved** task runs `automationGate` first — the same **402** and the same sentence `/approve` answers.
- The daemon half is **unchanged**: no new daemon route, no new field on `workItem`, no KARMAX change.
- The store is reached through the package's `ddb*` function variables (`internal/api/daemons.go:58`), never `ddb.X` directly, so every route stays testable with no AWS account.
- Mobile: no colour is ever named in a component; tone classes only.
- karma version floor moves from **v1.25.1** once Part B is released.

---

# Part A — a task you can write

## Task 1: `POST /tasks` and the one place a task is born

**Files:**
- Modify: `backend/go/internal/api/daemons.go:58-82` (add `ddbPutTask` to the var block)
- Modify: `backend/go/internal/api/tasks.go` (header comment, `registerTaskRoutes`, new `newTask`/`ownTaskID`/`mintTask`/`createTask`)
- Test: `backend/go/internal/api/tasks_test.go`

**Interfaces:**
- Consumes: `truncate(s string, n int) string`; `automationGate(ctx, userID) error`; `ddb.PutTask(ctx, ddb.Task) error`; `types.CoerceTaskKind(any) types.TaskKind`; test helpers `stub`, `appRoutes`, `do`, `automation`, `testUser` (all in `daemons_test.go`, same package).
- Produces: `mintTask(ctx context.Context, userID string, input newTask) (ddb.Task, error)` and the `newTask` struct — Task 7's chat tool calls `mintTask` directly.

- [ ] **Step 1: Write the failing tests**

In `backend/go/internal/api/tasks_test.go`, append:

```go
func TestCreatedTaskIdCannotBeMistakenForAConversationsOwn(t *testing.T) {
	// Extracted ids are "<recordingId>-<index>". A client that splits one on
	// its last hyphen must not be handed a UUID full of them.
	id := ownTaskID()
	if !strings.HasPrefix(id, "own_") {
		t.Fatalf("id = %q, want an own_ prefix", id)
	}
	if strings.Contains(strings.TrimPrefix(id, "own_"), "-") {
		t.Fatalf("id = %q, want no hyphens after the prefix", id)
	}
	if ownTaskID() == id {
		t.Fatal("two tasks minted the same id")
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
	// This status is the whole delivery mechanism: it is what moves the row
	// into TASKSTATUS#<sub>#approved, which is what GET /daemons/work reads.
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
```

Add to that file's imports: `context`, `net/http`, `strings`, `github.com/gofiber/fiber/v2`, and `github.com/MelloB1989/mr20-pendant/backend/internal/types`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend/go && go test ./internal/api/ -run 'TestCreatedTaskId|TestWritingA|TestAnApprovedTask' -v`
Expected: FAIL — `undefined: ownTaskID`, `undefined: createTask`, `undefined: ddbPutTask`.

- [ ] **Step 3: Add the store variable**

In `internal/api/daemons.go`, in the `var (…)` block, beside `ddbGetTask`:

```go
	ddbPutTask           = ddb.PutTask
```

- [ ] **Step 4: Write the route and the minting**

In `internal/api/tasks.go`, register it:

```go
	app.Post("/tasks", createTask)
```

and add, after `loadTask`:

```go
// newTask is a task somebody asked for directly — typed in the app, or filed
// by the assistant's tool. Every field but the text is optional.
type newTask struct {
	Text  string `json:"text"`
	Kind  string `json:"kind"`
	DueAt string `json:"dueAt"`
	// Approved skips the proposed state and queues the task for a daemon. It
	// is the only field here that costs anything, and the only one gated.
	Approved bool `json:"approved"`
}

// ownTaskID is the id for a task no conversation produced.
//
// An extracted task is "<recordingId>-<index>", and something that splits one
// on its last hyphen is a reasonable thing to have written. A UUID carries
// four hyphens of its own, so it goes in without them: "own_" and 32 hex
// characters cannot be read as either half of that shape.
func ownTaskID() string {
	return "own_" + strings.ReplaceAll(uuid.NewString(), "-", "")
}

// mintTask writes a task that was asked for rather than overheard.
//
// Shared by POST /tasks and the assistant's send_task_to_laptop tool, because
// "a task is born" should happen in one place: the id scheme, the truncation
// and the empty quote are the same fact whoever is asking.
func mintTask(ctx context.Context, userID string, input newTask) (ddb.Task, error) {
	status := ddb.TaskProposed
	if input.Approved {
		status = ddb.TaskApproved
	}
	now := time.Now().UTC().Format(time.RFC3339)
	task := ddb.Task{
		TaskID: ownTaskID(),
		UserID: userID,
		Text:   truncate(strings.TrimSpace(input.Text), 400),
		Kind:   types.CoerceTaskKind(input.Kind),
		Status: status,
		DueAt:  input.DueAt,
		// No RecordingID and no Quote: nobody said this, they asked for it.
		// Both are omitempty on the row and always-present on the daemon's
		// wire format, so the work item still decodes everywhere.
		CreatedAt: now,
		UpdatedAt: now,
	}
	if err := ddbPutTask(ctx, task); err != nil {
		return ddb.Task{}, err
	}
	return task, nil
}

func createTask(c *fiber.Ctx) error {
	user := authjwt.Sub(c)

	var input newTask
	if err := c.BodyParser(&input); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "request body must be JSON")
	}
	if strings.TrimSpace(input.Text) == "" {
		return fiber.NewError(fiber.StatusBadRequest, "a task needs text")
	}
	if input.DueAt != "" {
		if _, err := time.Parse(time.RFC3339, input.DueAt); err != nil {
			return fiber.NewError(fiber.StatusBadRequest, "dueAt must be an RFC3339 timestamp")
		}
	}
	// The gate is before the write, not after it: a task that cannot be
	// carried out must not exist in the queue for even one poll.
	if input.Approved {
		if err := automationGate(c.Context(), user); err != nil {
			return err
		}
	}

	task, err := mintTask(c.Context(), user, input)
	if err != nil {
		return err
	}
	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"task": task})
}
```

Add `"context"` and the `types` import to the file if absent. Update the header comment's route list with `POST /tasks   a task nobody said out loud`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend/go && go test ./internal/api/ -run 'TestCreatedTaskId|TestWritingA|TestAnApprovedTask' -v`
Expected: PASS, 4 tests.

- [ ] **Step 6: Run the whole backend suite**

Run: `cd backend/go && go build ./... && go test ./...`
Expected: PASS, nothing else disturbed.

- [ ] **Step 7: Commit**

```bash
git add backend/go/internal/api/tasks.go backend/go/internal/api/tasks_test.go backend/go/internal/api/daemons.go
git commit -m "tasks: a task nobody said out loud"
```

---

## Task 2: the app can ask for one

**Files:**
- Modify: `mobile/src/api/tasks.ts` (add `create` to `tasksApi`)
- Modify: `mobile/src/state/tasks.ts` (add `sendToLaptop` to the store)
- Test: `mobile/tests/state/tasks.test.ts` (new)

**Interfaces:**
- Consumes: `mintTask`'s wire shape from Task 1 — `POST /tasks` → `201 {task}`.
- Produces: `tasksApi.create(input) => Promise<{task: Task}>`; store action `sendToLaptop(text: string) => Promise<{ok: boolean; paymentRequired: boolean}>`; exported pure helper `withNewTask(existing: Task[], task: Task): Task[]`.

- [ ] **Step 1: Write the failing test**

Create `mobile/tests/state/tasks.test.ts`:

```ts
/**
 * The one pure part of sending a task: where the new row lands in the list
 * the segment is already drawing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withNewTask } from '../../src/state/newTask';
import type { Task } from '../../src/api/tasks';

const task = (id: string, createdAt: string): Task => ({
  taskId: id, text: id, kind: 'other', status: 'approved', createdAt,
} as Task);

test('a task just sent is the newest thing in the list', () => {
  const list = [task('b', '2026-09-10T09:00:00Z'), task('a', '2026-09-09T09:00:00Z')];
  const next = withNewTask(list, task('c', '2026-09-11T09:00:00Z'));
  assert.deepEqual(next.map((t) => t.taskId), ['c', 'b', 'a']);
});

test('the same task twice is one row', () => {
  const list = [task('c', '2026-09-11T09:00:00Z')];
  const next = withNewTask(list, { ...task('c', '2026-09-11T09:00:00Z'), text: 'edited' });
  assert.equal(next.length, 1);
  assert.equal(next[0].text, 'edited');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd mobile && npm test`
Expected: FAIL — cannot find module `src/state/newTask`.

- [ ] **Step 3: Write the pure helper**

Create `mobile/src/state/newTask.ts`:

```ts
/**
 * Where a task the person just sent goes in the list.
 *
 * Its own file, and importing nothing, because the store imports Expo and the
 * network and therefore cannot be reached by `node --test` — and this is the
 * part with a rule in it.
 */
import type { Task } from '../api/tasks';

/** Newest first, one row per id — the order the segment already draws. */
export function withNewTask(existing: Task[], task: Task): Task[] {
  const byId = new Map(existing.map((t) => [t.taskId, t]));
  byId.set(task.taskId, task);
  return [...byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
```

- [ ] **Step 4: Add the client call**

In `mobile/src/api/tasks.ts`, on `tasksApi`:

```ts
  /**
   * A task nobody said out loud. `approved` queues it for the paired laptop
   * and answers 402 unless the plan carries automation; without it the task
   * is a note to self.
   */
  create: (input: { text: string; kind?: TaskKind; dueAt?: string; approved?: boolean }) =>
    request<{ task: Task }>('POST', '/tasks', input),
```

- [ ] **Step 5: Add the store action**

In `mobile/src/state/tasks.ts`, declare on the interface:

```ts
  /** Write a task and hand it straight to the laptop. */
  sendToLaptop: (text: string) => Promise<{ ok: boolean; paymentRequired: boolean }>;
```

and implement it beside `approve`:

```ts
  sendToLaptop: async (text) => {
    try {
      const { task } = await tasksApi.create({ text, approved: true });
      set((s) => ({ tasks: withNewTask(s.tasks, task) }));
      return { ok: true, paymentRequired: false };
    } catch (err) {
      // A 402 is the price, not a failure — the same answer `approve` gives.
      return { ok: false, paymentRequired: isPaymentRequired(err) };
    }
  },
```

Import `withNewTask` from `./newTask` and `isPaymentRequired` from `../api/tasks` if not already imported.

- [ ] **Step 6: Run tests and the type-check**

Run: `cd mobile && npm test && npx tsc --noEmit -p tsconfig.json`
Expected: PASS, two new tests; no type errors.

- [ ] **Step 7: Commit**

```bash
git add mobile/src/api/tasks.ts mobile/src/state/tasks.ts mobile/src/state/newTask.ts mobile/tests/state/tasks.test.ts
git commit -m "tasks: the app can ask for a task of its own"
```

---

## Task 3: the compose sheet in the tasks segment

**Files:**
- Modify: `mobile/src/tasks/models.ts` (add `composeState`)
- Modify: `mobile/src/design/copy.ts` (`TASKS_COPY` additions)
- Modify: `mobile/src/home/TasksSegment.tsx` (the affordance and the sheet)
- Test: `mobile/tests/design/tasks-compose.test.ts` (new)

**Interfaces:**
- Consumes: `sendToLaptop` and `withNewTask` from Task 2.
- Produces: `composeState(features: {execution: boolean}, plan?: {automation?: boolean}): 'send' | 'unlock' | 'hidden'`.

- [ ] **Step 1: Write the failing test**

Create `mobile/tests/design/tasks-compose.test.ts`:

```ts
/**
 * Who is offered a task to write, and what the offer does.
 *
 * The same three-way answer the segment's upsell strip already computes, said
 * once so the button and the strip cannot disagree.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeState } from '../../src/tasks/models';

test('no execution feature, nothing to offer', () => {
  assert.equal(composeState({ execution: false }, { automation: true }), 'hidden');
  assert.equal(composeState({ execution: false }, undefined), 'hidden');
});

test('the feature is on and the plan carries it: send', () => {
  assert.equal(composeState({ execution: true }, { automation: true }), 'send');
});

test('the feature is on and the plan does not: the chooser, not a 402', () => {
  assert.equal(composeState({ execution: true }, { automation: false }), 'unlock');
  assert.equal(composeState({ execution: true }, undefined), 'unlock');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd mobile && npm test`
Expected: FAIL — `composeState` is not exported.

- [ ] **Step 3: Write `composeState`**

In `mobile/src/tasks/models.ts`:

```ts
/** What the segment's "write one" affordance does, if it is drawn at all. */
export type ComposeState = 'send' | 'unlock' | 'hidden';

/**
 * Whether a person may write a task for their laptop.
 *
 * The same rule the segment's upsell strip is drawn from: with the deployment
 * flag down there is nothing to sell and nothing to send, so the affordance is
 * absent rather than disabled; with the flag up and no automation on the plan,
 * the answer to a tap is the chooser and never a 402 the person has to read.
 */
export function composeState(
  features: { execution: boolean },
  plan?: { automation?: boolean },
): ComposeState {
  if (!features.execution) return 'hidden';
  return plan?.automation ? 'send' : 'unlock';
}
```

- [ ] **Step 4: Add the copy**

In `mobile/src/design/copy.ts`, inside `TASKS_COPY`:

```ts
  /** The affordance that opens the compose sheet. */
  writeOne: 'WRITE ONE FOR THE LAPTOP',
  composeTitle: 'What should it do?',
  composePlaceholder: 'pull main and run the tests',
  composeSend: 'SEND TO LAPTOP',
  /** Sent, and a machine is awake to take it. */
  composeSent: 'Sent. Your laptop takes it on its next check.',
  /** Sent, with nothing paired — the task waits, which is correct. */
  composeSentNoMachine: 'Filed. Nothing is paired to do it yet.',
  composeFailed: 'That did not send.',
```

- [ ] **Step 5: Wire the segment**

In `mobile/src/home/TasksSegment.tsx`:

```tsx
  const daemons = useDaemons();                       // already used by Home
  const sendToLaptop = useTasks((s) => s.sendToLaptop);
  const [compose, setCompose] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const offer = composeState(features, plan);

  const onSend = useCallback(async () => {
    if (!draft.trim() || sending) return;
    setSending(true);
    const outcome = await sendToLaptop(draft.trim());
    setSending(false);
    if (outcome.paymentRequired) { setCompose(false); setUnlock(true); return; }
    if (!outcome.ok) { toast.show(TASKS_COPY.composeFailed, { tone: 'error' }); return; }
    setCompose(false);
    setDraft('');
    toast.show(daemons.length ? TASKS_COPY.composeSent : TASKS_COPY.composeSentNoMachine);
  }, [draft, sending, sendToLaptop, daemons.length, toast]);
```

Draw the affordance under the open list — and inside the empty state, which is where somebody with no tasks will look:

```tsx
      {offer !== 'hidden' ? (
        <Button
          full
          variant="secondary"
          title={TASKS_COPY.writeOne}
          onPress={() => (offer === 'send' ? setCompose(true) : setUnlock(true))}
        />
      ) : null}
```

and the sheet itself, using the kit's `Sheet`:

```tsx
      <Sheet open={compose} onClose={() => setCompose(false)} title={TASKS_COPY.composeTitle}>
        <Field
          value={draft}
          onChangeText={setDraft}
          placeholder={TASKS_COPY.composePlaceholder}
          multiline
          accessibilityLabel="what the laptop should do"
        />
        <Button
          full
          title={TASKS_COPY.composeSend}
          busy={sending}
          busyLabel="SENDING…"
          disabled={draft.trim().length === 0}
          onPress={onSend}
          className="mt-[12px]"
        />
      </Sheet>
```

Import `Field` and `Sheet` from `../design/kit`, `composeState` from `../tasks/models`, and `useDaemons` from `../daemon/useDaemons`.

- [ ] **Step 6: Run tests and the type-check**

Run: `cd mobile && npm test && npx tsc --noEmit -p tsconfig.json`
Expected: PASS; no type errors.

- [ ] **Step 7: Commit**

```bash
git add mobile/src/tasks/models.ts mobile/src/design/copy.ts mobile/src/home/TasksSegment.tsx mobile/tests/design/tasks-compose.test.ts
git commit -m "tasks: write one for the laptop"
```

---

# Part B — the assistant can file one

## Task 4: karma carries a tool spec to Bedrock

**Files:**
- Modify: `~/Developer/code/karma/apis/aws/bedrock/converse.go`
- Test: `~/Developer/code/karma/apis/aws/bedrock/converse_tools_test.go` (new)

**Interfaces:**
- Produces: `bedrock.ToolSpec{Name, Description string; InputSchema map[string]any}`, `ConverseParams.Tools []ToolSpec`, `ConverseParams.ToolChoice string`, `bedrock.ToolUse{ID, Name string; Input json.RawMessage}`, `ConverseResult.ToolUses []ToolUse`.

- [ ] **Step 1: Write the failing test**

```go
package bedrock

import "testing"

func TestToolsBecomeAToolConfig(t *testing.T) {
	in, err := buildConverseInput(ConverseParams{
		ModelID: "anthropic.claude-haiku",
		Tools: []ToolSpec{{
			Name:        "send_task_to_laptop",
			Description: "File a task for the paired laptop",
			InputSchema: map[string]any{
				"type":       "object",
				"properties": map[string]any{"text": map[string]any{"type": "string"}},
				"required":   []string{"text"},
			},
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if in.ToolConfig == nil || len(in.ToolConfig.Tools) != 1 {
		t.Fatal("the tool did not reach the request")
	}
}

func TestNoToolsMeansNoToolConfig(t *testing.T) {
	// Every existing caller must build the request it built yesterday.
	in, err := buildConverseInput(ConverseParams{ModelID: "anthropic.claude-haiku"})
	if err != nil {
		t.Fatal(err)
	}
	if in.ToolConfig != nil {
		t.Fatal("a caller with no tools must send no ToolConfig")
	}
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd ~/Developer/code/karma && go test ./apis/aws/bedrock/ -run TestTool -v`
Expected: FAIL — `unknown field Tools`, `in.ToolConfig undefined`.

- [ ] **Step 3: Implement**

Add to `ConverseParams`:

```go
	// Tools the model may call. Empty means no ToolConfig is sent at all,
	// so a caller that has never heard of tools builds the same request it
	// always did.
	Tools      []ToolSpec
	ToolChoice string // "", "auto", "any", or a tool name
```

and the types plus the build step:

```go
// ToolSpec is one tool as Bedrock's Converse API wants it. InputSchema is a
// JSON Schema object. No handler lives here: this package is transport, and
// running somebody's Go function is not transport.
type ToolSpec struct {
	Name        string
	Description string
	InputSchema map[string]any
}

// ToolUse is the model asking for one. Input is the arguments as raw JSON —
// in a stream it arrives in fragments, and only the assembled whole parses.
type ToolUse struct {
	ID    string
	Name  string
	Input json.RawMessage
}
```

In `buildConverseInput`, after the inference config:

```go
	if len(params.Tools) > 0 {
		tools := make([]types.Tool, 0, len(params.Tools))
		for _, spec := range params.Tools {
			tools = append(tools, &types.ToolMemberToolSpec{Value: types.ToolSpecification{
				Name:        aws.String(spec.Name),
				Description: aws.String(spec.Description),
				InputSchema: &types.ToolInputSchemaMemberJson{
					Value: document.NewLazyDocument(spec.InputSchema),
				},
			}})
		}
		input.ToolConfig = &types.ToolConfiguration{Tools: tools}
	}
```

Add `ToolUses []ToolUse` to `ConverseResult`, and in `Converse` collect them from the output message's content blocks (`*types.ContentBlockMemberToolUse`).

- [ ] **Step 4: Run it to verify it passes**

Run: `cd ~/Developer/code/karma && go test ./apis/aws/bedrock/ -run TestTool -v`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
cd ~/Developer/code/karma
git add apis/aws/bedrock/converse.go apis/aws/bedrock/converse_tools_test.go
git commit -m "bedrock: converse can carry a tool config"
```

## Task 5: the stream reassembles a tool call

**Files:**
- Modify: `~/Developer/code/karma/apis/aws/bedrock/converse.go` (`ConverseStream`)
- Test: `~/Developer/code/karma/apis/aws/bedrock/converse_tools_test.go`

**Interfaces:**
- Consumes: `ToolUse` from Task 4.
- Produces: an unexported `toolUseAccumulator` with `start(index int, id, name string)`, `delta(index int, partial string)`, and `done() []ToolUse` — the piece the stream loop drives and the test exercises without AWS.

- [ ] **Step 1: Write the failing test**

```go
func TestPartialJSONAcrossDeltasReassembles(t *testing.T) {
	// Bedrock sends a tool call's arguments in fragments. Only the whole
	// parses, so anything that tries each fragment sees nothing but errors.
	var acc toolUseAccumulator
	acc.start(0, "tu_1", "send_task_to_laptop")
	acc.delta(0, `{"te`)
	acc.delta(0, `xt":"pull ma`)
	acc.delta(0, `in"}`)

	uses := acc.done()
	if len(uses) != 1 {
		t.Fatalf("got %d tool uses, want 1", len(uses))
	}
	var args struct{ Text string }
	if err := json.Unmarshal(uses[0].Input, &args); err != nil {
		t.Fatalf("input did not parse: %v", err)
	}
	if args.Text != "pull main" {
		t.Fatalf("text = %q", args.Text)
	}
	if uses[0].ID != "tu_1" || uses[0].Name != "send_task_to_laptop" {
		t.Fatalf("id/name = %q/%q", uses[0].ID, uses[0].Name)
	}
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd ~/Developer/code/karma && go test ./apis/aws/bedrock/ -run TestPartialJSON -v`
Expected: FAIL — `undefined: toolUseAccumulator`.

- [ ] **Step 3: Implement the accumulator and drive it from the stream**

```go
// toolUseAccumulator collects a streamed tool call. Bedrock announces the
// block (id, name), then sends its arguments as partial JSON across any
// number of deltas, then closes it. Nothing but the concatenation parses.
type toolUseAccumulator struct {
	order []int
	byIdx map[int]*ToolUse
	args  map[int]*strings.Builder
}

func (a *toolUseAccumulator) start(index int, id, name string) {
	if a.byIdx == nil {
		a.byIdx, a.args = map[int]*ToolUse{}, map[int]*strings.Builder{}
	}
	a.order = append(a.order, index)
	a.byIdx[index] = &ToolUse{ID: id, Name: name}
	a.args[index] = &strings.Builder{}
}

func (a *toolUseAccumulator) delta(index int, partial string) {
	if b, ok := a.args[index]; ok {
		b.WriteString(partial)
	}
}

// done returns the calls in the order the model opened them. A block whose
// arguments never arrived becomes "{}" rather than invalid JSON: a tool with
// no arguments is a thing, and a parse error here would be read as the
// model's fault.
func (a *toolUseAccumulator) done() []ToolUse {
	uses := make([]ToolUse, 0, len(a.order))
	for _, index := range a.order {
		use := a.byIdx[index]
		raw := a.args[index].String()
		if strings.TrimSpace(raw) == "" {
			raw = "{}"
		}
		use.Input = json.RawMessage(raw)
		uses = append(uses, *use)
	}
	return uses
}
```

In `ConverseStream`'s event loop, handle `*types.ConverseStreamOutputMemberContentBlockStart` (when its `Start` is a `ContentBlockStartMemberToolUse`, call `start`), and `…MemberContentBlockDelta` (when its `Delta` is a `ContentBlockDeltaMemberToolUse`, call `delta` with the partial input). Text deltas keep calling `onText` exactly as they do now. Set `result.ToolUses = acc.done()` before returning.

- [ ] **Step 4: Run it to verify it passes**

Run: `cd ~/Developer/code/karma && go test ./apis/aws/bedrock/ -v`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add apis/aws/bedrock/converse.go apis/aws/bedrock/converse_tools_test.go
git commit -m "bedrock: a streamed tool call is only a tool call once it is whole"
```

## Task 6: the pass loop, so a Go function is reachable on Bedrock

**Files:**
- Modify: `~/Developer/code/karma/ai/handlers.go` (`handleBedrockStreamCompletion`)
- Test: `~/Developer/code/karma/ai/bedrock_tools_test.go` (new)

**Interfaces:**
- Consumes: `bedrock.ToolSpec`, `bedrock.ToolUse` from Tasks 4–5; `kai.GoFunctionTools`, `kai.ToolsEnabled`, `kai.MaxToolPasses` (all existing).
- Produces: `bedrockToolSpecs(kai *KarmaAI) []bedrock.ToolSpec`; `runBedrockTool(ctx, kai, use bedrock.ToolUse) string` — the handler-dispatch step, separated so it is testable without a model; and `converseOnce`, a package-level function variable wrapping `bedrock.ConverseStream` so the pass loop can be driven by a fake.

- [ ] **Step 1: Write the failing test**

```go
func TestAnUnregisteredToolIsAnAnswerNotAFailure(t *testing.T) {
	kai := NewKarmaAI(BaseModel("x"), Bedrock, WithToolsEnabled())
	out := runBedrockTool(context.Background(), kai, bedrock.ToolUse{Name: "nope", Input: []byte("{}")})
	if out == "" {
		t.Fatal("the model must be told the tool does not exist, not left waiting")
	}
}

func TestAToolThatFailsReportsItsReason(t *testing.T) {
	kai := NewKarmaAI(BaseModel("x"), Bedrock, WithToolsEnabled())
	_ = kai.AddGoFunctionTool(NewGoFunctionTool("boom", "", NewFuncParams(),
		func(context.Context, FuncParams) (string, error) { return "", errors.New("no daemon") }))

	out := runBedrockTool(context.Background(), kai, bedrock.ToolUse{Name: "boom", Input: []byte("{}")})
	if !strings.Contains(out, "no daemon") {
		t.Fatalf("result = %q, want the reason in it", out)
	}
}

func TestTheLoopStopsAtMaxToolPasses(t *testing.T) {
	// A model that keeps asking must not be answered for ever: the pass
	// budget is what keeps one conversation from becoming an unbounded
	// number of Bedrock calls.
	calls := 0
	kai := NewKarmaAI(BaseModel("x"), Bedrock, WithToolsEnabled(), WithMaxToolPasses(2))
	_ = kai.AddGoFunctionTool(NewGoFunctionTool("again", "", NewFuncParams(),
		func(context.Context, FuncParams) (string, error) { calls++; return "{}", nil }))

	// converseOnce is the seam the loop calls; a fake that always asks for the
	// tool again is the only way to exercise the budget without a model.
	restore := stubConverse(func() (*bedrock.ConverseResult, error) {
		return &bedrock.ConverseResult{
			StopReason: "tool_use",
			ToolUses:   []bedrock.ToolUse{{ID: "tu", Name: "again", Input: []byte("{}")}},
		}, nil
	})
	defer restore()

	_, err := kai.handleBedrockStreamCompletion(
		models.AIChatHistory{}, func(models.StreamedResponse) error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	if calls != 2 {
		t.Fatalf("the tool ran %d times, want 2 — the pass budget", calls)
	}
}

func TestSpecsAreOnlyBuiltWhenToolsAreEnabled(t *testing.T) {
	kai := NewKarmaAI(BaseModel("x"), Bedrock)
	_ = kai.AddGoFunctionTool(NewGoFunctionTool("t", "", NewFuncParams(),
		func(context.Context, FuncParams) (string, error) { return "", nil }))
	if len(bedrockToolSpecs(kai)) != 0 {
		t.Fatal("a build that did not enable tools must send none")
	}
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd ~/Developer/code/karma && go test ./ai/ -run 'TestAnUnregistered|TestAToolThatFails|TestSpecsAre' -v`
Expected: FAIL — `undefined: runBedrockTool`, `undefined: bedrockToolSpecs`.

- [ ] **Step 3: Implement**

`bedrockToolSpecs` maps `kai.GoFunctionTools` → `[]bedrock.ToolSpec` (returning nil unless `kai.ToolsEnabled`), reading each tool's `Parameters` as its JSON Schema — the same translation `configureClaudeClientForMCP` does for Claude. `runBedrockTool` finds the tool by name, unmarshals `use.Input` into a `FuncParams`, calls the handler, and returns either its string or a sentence naming the failure; an unknown name returns a sentence saying so.

Then, in `handleBedrockStreamCompletion`, wrap the existing single call in the loop: pass the specs in `ConverseParams`, and while `result.StopReason == "tool_use"` and passes remain under `kai.MaxToolPasses`, append the assistant turn and a user turn carrying each `toolResult`, then converse again. `onText` keeps streaming throughout.

- [ ] **Step 4: Run the karma suite**

Run: `cd ~/Developer/code/karma && go build ./... && go test ./ai/ ./apis/aws/bedrock/`
Expected: PASS.

- [ ] **Step 5: Commit and tag**

```bash
git add ai/handlers.go ai/bedrock_tools_test.go
git commit -m "ai: a Go function tool is reachable on Bedrock"
git tag v1.26.0 && git push origin main --tags
```

## Task 7: the tool

**Files:**
- Modify: `backend/go/go.mod` (karma to v1.26.0)
- Modify: `backend/go/internal/api/chat.go` (`wrapperWith`: the tool, `WithToolsEnabled`, `WithMaxToolPasses`)
- Create: `backend/go/internal/api/chattools.go` (the tool and its handler)
- Test: `backend/go/internal/api/chattools_test.go` (new)

**Interfaces:**
- Consumes: `mintTask` and `newTask` (Task 1); `automationState(ctx, userID) (bool, string, error)`; `ddbListDaemons`; `daemonOnline(d ddb.Daemon, now time.Time) bool` (`daemons.go:271`); the `toolEmit` sink via `emitWrapEvent` (`chat.go:87`).
- Produces: `sendTaskTool(userID string) ai.GoFunctionTool`.

- [ ] **Step 1: Write the failing test**

```go
func TestTheToolTellsTheModelWhenThePlanDoesNotCarryIt(t *testing.T) {
	automation(t, false)
	stub(t, &ddbPutTask, func(context.Context, ddb.Task) error {
		t.Error("a task was queued for an account that has not paid for one")
		return nil
	})
	out, err := sendTaskTool(testUser).Handler(context.Background(),
		map[string]any{"text": "run the tests"})
	if err != nil {
		t.Fatalf("the model must be answered, not errored at: %v", err)
	}
	if !strings.Contains(out, "plan") {
		t.Fatalf("result = %q, want the reason in it", out)
	}
}

func TestTheToolQueuesTheTaskAndSaysWhetherAnythingIsAwake(t *testing.T) {
	automation(t, true)
	var written ddb.Task
	stub(t, &ddbPutTask, func(_ context.Context, task ddb.Task) error { written = task; return nil })
	stub(t, &ddbListDaemons, func(context.Context, string) ([]ddb.Daemon, error) {
		return []ddb.Daemon{
			{DaemonID: "d1", LastHeartbeatAt: time.Now().UTC().Format(time.RFC3339)},
			{DaemonID: "d2", LastHeartbeatAt: "2026-01-01T00:00:00Z"},
		}, nil
	})

	out, err := sendTaskTool(testUser).Handler(context.Background(),
		map[string]any{"text": "pull main", "kind": "file"})
	if err != nil {
		t.Fatal(err)
	}
	if written.Status != ddb.TaskApproved {
		t.Fatalf("status = %q — the tool queues work", written.Status)
	}
	var said struct {
		TaskID   string `json:"taskId"`
		Queued   bool   `json:"queued"`
		Machines int    `json:"machines"`
		Awake    int    `json:"awake"`
	}
	if err := json.Unmarshal([]byte(out), &said); err != nil {
		t.Fatalf("the tool must answer JSON: %v", err)
	}
	if said.TaskID != written.TaskID || !said.Queued {
		t.Fatal("the model must be told which task it filed")
	}
	if said.Machines != 2 || said.Awake != 1 {
		t.Fatalf("machines/awake = %d/%d, want 2/1", said.Machines, said.Awake)
	}
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend/go && go test ./internal/api/ -run TestTheTool -v`
Expected: FAIL — `undefined: sendTaskTool`.

- [ ] **Step 3: Bump karma**

Run: `cd backend/go && go get github.com/MelloB1989/karma@v1.26.0 && go mod tidy`

- [ ] **Step 4: Write the tool**

`internal/api/chattools.go` holds `sendTaskTool(userID)` built with `ai.NewGoFunctionTool` and `ai.NewFuncParams().SetString("text", …).SetStringEnum("kind", …, []string{"message","spend","file","reminder","other"}).SetRequired("text")`. Its handler: `automationState` → return the sentence as a successful result when not entitled; otherwise `mintTask(ctx, userID, newTask{Text: …, Kind: …, Approved: true})`; then `ddbListDaemons`, counting awake ones with the existing `daemonOnline(d, now)` predicate (`daemons.go:271`) rather than a second reading of the same clock; then marshal `{taskId, text, queued, machines, awake}`. It emits `task.sent` start/done through the same sink `emitWrapEvent` uses.

In `chat.go:wrapperWith`, add to the `ai.NewKarmaAI(…)` options:

```go
		ai.WithToolsEnabled(),
		ai.WithMaxToolPasses(3),
		ai.AddGoFunctionTool(sendTaskTool(userID)),
```

- [ ] **Step 5: Run the tests**

Run: `cd backend/go && go build ./... && go test ./...`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/go/go.mod backend/go/go.sum backend/go/internal/api/chat.go backend/go/internal/api/chattools.go backend/go/internal/api/chattools_test.go
git commit -m "chat: the assistant can put a task on your laptop"
```

## Task 8: the chat says it did

**Files:**
- Modify: `mobile/src/api/client.ts:105-110` (name the event in the union)
- Modify: `mobile/app/(tabs)/lyzn.tsx:403` (draw the step)
- Test: `mobile/tests/state/memorySteps.test.ts` (extend)

**Interfaces:**
- Consumes: the `task.sent` SSE event from Task 7.

- [ ] **Step 1: Write the failing test**

Extend `mobile/tests/state/memorySteps.test.ts` with a case asserting the step label for `task.sent` is drawn from the same helper the memory steps use, `start` and `done` included.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd mobile && npm test`
Expected: FAIL — the helper has no case for `task.sent`.

- [ ] **Step 3: Implement**

Add `'task.sent'` to `ChatToolEvent['name']`'s union and a line to the step-label helper: `SENDING TO YOUR LAPTOP` on `start`, `SENT TO YOUR LAPTOP` on `done`, `COULD NOT SEND` on `failed`. Render it in `lyzn.tsx` beside the `memory.recall` line.

- [ ] **Step 4: Run tests and the type-check**

Run: `cd mobile && npm test && npx tsc --noEmit -p tsconfig.json`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/api/client.ts mobile/app/\(tabs\)/lyzn.tsx mobile/tests/state/memorySteps.test.ts
git commit -m "lyzn: you can see it file the task"
```
