package api

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/MelloB1989/mr20-pendant/backend/internal/ddb"
)

func TestTheToolTellsTheModelWhichHalfOfTheGateIsShut(t *testing.T) {
	// Both halves have to hold, and they fail with different sentences: one
	// is the deployment's, the other the account's. The model repeats
	// whichever it is given, so neither may come back empty.
	cases := []struct {
		name            string
		execution, plan bool
		wants           string
	}{
		{"the feature is not deployed", false, true, "execution"},
		{"the account did not buy it", true, false, "plan"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			cfg := defaultConfigOrFail(t)
			cfg.Features.Execution = c.execution
			useConfig(t, cfg)
			t.Setenv("EXECUTION_ENABLED", "")
			stub(t, &ddbGetPlan, func(context.Context, string) (ddb.Plan, error) {
				return ddb.Plan{Plan: "act", Automation: c.plan, Status: "active"}, nil
			})
			stub(t, &ddbPutTask, func(context.Context, ddb.Task) error {
				t.Error("a task was queued for an account that may not have one")
				return nil
			})

			out, err := sendTaskTool(testUser).Handler(context.Background(),
				map[string]any{"text": "run the tests"})
			// Not an error: the model has to say this in its own voice, and
			// an error would end the turn with nothing said at all.
			if err != nil {
				t.Fatalf("the model must be answered, not errored at: %v", err)
			}
			if !strings.Contains(out, c.wants) {
				t.Fatalf("result = %q, want %q in it", out, c.wants)
			}
		})
	}
}

func TestTheToolQueuesTheTaskAndSaysWhetherAnythingIsAwake(t *testing.T) {
	automation(t, true)
	var written ddb.Task
	stub(t, &ddbPutTask, func(_ context.Context, task ddb.Task) error {
		written = task
		return nil
	})
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
	if written.UserID != testUser || written.Text != "pull main" {
		t.Fatalf("wrote %+v", written)
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
	// A queued task with nothing awake is not the same as one that runs in a
	// minute, and the reply has to be able to say so.
	if said.Machines != 2 || said.Awake != 1 {
		t.Fatalf("machines/awake = %d/%d, want 2/1", said.Machines, said.Awake)
	}
}

func TestTheToolRefusesAnEmptyInstruction(t *testing.T) {
	automation(t, true)
	stub(t, &ddbPutTask, func(context.Context, ddb.Task) error {
		t.Error("an empty task was written")
		return nil
	})

	out, err := sendTaskTool(testUser).Handler(context.Background(), map[string]any{"text": "  "})
	if err != nil {
		t.Fatalf("the model must be answered: %v", err)
	}
	if !strings.Contains(strings.ToLower(out), "what") {
		t.Fatalf("result = %q, want it to ask what the task is", out)
	}
}
