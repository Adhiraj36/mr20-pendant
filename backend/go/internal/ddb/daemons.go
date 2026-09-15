// The daemon: LYZN's hands on somebody's own laptop.
//
//	Daemon    PK USER#<sub>        SK DAEMON#<daemonId>
//	                               GSI1PK DTOKEN#<sha256 of the token>  GSI1SK DAEMON
//	PairCode  PK PAIRCODE#<code>   SK PAIRCODE   ttl <epoch seconds>
//
// KARMAX has no login. It is a program on a laptop, not a person with a
// session, so nothing it does can be authenticated the way the app is. Two
// key shapes follow from that.
//
// The pairing code is a *top-level* item rather than one of the user's,
// because the daemon redeeming it does not know whose account it is joining —
// that is the whole point of the code. It carries the user id, an expiry it
// checks itself, and the table's `ttl` attribute so an unredeemed code sweeps
// itself out rather than sitting in the partition forever. Redemption is a
// conditional delete, which is what makes a code single-use: the second
// daemon to send the same six characters finds nothing to delete.
//
// The daemon's token is 32 random bytes, handed back exactly once at the end
// of the claim and never stored — only its SHA-256 is, on GSI1, so a dump of
// this table hands nobody a working credential. Resolving a bearer token is
// therefore one index lookup on the hash of what was presented.
package ddb

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	ddbtypes "github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// DaemonStatus is what the daemon last said about itself. It is the daemon's
// own word, not a measurement: a laptop that closes its lid says nothing at
// all, which is why lastHeartbeatAt is what the app actually shows.
type DaemonStatus string

const (
	DaemonOnline  DaemonStatus = "online"
	DaemonBusy    DaemonStatus = "busy"
	DaemonOffline DaemonStatus = "offline"
)

// DaemonStatuses is every status the heartbeat accepts.
var DaemonStatuses = []DaemonStatus{DaemonOnline, DaemonBusy, DaemonOffline}

// CoerceDaemonStatus maps what a heartbeat sent onto a status, defaulting to
// online: a daemon that is talking to us is, by the fact of talking, up.
func CoerceDaemonStatus(raw string) DaemonStatus {
	for _, status := range DaemonStatuses {
		if strings.EqualFold(strings.TrimSpace(raw), string(status)) {
			return status
		}
	}
	return DaemonOnline
}

// Daemon is one paired machine.
//
// TokenHash is `json:"-"` and not a slip of the pen: this struct is what
// GET /daemons answers with, and the hash is the only half of the credential
// we hold. It never leaves the process.
type Daemon struct {
	DaemonID string `dynamodbav:"daemonId" json:"daemonId"`
	UserID   string `dynamodbav:"userId" json:"userId"`
	// Name is what the person calls this machine ("Kartik's MacBook").
	Name     string `dynamodbav:"name" json:"name"`
	Hostname string `dynamodbav:"hostname,omitempty" json:"hostname,omitempty"`
	OS       string `dynamodbav:"os,omitempty" json:"os,omitempty"`
	Version  string `dynamodbav:"version,omitempty" json:"version,omitempty"`
	// TokenHash is SHA-256 of the bearer token, hex. Never serialised.
	TokenHash string       `dynamodbav:"tokenHash" json:"-"`
	Status    DaemonStatus `dynamodbav:"status" json:"status"`
	// Capabilities is what this build of KARMAX can carry out — the loops it
	// has, the orchestrator it found. Advisory: the backend hands out work by
	// task status, not by capability, and a daemon that cannot do a thing
	// reports the failure rather than being spared the attempt.
	Capabilities    []string `dynamodbav:"capabilities,omitempty" json:"capabilities"`
	LastHeartbeatAt string   `dynamodbav:"lastHeartbeatAt,omitempty" json:"lastHeartbeatAt,omitempty"`
	RegisteredAt    string   `dynamodbav:"registeredAt" json:"registeredAt"`
	// MemoryKeyID is the public half of the GitLoom key this machine was given
	// — enough to revoke it when the machine is unpaired, and nothing else.
	// The secret itself is never stored: GitLoom shows it once, on the way to
	// the laptop that asked, and a machine that loses it asks for another.
	MemoryKeyID string `dynamodbav:"memoryKeyId,omitempty" json:"-"`
}

func daemonSK(daemonID string) string { return "DAEMON#" + daemonID }

// daemonTokenGSI is the index key a presented token resolves through. The
// hash is the key, so the index cannot be read backwards into a credential.
func daemonTokenGSI(tokenHash string) string { return "DTOKEN#" + tokenHash }

const daemonTokenGSISK = "DAEMON"

// -- the token ---------------------------------------------------------------

// HashDaemonToken is the one-way half of the credential: what is stored, and
// what a presented token is looked up by.
func HashDaemonToken(token string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(token)))
	return hex.EncodeToString(sum[:])
}

