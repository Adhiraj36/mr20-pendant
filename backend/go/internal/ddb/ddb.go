// Package ddb is the DynamoDB access layer.
//
// Single table, on-demand billing. Keys:
//
//	Device     PK USER#<sub>   SK DEVICE#<mac>
//	Recording  PK USER#<sub>   SK REC#<startedAt>#<recordingId>
//	                           GSI1PK REC#<recordingId>   (processor lookup)
//	Prefs      PK USER#<sub>   SK PREFS
//	Order      PK USER#<sub>   SK ORDER#<reference>   GSI1PK RZP#<rzp id>  GSI1SK ORDER
//	Plan       PK USER#<sub>   SK PLAN
//
// The recording sort key leads with startedAt so a Query returns a user's
// recordings in chronological order without a sort step. The processor only
// knows the recording id (it comes out of the S3 key), hence GSI1.
//
// Attribute names match what the TS backend wrote, so the port reads every
// existing row unchanged.
package ddb

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	ddbtypes "github.com/aws/aws-sdk-go-v2/service/dynamodb/types"

	"github.com/MelloB1989/mr20-pendant/backend/internal/types"
)

// ddbClient is the handful of DynamoDB operations this package calls.
//
// A narrow interface rather than *dynamodb.Client itself, so a test can stand
// in a fake that inspects the exact request a function sent — the difference
// between testing what FailBlockedWork actually does and testing what a test
// author assumed it does. *dynamodb.Client satisfies this with no wrapper.
type ddbClient interface {
	PutItem(ctx context.Context, params *dynamodb.PutItemInput, optFns ...func(*dynamodb.Options)) (*dynamodb.PutItemOutput, error)
	GetItem(ctx context.Context, params *dynamodb.GetItemInput, optFns ...func(*dynamodb.Options)) (*dynamodb.GetItemOutput, error)
	Query(ctx context.Context, params *dynamodb.QueryInput, optFns ...func(*dynamodb.Options)) (*dynamodb.QueryOutput, error)
	UpdateItem(ctx context.Context, params *dynamodb.UpdateItemInput, optFns ...func(*dynamodb.Options)) (*dynamodb.UpdateItemOutput, error)
	DeleteItem(ctx context.Context, params *dynamodb.DeleteItemInput, optFns ...func(*dynamodb.Options)) (*dynamodb.DeleteItemOutput, error)
	BatchWriteItem(ctx context.Context, params *dynamodb.BatchWriteItemInput, optFns ...func(*dynamodb.Options)) (*dynamodb.BatchWriteItemOutput, error)
	TransactWriteItems(ctx context.Context, params *dynamodb.TransactWriteItemsInput, optFns ...func(*dynamodb.Options)) (*dynamodb.TransactWriteItemsOutput, error)
}

var (
	client ddbClient
	table  string
)

// Init dials the client once per container. Called from every main().
func Init(ctx context.Context) error {
	if client != nil {
		return nil
	}
	cfg, err := awsconfig.LoadDefaultConfig(ctx)
	if err != nil {
		return fmt.Errorf("aws config: %w", err)
	}
	client = dynamodb.NewFromConfig(cfg)
	table = os.Getenv("TABLE_NAME")
	if table == "" {
		return errors.New("TABLE_NAME is not set")
	}
	return nil
}

// Client and Table expose the shared connection for sibling packages
// that own their key shapes but should not dial twice.
func Client() ddbClient { return client }
func Table() string     { return table }

func userPK(userID string) string { return "USER#" + userID }
func recSK(startedAt, recordingID string) string {
	return "REC#" + startedAt + "#" + recordingID
}
func devSK(mac string) string    { return "DEVICE#" + strings.ToLower(mac) }
func pushSK(token string) string { return "PUSH#" + token }

// stripKeys removes the internal key attributes before an item leaves this package.
func stripKeys(item map[string]ddbtypes.AttributeValue) {
	delete(item, "PK")
	delete(item, "SK")
	delete(item, "GSI1PK")
	delete(item, "GSI1SK")
	delete(item, "searchBlob") // legacy field from the removed search feature
}

func nowISO() string { return time.Now().UTC().Format(time.RFC3339) }

func s(v string) ddbtypes.AttributeValue { return &ddbtypes.AttributeValueMemberS{Value: v} }

