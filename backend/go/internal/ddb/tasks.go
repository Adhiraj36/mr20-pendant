// Tasks: the commitments a conversation contained, promoted from a field on
// the recording row to rows of their own.
//
//	Task  PK USER#<sub>  SK TASK#<createdAt>#<taskId>
//	                     GSI1PK TASKSTATUS#<sub>#<status>  GSI1SK <createdAt>
//
// The sort key leads with createdAt so a user's tasks come back in the order
// the promises were made without a sort step, and GSI1 answers the one query
// the base table cannot: "everything still waiting on me", across every
// conversation, without reading the ones already dealt with.
//
// Status is a state machine, and every move through it is a *conditional*
// update rather than a read-then-write — the same shape as MarkOrderFailed.
// Two phones with the same list open, or a notification action racing the
// screen behind it, are the normal case here, not the exotic one: whoever
// arrives second must find the transition refused, not silently reopen a task
// the first one closed.
package ddb

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	ddbtypes "github.com/aws/aws-sdk-go-v2/service/dynamodb/types"

	"github.com/MelloB1989/mr20-pendant/backend/internal/types"
)

// TaskStatus is where a commitment stands.
type TaskStatus string

const (
	// TaskProposed is where every task starts: the pendant heard a promise,
	// nobody has agreed it is real yet.
	TaskProposed TaskStatus = "proposed"
	// TaskApproved is the user handing a task to execution: the state a
	// daemon polls for (internal/ddb/daemons.go, GET /daemons/work).
	TaskApproved TaskStatus = "approved"
	// TaskExecuting is a daemon having claimed it. The claim is what moves
	// the row out of the approved partition, so "not already claimed" is a
	// property of where the row is rather than a filter anyone applies.
	TaskExecuting TaskStatus = "executing"
	// TaskBlocked is a task parked mid-execution on a question for the person
	// who approved it. It sits in its own GSI1 partition
	// (TASKSTATUS#<sub>#blocked), which is what keeps releaseAbandoned's lease
	// sweep — scoped to the executing partition alone — from ever touching it:
	// a blocked task stays pinned to the daemon that asked until it is
	// answered, expires, or that daemon gives it up.
	TaskBlocked   TaskStatus = "blocked"
	TaskDone      TaskStatus = "done"
	TaskDismissed TaskStatus = "dismissed"
	// TaskFailed is execution's verdict: the daemon ran it and it did not
	// work. Written by POST /daemons/work/:taskId/result.
	TaskFailed TaskStatus = "failed"
)

// TaskStatuses is every status a client may filter on.
var TaskStatuses = []TaskStatus{TaskProposed, TaskApproved, TaskExecuting, TaskBlocked, TaskDone, TaskDismissed, TaskFailed}

// ValidTaskStatus reports whether a client-supplied filter names a real status.
func ValidTaskStatus(v string) bool {
	for _, s := range TaskStatuses {
		if string(s) == v {
			return true
		}
	}
	return false
}

// ErrTaskTransition is a refused status change: the task is not in a state
// this move can start from. Handlers turn it into 409, or into an idempotent
// 200 when the task is already where the caller wanted it.
var ErrTaskTransition = errors.New("the task is not in a state that allows this")

// DefaultQuestionTTL is how long an unanswered question holds a task before
// the expiry escape hatch fails it. A daemon may ask for less; it may not
// ask for more than a day without saying so explicitly, because the disk a
// durable session holds is the cost of every hour this stays open.
const DefaultQuestionTTL = 24 * time.Hour

// TaskQuestion is what a daemon asked when it stopped mid-task. It hangs off
// a blocked task and never appears on any other status.
type TaskQuestion struct {
	ID   string `dynamodbav:"id" json:"id"`
	Text string `dynamodbav:"text" json:"text"`
	// Options, when present, makes this a choice rather than free text.
	Options   []string `dynamodbav:"options,omitempty" json:"options,omitempty"`
	AskedBy   string   `dynamodbav:"askedBy" json:"askedBy"`
	AskedAt   string   `dynamodbav:"askedAt" json:"askedAt"`
	ExpiresAt string   `dynamodbav:"expiresAt" json:"expiresAt"`
	// Answer, AnsweredAt and AnsweredBy are empty until somebody replies.
	// AnsweredBy is "app", "comms", or "desktop" — which surface wrote it,
	// not who.
	Answer     string `dynamodbav:"answer,omitempty" json:"answer,omitempty"`
	AnsweredAt string `dynamodbav:"answeredAt,omitempty" json:"answeredAt,omitempty"`
	AnsweredBy string `dynamodbav:"answeredBy,omitempty" json:"answeredBy,omitempty"`
}