// NewDaemonToken mints a bearer credential: 32 bytes from crypto/rand,
// base64url with no padding so it survives a header, a shell and a config
// file unescaped. Returned once, at the end of the claim, and never again —
// only the hash is written down.
func NewDaemonToken() (token, hash string, err error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", "", err
	}
	token = base64.RawURLEncoding.EncodeToString(raw)
	return token, HashDaemonToken(token), nil
}

// -- the pairing code --------------------------------------------------------

// PairCodeAlphabet is deliberately not the whole alphabet: I, O, 0 and 1 are
// out, because this is read off one screen and typed into another, often from
// across a desk.
const PairCodeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

const (
	// PairCodeLength × log2(32) = 30 bits of entropy, which is a lot to
	// guess inside five minutes against a code that is deleted on first use.
	PairCodeLength = 6
	// PairCodeTTL is how long a code is worth typing.
	PairCodeTTL = 5 * time.Minute
	// pairCodeMintAttempts bounds the retry when a code is already taken.
	pairCodeMintAttempts = 5
)

// ErrPairCode is an unknown, expired or already-used code. One error for all
// three on purpose: telling an anonymous caller which of the three it was
// would turn the claim endpoint into an oracle for guessing codes.
var ErrPairCode = errors.New("that pairing code is not one we are waiting for")

// PairCode is one outstanding invitation for a daemon to join an account.
type PairCode struct {
	Code   string `dynamodbav:"code"`
	UserID string `dynamodbav:"userId"`
	// ExpiresAt is epoch seconds, and is also written to the table's `ttl`
	// attribute. Both, because TTL deletion is a sweep DynamoDB runs when it
	// gets to it — up to two days late — so the expiry a redemption checks
	// has to be one we hold ourselves.
	ExpiresAt int64  `dynamodbav:"expiresAt"`
	CreatedAt string `dynamodbav:"createdAt"`
}

// Expired reports whether this code is past its life at the given instant.
func (p PairCode) Expired(now time.Time) bool { return now.Unix() >= p.ExpiresAt }

// ExpiresAtISO is the expiry in the format the rest of this API speaks.
func (p PairCode) ExpiresAtISO() string {
	return time.Unix(p.ExpiresAt, 0).UTC().Format(time.RFC3339)
}

func pairCodePK(code string) string { return "PAIRCODE#" + code }

const pairCodeSK = "PAIRCODE"

// NewPairCode draws one code. 256 is a whole number of alphabets long, so
// the modulo below is not biased towards the front of it.
func NewPairCode() (string, error) {
	raw := make([]byte, PairCodeLength)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	out := make([]byte, PairCodeLength)
	for i, b := range raw {
		out[i] = PairCodeAlphabet[int(b)%len(PairCodeAlphabet)]
	}
	return string(out), nil
}

// NormalisePairCode is what a person actually typed, turned into what was
// minted: case does not matter, and the spaces and hyphens someone adds to
// make six characters readable are not part of the code.
func NormalisePairCode(raw string) (string, error) {
	var b strings.Builder
	for _, r := range strings.ToUpper(strings.TrimSpace(raw)) {
		if r == ' ' || r == '-' || r == '_' {
			continue
		}
		if !strings.ContainsRune(PairCodeAlphabet, r) {
			return "", ErrPairCode
		}
		b.WriteRune(r)
	}
	code := b.String()
	if len(code) != PairCodeLength {
		return "", ErrPairCode
	}
	return code, nil
}

func pairCodeItem(p PairCode) (map[string]ddbtypes.AttributeValue, error) {
	item, err := attributevalue.MarshalMap(p)
	if err != nil {
		return nil, err
	}
	item["PK"] = s(pairCodePK(p.Code))
	item["SK"] = s(pairCodeSK)
	// The table's TTL attribute is named `ttl` (backend/lib/data-plane.ts).
	// This is the first row in the table to set it.
	item["ttl"] = &ddbtypes.AttributeValueMemberN{Value: strconv.FormatInt(p.ExpiresAt, 10)}
	return item, nil
}

// MintPairCode writes a fresh code for this user.
//
// The write is conditional on nothing already living at that key, so the one
// in a million draw that collides with somebody else's outstanding code is a
// retry rather than a stolen pairing.
func MintPairCode(ctx context.Context, userID string) (PairCode, error) {
	for attempt := 0; attempt < pairCodeMintAttempts; attempt++ {
		code, err := NewPairCode()
		if err != nil {
			return PairCode{}, err
		}
		p := PairCode{
			Code:      code,
			UserID:    userID,
			ExpiresAt: time.Now().Add(PairCodeTTL).Unix(),
			CreatedAt: nowISO(),
		}
		item, err := pairCodeItem(p)
		if err != nil {
			return PairCode{}, err
		}
		_, err = client.PutItem(ctx, &dynamodb.PutItemInput{
			TableName:           &table,
			Item:                item,
			ConditionExpression: aws.String("attribute_not_exists(PK)"),
		})
		if err == nil {
			return p, nil
		}
		var taken *ddbtypes.ConditionalCheckFailedException
		if errors.As(err, &taken) {
			continue
		}
		return PairCode{}, err
	}
	return PairCode{}, errors.New("could not mint an unused pairing code")
}