// -- pagination --------------------------------------------------------------
//
// A cursor is the LastEvaluatedKey, base64url-encoded. Every key attribute in
// this table is a string, so the encoding is a flat map of strings and a
// tampered cursor can only ever address a key, never a value — it is opaque to
// the client but not a capability.

func encodeCursor(key map[string]ddbtypes.AttributeValue) (string, error) {
	if len(key) == 0 {
		return "", nil
	}
	plain := map[string]string{}
	for k, v := range key {
		if sv, ok := v.(*ddbtypes.AttributeValueMemberS); ok {
			plain[k] = sv.Value
		}
	}
	raw, err := json.Marshal(plain)
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}

func decodeCursor(cursor string) (map[string]ddbtypes.AttributeValue, error) {
	if cursor == "" {
		return nil, nil
	}
	raw, err := base64.RawURLEncoding.DecodeString(cursor)
	if err != nil {
		return nil, fmt.Errorf("bad cursor: %w", err)
	}
	var plain map[string]string
	if err := json.Unmarshal(raw, &plain); err != nil {
		return nil, fmt.Errorf("bad cursor: %w", err)
	}
	start := map[string]ddbtypes.AttributeValue{}
	for k, v := range plain {
		start[k] = s(v)
	}
	return start, nil
}

// clampLimit keeps a client-supplied page size inside what a single Query
// should ever return.
func clampLimit(limit int32, fallback int32) int32 {
	if limit <= 0 {
		return fallback
	}
	if limit > 100 {
		return 100
	}
	return limit
}

// -- devices -----------------------------------------------------------------

func PutDevice(ctx context.Context, d types.Device) error {
	item, err := attributevalue.MarshalMap(d)
	if err != nil {
		return err
	}
	item["PK"] = s(userPK(d.UserID))
	item["SK"] = s(devSK(d.Mac))
	_, err = client.PutItem(ctx, &dynamodb.PutItemInput{TableName: &table, Item: item})
	return err
}

func ListDevices(ctx context.Context, userID string) ([]types.Device, error) {
	out, err := client.Query(ctx, &dynamodb.QueryInput{
		TableName:              &table,
		KeyConditionExpression: aws.String("PK = :pk AND begins_with(SK, :sk)"),
		ExpressionAttributeValues: map[string]ddbtypes.AttributeValue{
			":pk": s(userPK(userID)), ":sk": s("DEVICE#"),
		},
	})
	if err != nil {
		return nil, err
	}
	devices := make([]types.Device, 0, len(out.Items))
	for _, item := range out.Items {
		stripKeys(item)
		var d types.Device
		if err := attributevalue.UnmarshalMap(item, &d); err != nil {
			return nil, err
		}
		devices = append(devices, d)
	}
	return devices, nil
}

// PutPushToken records (or refreshes) one installation's push token.
//
// A plain put, so re-registering the same token on every launch is free and
// keeps RegisteredAt honest without a read first.
func PutPushToken(ctx context.Context, t types.PushToken) error {
	item, err := attributevalue.MarshalMap(t)
	if err != nil {
		return err
	}
	item["PK"] = s(userPK(t.UserID))
	item["SK"] = s(pushSK(t.Token))
	_, err = client.PutItem(ctx, &dynamodb.PutItemInput{TableName: &table, Item: item})
	return err
}

// ListPushTokens returns every installation this user has agreed to be
// notified on — often more than one, and occasionally one that has since gone
// stale. DeletePushToken clears those when Expo says so.
func ListPushTokens(ctx context.Context, userID string) ([]types.PushToken, error) {
	out, err := client.Query(ctx, &dynamodb.QueryInput{
		TableName:              &table,
		KeyConditionExpression: aws.String("PK = :pk AND begins_with(SK, :sk)"),
		ExpressionAttributeValues: map[string]ddbtypes.AttributeValue{
			":pk": s(userPK(userID)), ":sk": s("PUSH#"),
		},
	})
	if err != nil {
		return nil, err
	}
	tokens := make([]types.PushToken, 0, len(out.Items))
	for _, item := range out.Items {
		stripKeys(item)
		var t types.PushToken
		if err := attributevalue.UnmarshalMap(item, &t); err != nil {
			return nil, err
		}
		tokens = append(tokens, t)
	}
	return tokens, nil
}