// Task is one commitment, extracted from one conversation.
//
// Quote is the sentence as the transcript has it and never changes; Text is
// the model's phrasing of what was promised and the user may edit it. Keeping
// both is what lets the detail screen show the promise and its source without
// the source drifting when the wording is tidied.
type Task struct {
	TaskID      string `dynamodbav:"taskId" json:"taskId"`
	UserID      string `dynamodbav:"userId" json:"userId"`
	RecordingID string `dynamodbav:"recordingId,omitempty" json:"recordingId,omitempty"`
	// UtteranceIndex points at the line of the transcript the promise was
	// made in, so tapping the quote opens the recording there. Absent when no
	// line matched cheaply — a wrong jump is worse than none.
	UtteranceIndex *int           `dynamodbav:"utteranceIndex,omitempty" json:"utteranceIndex,omitempty"`
	Text           string         `dynamodbav:"text" json:"text"`
	Owner          *int           `dynamodbav:"owner,omitempty" json:"owner,omitempty"`
	Kind           types.TaskKind `dynamodbav:"kind" json:"kind"`
	Status         TaskStatus     `dynamodbav:"status" json:"status"`
	Quote          string         `dynamodbav:"quote,omitempty" json:"quote,omitempty"`
	DueAt          string         `dynamodbav:"dueAt,omitempty" json:"dueAt,omitempty"`
	DoneAt         string         `dynamodbav:"doneAt,omitempty" json:"doneAt,omitempty"`
	ReceiptID      string         `dynamodbav:"receiptId,omitempty" json:"receiptId,omitempty"`
	// DaemonID and ClaimedAt are which machine took this task and when.
	// Written by the claim, and what lets the app say a task is running on
	// somebody's laptop rather than merely "executing".
	DaemonID  string `dynamodbav:"daemonId,omitempty" json:"daemonId,omitempty"`
	ClaimedAt string `dynamodbav:"claimedAt,omitempty" json:"claimedAt,omitempty"`
	// LeaseUntil is when this claim stops meaning anything.
	//
	// A laptop that takes a task and then loses power, loses its network or
	// is simply closed would otherwise hold the promise for ever: the task
	// sits in the executing partition, which nothing polls, and the person
	// is told their work is running when no machine is running it. The lease
	// is what makes a claim a loan rather than a transfer — past it, the
	// task returns to the queue and the next poll offers it again.
	LeaseUntil string `dynamodbav:"leaseUntil,omitempty" json:"leaseUntil,omitempty"`
	// Question is set only while Status is blocked. The LYZN row is
	// authoritative for it: comms channels live in KARMAX and the app lives
	// here, so a question answered entirely inside KARMAX's comms plumbing
	// would otherwise never reach the app at all.
	Question  *TaskQuestion `dynamodbav:"question,omitempty" json:"question,omitempty"`
	CreatedAt string        `dynamodbav:"createdAt" json:"createdAt"`
	UpdatedAt string        `dynamodbav:"updatedAt" json:"updatedAt"`
}

func taskSK(createdAt, taskID string) string { return "TASK#" + createdAt + "#" + taskID }

func taskStatusGSI(userID string, status TaskStatus) string {
	return "TASKSTATUS#" + userID + "#" + string(status)
}

// SK is the task's sort key — the handle every conditional update needs, and
// the reason a task carries its createdAt on the wire.
func (t Task) SK() string { return taskSK(t.CreatedAt, t.TaskID) }

func taskItem(t Task) (map[string]ddbtypes.AttributeValue, error) {
	item, err := attributevalue.MarshalMap(t)
	if err != nil {
		return nil, err
	}
	item["PK"] = s(userPK(t.UserID))
	item["SK"] = s(t.SK())
	item["GSI1PK"] = s(taskStatusGSI(t.UserID, t.Status))
	item["GSI1SK"] = s(t.CreatedAt)
	return item, nil
}

// PutTask writes one task, overwriting an existing row with the same key.
func PutTask(ctx context.Context, t Task) error {
	item, err := taskItem(t)
	if err != nil {
		return err
	}
	_, err = client.PutItem(ctx, &dynamodb.PutItemInput{TableName: &table, Item: item})
	return err
}

