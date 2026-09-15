package ddb

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	ddbtypes "github.com/aws/aws-sdk-go-v2/service/dynamodb/types"

	"github.com/MelloB1989/mr20-pendant/backend/internal/types"
)

func sampleTask() Task {
	return Task{
		TaskID:      "rec_1-0",
		UserID:      "user_1",
		RecordingID: "rec_1",
		Text:        "send Priya the deck",
		Kind:        types.TaskKindMessage,
		Status:      TaskProposed,
		Quote:       "I'll send you the deck tonight",
		CreatedAt:   "2026-09-08T10:00:00Z",
		UpdatedAt:   "2026-09-08T10:00:00Z",
	}
}

func str(t *testing.T, av ddbtypes.AttributeValue, label string) string {
	t.Helper()
	sv, ok := av.(*ddbtypes.AttributeValueMemberS)
	if !ok {
		t.Fatalf("%s is not a string attribute: %#v", label, av)
	}
	return sv.Value
}

func TestTaskKeys(t *testing.T) {
	task := sampleTask()
	if got := task.SK(); got != "TASK#2026-09-08T10:00:00Z#rec_1-0" {
		t.Fatalf("SK = %q", got)
	}
	item, err := taskItem(task)
	if err != nil {
		t.Fatal(err)
	}
	if got := str(t, item["PK"], "PK"); got != "USER#user_1" {
		t.Fatalf("PK = %q", got)
	}
	// The status index is what answers "still waiting on me" without reading
	// every task the user ever made.
	if got := str(t, item["GSI1PK"], "GSI1PK"); got != "TASKSTATUS#user_1#proposed" {
		t.Fatalf("GSI1PK = %q", got)
	}
	if got := str(t, item["GSI1SK"], "GSI1SK"); got != task.CreatedAt {
		t.Fatalf("GSI1SK = %q", got)
	}
}

// The guard is the whole point of a transition: two phones on the same list is
// the normal case, and the second tap must be refused rather than reopen what
// the first one closed.
func TestTaskTransitionGuardsTheStartingState(t *testing.T) {
	task := sampleTask()
	in, err := taskTransitionInput(task.UserID, task.SK(),
		[]TaskStatus{TaskProposed, TaskApproved}, TaskDone,
		map[string]string{"doneAt": "2026-09-08T12:00:00Z", "receiptId": "r_1"})
	if err != nil {
		t.Fatal(err)
	}

	condition := aws.ToString(in.ConditionExpression)
	if !strings.Contains(condition, "attribute_exists(PK)") {
		t.Fatalf("condition does not require the row to exist: %q", condition)
	}
	if !strings.Contains(condition, "#status IN (:from0, :from1)") {
		t.Fatalf("condition does not pin the starting state: %q", condition)
	}
	if got := str(t, in.ExpressionAttributeValues[":from0"], ":from0"); got != "proposed" {
		t.Fatalf(":from0 = %q", got)
	}
	if got := str(t, in.ExpressionAttributeValues[":from1"], ":from1"); got != "approved" {
		t.Fatalf(":from1 = %q", got)
	}
	if in.ExpressionAttributeNames["#status"] != "status" {
		t.Fatalf("status is a reserved word and must be aliased: %+v", in.ExpressionAttributeNames)
	}
}

// The index key moves with the status, or a done task keeps answering the
// "proposed" query forever.
func TestTaskTransitionMovesTheIndexKey(t *testing.T) {
	task := sampleTask()
	in, err := taskTransitionInput(task.UserID, task.SK(), []TaskStatus{TaskProposed}, TaskDismissed, nil)
	if err != nil {
		t.Fatal(err)
	}
	if got := str(t, in.ExpressionAttributeValues[":gsi"], ":gsi"); got != "TASKSTATUS#user_1#dismissed" {
		t.Fatalf(":gsi = %q", got)
	}
	if update := aws.ToString(in.UpdateExpression); !strings.Contains(update, "GSI1PK = :gsi") {
		t.Fatalf("update does not move the index key: %q", update)
	}
}

func TestTaskTransitionCarriesTheExtraFields(t *testing.T) {
	task := sampleTask()
	in, err := taskTransitionInput(task.UserID, task.SK(), []TaskStatus{TaskProposed}, TaskDone,
		map[string]string{"doneAt": "2026-09-08T12:00:00Z", "receiptId": "r_1"})
	if err != nil {
		t.Fatal(err)
	}
	update := aws.ToString(in.UpdateExpression)
	for _, want := range []string{"#doneAt = :doneAt", "#receiptId = :receiptId"} {
		if !strings.Contains(update, want) {
			t.Fatalf("update missing %q: %q", want, update)
		}
	}
	if got := str(t, in.ExpressionAttributeValues[":receiptId"], ":receiptId"); got != "r_1" {
		t.Fatalf(":receiptId = %q", got)
	}
}

func TestTaskTransitionNeedsAStartingState(t *testing.T) {
	if _, err := taskTransitionInput("user_1", "TASK#x", nil, TaskDone, nil); err == nil {
		t.Fatal("a transition from nowhere must be refused")
	}
}

