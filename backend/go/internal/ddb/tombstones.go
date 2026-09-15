// Tombstones: what the app can do about a memory it cannot delete.
//
//	Tombstone  PK USER#<sub>  SK TOMBSTONE#<recordingId>
//
// GitLoom has no delete endpoint for a memory — not by id, not by session, not
// by namespace; erasure today is an email to their support address. So
// deleting a recording used to remove the audio, the transcript and the row
// while everything extracted from it stayed in the user's namespace forever,
// still answering retrieval.
//
// A tombstone is the honest half-measure: the row that says "this
// conversation was deleted", written before the recording goes, and consulted
// by every retrieval we serve so hits that trace back to it are dropped before
// the user sees them. It is suppression, not erasure — the memory is still
// there, and a GitLoom-side answer or a support request is what actually
// removes it. Marked [GL_ERASE] in the plan and best-effort by construction:
// provenance names a commit, not a session id, so matching is on the
// recording id appearing in the memory's path, message or snippet.
package ddb

import (
	"context"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	ddbtypes "github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// Tombstone marks one deleted conversation.
type Tombstone struct {
	RecordingID string `dynamodbav:"recordingId" json:"recordingId"`
	// Title as it stood, so a future erasure request can name what it is
	// asking about without the row it described.
	Title string `dynamodbav:"title,omitempty" json:"title,omitempty"`
	// StartedAt is the conversation's own date, which is also the date the
	// memories were filed under.
	StartedAt string `dynamodbav:"startedAt,omitempty" json:"startedAt,omitempty"`
	Reason    string `dynamodbav:"reason,omitempty" json:"reason,omitempty"`
	CreatedAt string `dynamodbav:"createdAt" json:"createdAt"`
}

func tombstoneSK(recordingID string) string { return "TOMBSTONE#" + recordingID }

// PutTombstone records a deletion. Idempotent: deleting the same recording
// twice writes the same row.
func PutTombstone(ctx context.Context, userID string, t Tombstone) error {
	if t.CreatedAt == "" {
		t.CreatedAt = nowISO()
	}
	item, err := attributevalue.MarshalMap(t)
	if err != nil {
		return err
	}
	item["PK"] = s(userPK(userID))
	item["SK"] = s(tombstoneSK(t.RecordingID))
	_, err = client.PutItem(ctx, &dynamodb.PutItemInput{TableName: &table, Item: item})
	return err
}

// ListTombstones returns every deletion this user has asked for.
func ListTombstones(ctx context.Context, userID string) ([]Tombstone, error) {
	out, err := client.Query(ctx, &dynamodb.QueryInput{
		TableName:              &table,
		KeyConditionExpression: aws.String("PK = :pk AND begins_with(SK, :sk)"),
		ExpressionAttributeValues: map[string]ddbtypes.AttributeValue{
			":pk": s(userPK(userID)), ":sk": s("TOMBSTONE#"),
		},
	})
	if err != nil {
		return nil, err
	}
	stones := make([]Tombstone, 0, len(out.Items))
	for _, item := range out.Items {
		stripKeys(item)
		var t Tombstone
		if err := attributevalue.UnmarshalMap(item, &t); err != nil {
			return nil, err
		}
		stones = append(stones, t)
	}
	return stones, nil
}

// TombstonedIDs is the set a retrieval filters against.
func TombstonedIDs(ctx context.Context, userID string) (map[string]bool, error) {
	stones, err := ListTombstones(ctx, userID)
	if err != nil {
		return nil, err
	}
	ids := make(map[string]bool, len(stones))
	for _, t := range stones {
		if t.RecordingID != "" {
			ids[t.RecordingID] = true
		}
	}
	return ids, nil
}