// maxBatchWrite is DynamoDB's own limit on one BatchWriteItem.
const maxBatchWrite = 25

// PutTasks writes a conversation's whole set of tasks in as few round trips as
// the service allows. BatchWriteItem takes no conditions, which is why the
// processor mints task ids deterministically from the recording: a redelivered
// SQS message rewrites the same rows rather than growing a second copy of
// every promise.
func PutTasks(ctx context.Context, tasks []Task) error {
	for start := 0; start < len(tasks); start += maxBatchWrite {
		end := start + maxBatchWrite
		if end > len(tasks) {
			end = len(tasks)
		}
		requests := make([]ddbtypes.WriteRequest, 0, end-start)
		for _, t := range tasks[start:end] {
			item, err := taskItem(t)
			if err != nil {
				return err
			}
			requests = append(requests, ddbtypes.WriteRequest{
				PutRequest: &ddbtypes.PutRequest{Item: item},
			})
		}
		out, err := client.BatchWriteItem(ctx, &dynamodb.BatchWriteItemInput{
			RequestItems: map[string][]ddbtypes.WriteRequest{table: requests},
		})
		if err != nil {
			return err
		}
		// Unprocessed items are throttling, not failure. One retry pass is
		// enough at this table's write rate; anything left is reported.
		if left := out.UnprocessedItems[table]; len(left) > 0 {
			retry, err := client.BatchWriteItem(ctx, &dynamodb.BatchWriteItemInput{
				RequestItems: map[string][]ddbtypes.WriteRequest{table: left},
			})
			if err != nil {
				return err
			}
			if len(retry.UnprocessedItems[table]) > 0 {
				return fmt.Errorf("%d task rows were throttled twice", len(retry.UnprocessedItems[table]))
			}
		}
	}
	return nil
}

func unmarshalTasks(items []map[string]ddbtypes.AttributeValue) ([]Task, error) {
	tasks := make([]Task, 0, len(items))
	for _, item := range items {
		stripKeys(item)
		var t Task
		if err := attributevalue.UnmarshalMap(item, &t); err != nil {
			return nil, err
		}
		tasks = append(tasks, t)
	}
	return tasks, nil
}

// ListTasks pages a user's tasks newest first. An empty status reads the base
// table (everything); a status reads GSI1, which holds only the rows in that
// state — the difference between "waiting on me" costing one page and costing
// a scan of every task ever made.
func ListTasks(ctx context.Context, userID string, status TaskStatus, limit int32, cursor string) ([]Task, string, error) {
	limit = clampLimit(limit, 50)
	input := &dynamodb.QueryInput{
		TableName:        &table,
		ScanIndexForward: aws.Bool(false),
		Limit:            &limit,
	}
	if status == "" {
		input.KeyConditionExpression = aws.String("PK = :pk AND begins_with(SK, :sk)")
		input.ExpressionAttributeValues = map[string]ddbtypes.AttributeValue{
			":pk": s(userPK(userID)), ":sk": s("TASK#"),
		}
	} else {
		input.IndexName = aws.String("GSI1")
		input.KeyConditionExpression = aws.String("GSI1PK = :pk")
		input.ExpressionAttributeValues = map[string]ddbtypes.AttributeValue{
			":pk": s(taskStatusGSI(userID, status)),
		}
	}

	start, err := decodeCursor(cursor)
	if err != nil {
		return nil, "", err
	}
	input.ExclusiveStartKey = start

	out, err := client.Query(ctx, input)
	if err != nil {
		return nil, "", err
	}
	tasks, err := unmarshalTasks(out.Items)
	if err != nil {
		return nil, "", err
	}
	next, err := encodeCursor(out.LastEvaluatedKey)
	if err != nil {
		return nil, "", err
	}
	return tasks, next, nil
}

// GetTask finds one task by its id alone.
//
// The id is not in the sort key's leading position — createdAt is — so this is
// a Query over the user's own TASK# range with a filter, the same shape
// FindByDeviceFile uses. GSI1 cannot help: it is spent on status, which is the
// query that had to be cheap. A single user's task list is small and the
// partition is theirs, so the read stays bounded to their own rows.
func GetTask(ctx context.Context, userID, taskID string) (*Task, error) {
	out, err := client.Query(ctx, &dynamodb.QueryInput{
		TableName:              &table,
		KeyConditionExpression: aws.String("PK = :pk AND begins_with(SK, :sk)"),
		FilterExpression:       aws.String("taskId = :id"),
		ExpressionAttributeValues: map[string]ddbtypes.AttributeValue{
			":pk": s(userPK(userID)), ":sk": s("TASK#"), ":id": s(taskID),
		},
	})
	if err != nil {
		return nil, err
	}
	tasks, err := unmarshalTasks(out.Items)
	if err != nil || len(tasks) == 0 {
		return nil, err
	}
	return &tasks[0], nil
}

