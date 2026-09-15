package push

import (
	"encoding/json"
	"testing"
)

var tokens = []string{"ExponentPushToken[a]", "ExponentPushToken[b]"}

func TestTasksProposedPayload(t *testing.T) {
	messages := TasksProposed(tokens, 3, "rec_1", "send Priya the deck")
	if len(messages) != 2 {
		t.Fatalf("one message per installation: %d", len(messages))
	}
	m := messages[0]

	if m.Title != "3 things you promised" {
		t.Fatalf("title = %q", m.Title)
	}
	if m.Body != "send Priya the deck" {
		t.Fatalf("body = %q — the first task is what makes it worth opening", m.Body)
	}
	// This is the notification the product is for: it wakes the device, it
	// carries the actions, and it survives long enough to be acted on.
	if m.Priority != "high" {
		t.Fatalf("priority = %q, want high", m.Priority)
	}
	if m.ChannelID != ChannelTasks || m.CategoryID != CategoryTask {
		t.Fatalf("channel/category = %q %q", m.ChannelID, m.CategoryID)
	}
	if m.TTL == nil || *m.TTL != ttlThree {
		t.Fatalf("ttl = %v", m.TTL)
	}
	if m.Badge == nil || *m.Badge != 3 {
		t.Fatalf("badge = %v", m.Badge)
	}
	if m.Data["type"] != "tasks.proposed" || m.Data["recordingId"] != "rec_1" || m.Data["count"] != 3 {
		t.Fatalf("data = %+v", m.Data)
	}
	if messages[1].To != tokens[1] {
		t.Fatalf("second installation not addressed: %q", messages[1].To)
	}
}

func TestTasksProposedSingular(t *testing.T) {
	m := TasksProposed(tokens, 1, "rec_1", "call the landlord")[0]
	if m.Title != "1 thing you promised" {
		t.Fatalf("title = %q", m.Title)
	}
}

func TestTasksProposedSaysNothingAboutNothing(t *testing.T) {
	if got := TasksProposed(tokens, 0, "rec_1", ""); got != nil {
		t.Fatalf("no tasks must send no notification, got %+v", got)
	}
}

func TestRecordingReadyPayload(t *testing.T) {
	m := RecordingReady(tokens, "rec_1", "Lease renewal with Priya")[0]
	if m.Title != "Your conversation is ready" || m.Body != "Lease renewal with Priya" {
		t.Fatalf("title/body = %q %q", m.Title, m.Body)
	}
	if m.ChannelID != ChannelConversations {
		t.Fatalf("channel = %q", m.ChannelID)
	}
	if m.Priority != "default" {
		t.Fatalf("priority = %q — only tasks are urgent", m.Priority)
	}
	if m.Data["type"] != "recording.ready" || m.Data["recordingId"] != "rec_1" {
		t.Fatalf("data = %+v", m.Data)
	}
	// An untitled recording must still say something.
	if body := RecordingReady(tokens, "rec_1", "  ")[0].Body; body == "" {
		t.Fatal("empty body on an untitled recording")
	}
}

func TestRecordingFailedPayload(t *testing.T) {
	m := RecordingFailed(tokens, "rec_1", "the audio could not be read")[0]
	if m.Data["type"] != "recording.failed" {
		t.Fatalf("data = %+v", m.Data)
	}
	if m.ChannelID != ChannelConversations {
		t.Fatalf("channel = %q", m.ChannelID)
	}
	if m.Body != "the audio could not be read" {
		t.Fatalf("body = %q", m.Body)
	}
	if body := RecordingFailed(tokens, "rec_1", "")[0].Body; body == "" {
		t.Fatal("silence is what makes a user think the pendant is broken")
	}
}

func TestPlanActivatedPayload(t *testing.T) {
	m := PlanActivated(tokens, "Act", "LYZN-12")[0]
	if m.ChannelID != ChannelAccount {
		t.Fatalf("channel = %q", m.ChannelID)
	}
	if m.Data["type"] != "plan.activated" || m.Data["orderReference"] != "LYZN-12" {
		t.Fatalf("data = %+v", m.Data)
	}
}

func TestReceiptPrintedPayload(t *testing.T) {
	m := ReceiptPrinted(tokens, "r_1", "t_1", "send Priya the deck")[0]
	if m.Data["type"] != "receipt.printed" || m.Data["receiptId"] != "r_1" || m.Data["taskId"] != "t_1" {
		t.Fatalf("data = %+v", m.Data)
	}
}

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

// The wire shape is Expo's, not ours: an omitted field must be absent, and a
// zeroed pointer field must be present as zero.
func TestMessageWireShape(t *testing.T) {
	raw, err := json.Marshal(RecordingReady(tokens[:1], "rec_1", "title")[0])
	if err != nil {
		t.Fatal(err)
	}
	var wire map[string]any
	if err := json.Unmarshal(raw, &wire); err != nil {
		t.Fatal(err)
	}
	for _, absent := range []string{"categoryId", "badge"} {
		if _, ok := wire[absent]; ok {
			t.Fatalf("%s should be omitted when unset: %s", absent, raw)
		}
	}
	for _, present := range []string{"to", "title", "body", "priority", "ttl", "channelId", "data"} {
		if _, ok := wire[present]; !ok {
			t.Fatalf("%s missing from the payload: %s", present, raw)
		}
	}

	zero := 0
	raw, err = json.Marshal(Message{To: "x", Badge: &zero})
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(raw, &wire); err != nil {
		t.Fatal(err)
	}
	if wire["badge"] != float64(0) {
		t.Fatalf("badge 0 must survive as 0 — it is how the count is cleared: %s", raw)
	}
}