func DeletePushToken(ctx context.Context, userID, token string) error {
	_, err := client.DeleteItem(ctx, &dynamodb.DeleteItemInput{
		TableName: &table,
		Key:       map[string]ddbtypes.AttributeValue{"PK": s(userPK(userID)), "SK": s(pushSK(token))},
	})
	return err
}

func DeleteDevice(ctx context.Context, userID, mac string) error {
	_, err := client.DeleteItem(ctx, &dynamodb.DeleteItemInput{
		TableName: &table,
		Key:       map[string]ddbtypes.AttributeValue{"PK": s(userPK(userID)), "SK": s(devSK(mac))},
	})
	return err
}

// TouchDevice refreshes telemetry without overwriting pairing fields, and
// without resurrecting a device the user unpaired mid-sync.
func TouchDevice(ctx context.Context, userID, mac string, telemetry map[string]any) error {
	sets := []string{"lastSeenAt = :now"}
	values := map[string]ddbtypes.AttributeValue{":now": s(nowISO())}
	names := map[string]string{}
	for key, value := range telemetry {
		if value == nil {
			continue
		}
		av, err := attributevalue.Marshal(value)
		if err != nil {
			return err
		}
		names["#"+key] = key
		values[":"+key] = av
		sets = append(sets, fmt.Sprintf("#%s = :%s", key, key))
	}
	_, err := client.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName:                 &table,
		Key:                       map[string]ddbtypes.AttributeValue{"PK": s(userPK(userID)), "SK": s(devSK(mac))},
		UpdateExpression:          aws.String("SET " + strings.Join(sets, ", ")),
		ExpressionAttributeNames:  orNil(names),
		ExpressionAttributeValues: values,
		ConditionExpression:       aws.String("attribute_exists(PK)"),
	})
	var conditionFailed *ddbtypes.ConditionalCheckFailedException
	if errors.As(err, &conditionFailed) {
		return nil
	}
	return err
}

func orNil(names map[string]string) map[string]string {
	if len(names) == 0 {
		return nil
	}
	return names
}

// -- recordings --------------------------------------------------------------

// PutRecording creates the row; a repeat upload of the same device file must
// not clobber a transcript that already landed, hence the existence condition.
func PutRecording(ctx context.Context, rec types.Recording) error {
	item, err := attributevalue.MarshalMap(rec)
	if err != nil {
		return err
	}
	item["PK"] = s(userPK(rec.UserID))
	item["SK"] = s(recSK(rec.StartedAt, rec.RecordingID))
	item["GSI1PK"] = s("REC#" + rec.RecordingID)
	item["GSI1SK"] = s("REC#" + rec.RecordingID)
	_, err = client.PutItem(ctx, &dynamodb.PutItemInput{
		TableName:           &table,
		Item:                item,
		ConditionExpression: aws.String("attribute_not_exists(PK)"),
	})
	return err
}

func unmarshalRecordings(items []map[string]ddbtypes.AttributeValue) ([]types.Recording, error) {
	recs := make([]types.Recording, 0, len(items))
	for _, item := range items {
		stripKeys(item)
		var r types.Recording
		if err := attributevalue.UnmarshalMap(item, &r); err != nil {
			return nil, err
		}
		recs = append(recs, r)
	}
	return recs, nil
}

// FindByDeviceFile locates a recording by the device folder+file it came from,
// to avoid duplicates when the app's manifest was lost to a reinstall.
func FindByDeviceFile(ctx context.Context, userID, deviceFolder, deviceFile string) (*types.Recording, error) {
	out, err := client.Query(ctx, &dynamodb.QueryInput{
		TableName:              &table,
		KeyConditionExpression: aws.String("PK = :pk AND begins_with(SK, :sk)"),
		FilterExpression:       aws.String("deviceFolder = :folder AND deviceFile = :file"),
		ExpressionAttributeValues: map[string]ddbtypes.AttributeValue{
			":pk": s(userPK(userID)), ":sk": s("REC#"),
			":folder": s(deviceFolder), ":file": s(deviceFile),
		},
	})
	if err != nil {
		return nil, err
	}
	recs, err := unmarshalRecordings(out.Items)
	if err != nil || len(recs) == 0 {
		return nil, err
	}
	return &recs[0], nil
}