// taskTransitionInput builds the conditional update one status change sends.
//
// Split out so the expression, the condition and the index key can be tested
// without a DynamoDB client — there is no interface to inject a fake into, and
// what matters here is exactly what the guard says.
//
// `extra` carries the fields that only some transitions set (doneAt on done, a
// receipt id when one was printed alongside).
func taskTransitionInput(userID, sk string, from []TaskStatus, to TaskStatus, extra map[string]string) (*dynamodb.UpdateItemInput, error) {
	if len(from) == 0 {
		return nil, errors.New("a transition needs at least one state to come from")
	}
	sets := []string{"#status = :to", "GSI1PK = :gsi", "updatedAt = :now"}
	values := map[string]ddbtypes.AttributeValue{
		":to":  s(string(to)),
		":gsi": s(taskStatusGSI(userID, to)),
		":now": s(nowISO()),
	}
	names := map[string]string{"#status": "status"}
	for key, value := range extra {
		names["#"+key] = key
		values[":"+key] = s(value)
		sets = append(sets, fmt.Sprintf("#%s = :%s", key, key))
	}

	placeholders := make([]string, 0, len(from))
	for i, state := range from {
		name := fmt.Sprintf(":from%d", i)
		values[name] = s(string(state))
		placeholders = append(placeholders, name)
	}
	condition := fmt.Sprintf("attribute_exists(PK) AND #status IN (%s)", strings.Join(placeholders, ", "))

	return &dynamodb.UpdateItemInput{
		TableName:                 &table,
		Key:                       map[string]ddbtypes.AttributeValue{"PK": s(userPK(userID)), "SK": s(sk)},
		UpdateExpression:          aws.String("SET " + strings.Join(sets, ", ")),
		ExpressionAttributeNames:  names,
		ExpressionAttributeValues: values,
		ConditionExpression:       aws.String(condition),
	}, nil
}

// applyTransition mirrors onto a local copy what the update just committed, so
// a handler can answer with the new task without reading it back.
func applyTransition(t Task, to TaskStatus, extra map[string]string) Task {
	t.Status = to
	t.UpdatedAt = nowISO()
	for key, value := range extra {
		switch key {
		case "doneAt":
			t.DoneAt = value
		case "receiptId":
			t.ReceiptID = value
		case "daemonId":
			t.DaemonID = value
		case "claimedAt":
			t.ClaimedAt = value
		case "leaseUntil":
			t.LeaseUntil = value
		}
	}
	return t
}

func transitionTask(ctx context.Context, t Task, from []TaskStatus, to TaskStatus, extra map[string]string) (Task, error) {
	input, err := taskTransitionInput(t.UserID, t.SK(), from, to, extra)
	if err != nil {
		return t, err
	}
	if _, err := client.UpdateItem(ctx, input); err != nil {
		var conditionFailed *ddbtypes.ConditionalCheckFailedException
		if errors.As(err, &conditionFailed) {
			return t, ErrTaskTransition
		}
		return t, err
	}
	return applyTransition(t, to, extra), nil
}

// dismissTaskInput builds DismissTask's own conditional update. Split out,
// the same way claimWorkInput and failBlockedWorkInput are, so the guard is
// what a test pins down rather than something re-derived from DismissTask's
// own behavior.
func dismissTaskInput(t Task) (*dynamodb.UpdateItemInput, error) {
	input, err := taskTransitionInput(t.UserID, t.SK(),
		[]TaskStatus{TaskProposed, TaskApproved, TaskBlocked}, TaskDismissed, nil)
	if err != nil {
		return nil, err
	}
	// The same guardUnanswered condition FailBlockedWork's own write uses,
	// and for the identical reason (I5): a read-then-write window can
	// straddle an answer arriving in between, and answering a question never
	// moves the task's status, so a status-only condition cannot see it —
	// the write itself would still succeed, silently discarding a reply that
	// got there in time. For the two non-blocked states this costs nothing:
	// neither ever carries a question attribute, so attribute_not_exists
	// trivially holds.
	input.ExpressionAttributeNames["#question"] = "question"
	input.ExpressionAttributeNames["#answer"] = "answer"
	input.ConditionExpression = aws.String(
		aws.ToString(input.ConditionExpression) + " AND attribute_not_exists(#question.#answer)")
	return input, nil
}