// redeemPairCodeInput is the conditional delete a redemption is.
//
// Split out and pure so the two properties that matter — single use, and an
// expiry we enforce ourselves rather than trusting the TTL sweep — can be
// read off the expression in a test.
func redeemPairCodeInput(code string, now int64) *dynamodb.DeleteItemInput {
	return &dynamodb.DeleteItemInput{
		TableName: &table,
		Key: map[string]ddbtypes.AttributeValue{
			"PK": s(pairCodePK(code)), "SK": s(pairCodeSK),
		},
		ConditionExpression: aws.String("attribute_exists(PK) AND expiresAt > :now"),
		ExpressionAttributeValues: map[string]ddbtypes.AttributeValue{
			":now": &ddbtypes.AttributeValueMemberN{Value: strconv.FormatInt(now, 10)},
		},
		ReturnValues: ddbtypes.ReturnValueAllOld,
	}
}

// RedeemPairCode spends a code and says whose account it belonged to.
//
// The delete *is* the redemption: two daemons racing the same six characters
// produce one success and one ErrPairCode, with no read-then-write in
// between for the second one to slip through.
func RedeemPairCode(ctx context.Context, raw string) (PairCode, error) {
	code, err := NormalisePairCode(raw)
	if err != nil {
		return PairCode{}, err
	}
	out, err := client.DeleteItem(ctx, redeemPairCodeInput(code, time.Now().Unix()))
	if err != nil {
		var refused *ddbtypes.ConditionalCheckFailedException
		if errors.As(err, &refused) {
			return PairCode{}, ErrPairCode
		}
		return PairCode{}, err
	}
	if len(out.Attributes) == 0 {
		return PairCode{}, ErrPairCode
	}
	stripKeys(out.Attributes)
	var p PairCode
	if err := attributevalue.UnmarshalMap(out.Attributes, &p); err != nil {
		return PairCode{}, err
	}
	if p.UserID == "" {
		return PairCode{}, ErrPairCode
	}
	return p, nil
}

// -- daemons -----------------------------------------------------------------

func daemonItem(d Daemon) (map[string]ddbtypes.AttributeValue, error) {
	item, err := attributevalue.MarshalMap(d)
	if err != nil {
		return nil, err
	}
	item["PK"] = s(userPK(d.UserID))
	item["SK"] = s(daemonSK(d.DaemonID))
	item["GSI1PK"] = s(daemonTokenGSI(d.TokenHash))
	item["GSI1SK"] = s(daemonTokenGSISK)
	return item, nil
}

// PutDaemon writes one paired machine. A plain put: the daemon id is minted
// at the moment of pairing, so there is nothing to overwrite.
func PutDaemon(ctx context.Context, d Daemon) error {
	item, err := daemonItem(d)
	if err != nil {
		return err
	}
	_, err = client.PutItem(ctx, &dynamodb.PutItemInput{TableName: &table, Item: item})
	return err
}

func unmarshalDaemons(items []map[string]ddbtypes.AttributeValue) ([]Daemon, error) {
	daemons := make([]Daemon, 0, len(items))
	for _, item := range items {
		stripKeys(item)
		var d Daemon
		if err := attributevalue.UnmarshalMap(item, &d); err != nil {
			return nil, err
		}
		daemons = append(daemons, d)
	}
	return daemons, nil
}

// ListDaemons returns the machines paired to this account.
func ListDaemons(ctx context.Context, userID string) ([]Daemon, error) {
	out, err := client.Query(ctx, &dynamodb.QueryInput{
		TableName:              &table,
		KeyConditionExpression: aws.String("PK = :pk AND begins_with(SK, :sk)"),
		ExpressionAttributeValues: map[string]ddbtypes.AttributeValue{
			":pk": s(userPK(userID)), ":sk": s("DAEMON#"),
		},
	})
	if err != nil {
		return nil, err
	}
	return unmarshalDaemons(out.Items)
}

// GetDaemon reads one by id, scoped to its owner.
func GetDaemon(ctx context.Context, userID, daemonID string) (*Daemon, error) {
	out, err := client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: &table,
		Key: map[string]ddbtypes.AttributeValue{
			"PK": s(userPK(userID)), "SK": s(daemonSK(daemonID)),
		},
	})
	if err != nil || out.Item == nil {
		return nil, err
	}
	stripKeys(out.Item)
	var d Daemon
	if err := attributevalue.UnmarshalMap(out.Item, &d); err != nil {
		return nil, err
	}
	return &d, nil
}

