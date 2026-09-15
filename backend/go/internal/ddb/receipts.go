// Receipts: the app's proof that something happened.
//
//	Receipt  PK USER#<sub>  SK RECEIPT#<createdAt>#<receiptId>
//
// A receipt is written, never edited — it is a record of a moment, and a
// record that can be changed afterwards proves nothing. There is no update
// path here on purpose, and the roll is read newest first because that is the
// order a receipt roll comes off the printer.
package ddb

import (
	"context"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	ddbtypes "github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// ReceiptKind says what was proved.
type ReceiptKind string

const (
	ReceiptTask         ReceiptKind = "task"         // a commitment was kept
	ReceiptPairing      ReceiptKind = "pairing"      // a pendant was paired
	ReceiptPlan         ReceiptKind = "plan"         // a plan was paid for
	ReceiptConversation ReceiptKind = "conversation" // a conversation was filed
)

// ReceiptStamp is the mark across the paper.
type ReceiptStamp string

const (
	StampDone     ReceiptStamp = "DONE"
	StampReady    ReceiptStamp = "READY"
	StampUnlocked ReceiptStamp = "UNLOCKED"
	StampFiled    ReceiptStamp = "FILED"
	// StampFailed is the one stamp nobody wants and the product needs: a run
	// that did not work still prints, because the proof a receipt offers is
	// only worth anything if it is also printed when the answer is no.
	StampFailed ReceiptStamp = "FAILED"
)

// ReceiptRow is one dotted-leader line: a label, its value, and — when the
// line is a verdict rather than a detail — whether it went well. OK is a
// pointer so a plain detail line carries no verdict at all, rather than
// carrying "false".
type ReceiptRow struct {
	K  string `dynamodbav:"k" json:"k"`
	V  string `dynamodbav:"v" json:"v"`
	OK *bool  `dynamodbav:"ok,omitempty" json:"ok,omitempty"`
}

// Receipt is one printed proof.
type Receipt struct {
	ReceiptID   string       `dynamodbav:"receiptId" json:"receiptId"`
	UserID      string       `dynamodbav:"userId" json:"userId"`
	Kind        ReceiptKind  `dynamodbav:"kind" json:"kind"`
	TaskID      string       `dynamodbav:"taskId,omitempty" json:"taskId,omitempty"`
	RecordingID string       `dynamodbav:"recordingId,omitempty" json:"recordingId,omitempty"`
	Title       string       `dynamodbav:"title" json:"title"`
	Quote       string       `dynamodbav:"quote,omitempty" json:"quote,omitempty"`
	Rows        []ReceiptRow `dynamodbav:"rows,omitempty" json:"rows"`
	Stamp       ReceiptStamp `dynamodbav:"stamp" json:"stamp"`
	CreatedAt   string       `dynamodbav:"createdAt" json:"createdAt"`
}

func receiptSK(createdAt, receiptID string) string {
	return "RECEIPT#" + createdAt + "#" + receiptID
}

func receiptItem(userID string, r Receipt) (map[string]ddbtypes.AttributeValue, error) {
	r.UserID = userID
	item, err := attributevalue.MarshalMap(r)
	if err != nil {
		return nil, err
	}
	item["PK"] = s(userPK(userID))
	item["SK"] = s(receiptSK(r.CreatedAt, r.ReceiptID))
	return item, nil
}

// PutReceipt prints one.
func PutReceipt(ctx context.Context, userID string, r Receipt) error {
	item, err := receiptItem(userID, r)
	if err != nil {
		return err
	}
	_, err = client.PutItem(ctx, &dynamodb.PutItemInput{TableName: &table, Item: item})
	return err
}

func unmarshalReceipts(items []map[string]ddbtypes.AttributeValue) ([]Receipt, error) {
	receipts := make([]Receipt, 0, len(items))
	for _, item := range items {
		stripKeys(item)
		var r Receipt
		if err := attributevalue.UnmarshalMap(item, &r); err != nil {
			return nil, err
		}
		receipts = append(receipts, r)
	}
	return receipts, nil
}

// ListReceipts pages the roll, newest first.
func ListReceipts(ctx context.Context, userID string, limit int32, cursor string) ([]Receipt, string, error) {
	limit = clampLimit(limit, 50)
	start, err := decodeCursor(cursor)
	if err != nil {
		return nil, "", err
	}
	out, err := client.Query(ctx, &dynamodb.QueryInput{
		TableName:              &table,
		KeyConditionExpression: aws.String("PK = :pk AND begins_with(SK, :sk)"),
		ExpressionAttributeValues: map[string]ddbtypes.AttributeValue{
			":pk": s(userPK(userID)), ":sk": s("RECEIPT#"),
		},
		ScanIndexForward:  aws.Bool(false),
		Limit:             &limit,
		ExclusiveStartKey: start,
	})
	if err != nil {
		return nil, "", err
	}
	receipts, err := unmarshalReceipts(out.Items)
	if err != nil {
		return nil, "", err
	}
	next, err := encodeCursor(out.LastEvaluatedKey)
	if err != nil {
		return nil, "", err
	}
	return receipts, next, nil
}

// GetReceipt finds one by id — a Query over the user's own RECEIPT# range
// with a filter, for the same reason GetTask is one: createdAt leads the sort
// key, and the id alone is what a deep link carries.
func GetReceipt(ctx context.Context, userID, receiptID string) (*Receipt, error) {
	out, err := client.Query(ctx, &dynamodb.QueryInput{
		TableName:              &table,
		KeyConditionExpression: aws.String("PK = :pk AND begins_with(SK, :sk)"),
		FilterExpression:       aws.String("receiptId = :id"),
		ExpressionAttributeValues: map[string]ddbtypes.AttributeValue{
			":pk": s(userPK(userID)), ":sk": s("RECEIPT#"), ":id": s(receiptID),
		},
	})
	if err != nil {
		return nil, err
	}
	receipts, err := unmarshalReceipts(out.Items)
	if err != nil || len(receipts) == 0 {
		return nil, err
	}
	return &receipts[0], nil
}

// CleanRows drops lines with nothing on them — the design's rule that empty
// fragments are dropped rather than printed blank — and trims what is left to
// what a receipt line can hold.
func CleanRows(rows []ReceiptRow) []ReceiptRow {
	out := make([]ReceiptRow, 0, len(rows))
	for _, row := range rows {
		row.K = strings.TrimSpace(row.K)
		row.V = strings.TrimSpace(row.V)
		if row.K == "" || row.V == "" {
			continue
		}
		if len(row.K) > 40 {
			row.K = row.K[:40]
		}
		if len(row.V) > 160 {
			row.V = row.V[:160]
		}
		out = append(out, row)
		if len(out) >= maxReceiptRows {
			break
		}
	}
	return out
}

// maxReceiptRows is what fits on a receipt before it stops being one.
const maxReceiptRows = 12

// ReceiptFromTask is the receipt a kept commitment prints.
//
// Pure, and separate from the write, so what a task turns into is a thing that
// can be read and tested rather than a shape assembled inside a handler. The
// id and the timestamp come from the caller because the same values go into
// the task's own row in the same transaction.
func ReceiptFromTask(t Task, receiptID, createdAt string) Receipt {
	ok := true
	return Receipt{
		ReceiptID:   receiptID,
		UserID:      t.UserID,
		Kind:        ReceiptTask,
		TaskID:      t.TaskID,
		RecordingID: t.RecordingID,
		Title:       t.Text,
		Quote:       t.Quote,
		Stamp:       StampDone,
		CreatedAt:   createdAt,
		Rows: CleanRows([]ReceiptRow{
			{K: "KIND", V: strings.ToUpper(string(t.Kind))},
			{K: "PROMISED", V: t.CreatedAt},
			{K: "DUE", V: t.DueAt},
			{K: "MARKED DONE", V: createdAt},
			{K: "STATUS", V: "DONE", OK: &ok},
		}),
	}
}