// ListRecordings pages newest first: the app opens on the most recent conversation.
func ListRecordings(ctx context.Context, userID string, limit int32, cursor string) ([]types.Recording, string, error) {
	input := &dynamodb.QueryInput{
		TableName:              &table,
		KeyConditionExpression: aws.String("PK = :pk AND begins_with(SK, :sk)"),
		ExpressionAttributeValues: map[string]ddbtypes.AttributeValue{
			":pk": s(userPK(userID)), ":sk": s("REC#"),
		},
		ScanIndexForward: aws.Bool(false),
		Limit:            &limit,
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
	recs, err := unmarshalRecordings(out.Items)
	if err != nil {
		return nil, "", err
	}
	next, err := encodeCursor(out.LastEvaluatedKey)
	if err != nil {
		return nil, "", err
	}
	return recs, next, nil
}

func queryByRecordingID(ctx context.Context, recordingID string) (*types.Recording, error) {
	out, err := client.Query(ctx, &dynamodb.QueryInput{
		TableName:              &table,
		IndexName:              aws.String("GSI1"),
		KeyConditionExpression: aws.String("GSI1PK = :pk"),
		ExpressionAttributeValues: map[string]ddbtypes.AttributeValue{
			":pk": s("REC#" + recordingID),
		},
	})
	if err != nil {
		return nil, err
	}
	recs, err := unmarshalRecordings(out.Items)
	if err != nil || len(recs) == 0 {
		return nil, err
	}
	return &recs[0], nil
}

// GetRecording scopes the GSI lookup to the caller: the index is global.
func GetRecording(ctx context.Context, userID, recordingID string) (*types.Recording, error) {
	rec, err := queryByRecordingID(ctx, recordingID)
	if err != nil || rec == nil {
		return nil, err
	}
	if rec.UserID != userID {
		return nil, nil
	}
	return rec, nil
}

// GetRecordingByID locates a recording without a user context. Processor only.
func GetRecordingByID(ctx context.Context, recordingID string) (*types.Recording, error) {
	return queryByRecordingID(ctx, recordingID)
}

// updateRecordingInput builds the SET expression an UpdateRecording-shaped
// write sends, with an optional extra condition. Split out and pure — the
// same reason taskTransitionInput is — so the exact expression a caller like
// SetFactsMemoryStatusIfUnset sends can be read in a test without a table.
// Every attribute name goes through ExpressionAttributeNames because
// `status` and `error` are DynamoDB reserved words.
func updateRecordingInput(userID, startedAt, recordingID string, patch map[string]any, condition string) (*dynamodb.UpdateItemInput, error) {
	sets := []string{"updatedAt = :updatedAt"}
	names := map[string]string{}
	values := map[string]ddbtypes.AttributeValue{":updatedAt": s(nowISO())}
	for key, value := range patch {
		av, err := attributevalue.Marshal(value)
		if err != nil {
			return nil, err
		}
		names["#"+key] = key
		values[":"+key] = av
		sets = append(sets, fmt.Sprintf("#%s = :%s", key, key))
	}
	input := &dynamodb.UpdateItemInput{
		TableName: &table,
		Key: map[string]ddbtypes.AttributeValue{
			"PK": s(userPK(userID)), "SK": s(recSK(startedAt, recordingID)),
		},
		UpdateExpression:          aws.String("SET " + strings.Join(sets, ", ")),
		ExpressionAttributeNames:  orNil(names),
		ExpressionAttributeValues: values,
	}
	if condition != "" {
		input.ConditionExpression = aws.String(condition)
	}
	return input, nil
}

// UpdateRecording sets the given attributes plus updatedAt.
func UpdateRecording(ctx context.Context, userID, startedAt, recordingID string, patch map[string]any) error {
	input, err := updateRecordingInput(userID, startedAt, recordingID, patch, "")
	if err != nil {
		return err
	}
	_, err = client.UpdateItem(ctx, input)
	return err
}

// SetFactsMemoryStatusIfUnset writes patch (expected to carry at least
// factsMemoryStatus) only if factsMemoryStatus does not already exist on the
// row, and reports whether this call's write was the one that landed.
//
// This is the per-recording alternative to ApplyFn's own
// reservedConcurrency: 1 on the whole Lambda. Two concurrent deliveries of
// the same recording — a redelivered applyQueue message racing extractDlq's
// fallback, say — both reading an empty factsMemoryStatus and both sending
// the same facts to GitLoom is the race that blunt guard closes today, at
// the cost of serialising every recording's apply step across the whole
// account, even ones that share nothing. A conditional write lets the loser
// of that race detect it — ok is false, not an error, exactly the outcome a
// losing race is supposed to have — instead of being prevented from ever
// running concurrently with an unrelated recording's own apply.
//
// ok is false with a nil error whenever some other write already set
// factsMemoryStatus first; the caller must not treat that as a reason to
// retry or to fail the message, only as "somebody else already owns finishing
// this recording's facts send."
func SetFactsMemoryStatusIfUnset(ctx context.Context, userID, startedAt, recordingID string, patch map[string]any) (bool, error) {
	input, err := updateRecordingInput(userID, startedAt, recordingID, patch, "attribute_not_exists(factsMemoryStatus)")
	if err != nil {
		return false, err
	}
	if _, err := client.UpdateItem(ctx, input); err != nil {
		var refused *ddbtypes.ConditionalCheckFailedException
		if errors.As(err, &refused) {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

func DeleteRecording(ctx context.Context, userID, startedAt, recordingID string) error {
	_, err := client.DeleteItem(ctx, &dynamodb.DeleteItemInput{
		TableName: &table,
		Key: map[string]ddbtypes.AttributeValue{
			"PK": s(userPK(userID)), "SK": s(recSK(startedAt, recordingID)),
		},
	})
	return err
}

// -- user prefs (categories) -------------------------------------------------

// GetCategories returns the user's category set, seeding the defaults on
// first read so the app never has to special-case an empty account.
func GetCategories(ctx context.Context, userID string) ([]types.Category, error) {
	out, err := client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: &table,
		Key:       map[string]ddbtypes.AttributeValue{"PK": s(userPK(userID)), "SK": s("PREFS")},
	})
	if err != nil {
		return nil, err
	}
	if out.Item != nil {
		var prefs struct {
			Categories []types.Category `dynamodbav:"categories"`
		}
		if err := attributevalue.UnmarshalMap(out.Item, &prefs); err != nil {
			return nil, err
		}
		if len(prefs.Categories) > 0 {
			return prefs.Categories, nil
		}
	}
	defaults := types.DefaultCategories()
	if err := PutCategories(ctx, userID, defaults); err != nil {
		return nil, err
	}
	return defaults, nil
}

func PutCategories(ctx context.Context, userID string, categories []types.Category) error {
	list, err := attributevalue.Marshal(categories)
	if err != nil {
		return err
	}
	_, err = client.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName:                 &table,
		Key:                       map[string]ddbtypes.AttributeValue{"PK": s(userPK(userID)), "SK": s("PREFS")},
		UpdateExpression:          aws.String("SET categories = :c, updatedAt = :now"),
		ExpressionAttributeValues: map[string]ddbtypes.AttributeValue{":c": list, ":now": s(nowISO())},
	})
	return err
}

