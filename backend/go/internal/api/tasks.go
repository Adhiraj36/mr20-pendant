// Task routes — the commitments a conversation contained.
//
//	POST  /tasks                          a task nobody said out loud
//	GET   /tasks?status=&cursor=&limit=   the list, newest first
//	PATCH /tasks/:id                      edit the text or the due date
//	POST  /tasks/:id/done                 mark done and print the receipt
//	POST  /tasks/:id/dismiss              not going to happen
//	POST  /tasks/:id/approve              hand to the daemon
//	POST  /tasks/:id/answer               reply to a question a claimed task asked
//
// POST /tasks is the one origin that is not a conversation: the app's compose
// sheet and the assistant's send_task_to_laptop tool both come through it, and
// both land in mintTask so that "a task is born" happens in one place.
//
// Under the capture tier a task goes proposed → done or proposed → dismissed,
// by the user, and marking one done prints a receipt. Approval is the other
// road: it puts the task in the state a paired daemon polls for
// (internal/api/daemons.go), and it answers 402 until both the execution
// feature and the user's plan say otherwise, so nothing can quietly depend on
// a tier the account has not bought.
package api

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"

	"github.com/MelloB1989/mr20-pendant/backend/internal/authjwt"
	"github.com/MelloB1989/mr20-pendant/backend/internal/ddb"
	"github.com/MelloB1989/mr20-pendant/backend/internal/types"
)

func registerTaskRoutes(app fiber.Router) {
	app.Post("/tasks", createTask)
	app.Get("/tasks", listTasks)
	app.Patch("/tasks/:id", patchTask)
	app.Post("/tasks/:id/done", doneTask)
	app.Post("/tasks/:id/dismiss", dismissTask)
	app.Post("/tasks/:id/approve", approveTask)
	app.Post("/tasks/:id/answer", answerTask)
}

func taskLimit(c *fiber.Ctx) int32 {
	if v, err := strconv.Atoi(c.Query("limit")); err == nil && v > 0 {
		return int32(v)
	}
	return 0
}

func listTasks(c *fiber.Ctx) error {
	user := authjwt.Sub(c)
	status := strings.TrimSpace(c.Query("status"))
	if status != "" && !ddb.ValidTaskStatus(status) {
		return fiber.NewError(fiber.StatusBadRequest, "no such task status")
	}

	tasks, cursor, err := ddb.ListTasks(c.Context(), user, ddb.TaskStatus(status), taskLimit(c), c.Query("cursor"))
	if err != nil {
		return err
	}
	out := fiber.Map{"tasks": tasks}
	if cursor != "" {
		out["cursor"] = cursor
	}
	return c.JSON(out)
}

// loadTask is the read every single-task route starts with, scoped to the
// caller so a guessed id is a 404 rather than someone else's commitment.
func loadTask(c *fiber.Ctx) (*ddb.Task, error) {
	task, err := ddbGetTask(c.Context(), authjwt.Sub(c), c.Params("id"))
	if err != nil {
		return nil, err
	}
	if task == nil {
		return nil, fiber.NewError(fiber.StatusNotFound, "no such task")
	}
	return task, nil
}

// newTask is a task somebody asked for directly — typed into the app, or filed
// by the assistant's tool. Everything but the text is optional.
type newTask struct {
	Text  string `json:"text"`
	Kind  string `json:"kind"`
	DueAt string `json:"dueAt"`
	// Approved skips the proposed state and queues the task for a daemon. It
	// is the only field here that costs anything, and the only one gated.
	Approved bool `json:"approved"`
}

// ownTaskID is the id of a task no conversation produced.
//
// An extracted task is "<recordingId>-<index>", and something that splits one
// on its last hyphen is a reasonable thing to have written. A UUID carries
// four hyphens of its own, so none of them survive into the id: "own_" and
// thirty-two hex characters cannot be read as either half of that shape.
func ownTaskID() string {
	return "own_" + strings.ReplaceAll(uuid.NewString(), "-", "")
}

// mintTask writes a task that was asked for rather than overheard.
//
// Shared by POST /tasks and the assistant's tool, because a task being born
// should happen in one place: the id scheme, the truncation and the empty
// quote are the same fact whoever is doing the asking.
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
		// No recording and no quote: nobody said this, they asked for it.
		// Both are omitempty on the row and always present on the daemon's
		// wire format, so the work item still decodes wherever it lands.
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
		// The same rule PATCH applies: a stale client must not write a string
		// the list then sorts on.
		if _, err := time.Parse(time.RFC3339, input.DueAt); err != nil {
			return fiber.NewError(fiber.StatusBadRequest, "dueAt must be an RFC3339 timestamp")
		}
	}
	// The gate comes before the write, not after it: a task that cannot be
	// carried out must not sit in the queue for even one poll.
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

