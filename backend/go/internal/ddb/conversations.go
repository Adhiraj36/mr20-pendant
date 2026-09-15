// Conversations: the metadata GitLoom has nowhere to put.
//
//	Conversation  PK USER#<sub>  SK CONV#<updatedAt>#<id>
//
// GitLoom stores the turns, the branches and the title, and that part works.
// What it has no field for is everything else a chat list needs: whether a
// thread was spoken or typed, whether it is pinned or archived, and how many
// exchanges have gone by since it was last compacted. Until now the first of
// those was smuggled into the id as a "voice-" prefix — a string convention
// doing a schema's job — and the list came back capped at a hundred with no
// cursor.
//
// The exchange counter is the load-bearing one. gitloom-go decides to compact
// from per-process fields, and this API is a Lambda: a cold container starts
// at zero exchanges, so "compact every five" fires only if one warm container
// happens to serve five turns of the same chat. Counting here instead makes
// the cadence survive the freeze.
//
// updatedAt leads the sort key so the list comes back in the order a chat list
// wants without a sort, which means a touched conversation moves: the write
// below deletes the old key and puts the new one in one transaction.
package ddb

import (
	"context"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	ddbtypes "github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// ConversationKind separates a typed thread from a spoken one.
type ConversationKind string

const (
	ConversationText  ConversationKind = "text"
	ConversationVoice ConversationKind = "voice"
)

// CoerceConversationKind defaults anything unrecognised to text — the app
// sends this field, and a stale client must not invent a third kind.
func CoerceConversationKind(v string) ConversationKind {
	if ConversationKind(v) == ConversationVoice {
		return ConversationVoice
	}
	return ConversationText
}

// CompactEveryExchanges is how many exchanges pass before the window is
// compacted. Each compaction costs one chat on GitLoom's meter, so this is a
// price as much as a cadence.
const CompactEveryExchanges = 5

// Conversation is one chat thread's row.
type Conversation struct {
	ID    string           `dynamodbav:"id" json:"id"`
	Kind  ConversationKind `dynamodbav:"kind" json:"kind"`
	Title string           `dynamodbav:"title,omitempty" json:"title,omitempty"`
	// Pinned and Archived are the app's, not GitLoom's.
	Pinned   bool `dynamodbav:"pinned,omitempty" json:"pinned"`
	Archived bool `dynamodbav:"archived,omitempty" json:"archived"`
	// Exchanges since the last compaction. See the package comment.
	Exchanges int    `dynamodbav:"exchanges,omitempty" json:"exchanges"`
	CreatedAt string `dynamodbav:"createdAt" json:"createdAt"`
	UpdatedAt string `dynamodbav:"updatedAt" json:"updatedAt"`
}

func convSK(updatedAt, id string) string { return "CONV#" + updatedAt + "#" + id }

// SK is the row's sort key, which moves whenever the conversation is touched.
func (c Conversation) SK() string { return convSK(c.UpdatedAt, c.ID) }

func conversationItem(userID string, c Conversation) (map[string]ddbtypes.AttributeValue, error) {
	item, err := attributevalue.MarshalMap(c)
	if err != nil {
		return nil, err
	}
	item["PK"] = s(userPK(userID))
	item["SK"] = s(c.SK())
	return item, nil
}

func unmarshalConversations(items []map[string]ddbtypes.AttributeValue) ([]Conversation, error) {
	convs := make([]Conversation, 0, len(items))
	for _, item := range items {
		stripKeys(item)
		var c Conversation
		if err := attributevalue.UnmarshalMap(item, &c); err != nil {
			return nil, err
		}
		convs = append(convs, c)
	}
	return convs, nil
}

// GetConversation finds one row by the app's conversation id.
func GetConversation(ctx context.Context, userID, id string) (*Conversation, error) {
	out, err := client.Query(ctx, &dynamodb.QueryInput{
		TableName:              &table,
		KeyConditionExpression: aws.String("PK = :pk AND begins_with(SK, :sk)"),
		FilterExpression:       aws.String("id = :id"),
		ExpressionAttributeValues: map[string]ddbtypes.AttributeValue{
			":pk": s(userPK(userID)), ":sk": s("CONV#"), ":id": s(id),
		},
	})
	if err != nil {
		return nil, err
	}
	convs, err := unmarshalConversations(out.Items)
	if err != nil || len(convs) == 0 {
		return nil, err
	}
	return &convs[0], nil
}

// PutConversation writes a row at its current key, replacing the row at the
// old key when the timestamp moved. Delete-and-put in one transaction, because
// a half-applied move is either two rows for one chat or none.
func PutConversation(ctx context.Context, userID string, c Conversation, previousSK string) error {
	item, err := conversationItem(userID, c)
	if err != nil {
		return err
	}
	if previousSK == "" || previousSK == c.SK() {
		_, err = client.PutItem(ctx, &dynamodb.PutItemInput{TableName: &table, Item: item})
		return err
	}
	_, err = client.TransactWriteItems(ctx, &dynamodb.TransactWriteItemsInput{
		TransactItems: []ddbtypes.TransactWriteItem{
			{Delete: &ddbtypes.Delete{
				TableName: &table,
				Key:       map[string]ddbtypes.AttributeValue{"PK": s(userPK(userID)), "SK": s(previousSK)},
			}},
			{Put: &ddbtypes.Put{TableName: &table, Item: item}},
		},
	})
	return err
}

// TouchConversation records that one more exchange happened: it creates the
// row on the first turn, moves it to the front of the list on every turn, and
// returns the row so the caller can read the counter it just bumped.
//
// A title is only written when one is offered — GitLoom names conversations
// itself, and an empty title here must not blank the name it chose.
func TouchConversation(ctx context.Context, userID, id string, kind ConversationKind, title string) (Conversation, error) {
	existing, err := GetConversation(ctx, userID, id)
	if err != nil {
		return Conversation{}, err
	}

	now := nowISO()
	conv := Conversation{ID: id, Kind: kind, CreatedAt: now}
	previousSK := ""
	if existing != nil {
		conv = *existing
		previousSK = existing.SK()
		if kind != "" {
			conv.Kind = kind
		}
	}
	if title != "" {
		conv.Title = title
	}
	if conv.Kind == "" {
		conv.Kind = ConversationText
	}
	conv.Exchanges++
	conv.UpdatedAt = now

	if err := PutConversation(ctx, userID, conv, previousSK); err != nil {
		return Conversation{}, err
	}
	return conv, nil
}

// ResetConversationExchanges zeroes the counter after a compaction. The sort
// key does not move, so this is a plain narrow update.
func ResetConversationExchanges(ctx context.Context, userID string, c Conversation) error {
	_, err := client.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName:                 &table,
		Key:                       map[string]ddbtypes.AttributeValue{"PK": s(userPK(userID)), "SK": s(c.SK())},
		UpdateExpression:          aws.String("SET exchanges = :zero"),
		ExpressionAttributeValues: map[string]ddbtypes.AttributeValue{":zero": &ddbtypes.AttributeValueMemberN{Value: "0"}},
		ConditionExpression:       aws.String("attribute_exists(PK)"),
	})
	return err
}