// DeleteDaemon unpairs. The row is the credential's only anchor, so deleting
// it is what makes the daemon's token stop resolving — there is no separate
// revocation list to keep in step.
func DeleteDaemon(ctx context.Context, userID, daemonID string) error {
	_, err := client.DeleteItem(ctx, &dynamodb.DeleteItemInput{
		TableName: &table,
		Key: map[string]ddbtypes.AttributeValue{
			"PK": s(userPK(userID)), "SK": s(daemonSK(daemonID)),
		},
	})
	return err
}

// daemonByTokenInput is the index lookup a bearer token resolves through.
func daemonByTokenInput(tokenHash string) *dynamodb.QueryInput {
	return &dynamodb.QueryInput{
		TableName:              &table,
		IndexName:              aws.String("GSI1"),
		KeyConditionExpression: aws.String("GSI1PK = :pk"),
		ExpressionAttributeValues: map[string]ddbtypes.AttributeValue{
			":pk": s(daemonTokenGSI(tokenHash)),
		},
		Limit: aws.Int32(1),
	}
}

// DaemonByToken resolves a presented bearer token to the daemon that holds
// it, or nil for a token nothing is paired to. Nothing here touches Clerk:
// a daemon has no session and never will.
func DaemonByToken(ctx context.Context, token string) (*Daemon, error) {
	if strings.TrimSpace(token) == "" {
		return nil, nil
	}
	out, err := client.Query(ctx, daemonByTokenInput(HashDaemonToken(token)))
	if err != nil {
		return nil, err
	}
	daemons, err := unmarshalDaemons(out.Items)
	if err != nil || len(daemons) == 0 {
		return nil, err
	}
	return &daemons[0], nil
}

// TouchDaemon records a heartbeat. Conditional on the row still being there,
// so a daemon the user unpaired while it was mid-poll is told it is gone
// rather than quietly resurrected — the same rule TouchDevice follows, with
// the opposite answer, because a daemon needs to know to stop.
// SetDaemonMemoryKey records which GitLoom key a machine is holding.
//
// Conditional on the row still existing: a machine unpaired between minting a
// key and writing it down must not resurrect its own row.
func SetDaemonMemoryKey(ctx context.Context, userID, daemonID, keyID string) error {
	_, err := client.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: &table,
		Key: map[string]ddbtypes.AttributeValue{
			"PK": s(userPK(userID)), "SK": s(daemonSK(daemonID)),
		},
		UpdateExpression:    aws.String("SET memoryKeyId = :id"),
		ConditionExpression: aws.String("attribute_exists(PK)"),
		ExpressionAttributeValues: map[string]ddbtypes.AttributeValue{
			":id": s(keyID),
		},
	})
	if err != nil {
		var gone *ddbtypes.ConditionalCheckFailedException
		if errors.As(err, &gone) {
			return ErrDaemonGone
		}
		return err
	}
	return nil
}

func TouchDaemon(ctx context.Context, userID, daemonID string, status DaemonStatus, version string, capabilities []string) error {
	sets := []string{"lastHeartbeatAt = :now", "#status = :status"}
	names := map[string]string{"#status": "status"}
	values := map[string]ddbtypes.AttributeValue{
		":now":    s(nowISO()),
		":status": s(string(status)),
	}
	if strings.TrimSpace(version) != "" {
		names["#version"] = "version"
		values[":version"] = s(version)
		sets = append(sets, "#version = :version")
	}
	if capabilities != nil {
		list, err := attributevalue.Marshal(capabilities)
		if err != nil {
			return err
		}
		names["#capabilities"] = "capabilities"
		values[":capabilities"] = list
		sets = append(sets, "#capabilities = :capabilities")
	}
	_, err := client.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: &table,
		Key: map[string]ddbtypes.AttributeValue{
			"PK": s(userPK(userID)), "SK": s(daemonSK(daemonID)),
		},
		UpdateExpression:          aws.String("SET " + strings.Join(sets, ", ")),
		ExpressionAttributeNames:  names,
		ExpressionAttributeValues: values,
		ConditionExpression:       aws.String("attribute_exists(PK)"),
	})
	var gone *ddbtypes.ConditionalCheckFailedException
	if errors.As(err, &gone) {
		return ErrDaemonGone
	}
	return err
}

// ErrDaemonGone is a daemon that was unpaired between one request and the
// next. Handlers answer it 401: the credential is no longer attached to
// anything, which is the same thing as never having been.
var ErrDaemonGone = errors.New("this daemon is no longer paired")

// -- the work ----------------------------------------------------------------

