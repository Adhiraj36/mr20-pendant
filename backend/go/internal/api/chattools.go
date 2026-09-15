// The tools the assistant may call, and the only place in this API where a
// model causes something rather than describing it.
//
// There is one. `send_task_to_laptop` files a task for the account's paired
// machine, already approved — which is what puts it in front of a daemon on
// its next poll. A sentence in a chat therefore becomes work on somebody's
// laptop, and that is the intent: the alternative, a draft the person then
// has to approve in another screen, is the thing they asked not to do.
//
// Three rules hold it in place.
//
//  1. The plan gate is the same one every other route carries. A model
//     cannot spend what the account has not bought.
//  2. Every outcome is a *successful* tool result carrying a sentence —
//     including the refusals. An error would end the turn, and the person
//     would be told nothing at all rather than why.
//  3. The answer says what was filed and whether any machine is awake to
//     take it. A queued task with nothing paired is not the same as one that
//     runs in a minute, and the reply must be able to tell them apart.
package api

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	gl "github.com/GitLoomHQ/gitloom-go/gitloom"
	"github.com/MelloB1989/karma/ai"
)

// sendTaskTool builds the tool for one account. The user id is closed over
// rather than taken as an argument: a model must not be able to name whose
// laptop it is writing to.
func sendTaskTool(userID string) ai.GoFunctionTool {
	return ai.NewGoFunctionTool(
		"send_task_to_laptop",
		"File a task for this person's paired laptop to carry out. Use it when they ask "+
			"for something to be done on their machine. The task is queued the moment this "+
			"returns and is run by their laptop, not here — so say that it is queued, never "+
			"that it is finished.",
		ai.NewFuncParams().
			SetString("text", "What to do, as one instruction, in the person's own words").
			SetStringEnum("kind", "What sort of act it is",
				[]string{"message", "spend", "file", "reminder", "other"}).
			SetRequired("text"),
		func(ctx context.Context, args ai.FuncParams) (string, error) {
			return sendTask(ctx, userID, args), nil
		},
	)
}

// sendTask is the handler proper, split out so it returns one string and
// never an error — see rule 2 above.
func sendTask(ctx context.Context, userID string, args ai.FuncParams) string {
	text, _ := args["text"].(string)
	if strings.TrimSpace(text) == "" {
		return "Nothing was filed: ask them what the task should say."
	}
	kind, _ := args["kind"].(string)

	ok, why, err := automationState(ctx, userID)
	if err != nil {
		return "Nothing was filed: the account's plan could not be read just now."
	}
	if !ok {
		// `why` is already a sentence written for a person to read.
		return "Nothing was filed. " + why
	}

	task, err := mintTask(ctx, userID, newTask{Text: text, Kind: kind, Approved: true})
	if err != nil {
		emitWrapEvent(gl.WrapEvent{Kind: "task.sent", Err: err})
		return "Nothing was filed: the task could not be written just now."
	}
	emitWrapEvent(gl.WrapEvent{Kind: "task.sent"})

	machines, awake := machinesFor(ctx, userID)
	answer, err := json.Marshal(map[string]any{
		"taskId":   task.TaskID,
		"text":     task.Text,
		"queued":   true,
		"machines": machines,
		"awake":    awake,
	})
	if err != nil {
		return "Filed, and queued for their laptop."
	}
	return string(answer)
}

// machinesFor counts the account's paired machines and how many are awake,
// using the same reading of a heartbeat the daemon list is drawn from. A list
// that cannot be read is no machines rather than a failure: the task is
// already queued, and this only decides how the reply is worded.
func machinesFor(ctx context.Context, userID string) (machines, awake int) {
	daemons, err := ddbListDaemons(ctx, userID)
	if err != nil {
		return 0, 0
	}
	now := time.Now().UTC()
	for _, daemon := range daemons {
		machines++
		if daemonOnline(daemon, now) {
			awake++
		}
	}
	return machines, awake
}
