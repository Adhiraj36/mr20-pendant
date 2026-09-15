package ddb

import (
	"context"
	"errors"
	"testing"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	ddbtypes "github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// The claim SetFactsMemoryStatusIfUnset makes: only the first writer of
// factsMemoryStatus on a row gets to send that recording's facts to GitLoom.
func TestSetFactsMemoryStatusIfUnsetGuardsOnTheAttributeBeingAbsent(t *testing.T) {
	in, err := updateRecordingInput("user_1", "2026-09-08T10:00:00Z", "rec_1",
		map[string]any{"factsMemoryStatus": "ingested"}, "attribute_not_exists(factsMemoryStatus)")
	if err != nil {
		t.Fatal(err)
	}
	condition := aws.ToString(in.ConditionExpression)
	if condition != "attribute_not_exists(factsMemoryStatus)" {
		t.Fatalf("condition = %q", condition)
	}
	if got := str(t, in.ExpressionAttributeValues[":factsMemoryStatus"], ":factsMemoryStatus"); got != "ingested" {
		t.Fatalf(":factsMemoryStatus = %q", got)
	}
}

// A plain UpdateRecording carries no condition at all: PATCH /recordings and
// every other caller of it has always been allowed to overwrite freely.
func TestUpdateRecordingCarriesNoCondition(t *testing.T) {
	in, err := updateRecordingInput("user_1", "2026-09-08T10:00:00Z", "rec_1",
		map[string]any{"title": "Dinner with Priya"}, "")
	if err != nil {
		t.Fatal(err)
	}
	if in.ConditionExpression != nil {
		t.Fatalf("condition = %q, want none", aws.ToString(in.ConditionExpression))
	}
}

// The two outcomes SetFactsMemoryStatusIfUnset's caller actually branches on:
// a clean win, and a lost race that must read as "someone else has it", not
// as a failure worth retrying or logging as an error.
func TestSetFactsMemoryStatusIfUnsetWinAndLose(t *testing.T) {
	withFakeClient(t, fakeDDBClient{
		updateItem: func(_ context.Context, _ *dynamodb.UpdateItemInput, _ ...func(*dynamodb.Options)) (*dynamodb.UpdateItemOutput, error) {
			return &dynamodb.UpdateItemOutput{}, nil
		},
	})
	ok, err := SetFactsMemoryStatusIfUnset(context.Background(), "user_1", "2026-09-08T10:00:00Z", "rec_1",
		map[string]any{"factsMemoryStatus": "ingested"})
	if err != nil {
		t.Fatal(err)
	}
	if !ok {
		t.Fatal("the only writer of an absent attribute must win")
	}

	withFakeClient(t, fakeDDBClient{
		updateItem: func(_ context.Context, _ *dynamodb.UpdateItemInput, _ ...func(*dynamodb.Options)) (*dynamodb.UpdateItemOutput, error) {
			return nil, &ddbtypes.ConditionalCheckFailedException{}
		},
	})
	ok, err = SetFactsMemoryStatusIfUnset(context.Background(), "user_1", "2026-09-08T10:00:00Z", "rec_1",
		map[string]any{"factsMemoryStatus": "ingested"})
	if err != nil {
		t.Fatalf("a lost race is not an error: %v", err)
	}
	if ok {
		t.Fatal("a conditional check failure means somebody else already set it first")
	}

	withFakeClient(t, fakeDDBClient{
		updateItem: func(_ context.Context, _ *dynamodb.UpdateItemInput, _ ...func(*dynamodb.Options)) (*dynamodb.UpdateItemOutput, error) {
			return nil, errors.New("dynamodb is having a day")
		},
	})
	if _, err := SetFactsMemoryStatusIfUnset(context.Background(), "user_1", "2026-09-08T10:00:00Z", "rec_1",
		map[string]any{"factsMemoryStatus": "ingested"}); err == nil {
		t.Fatal("a genuine DynamoDB error must not be swallowed as a lost race")
	}
}
