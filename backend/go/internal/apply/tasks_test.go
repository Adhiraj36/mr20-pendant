package apply

import (
	"testing"

	"github.com/MelloB1989/mr20-pendant/backend/internal/types"
)

func TestTaskIdsAreDeterministicFromRecordingAndPosition(t *testing.T) {
	items := []types.ActionItem{{Text: "call the vet"}, {Text: "pay the rent"}}
	transcript := &types.Transcript{Utterances: []types.Utterance{{Text: "I'll call the vet tomorrow"}}}

	tasks := TasksFromActionItems("user_1", "rec_1", "2026-09-14T09:00:00Z", items, transcript)

	if len(tasks) != 2 {
		t.Fatalf("got %d tasks, want 2", len(tasks))
	}
	if tasks[0].TaskID != "rec_1-0" || tasks[1].TaskID != "rec_1-1" {
		t.Fatalf("ids = %q, %q", tasks[0].TaskID, tasks[1].TaskID)
	}
	again := TasksFromActionItems("user_1", "rec_1", "2026-09-14T09:00:00Z", items, transcript)
	if again[0].TaskID != tasks[0].TaskID {
		t.Fatal("the same call twice must mint the same ids — redelivery must rewrite, not duplicate")
	}
}

func TestNoActionItemsIsNoTasks(t *testing.T) {
	if got := TasksFromActionItems("u", "r", "t", nil, &types.Transcript{}); got != nil {
		t.Fatalf("got %v, want nil", got)
	}
}