// DismissTask closes a task the user is not going to do.
//
// Reachable from every open state, blocked included (I5): today a stuck
// blocked task — its daemon gone, its question never enforced — has no
// human override anywhere, in the app or the API. It is never reachable
// from a finished one, since dismissing a done or failed task would erase
// its receipt's reason for existing.
func DismissTask(ctx context.Context, t Task) (Task, error) {
	input, err := dismissTaskInput(t)
	if err != nil {
		return t, err
	}
	if _, err := client.UpdateItem(ctx, input); err != nil {
		var conditionFailed *ddbtypes.ConditionalCheckFailedException
		if errors.As(err, &conditionFailed) {
			return t, ErrTaskTransition
		}
		return t, err
	}
	return applyTransition(t, TaskDismissed, nil), nil
}

// ApproveTask hands a task to execution. The tier check belongs to the
// handler; this is only the write.
func ApproveTask(ctx context.Context, t Task) (Task, error) {
	return transitionTask(ctx, t, []TaskStatus{TaskProposed}, TaskApproved, nil)
}

// EditTask changes what a task says and when it is due. Text and due date are
// the user's to edit in any open state, so the only condition is that the row
// still exists.
func EditTask(ctx context.Context, t Task, text, dueAt *string) (Task, error) {
	sets := []string{"updatedAt = :now"}
	values := map[string]ddbtypes.AttributeValue{":now": s(nowISO())}
	names := map[string]string{}
	if text != nil {
		names["#text"] = "text"
		values[":text"] = s(*text)
		sets = append(sets, "#text = :text")
		t.Text = *text
	}
	if dueAt != nil {
		names["#dueAt"] = "dueAt"
		values[":dueAt"] = s(*dueAt)
		sets = append(sets, "#dueAt = :dueAt")
		t.DueAt = *dueAt
	}
	_, err := client.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName:                 &table,
		Key:                       map[string]ddbtypes.AttributeValue{"PK": s(userPK(t.UserID)), "SK": s(t.SK())},
		UpdateExpression:          aws.String("SET " + strings.Join(sets, ", ")),
		ExpressionAttributeNames:  orNil(names),
		ExpressionAttributeValues: values,
		ConditionExpression:       aws.String("attribute_exists(PK)"),
	})
	if err != nil {
		var conditionFailed *ddbtypes.ConditionalCheckFailedException
		if errors.As(err, &conditionFailed) {
			return t, ErrTaskTransition
		}
		return t, err
	}
	t.UpdatedAt = nowISO()
	return t, nil
}

// CompleteTask marks a task done and prints its receipt in one
// TransactWriteItems.
//
// One write, not two, because the receipt is the product's proof that the task
// was closed: a done task with no receipt is a claim with nothing behind it,
// and a receipt for a task that is still open is worse. The transaction makes
// both true or neither, and the condition inside it keeps the second phone's
// tap from printing a second receipt for the same promise.
func CompleteTask(ctx context.Context, t Task, r Receipt) (Task, Receipt, error) {
	extra := map[string]string{"doneAt": r.CreatedAt, "receiptId": r.ReceiptID}
	update, err := taskTransitionInput(t.UserID, t.SK(), []TaskStatus{TaskProposed, TaskApproved}, TaskDone, extra)
	if err != nil {
		return t, r, err
	}
	item, err := receiptItem(t.UserID, r)
	if err != nil {
		return t, r, err
	}

	_, err = client.TransactWriteItems(ctx, &dynamodb.TransactWriteItemsInput{
		TransactItems: []ddbtypes.TransactWriteItem{
			{Update: &ddbtypes.Update{
				TableName:                 update.TableName,
				Key:                       update.Key,
				UpdateExpression:          update.UpdateExpression,
				ExpressionAttributeNames:  update.ExpressionAttributeNames,
				ExpressionAttributeValues: update.ExpressionAttributeValues,
				ConditionExpression:       update.ConditionExpression,
			}},
			{Put: &ddbtypes.Put{TableName: &table, Item: item}},
		},
	})
	if err != nil {
		var canceled *ddbtypes.TransactionCanceledException
		if errors.As(err, &canceled) {
			for _, reason := range canceled.CancellationReasons {
				if aws.ToString(reason.Code) == "ConditionalCheckFailed" {
					return t, r, ErrTaskTransition
				}
			}
		}
		return t, r, err
	}
	return applyTransition(t, TaskDone, extra), r, nil
}