// DefaultWorkLimit is how many tasks one poll may carry away. Small on
// purpose: a daemon runs them one at a time, and a task claimed and then
// abandoned by a laptop that shut its lid is worse than a task left waiting.
const DefaultWorkLimit int32 = 10

// approvedWorkInput is the query behind GET /daemons/work.
//
// Approved only, and oldest first: the index partition holds exactly the
// tasks in that state, so "not already claimed" costs nothing to enforce —
// claiming moves the row to the executing partition and it stops being
// returned. There is no filter to get wrong.
func approvedWorkInput(userID string, limit int32) *dynamodb.QueryInput {
	if limit <= 0 || limit > DefaultWorkLimit {
		limit = DefaultWorkLimit
	}
	return &dynamodb.QueryInput{
		TableName:              &table,
		IndexName:              aws.String("GSI1"),
		KeyConditionExpression: aws.String("GSI1PK = :pk"),
		ExpressionAttributeValues: map[string]ddbtypes.AttributeValue{
			":pk": s(taskStatusGSI(userID, TaskApproved)),
		},
		ScanIndexForward: aws.Bool(true), // oldest promise first
		Limit:            &limit,
	}
}

// ApprovedWork returns the tasks this account has approved and no daemon has
// claimed, oldest first.
func ApprovedWork(ctx context.Context, userID string, limit int32) ([]Task, error) {
	out, err := client.Query(ctx, approvedWorkInput(userID, limit))
	if err != nil {
		return nil, err
	}
	return unmarshalTasks(out.Items)
}

// CountApprovedWork is the number a heartbeat answers with — the same query,
// counted rather than read, so the daemon can decide whether polling for the
// work itself is worth a round trip.
//
// It counts up to the same page limit a poll would hand over, so a very long
// queue reports DefaultWorkLimit rather than its true length. The daemon uses
// this as "is there anything", and a count that walked an unbounded partition
// every thirty seconds would be a worse answer to that question.
func CountApprovedWork(ctx context.Context, userID string) (int, error) {
	input := approvedWorkInput(userID, DefaultWorkLimit)
	input.Select = ddbtypes.SelectCount
	out, err := client.Query(ctx, input)
	if err != nil {
		return 0, err
	}
	return int(out.Count), nil
}

// claimWorkInput is the conditional update a claim is: approved, and only
// approved, becomes executing. Pure, so the guard can be read in a test.
func claimWorkInput(t Task, daemonID, claimedAt, leaseUntil string) (*dynamodb.UpdateItemInput, error) {
	return taskTransitionInput(t.UserID, t.SK(), []TaskStatus{TaskApproved}, TaskExecuting,
		map[string]string{"daemonId": daemonID, "claimedAt": claimedAt, "leaseUntil": leaseUntil})
}

// WorkLease is how long a claim holds. Fifteen minutes because the daemon's
// own run cap is twelve: a loop that is still working must never have its
// task taken away underneath it, and a loop that died must not hold one for
// longer than it takes a person to notice.
const WorkLease = 15 * time.Minute

// expiredWorkInput reads the executing partition. It is small by nature —
// only what daemons hold right now — so the filter can be applied after the
// read rather than being designed into the key.
func expiredWorkInput(userID string, limit int32) *dynamodb.QueryInput {
	return &dynamodb.QueryInput{
		TableName:              &table,
		IndexName:              aws.String("GSI1"),
		KeyConditionExpression: aws.String("GSI1PK = :pk"),
		ExpressionAttributeValues: map[string]ddbtypes.AttributeValue{
			":pk": s(taskStatusGSI(userID, TaskExecuting)),
		},
		ScanIndexForward: aws.Bool(true),
		Limit:            &limit,
	}
}

// ExpiredWork is the tasks whose lease has run out: claimed, never finished,
// and now free to be offered again.
func ExpiredWork(ctx context.Context, userID string, now time.Time) ([]Task, error) {
	out, err := client.Query(ctx, expiredWorkInput(userID, DefaultWorkLimit))
	if err != nil {
		return nil, err
	}
	held, err := unmarshalTasks(out.Items)
	if err != nil {
		return nil, err
	}
	stale := make([]Task, 0, len(held))
	for _, task := range held {
		if LeaseExpired(task, now) {
			stale = append(stale, task)
		}
	}
	return stale, nil
}

// LeaseExpired is the judgement, pure so a test can make it without a table.
//
// A task holding no lease at all is treated as expired: it was claimed by a
// build that predates leases, and leaving it stranded for ever is the worse
// of the two mistakes.
func LeaseExpired(t Task, now time.Time) bool {
	if t.Status != TaskExecuting {
		return false
	}
	if t.LeaseUntil == "" {
		return true
	}
	until, err := time.Parse(time.RFC3339, t.LeaseUntil)
	if err != nil {
		return true
	}
	return now.After(until)
}