func patchTask(c *fiber.Ctx) error {
	task, err := loadTask(c)
	if err != nil {
		return err
	}

	var input struct {
		Text  *string `json:"text"`
		DueAt *string `json:"dueAt"`
	}
	if err := c.BodyParser(&input); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "request body must be JSON")
	}
	if input.Text == nil && input.DueAt == nil {
		return fiber.NewError(fiber.StatusBadRequest, "nothing to update")
	}
	if input.Text != nil {
		text := strings.TrimSpace(*input.Text)
		if text == "" {
			return fiber.NewError(fiber.StatusBadRequest, "a task needs text")
		}
		text = truncate(text, 400)
		input.Text = &text
	}
	if input.DueAt != nil && *input.DueAt != "" {
		// "" clears the date; anything else must be a real instant, so a
		// stale client cannot write a string the list then sorts on.
		if _, err := time.Parse(time.RFC3339, *input.DueAt); err != nil {
			return fiber.NewError(fiber.StatusBadRequest, "dueAt must be an RFC3339 timestamp")
		}
	}

	updated, err := ddb.EditTask(c.Context(), *task, input.Text, input.DueAt)
	if err != nil {
		if errors.Is(err, ddb.ErrTaskTransition) {
			return fiber.NewError(fiber.StatusNotFound, "no such task")
		}
		return err
	}
	return c.JSON(fiber.Map{"task": updated})
}

// doneTask closes a commitment and prints its proof in the same write.
//
// Idempotent on purpose: a second tap — from the other phone, or from the
// notification action after the screen already did it — finds the task done
// and answers with the same task and the same receipt rather than printing a
// second one. Only a task that went somewhere else, dismissed, is a conflict.
func doneTask(c *fiber.Ctx) error {
	user := authjwt.Sub(c)
	task, err := loadTask(c)
	if err != nil {
		return err
	}

	if task.Status == ddb.TaskDone {
		return alreadyDone(c, user, *task)
	}

	now := nowISO()
	receipt := ddb.ReceiptFromTask(*task, uuid.NewString(), now)
	updated, printed, err := ddb.CompleteTask(c.Context(), *task, receipt)
	if err != nil {
		if errors.Is(err, ddb.ErrTaskTransition) {
			// Someone got there first. Re-read: done is the same answer, and
			// anything else is a genuine conflict.
			fresh, ferr := ddb.GetTask(c.Context(), user, task.TaskID)
			if ferr == nil && fresh != nil && fresh.Status == ddb.TaskDone {
				return alreadyDone(c, user, *fresh)
			}
			return fiber.NewError(fiber.StatusConflict, "this task is no longer open")
		}
		return err
	}
	return c.JSON(fiber.Map{"task": updated, "receipt": printed})
}

// alreadyDone answers a repeat completion with what the first one produced.
func alreadyDone(c *fiber.Ctx, user string, task ddb.Task) error {
	if task.ReceiptID == "" {
		return c.JSON(fiber.Map{"task": task, "receipt": nil})
	}
	receipt, err := ddb.GetReceipt(c.Context(), user, task.ReceiptID)
	if err != nil {
		return err
	}
	return c.JSON(fiber.Map{"task": task, "receipt": receipt})
}

func dismissTask(c *fiber.Ctx) error {
	task, err := loadTask(c)
	if err != nil {
		return err
	}
	if task.Status == ddb.TaskDismissed {
		return c.JSON(fiber.Map{"task": *task})
	}

	updated, err := ddb.DismissTask(c.Context(), *task)
	if err != nil {
		if errors.Is(err, ddb.ErrTaskTransition) {
			return fiber.NewError(fiber.StatusConflict, "this task is no longer open")
		}
		return err
	}
	return c.JSON(fiber.Map{"task": updated})
}

// approveTask hands a task to execution — which, from round eight, means a
// daemon on the user's own laptop picks it up on its next poll.
//
// Two gates, and both have to hold: the feature has to be switched on
// (AppConfig.features.execution), and the user has to have paid for the tier
// that includes it. 402 rather than 403 because the second gate is a price,
// and the app opens the plan chooser on it. Both live in one helper with
// every /daemons route's gate — internal/api/daemons.go, automationGate.
func approveTask(c *fiber.Ctx) error {
	user := authjwt.Sub(c)
	task, err := loadTask(c)
	if err != nil {
		return err
	}

	if err := automationGate(c.Context(), user); err != nil {
		return err
	}

	if task.Status == ddb.TaskApproved {
		return c.JSON(fiber.Map{"task": *task})
	}
	updated, err := ddb.ApproveTask(c.Context(), *task)
	if err != nil {
		if errors.Is(err, ddb.ErrTaskTransition) {
			return fiber.NewError(fiber.StatusConflict, "this task is no longer open")
		}
		return err
	}
	return c.JSON(fiber.Map{"task": updated})
}

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

	// No separate expiry pre-check: the same DDB condition AnswerQuestion
	// always applies — still blocked, nobody has answered yet — is the single
	// source of truth. A question the expiry sweep has already failed is no
	// longer blocked, so that same write reports the conflict on its own; a
	// question merely past its clock but not yet swept still gets an honest
	// answer rather than a race against a background job.
	updated, err := ddbAnswerQuestion(c.Context(), *task, answer, "app")
	if err != nil {
		if errors.Is(err, ddb.ErrTaskTransition) {
			return fiber.NewError(fiber.StatusConflict, "this question is no longer open")
		}
		return err
	}
	return c.JSON(fiber.Map{"task": updated})
}