// blockTaskInput is the conditional update that parks a task on a question.
// Pure, so the guard and the embedded question can be read in a test without
// a table.
func blockTaskInput(t Task, q TaskQuestion, now string) (*dynamodb.UpdateItemInput, error) {
	qItem, err := attributevalue.MarshalMap(q)
	if err != nil {
		return nil, err
	}
	return &dynamodb.UpdateItemInput{
		TableName: &table,
		Key:       map[string]ddbtypes.AttributeValue{"PK": s(userPK(t.UserID)), "SK": s(t.SK())},
		UpdateExpression: aws.String(
			"SET #status = :to, GSI1PK = :gsi, updatedAt = :now, #question = :q"),
		ExpressionAttributeNames: map[string]string{"#status": "status", "#question": "question"},
		ExpressionAttributeValues: map[string]ddbtypes.AttributeValue{
			":to":   s(string(TaskBlocked)),
			":gsi":  s(taskStatusGSI(t.UserID, TaskBlocked)),
			":now":  s(now),
			":q":    &ddbtypes.AttributeValueMemberM{Value: qItem},
			":from": s(string(TaskExecuting)),
		},
		ConditionExpression: aws.String("attribute_exists(PK) AND #status = :from"),
	}, nil
}

// BlockTask parks a claimed task on a question. Conditional on it still being
// executing — the same daemon that is asking is the only one that could hold
// it there, so a task somebody else already closed cannot be blocked instead.
func BlockTask(ctx context.Context, t Task, q TaskQuestion) (Task, error) {
	now := nowISO()
	input, err := blockTaskInput(t, q, now)
	if err != nil {
		return t, err
	}
	if _, err := client.UpdateItem(ctx, input); err != nil {
		var refused *ddbtypes.ConditionalCheckFailedException
		if errors.As(err, &refused) {
			return t, ErrTaskTransition
		}
		return t, err
	}
	t.Status, t.UpdatedAt, t.Question = TaskBlocked, now, &q
	return t, nil
}

// answerQuestionInput writes an answer onto an open question. It does not
// move the task's status — blocked stays blocked until the daemon it is
// pinned to resumes it — so this is the one write in this file that changes
// no partition.
func answerQuestionInput(t Task, answer, answeredBy, now string) *dynamodb.UpdateItemInput {
	return &dynamodb.UpdateItemInput{
		TableName: &table,
		Key:       map[string]ddbtypes.AttributeValue{"PK": s(userPK(t.UserID)), "SK": s(t.SK())},
		UpdateExpression: aws.String(
			"SET #question.#answer = :answer, #question.#answeredAt = :now, " +
				"#question.#answeredBy = :by, updatedAt = :now"),
		ExpressionAttributeNames: map[string]string{
			"#question": "question", "#answer": "answer",
			"#answeredAt": "answeredAt", "#answeredBy": "answeredBy",
			"#status": "status",
		},
		ExpressionAttributeValues: map[string]ddbtypes.AttributeValue{
			":answer": s(answer), ":now": s(now), ":by": s(answeredBy),
			":status": s(string(TaskBlocked)),
		},
		// Both guards matter: the task must still be blocked, and nobody may
		// have answered already — the first reply stands, whichever surface
		// it came from.
		ConditionExpression: aws.String(
			"attribute_exists(PK) AND #status = :status AND attribute_not_exists(#question.#answer)"),
	}
}

// AnswerQuestion writes a reply onto an open question. Whoever asked resumes
// on their own poll; this call never changes the task's status.
func AnswerQuestion(ctx context.Context, t Task, answer, answeredBy string) (Task, error) {
	if t.Question == nil {
		return t, ErrTaskTransition
	}
	now := nowISO()
	input := answerQuestionInput(t, answer, answeredBy, now)
	if _, err := client.UpdateItem(ctx, input); err != nil {
		var refused *ddbtypes.ConditionalCheckFailedException
		if errors.As(err, &refused) {
			return t, ErrTaskTransition
		}
		return t, err
	}
	t.UpdatedAt = now
	q := *t.Question
	q.Answer, q.AnsweredAt, q.AnsweredBy = answer, now, answeredBy
	t.Question = &q
	return t, nil
}
