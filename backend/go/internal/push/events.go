// Every notification the backend sends, built in one place.
//
// A notification is the only thing this product does uninvited, so what it may
// say is worth keeping in one file where it can be read whole rather than
// assembled inline at four call sites. Each builder is pure — tokens in,
// messages out — so the payload a user would actually receive is something a
// test can assert on rather than something only production can show.
//
// The routing table these fill in:
//
//	event              channel         category  priority  ttl
//	recording.ready    conversations   —         default   1 day
//	recording.failed   conversations   —         default   1 day
//	tasks.proposed     tasks           task      high      3 days
//	plan.activated     account         —         default   1 week
//	receipt.printed    tasks           —         default   1 day
//	task.question      tasks           task      high      1 day
package push

import (
	"fmt"
	"strings"
)

// Android channel ids. The app must create channels with exactly these ids;
// Android silently drops a notification naming a channel it does not have.
const (
	ChannelTasks         = "tasks"
	ChannelConversations = "conversations"
	ChannelAccount       = "account"
)

// CategoryTask is the iOS category carrying the "Mark done" and "Open"
// actions. The app registers it at launch.
const CategoryTask = "task"

const (
	ttlDay   = 24 * 60 * 60
	ttlThree = 3 * ttlDay
	ttlWeek  = 7 * ttlDay
)

func ttl(seconds int) *int { return &seconds }

// fanOut addresses one message to every installation the user has.
func fanOut(tokens []string, m Message) []Message {
	messages := make([]Message, 0, len(tokens))
	for _, token := range tokens {
		m.To = token
		messages = append(messages, m)
	}
	return messages
}

// RecordingReady: the conversation the user was waiting on has been
// transcribed. The one moment in the pipeline they cannot see.
func RecordingReady(tokens []string, recordingID, title string) []Message {
	body := strings.TrimSpace(title)
	if body == "" {
		body = "A new conversation is ready to read."
	}
	return fanOut(tokens, Message{
		Title:     "Your conversation is ready",
		Body:      body,
		Sound:     "default",
		Priority:  "default",
		TTL:       ttl(ttlDay),
		ChannelID: ChannelConversations,
		Data:      map[string]any{"type": "recording.ready", "recordingId": recordingID},
	})
}

// RecordingFailed: a recording could not be transcribed and will not be
// retried on its own. Said plainly, because the alternative is a conversation
// that silently never arrives and a user who assumes the pendant is broken.
func RecordingFailed(tokens []string, recordingID, reason string) []Message {
	body := strings.TrimSpace(reason)
	if body == "" {
		body = "It could not be transcribed. Open it to try again."
	}
	if len(body) > 160 {
		body = body[:160]
	}
	return fanOut(tokens, Message{
		Title:     "A recording could not be processed",
		Body:      body,
		Sound:     "default",
		Priority:  "default",
		TTL:       ttl(ttlDay),
		ChannelID: ChannelConversations,
		Data:      map[string]any{"type": "recording.failed", "recordingId": recordingID},
	})
}

// TasksProposed: the conversation contained commitments.
//
// This is the notification the product is actually for, which is why it is the
// only one sent at high priority and the only one that carries actions. The
// title counts them and the body is the first one in full: a count alone is a
// nag, and a count with the promise attached is a reason to open the app.
func TasksProposed(tokens []string, count int, recordingID, firstTask string) []Message {
	if count <= 0 {
		return nil
	}
	noun := "things"
	if count == 1 {
		noun = "thing"
	}
	body := strings.TrimSpace(firstTask)
	if body == "" {
		body = "Open the conversation to see what you said."
	}
	badge := count
	return fanOut(tokens, Message{
		Title:      fmt.Sprintf("%d %s you promised", count, noun),
		Body:       body,
		Sound:      "default",
		Priority:   "high",
		TTL:        ttl(ttlThree),
		ChannelID:  ChannelTasks,
		CategoryID: CategoryTask,
		Badge:      &badge,
		Data: map[string]any{
			"type": "tasks.proposed", "count": count, "recordingId": recordingID,
		},
	})
}

// PlanActivated: a payment cleared and the plan is live.
func PlanActivated(tokens []string, plan, orderReference string) []Message {
	return fanOut(tokens, Message{
		Title:     "Your plan is active",
		Body:      "Everything on " + plan + " is switched on.",
		Sound:     "default",
		Priority:  "default",
		TTL:       ttl(ttlWeek),
		ChannelID: ChannelAccount,
		Data: map[string]any{
			"type": "plan.activated", "plan": plan, "orderReference": orderReference,
		},
	})
}

// ReceiptPrinted: execution closed a task and printed its proof. Nothing sends
// this yet — the execution tier is a flagged slot ([EXECUTION]) — and it is
// here so the app's routing table has one shape to code against.
func ReceiptPrinted(tokens []string, receiptID, taskID, title string) []Message {
	body := strings.TrimSpace(title)
	if body == "" {
		body = "A receipt was added to your roll."
	}
	return fanOut(tokens, Message{
		Title:     "Done, and filed",
		Body:      body,
		Sound:     "default",
		Priority:  "default",
		TTL:       ttl(ttlDay),
		ChannelID: ChannelTasks,
		Data: map[string]any{
			"type": "receipt.printed", "receiptId": receiptID, "taskId": taskID,
		},
	})
}

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
