package apply

import (
	"fmt"
	"time"

	"github.com/MelloB1989/mr20-pendant/backend/internal/ddb"
	"github.com/MelloB1989/mr20-pendant/backend/internal/enrich"
	"github.com/MelloB1989/mr20-pendant/backend/internal/types"
)

// TasksFromActionItems turns a conversation's action items into task rows.
// Moved here from cmd/processor/main.go unchanged: ApplyFn is now the only
// caller, on both the extracted path and the Bedrock fallback, so this
// belongs beside the rest of what a recording's finish line writes.
//
// The ids are deterministic — the recording id and the item's position —
// and so is createdAt, the recording's own startedAt. Both on purpose: SQS
// delivers at least once, and a redelivered applyQueue message must rewrite
// the same rows rather than leave the user with every promise listed twice.
func TasksFromActionItems(userID, recordingID, startedAt string, items []types.ActionItem, t *types.Transcript) []ddb.Task {
	if len(items) == 0 {
		return nil
	}
	now := time.Now().UTC().Format(time.RFC3339)
	tasks := make([]ddb.Task, 0, len(items))
	for i, item := range items {
		kind := item.Kind
		if kind == "" {
			kind = types.TaskKindOther
		}
		task := ddb.Task{
			TaskID:      fmt.Sprintf("%s-%d", recordingID, i),
			UserID:      userID,
			RecordingID: recordingID,
			Text:        item.Text,
			Owner:       item.Owner,
			Kind:        kind,
			Status:      ddb.TaskProposed,
			Quote:       item.Text,
			CreatedAt:   startedAt,
			UpdatedAt:   now,
		}
		if idx := enrich.BestUtterance(item.Text, t.Utterances); idx >= 0 {
			at := idx
			task.UtteranceIndex = &at
			task.Quote = t.Utterances[idx].Text
		}
		tasks = append(tasks, task)
	}
	return tasks
}