// QuestionAnswered reports whether a blocked task's question has a reply
// waiting for the daemon that asked it.
func QuestionAnswered(t Task) bool {
	return t.Status == TaskBlocked && t.Question != nil && strings.TrimSpace(t.Question.Answer) != ""
}

// QuestionExpired reports whether a blocked task's question passed its
// expiry with no answer. An answered question is never expired, even past
// the deadline: the answer arrived, and racing the clock against it would
// throw away a reply that got there in time.
func QuestionExpired(t Task, now time.Time) bool {
	if t.Status != TaskBlocked || t.Question == nil || QuestionAnswered(t) {
		return false
	}
	if t.Question.ExpiresAt == "" {
		return true
	}
	until, err := time.Parse(time.RFC3339, t.Question.ExpiresAt)
	if err != nil {
		return true
	}
	return now.After(until)
}

// blockedWorkInput reads the whole blocked partition. Small by
// construction, the same reasoning ExpiredWork rests on for executing: a
// task sits here only while pinned to one daemon awaiting one answer, so
// filtering by daemon and by answered/expired happens in Go, not in the
// query.
func blockedWorkInput(userID string, limit int32) *dynamodb.QueryInput {
	return &dynamodb.QueryInput{
		TableName:              &table,
		IndexName:              aws.String("GSI1"),
		KeyConditionExpression: aws.String("GSI1PK = :pk"),
		ExpressionAttributeValues: map[string]ddbtypes.AttributeValue{
			":pk": s(taskStatusGSI(userID, TaskBlocked)),
		},
		ScanIndexForward: aws.Bool(true),
		Limit:            &limit,
	}
}

// BlockedWork returns every blocked task on this account.
func BlockedWork(ctx context.Context, userID string) ([]Task, error) {
	out, err := client.Query(ctx, blockedWorkInput(userID, DefaultWorkLimit))
	if err != nil {
		return nil, err
	}
	return unmarshalTasks(out.Items)
}

// resumeBlockedWorkInput moves an answered blocked task back to executing.
// Conditional on ownership as well as status: a task pinned to one machine
// cannot be resumed by another, the same rule a claim enforces on an
// approved one.
//
// It writes a fresh claimedAt and leaseUntil, exactly as claimWorkInput does
// on the way into executing the first time. Without this, the row keeps
// whatever lease ClaimWork wrote at claim time — fifteen minutes — while a
// question can sit unanswered for up to DefaultQuestionTTL (a day). The
// instant this write lands, LeaseExpired stops exempting the row (that
// exemption is for status blocked, and this write's whole point is to leave
// blocked), so an answer that arrives more than fifteen minutes after the
// original claim would resume onto a lease that is already expired —
// releaseAbandoned would return it to approved out from under the daemon
// that is now actively executing it, on its very next poll.
func resumeBlockedWorkInput(t Task, daemonID, claimedAt, leaseUntil, now string) *dynamodb.UpdateItemInput {
	return &dynamodb.UpdateItemInput{
		TableName: &table,
		Key:       map[string]ddbtypes.AttributeValue{"PK": s(userPK(t.UserID)), "SK": s(t.SK())},
		UpdateExpression: aws.String(
			"SET #status = :to, GSI1PK = :gsi, updatedAt = :now, claimedAt = :claimedAt, leaseUntil = :leaseUntil"),
		ExpressionAttributeNames: map[string]string{"#status": "status"},
		ExpressionAttributeValues: map[string]ddbtypes.AttributeValue{
			":to": s(string(TaskExecuting)), ":gsi": s(taskStatusGSI(t.UserID, TaskExecuting)),
			":now": s(now), ":from": s(string(TaskBlocked)), ":daemonId": s(daemonID),
			":claimedAt": s(claimedAt), ":leaseUntil": s(leaseUntil),
		},
		ConditionExpression: aws.String("attribute_exists(PK) AND #status = :from AND daemonId = :daemonId"),
	}
}

// ResumeBlockedWork puts a blocked task back to executing — the daemon it is
// pinned to picking its own question back up now that somebody answered.
// The lease is renewed from this moment, the same WorkLease window a fresh
// claim gets, not whatever was left over from before the question blocked it.
func ResumeBlockedWork(ctx context.Context, t Task, daemonID string) (Task, error) {
	now := nowISO()
	claimedAt := now
	leaseUntil := time.Now().UTC().Add(WorkLease).Format(time.RFC3339)
	if _, err := client.UpdateItem(ctx, resumeBlockedWorkInput(t, daemonID, claimedAt, leaseUntil, now)); err != nil {
		var refused *ddbtypes.ConditionalCheckFailedException
		if errors.As(err, &refused) {
			return t, ErrTaskTransition
		}
		return t, err
	}
	t.Status, t.UpdatedAt, t.ClaimedAt, t.LeaseUntil = TaskExecuting, now, claimedAt, leaseUntil
	return t, nil
}