func TestApplyTransitionMirrorsTheWrite(t *testing.T) {
	got := applyTransition(sampleTask(), TaskDone, map[string]string{
		"doneAt": "2026-09-08T12:00:00Z", "receiptId": "r_1",
	})
	if got.Status != TaskDone || got.DoneAt != "2026-09-08T12:00:00Z" || got.ReceiptID != "r_1" {
		t.Fatalf("local copy does not match what was written: %+v", got)
	}
	if got.UpdatedAt == sampleTask().UpdatedAt {
		t.Fatal("updatedAt did not move")
	}
}

// I5: a stuck blocked task — its daemon gone, its question never enforced —
// has no human override today, in the app or the API. dismissTaskInput must
// reach blocked, alongside the two states it already covered.
func TestDismissTaskInputReachesBlocked(t *testing.T) {
	task := sampleBlockedTask()
	task.Status = TaskBlocked
	in, err := dismissTaskInput(task)
	if err != nil {
		t.Fatal(err)
	}
	condition := aws.ToString(in.ConditionExpression)
	if !strings.Contains(condition, "#status IN (:from0, :from1, :from2)") {
		t.Fatalf("condition does not pin three starting states: %q", condition)
	}
	var froms []string
	for _, key := range []string{":from0", ":from1", ":from2"} {
		froms = append(froms, str(t, in.ExpressionAttributeValues[key], key))
	}
	found := map[string]bool{}
	for _, f := range froms {
		found[f] = true
	}
	for _, want := range []string{"proposed", "approved", "blocked"} {
		if !found[want] {
			t.Fatalf("froms = %v, missing %q", froms, want)
		}
	}
}

// The same race FailBlockedWork already guards against: a read-then-write
// window can straddle an answer landing in between, and answering a
// question never moves the task's status, so a status-only condition cannot
// see it. Dismiss must refuse rather than silently discard a reply that got
// there in time.
func TestDismissTaskInputGuardsAQuestionThatWasJustAnswered(t *testing.T) {
	task := sampleBlockedTask()
	task.Status = TaskBlocked
	in, err := dismissTaskInput(task)
	if err != nil {
		t.Fatal(err)
	}
	condition := aws.ToString(in.ConditionExpression)
	if !strings.Contains(condition, "attribute_not_exists(#question.#answer)") {
		t.Fatalf("condition = %q — dismiss must refuse a question that was just answered", condition)
	}
	if in.ExpressionAttributeNames["#question"] != "question" || in.ExpressionAttributeNames["#answer"] != "answer" {
		t.Fatalf("names = %+v — question and answer are not aliased", in.ExpressionAttributeNames)
	}
}

// The exported entry point, exercised end to end against a fake client: a
// blocked-and-answered task must be refused (ErrTaskTransition), and a
// blocked-and-unanswered one — the ordinary stuck case I5 exists for — must
// actually dismiss.
func TestDismissTaskClosesAStuckBlockedTaskButRefusesAnAnsweredOne(t *testing.T) {
	unanswered := sampleBlockedTask()
	unanswered.Status = TaskBlocked
	unanswered.Question = &TaskQuestion{ID: "q_1", Text: "which account?"}

	withFakeClient(t, fakeDDBClient{
		updateItem: func(_ context.Context, in *dynamodb.UpdateItemInput, _ ...func(*dynamodb.Options)) (*dynamodb.UpdateItemOutput, error) {
			return &dynamodb.UpdateItemOutput{}, nil
		},
	})
	dismissed, err := DismissTask(context.Background(), unanswered)
	if err != nil {
		t.Fatalf("a stuck, unanswered blocked task must be dismissable: %v", err)
	}
	if dismissed.Status != TaskDismissed {
		t.Fatalf("status = %q, want dismissed", dismissed.Status)
	}

	answered := sampleBlockedTask()
	answered.Status = TaskBlocked
	answered.Question = &TaskQuestion{ID: "q_1", Text: "which account?", Answer: "the work one"}
	withFakeClient(t, fakeDDBClient{
		updateItem: func(_ context.Context, in *dynamodb.UpdateItemInput, _ ...func(*dynamodb.Options)) (*dynamodb.UpdateItemOutput, error) {
			return nil, &ddbtypes.ConditionalCheckFailedException{}
		},
	})
	if _, err := DismissTask(context.Background(), answered); !errors.Is(err, ErrTaskTransition) {
		t.Fatalf("err = %v, want ErrTaskTransition — a landed answer must not be silently discarded", err)
	}
}

func TestValidTaskStatus(t *testing.T) {
	for _, ok := range []string{"proposed", "approved", "done", "dismissed", "failed"} {
		if !ValidTaskStatus(ok) {
			t.Fatalf("%q should be a status", ok)
		}
	}
	for _, bad := range []string{"", "DONE", "pending", "rejected"} {
		if ValidTaskStatus(bad) {
			t.Fatalf("%q should not be a status", bad)
		}
	}
}

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