// DueForCompaction is the cadence rule, on its own so it can be read and
// tested rather than inferred from a modulus buried in a handler.
func DueForCompaction(exchanges int) bool {
	return exchanges > 0 && exchanges%CompactEveryExchanges == 0
}

// ListConversations pages a user's threads, most recently used first.
func ListConversations(ctx context.Context, userID string, limit int32, cursor string) ([]Conversation, string, error) {
	limit = clampLimit(limit, 50)
	start, err := decodeCursor(cursor)
	if err != nil {
		return nil, "", err
	}
	out, err := client.Query(ctx, &dynamodb.QueryInput{
		TableName:              &table,
		KeyConditionExpression: aws.String("PK = :pk AND begins_with(SK, :sk)"),
		ExpressionAttributeValues: map[string]ddbtypes.AttributeValue{
			":pk": s(userPK(userID)), ":sk": s("CONV#"),
		},
		ScanIndexForward:  aws.Bool(false),
		Limit:             &limit,
		ExclusiveStartKey: start,
	})
	if err != nil {
		return nil, "", err
	}
	convs, err := unmarshalConversations(out.Items)
	if err != nil {
		return nil, "", err
	}
	next, err := encodeCursor(out.LastEvaluatedKey)
	if err != nil {
		return nil, "", err
	}
	return convs, next, nil
}

// DeleteConversationRow removes the metadata when the chat itself is deleted.
func DeleteConversationRow(ctx context.Context, userID string, c Conversation) error {
	_, err := client.DeleteItem(ctx, &dynamodb.DeleteItemInput{
		TableName: &table,
		Key:       map[string]ddbtypes.AttributeValue{"PK": s(userPK(userID)), "SK": s(c.SK())},
	})
	return err
}