// ReleaseWork puts an abandoned task back on the queue.
//
// Conditional on it still being executing, so a daemon that finishes in the
// same instant wins and its receipt stands: releasing is only ever allowed
// to lose a race, never to undo a result.
func ReleaseWork(ctx context.Context, t Task) (Task, error) {
	input, err := taskTransitionInput(t.UserID, t.SK(), []TaskStatus{TaskExecuting}, TaskApproved,
		map[string]string{"daemonId": "", "claimedAt": "", "leaseUntil": ""})
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
	return applyTransition(t, TaskApproved, map[string]string{
		"daemonId": "", "claimedAt": "", "leaseUntil": "",
	}), nil
}

// ClaimWork takes a task off the queue, conditional, so two daemons on the
// same account produce one winner and one 409 — and so a task the user
// dismissed between the poll and the claim is not run anyway.
func ClaimWork(ctx context.Context, t Task, daemonID string) (Task, error) {
	claimedAt := nowISO()
	leaseUntil := time.Now().UTC().Add(WorkLease).Format(time.RFC3339)
	input, err := claimWorkInput(t, daemonID, claimedAt, leaseUntil)
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
	return applyTransition(t, TaskExecuting, map[string]string{
		"daemonId": daemonID, "claimedAt": claimedAt, "leaseUntil": leaseUntil,
	}), nil
}

// finishWorkInput is the one transaction a result is: the task closes and the
// receipt prints, both or neither.
//
// Both, because a task marked done with no receipt is a claim with nothing
// behind it, and a receipt for a task still shown as running is worse. The
// condition inside it pins the starting state, which is what makes a
// repeated POST idempotent rather than a second receipt.
//
// guardUnanswered adds a second condition, used only when closing from
// blocked: the write also requires that no answer has landed on the
// question. Without it, the expiry sweep's own read-then-write window can
// straddle an answer arriving in between — the write would still succeed,
// because answering a question never changes the task's status, so a
// status-only condition cannot see it — silently discarding the answer and
// recording a task as "nobody answered" when somebody did. FinishWork's own
// executing path never sets this: a task in executing has no question on it
// to race against.
func finishWorkInput(t Task, r Receipt, from []TaskStatus, to TaskStatus, guardUnanswered bool) (*dynamodb.TransactWriteItemsInput, error) {
	update, err := taskTransitionInput(t.UserID, t.SK(), from, to, map[string]string{
		"doneAt":    r.CreatedAt,
		"receiptId": r.ReceiptID,
	})
	if err != nil {
		return nil, err
	}
	if guardUnanswered {
		update.ExpressionAttributeNames["#question"] = "question"
		update.ExpressionAttributeNames["#answer"] = "answer"
		update.ConditionExpression = aws.String(
			aws.ToString(update.ConditionExpression) + " AND attribute_not_exists(#question.#answer)")
	}
	item, err := receiptItem(t.UserID, r)
	if err != nil {
		return nil, err
	}
	return &dynamodb.TransactWriteItemsInput{
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
	}, nil
}

