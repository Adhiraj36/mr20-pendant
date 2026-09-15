package apply

import (
	"testing"

	"github.com/MelloB1989/mr20-pendant/backend/internal/types"
)

func TestPatchOmitsFieldsTheSourceLeftEmpty(t *testing.T) {
	// Patch is agnostic about which path called it — it only ever includes
	// a field when Result actually carries one, so UpdateRecording leaves
	// whatever was already on the row untouched rather than clobbering it
	// with a zero value.
	patch := Patch(Result{Tasks: nil, Memories: nil})
	if _, ok := patch["title"]; ok {
		t.Fatal("an empty Result must not put title in the patch")
	}
	if patch["status"] != types.StatusReady {
		t.Fatalf("status = %v, want ready", patch["status"])
	}
}

func TestPatchCarriesWhicheverPathProducedTitleAndCategory(t *testing.T) {
	patch := Patch(Result{Title: "Standup with Ravi", CategoryID: "work"})
	if patch["title"] != "Standup with Ravi" || patch["categoryId"] != "work" {
		t.Fatalf("patch = %+v", patch)
	}
}

// TestPatchTaskCountMirrorsTasksIncludingZero is I8's other half: a re-run
// that produces fewer action items than an earlier attempt did must
// eventually ratchet the recording's own taskCount down to match, zero
// included — reconcileOrphanTasks (cmd/apply) reads this field on the next
// attempt to know which of its own earlier rows are now orphaned.
func TestPatchTaskCountMirrorsTasksIncludingZero(t *testing.T) {
	if got := Patch(Result{Tasks: []types.ActionItem{{Text: "a"}, {Text: "b"}}})["taskCount"]; got != 2 {
		t.Fatalf("taskCount = %v, want 2", got)
	}
	if got := Patch(Result{})["taskCount"]; got != 0 {
		t.Fatalf("taskCount = %v, want 0 — a run with no action items must still ratchet the count down", got)
	}
}