// -- user profile ------------------------------------------------------------

// Profile is the user's face in the app: a chosen name and an avatar image
// key. Both live on the same PREFS item as the categories.
type Profile struct {
	Name      string `dynamodbav:"profileName"`
	AvatarKey string `dynamodbav:"avatarKey"`
}

func GetProfile(ctx context.Context, userID string) (Profile, error) {
	out, err := client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: &table,
		Key:       map[string]ddbtypes.AttributeValue{"PK": s(userPK(userID)), "SK": s("PREFS")},
	})
	if err != nil || out.Item == nil {
		return Profile{}, err
	}
	var p Profile
	if err := attributevalue.UnmarshalMap(out.Item, &p); err != nil {
		return Profile{}, err
	}
	return p, nil
}

// PutProfile writes only the fields the caller is changing.
func PutProfile(ctx context.Context, userID string, name, avatarKey *string) error {
	sets := []string{"updatedAt = :now"}
	values := map[string]ddbtypes.AttributeValue{":now": s(nowISO())}
	if name != nil {
		sets = append(sets, "profileName = :n")
		values[":n"] = s(*name)
	}
	if avatarKey != nil {
		sets = append(sets, "avatarKey = :a")
		values[":a"] = s(*avatarKey)
	}
	_, err := client.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName:                 &table,
		Key:                       map[string]ddbtypes.AttributeValue{"PK": s(userPK(userID)), "SK": s("PREFS")},
		UpdateExpression:          aws.String("SET " + strings.Join(sets, ", ")),
		ExpressionAttributeValues: values,
	})
	return err
}