// FinishWork closes an executing task and prints its receipt in one write.
func FinishWork(ctx context.Context, t Task, r Receipt, to TaskStatus) (Task, Receipt, error) {
	input, err := finishWorkInput(t, r, []TaskStatus{TaskExecuting}, to, false)
	if err != nil {
		return t, r, err
	}
	if _, err := client.TransactWriteItems(ctx, input); err != nil {
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
	extra := map[string]string{"doneAt": r.CreatedAt, "receiptId": r.ReceiptID}
	return applyTransition(t, to, extra), r, nil
}

// failBlockedWorkInput is the transaction FailBlockedWork sends: from blocked
// only — never executing, which is the lease sweep's own partition and a
// completely different escape hatch — and guarded against a question that
// was just answered, so the write itself refuses to fail a task out from
// under a reply that beat it. Split out, the same way claimWorkInput and
// resumeBlockedWorkInput are, so this exact choice is what a test pins down
// rather than something a test re-derives on FailBlockedWork's behalf.
func failBlockedWorkInput(t Task, r Receipt) (*dynamodb.TransactWriteItemsInput, error) {
	return finishWorkInput(t, r, []TaskStatus{TaskBlocked}, TaskFailed, true)
}

// FailBlockedWork closes a blocked task without anyone answering — a
// question that expired, or a daemon that went away before one arrived.
// Reuses FinishWork's own transaction shape from a different starting state.
func FailBlockedWork(ctx context.Context, t Task, r Receipt) (Task, Receipt, error) {
	input, err := failBlockedWorkInput(t, r)
	if err != nil {
		return t, r, err
	}
	if _, err := client.TransactWriteItems(ctx, input); err != nil {
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
	extra := map[string]string{"doneAt": r.CreatedAt, "receiptId": r.ReceiptID}
	return applyTransition(t, TaskFailed, extra), r, nil
}

// failAnsweredBlockedWorkInput fails a blocked task even though its question
// has just been answered — reached only from the unpair/staleness hatch,
// once a re-read has confirmed the task is still sitting in blocked with a
// reply on it. The daemon that pinned it is gone (unpaired, or silent past
// releaseStaleQuestions' window), so the durable session that would have
// used the answer no longer exists anywhere to resume it. Unlike
// failBlockedWorkInput, this carries no guardUnanswered: an answered
// question is exactly the case this closes, not the one it protects
// against. The answer itself is never erased — Question stays on the row —
// so the receipt and the task detail screen both still show what was
// replied, for whoever redoes this by hand.
func failAnsweredBlockedWorkInput(t Task, r Receipt) (*dynamodb.TransactWriteItemsInput, error) {
	return finishWorkInput(t, r, []TaskStatus{TaskBlocked}, TaskFailed, false)
}

// FailAnsweredBlockedWork is FailBlockedWork's sibling for that one case: a
// blocked task whose question was answered after the daemon holding it was
// already gone. See failAnsweredBlockedWorkInput.
func FailAnsweredBlockedWork(ctx context.Context, t Task, r Receipt) (Task, Receipt, error) {
	input, err := failAnsweredBlockedWorkInput(t, r)
	if err != nil {
		return t, r, err
	}
	if _, err := client.TransactWriteItems(ctx, input); err != nil {
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
	extra := map[string]string{"doneAt": r.CreatedAt, "receiptId": r.ReceiptID}
	return applyTransition(t, TaskFailed, extra), r, nil
}

// -- the receipt a run prints ------------------------------------------------

// maxArtifacts is what a receipt can carry without stopping being one. The
// run's own summary is the record; the artifacts are pointers into it.
const maxArtifacts = 6

// Artifact is one thing a run produced — a file it wrote, a message it sent,
// a URL it left behind.
type Artifact struct {
	Name string `json:"name"`
	URI  string `json:"uri,omitempty"`
}

// WorkResult is what the daemon reports when it is finished.
type WorkResult struct {
	Outcome    string
	Summary    string
	StartedAt  string
	FinishedAt string
	Artifacts  []Artifact
}

// Succeeded reads the outcome. Anything that is not the word "success" is a
// failure: a daemon that reports something we do not recognise has not
// proved the promise was kept.
func (w WorkResult) Succeeded() bool {
	return strings.EqualFold(strings.TrimSpace(w.Outcome), "success")
}

// ReceiptFromWork is the receipt an executed task prints. Pure, and separate
// from the write, so what a run turns into is a thing a test can read.
func ReceiptFromWork(t Task, d Daemon, result WorkResult, receiptID, createdAt string) Receipt {
	ok := result.Succeeded()
	stamp := StampFailed
	verdict := "FAILED"
	if ok {
		stamp = StampDone
		verdict = "DONE"
	}
	machine := strings.TrimSpace(d.Name)
	if machine == "" {
		machine = strings.TrimSpace(d.Hostname)
	}

	rows := []ReceiptRow{
		{K: "KIND", V: strings.ToUpper(string(t.Kind))},
		{K: "PROMISED", V: t.CreatedAt},
		{K: "RAN ON", V: machine},
		{K: "STARTED", V: result.StartedAt},
		{K: "FINISHED", V: result.FinishedAt},
	}
	for i, artifact := range result.Artifacts {
		if i >= maxArtifacts {
			break
		}
		value := strings.TrimSpace(artifact.Name)
		if uri := strings.TrimSpace(artifact.URI); uri != "" {
			if value == "" {
				value = uri
			} else {
				value += " · " + uri
			}
		}
		rows = append(rows, ReceiptRow{K: "PRODUCED", V: value})
	}
	rows = append(rows, ReceiptRow{K: "STATUS", V: verdict, OK: &ok})

	// The run's own words are the receipt's quote when it has any: a receipt
	// for work somebody did not watch has to say what was actually done, and
	// the transcript's phrasing of the promise is on the task already.
	quote := strings.TrimSpace(result.Summary)
	if quote == "" {
		quote = t.Quote
	}

	return Receipt{
		ReceiptID:   receiptID,
		UserID:      t.UserID,
		Kind:        ReceiptTask,
		TaskID:      t.TaskID,
		RecordingID: t.RecordingID,
		Title:       t.Text,
		Quote:       quote,
		Stamp:       stamp,
		CreatedAt:   createdAt,
		Rows:        CleanRows(rows),
	}
}
