package ddb

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	ddbtypes "github.com/aws/aws-sdk-go-v2/service/dynamodb/types"

	"github.com/MelloB1989/mr20-pendant/backend/internal/types"
)

func sampleDaemon() Daemon {
	return Daemon{
		DaemonID:        "dmn_1",
		UserID:          "user_1",
		Name:            "Kartik's MacBook",
		Hostname:        "kartik-mbp.local",
		OS:              "darwin/arm64",
		Version:         "karmax 0.4.1",
		TokenHash:       HashDaemonToken("a-token"),
		Status:          DaemonOnline,
		Capabilities:    []string{"claude-code"},
		LastHeartbeatAt: "2026-09-09T10:00:00Z",
		RegisteredAt:    "2026-09-09T09:00:00Z",
	}
}

func num(t *testing.T, av ddbtypes.AttributeValue, label string) string {
	t.Helper()
	nv, ok := av.(*ddbtypes.AttributeValueMemberN)
	if !ok {
		t.Fatalf("%s is not a number attribute: %#v", label, av)
	}
	return nv.Value
}

func TestDaemonKeys(t *testing.T) {
	item, err := daemonItem(sampleDaemon())
	if err != nil {
		t.Fatal(err)
	}
	if got := str(t, item["PK"], "PK"); got != "USER#user_1" {
		t.Fatalf("PK = %q", got)
	}
	if got := str(t, item["SK"], "SK"); got != "DAEMON#dmn_1" {
		t.Fatalf("SK = %q", got)
	}
	// The index is keyed by the *hash*, which is the whole reason a token can
	// be resolved in one lookup without the table holding a usable credential.
	want := "DTOKEN#" + HashDaemonToken("a-token")
	if got := str(t, item["GSI1PK"], "GSI1PK"); got != want {
		t.Fatalf("GSI1PK = %q, want %q", got, want)
	}
	if got := str(t, item["GSI1SK"], "GSI1SK"); got != "DAEMON" {
		t.Fatalf("GSI1SK = %q", got)
	}
	if got := str(t, item["tokenHash"], "tokenHash"); got != HashDaemonToken("a-token") {
		t.Fatalf("tokenHash = %q", got)
	}
	if _, ok := item["token"]; ok {
		t.Fatal("the token itself must never reach the table")
	}
}

// GET /daemons answers with this struct. The hash is half a credential and
// has no business on a wire.
func TestDaemonJSONWithholdsTheTokenHash(t *testing.T) {
	body, err := json.Marshal(sampleDaemon())
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(body), HashDaemonToken("a-token")) {
		t.Fatalf("the token hash is in the response: %s", body)
	}
	if strings.Contains(strings.ToLower(string(body)), "tokenhash") {
		t.Fatalf("the token hash field is in the response: %s", body)
	}
}

func TestDaemonTokenIsRandomAndStoredOnlyAsAHash(t *testing.T) {
	token, hash, err := NewDaemonToken()
	if err != nil {
		t.Fatal(err)
	}
	raw, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil {
		t.Fatalf("the token is not base64url: %v", err)
	}
	if len(raw) != 32 {
		t.Fatalf("the token carries %d bytes, want 32", len(raw))
	}
	if hash == token {
		t.Fatal("the stored hash must not be the token")
	}
	if len(hash) != 64 {
		t.Fatalf("hash = %d characters, want 64 hex", len(hash))
	}
	if got := HashDaemonToken(token); got != hash {
		t.Fatal("hashing the token again must produce what was stored")
	}
	// Whitespace around a token pasted into a config file is not part of it.
	if got := HashDaemonToken(" " + token + "\n"); got != hash {
		t.Fatal("a trimmed token must hash the same")
	}

	second, _, err := NewDaemonToken()
	if err != nil {
		t.Fatal(err)
	}
	if second == token {
		t.Fatal("two mints produced the same token")
	}
}

func TestPairCodeIsUnambiguousAndUnpredictable(t *testing.T) {
	seen := map[string]int{}
	for i := 0; i < 200; i++ {
		code, err := NewPairCode()
		if err != nil {
			t.Fatal(err)
		}
		if len(code) != PairCodeLength {
			t.Fatalf("code %q is %d characters, want %d", code, len(code), PairCodeLength)
		}
		for _, r := range code {
			if !strings.ContainsRune(PairCodeAlphabet, r) {
				t.Fatalf("code %q uses %q, which is not in the alphabet", code, r)
			}
		}
		// Read off one screen, typed into another: the four characters people
		// confuse are not in play.
		if strings.ContainsAny(code, "IO01") {
			t.Fatalf("code %q contains a character people misread", code)
		}
		seen[code]++
	}
	if len(seen) < 195 {
		t.Fatalf("200 draws produced only %d distinct codes", len(seen))
	}
}

func TestNormalisePairCode(t *testing.T) {
	for _, typed := range []string{"k7qd2m", "K7QD2M", " k7qd2m ", "K7Q-D2M", "K7Q D2M"} {
		got, err := NormalisePairCode(typed)
		if err != nil {
			t.Fatalf("%q: %v", typed, err)
		}
		if got != "K7QD2M" {
			t.Fatalf("%q normalised to %q", typed, got)
		}
	}
	for _, refused := range []string{"", "K7QD2", "K7QD2MM", "K7QD2!", "K7QD2O", "K7QD21"} {
		if _, err := NormalisePairCode(refused); err == nil {
			t.Fatalf("%q was accepted as a code", refused)
		}
	}
}

// The code is a top-level item so a daemon that knows nothing but the six
// characters can redeem it, and it carries the table's TTL attribute so an
// unredeemed one sweeps itself out.
func TestPairCodeItemIsTopLevelAndSelfSweeping(t *testing.T) {
	code := PairCode{Code: "K7QD2M", UserID: "user_1", ExpiresAt: 1789000000, CreatedAt: "2026-09-09T10:00:00Z"}
	item, err := pairCodeItem(code)
	if err != nil {
		t.Fatal(err)
	}
	if got := str(t, item["PK"], "PK"); got != "PAIRCODE#K7QD2M" {
		t.Fatalf("PK = %q", got)
	}
	if got := str(t, item["SK"], "SK"); got != "PAIRCODE" {
		t.Fatalf("SK = %q", got)
	}
	if got := str(t, item["userId"], "userId"); got != "user_1" {
		t.Fatalf("userId = %q", got)
	}
	if got := num(t, item["ttl"], "ttl"); got != "1789000000" {
		t.Fatalf("ttl = %q — the table's TTL attribute is named ttl", got)
	}
	if got := num(t, item["expiresAt"], "expiresAt"); got != "1789000000" {
		t.Fatalf("expiresAt = %q", got)
	}
}

// Single use is the delete; the expiry is ours to enforce, because DynamoDB's
// TTL sweep runs when it gets to it and may be two days late.
func TestRedeemPairCodeIsSingleUseAndChecksTheExpiryItself(t *testing.T) {
	in := redeemPairCodeInput("K7QD2M", 1788999999)

	if got := str(t, in.Key["PK"], "PK"); got != "PAIRCODE#K7QD2M" {
		t.Fatalf("PK = %q", got)
	}
	condition := aws.ToString(in.ConditionExpression)
	if !strings.Contains(condition, "attribute_exists(PK)") {
		t.Fatalf("a spent code must have nothing to delete: %q", condition)
	}
	if !strings.Contains(condition, "expiresAt > :now") {
		t.Fatalf("an expired code must be refused by the write, not by a read: %q", condition)
	}
	if got := num(t, in.ExpressionAttributeValues[":now"], ":now"); got != "1788999999" {
		t.Fatalf(":now = %q", got)
	}
	// The user id comes back out of the deleted row: there is no second read
	// in which a racing daemon could redeem the same code.
	if in.ReturnValues != ddbtypes.ReturnValueAllOld {
		t.Fatalf("ReturnValues = %q, want ALL_OLD", in.ReturnValues)
	}
}

func TestPairCodeExpiry(t *testing.T) {
	code := PairCode{ExpiresAt: time.Date(2026, 9, 9, 10, 5, 0, 0, time.UTC).Unix()}
	if code.Expired(time.Date(2026, 9, 9, 10, 4, 59, 0, time.UTC)) {
		t.Fatal("a code with a second left is still good")
	}
	if !code.Expired(time.Date(2026, 9, 9, 10, 5, 0, 0, time.UTC)) {
		t.Fatal("a code is dead at its expiry, not after it")
	}
	if got := code.ExpiresAtISO(); got != "2026-09-09T10:05:00Z" {
		t.Fatalf("ExpiresAtISO = %q", got)
	}
}

func TestDaemonTokenLookupIsByHashOnGSI1(t *testing.T) {
	in := daemonByTokenInput(HashDaemonToken("a-token"))
	if aws.ToString(in.IndexName) != "GSI1" {
		t.Fatalf("IndexName = %q", aws.ToString(in.IndexName))
	}
	want := "DTOKEN#" + HashDaemonToken("a-token")
	if got := str(t, in.ExpressionAttributeValues[":pk"], ":pk"); got != want {
		t.Fatalf(":pk = %q, want %q", got, want)
	}
	if aws.ToInt32(in.Limit) != 1 {
		t.Fatalf("Limit = %d — one token, one daemon", aws.ToInt32(in.Limit))
	}
}

func TestCoerceDaemonStatus(t *testing.T) {
	for raw, want := range map[string]DaemonStatus{
		"online": DaemonOnline, "BUSY": DaemonBusy, " offline ": DaemonOffline,
		"": DaemonOnline, "whatever": DaemonOnline,
	} {
		if got := CoerceDaemonStatus(raw); got != want {
			t.Fatalf("CoerceDaemonStatus(%q) = %q, want %q", raw, got, want)
		}
	}
}

// Approved only, oldest first, and "not already claimed" costs nothing to
// enforce: claiming moves the row out of this index partition.
func TestApprovedWorkReadsTheApprovedPartitionOldestFirst(t *testing.T) {
	in := approvedWorkInput("user_1", 0)
	if aws.ToString(in.IndexName) != "GSI1" {
		t.Fatalf("IndexName = %q", aws.ToString(in.IndexName))
	}
	if got := str(t, in.ExpressionAttributeValues[":pk"], ":pk"); got != "TASKSTATUS#user_1#approved" {
		t.Fatalf(":pk = %q", got)
	}
	if !aws.ToBool(in.ScanIndexForward) {
		t.Fatal("work comes oldest first: the promise made first is the one to keep first")
	}
	if got := aws.ToInt32(in.Limit); got != DefaultWorkLimit {
		t.Fatalf("Limit = %d, want the default %d", got, DefaultWorkLimit)
	}
	if got := aws.ToInt32(approvedWorkInput("user_1", 500).Limit); got != DefaultWorkLimit {
		t.Fatalf("an oversized limit was honoured: %d", got)
	}
	if got := aws.ToInt32(approvedWorkInput("user_1", 3).Limit); got != 3 {
		t.Fatalf("Limit = %d, want 3", got)
	}
}

func approvedTask() Task {
	t := sampleTask()
	t.Status = TaskApproved
	return t
}

// The claim is the queue: only an approved task may be taken, and taking it
// moves it out of the partition the next daemon polls.
func TestClaimIsConditionalOnBeingApproved(t *testing.T) {
	in, err := claimWorkInput(approvedTask(), "dmn_1", "2026-09-09T11:00:00Z", "2026-09-09T11:15:00Z")
	if err != nil {
		t.Fatal(err)
	}
	condition := aws.ToString(in.ConditionExpression)
	if !strings.Contains(condition, "#status IN (:from0)") {
		t.Fatalf("the claim must pin exactly one starting state: %q", condition)
	}
	if got := str(t, in.ExpressionAttributeValues[":from0"], ":from0"); got != "approved" {
		t.Fatalf(":from0 = %q", got)
	}
	if got := str(t, in.ExpressionAttributeValues[":to"], ":to"); got != "executing" {
		t.Fatalf(":to = %q", got)
	}
	if got := str(t, in.ExpressionAttributeValues[":gsi"], ":gsi"); got != "TASKSTATUS#user_1#executing" {
		t.Fatalf("the row must leave the approved partition: :gsi = %q", got)
	}
	if got := str(t, in.ExpressionAttributeValues[":daemonId"], ":daemonId"); got != "dmn_1" {
		t.Fatalf(":daemonId = %q", got)
	}
	if got := str(t, in.ExpressionAttributeValues[":claimedAt"], ":claimedAt"); got != "2026-09-09T11:00:00Z" {
		t.Fatalf(":claimedAt = %q", got)
	}
}

// A claimed task, mirrored locally, is what the handler answers with.
func TestClaimMirrorCarriesTheMachine(t *testing.T) {
	got := applyTransition(approvedTask(), TaskExecuting, map[string]string{
		"daemonId": "dmn_1", "claimedAt": "2026-09-09T11:00:00Z",
	})
	if got.Status != TaskExecuting || got.DaemonID != "dmn_1" || got.ClaimedAt != "2026-09-09T11:00:00Z" {
		t.Fatalf("mirror = %+v", got)
	}
}

func executingTask() Task {
	t := sampleTask()
	t.Status = TaskExecuting
	t.DaemonID = "dmn_1"
	return t
}

// The receipt and the closed task are one write. Two would allow a task that
// says done with no proof behind it, or a proof of something still running.
func TestFinishWorkIsOneTransactionOfTwoWrites(t *testing.T) {
	task := executingTask()
	receipt := ReceiptFromWork(task, sampleDaemon(), WorkResult{
		Outcome: "success", Summary: "Sent the deck.",
		StartedAt: "2026-09-09T11:00:00Z", FinishedAt: "2026-09-09T11:02:00Z",
	}, "rcpt_1", "2026-09-09T11:02:00Z")

	in, err := finishWorkInput(task, receipt, []TaskStatus{TaskExecuting}, TaskDone, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(in.TransactItems) != 2 {
		t.Fatalf("%d writes in the transaction, want 2", len(in.TransactItems))
	}

	update := in.TransactItems[0].Update
	if update == nil {
		t.Fatal("the first write must be the task")
	}
	condition := aws.ToString(update.ConditionExpression)
	if !strings.Contains(condition, "#status IN (:from0)") {
		t.Fatalf("the result must pin the executing state: %q", condition)
	}
	if got := str(t, update.ExpressionAttributeValues[":from0"], ":from0"); got != "executing" {
		t.Fatalf(":from0 = %q — a result is only accepted for a claimed task", got)
	}
	if got := str(t, update.ExpressionAttributeValues[":to"], ":to"); got != "done" {
		t.Fatalf(":to = %q", got)
	}
	// The receipt id lands on the task in the same write, which is what a
	// repeated result reads back instead of printing a second one.
	if got := str(t, update.ExpressionAttributeValues[":receiptId"], ":receiptId"); got != "rcpt_1" {
		t.Fatalf(":receiptId = %q", got)
	}
	if got := str(t, update.Key["SK"], "SK"); got != task.SK() {
		t.Fatalf("the update addresses %q", got)
	}

	put := in.TransactItems[1].Put
	if put == nil {
		t.Fatal("the second write must be the receipt")
	}
	if got := str(t, put.Item["SK"], "SK"); got != "RECEIPT#2026-09-09T11:02:00Z#rcpt_1" {
		t.Fatalf("receipt SK = %q", got)
	}
	if got := str(t, put.Item["taskId"], "taskId"); got != task.TaskID {
		t.Fatalf("the receipt does not name the task: %q", got)
	}

	// A failure prints too, and closes the task the other way.
	failed, err := finishWorkInput(task, receipt, []TaskStatus{TaskExecuting}, TaskFailed, false)
	if err != nil {
		t.Fatal(err)
	}
	if got := str(t, failed.TransactItems[0].Update.ExpressionAttributeValues[":to"], ":to"); got != "failed" {
		t.Fatalf("failed :to = %q", got)
	}
}

func TestReceiptFromWork(t *testing.T) {
	task := executingTask()
	task.Kind = types.TaskKindMessage
	result := WorkResult{
		Outcome:    "success",
		Summary:    "Drafted and sent the deck to Priya.",
		StartedAt:  "2026-09-09T11:00:00Z",
		FinishedAt: "2026-09-09T11:02:00Z",
		Artifacts:  []Artifact{{Name: "deck.pdf", URI: "file:///Users/k/deck.pdf"}},
	}
	receipt := ReceiptFromWork(task, sampleDaemon(), result, "rcpt_1", "2026-09-09T11:02:00Z")

	if receipt.Kind != ReceiptTask || receipt.Stamp != StampDone {
		t.Fatalf("kind/stamp = %q/%q", receipt.Kind, receipt.Stamp)
	}
	if receipt.TaskID != task.TaskID || receipt.RecordingID != task.RecordingID {
		t.Fatal("the receipt must link back to the task and its conversation")
	}
	// What the machine says it did is the receipt's quote: nobody watched.
	if receipt.Quote != result.Summary {
		t.Fatalf("quote = %q", receipt.Quote)
	}

	rows := map[string]ReceiptRow{}
	for _, row := range receipt.Rows {
		rows[row.K] = row
	}
	if rows["RAN ON"].V != "Kartik's MacBook" {
		t.Fatalf("RAN ON = %q", rows["RAN ON"].V)
	}
	if rows["STARTED"].V != result.StartedAt || rows["FINISHED"].V != result.FinishedAt {
		t.Fatalf("the run's own clock is missing: %+v", receipt.Rows)
	}
	if rows["PRODUCED"].V != "deck.pdf · file:///Users/k/deck.pdf" {
		t.Fatalf("PRODUCED = %q", rows["PRODUCED"].V)
	}
	verdict := rows["STATUS"]
	if verdict.V != "DONE" || verdict.OK == nil || !*verdict.OK {
		t.Fatalf("STATUS = %+v", verdict)
	}

	// A failure prints too, and says so — a receipt roll that only records
	// the wins proves nothing.
	result.Outcome = "failure"
	failed := ReceiptFromWork(task, sampleDaemon(), result, "rcpt_2", "2026-09-09T11:02:00Z")
	if failed.Stamp != StampFailed {
		t.Fatalf("stamp = %q", failed.Stamp)
	}
	for _, row := range failed.Rows {
		if row.K == "STATUS" && (row.V != "FAILED" || row.OK == nil || *row.OK) {
			t.Fatalf("STATUS = %+v", row)
		}
	}

	// Anything that is not the word success is a failure: an outcome we do
	// not recognise has proved nothing.
	result.Outcome = "mostly"
	if ReceiptFromWork(task, sampleDaemon(), result, "rcpt_3", "x").Stamp != StampFailed {
		t.Fatal("an unrecognised outcome must not stamp DONE")
	}
}

func TestReceiptFromWorkCapsWhatItPrints(t *testing.T) {
	artifacts := make([]Artifact, 0, 20)
	for i := 0; i < 20; i++ {
		artifacts = append(artifacts, Artifact{Name: "file"})
	}
	receipt := ReceiptFromWork(executingTask(), sampleDaemon(), WorkResult{
		Outcome: "success", Artifacts: artifacts,
	}, "rcpt_1", "2026-09-09T11:02:00Z")

	produced := 0
	for _, row := range receipt.Rows {
		if row.K == "PRODUCED" {
			produced++
		}
	}
	if produced > maxArtifacts {
		t.Fatalf("%d artifact rows, want at most %d", produced, maxArtifacts)
	}
	if len(receipt.Rows) > maxReceiptRows {
		t.Fatalf("%d rows — that is no longer a receipt", len(receipt.Rows))
	}
	// Empty rows are dropped rather than printed blank: a run that reported
	// no clock should not print two empty lines.
	for _, row := range receipt.Rows {
		if strings.TrimSpace(row.V) == "" {
			t.Fatalf("an empty row was printed: %+v", row)
		}
	}
}

func TestWorkResultOutcome(t *testing.T) {
	for raw, want := range map[string]bool{
		"success": true, "SUCCESS": true, " success ": true,
		"failure": false, "": false, "ok": false,
	} {
		if got := (WorkResult{Outcome: raw}).Succeeded(); got != want {
			t.Fatalf("Succeeded(%q) = %v", raw, got)
		}
	}
}

func TestResumeBlockedWorkIsConditionalOnOwnership(t *testing.T) {
	task := sampleBlockedTask()
	task.Status = TaskBlocked
	in := resumeBlockedWorkInput(task, "daemon_1", "2026-09-08T13:00:00Z", "2026-09-08T13:15:00Z", "2026-09-08T13:00:00Z")
	condition := aws.ToString(in.ConditionExpression)
	if !strings.Contains(condition, "#status = :from") || !strings.Contains(condition, "daemonId = :daemonId") {
		t.Fatalf("condition does not check both status and ownership: %q", condition)
	}
	if got := str(t, in.ExpressionAttributeValues[":to"], ":to"); got != "executing" {
		t.Fatalf(":to = %q", got)
	}
}

// C2: a blocked task can sit unanswered for up to DefaultQuestionTTL (a day)
// while the lease ClaimWork wrote at claim time is only WorkLease (fifteen
// minutes) long. If resuming did not renew it, the very next
// releaseAbandoned sweep after any answer arriving more than fifteen minutes
// post-claim would find the row back in the executing partition with an
// already-expired lease and return it to approved — while a daemon is
// actively running it. This pins resumeBlockedWorkInput's write, the same
// way TestClaimIsConditionalOnBeingApproved pins claimWorkInput's.
func TestResumeBlockedWorkRenewsTheLease(t *testing.T) {
	task := sampleBlockedTask()
	task.Status = TaskBlocked
	task.ClaimedAt = "2026-09-08T09:00:00Z"  // the original claim, hours ago
	task.LeaseUntil = "2026-09-08T09:15:00Z" // and its long-expired lease
	in := resumeBlockedWorkInput(task, "daemon_1", "2026-09-08T13:00:00Z", "2026-09-08T13:15:00Z", "2026-09-08T13:00:00Z")

	update := aws.ToString(in.UpdateExpression)
	for _, want := range []string{"claimedAt = :claimedAt", "leaseUntil = :leaseUntil"} {
		if !strings.Contains(update, want) {
			t.Fatalf("resume does not renew the lease: update = %q", update)
		}
	}
	if got := str(t, in.ExpressionAttributeValues[":claimedAt"], ":claimedAt"); got != "2026-09-08T13:00:00Z" {
		t.Fatalf(":claimedAt = %q, want the resume time, not the original claim", got)
	}
	if got := str(t, in.ExpressionAttributeValues[":leaseUntil"], ":leaseUntil"); got != "2026-09-08T13:15:00Z" {
		t.Fatalf(":leaseUntil = %q, want a fresh lease from the resume, not the stale claim-time one", got)
	}
}

// The same renewal, through the exported entry point: the local mirror
// ResumeBlockedWork hands back must carry the fresh lease too, since that is
// what a caller (and a later test) reads rather than re-deriving the write.
func TestResumeBlockedWorkExportedRenewsTheLease(t *testing.T) {
	task := sampleBlockedTask()
	task.Status = TaskBlocked
	task.ClaimedAt = "2026-09-08T09:00:00Z"
	task.LeaseUntil = "2026-09-08T09:15:00Z"

	withFakeClient(t, fakeDDBClient{
		updateItem: func(_ context.Context, _ *dynamodb.UpdateItemInput, _ ...func(*dynamodb.Options)) (*dynamodb.UpdateItemOutput, error) {
			return &dynamodb.UpdateItemOutput{}, nil
		},
	})

	resumed, err := ResumeBlockedWork(context.Background(), task, "daemon_1")
	if err != nil {
		t.Fatal(err)
	}
	if resumed.LeaseUntil == task.LeaseUntil {
		t.Fatalf("ResumeBlockedWork left the stale lease in place: %q", resumed.LeaseUntil)
	}
	until, err := time.Parse(time.RFC3339, resumed.LeaseUntil)
	if err != nil {
		t.Fatalf("leaseUntil is not RFC3339: %v", err)
	}
	if d := until.Sub(time.Now().UTC()); d < WorkLease-time.Minute || d > WorkLease+time.Minute {
		t.Fatalf("leaseUntil is %s from now, want ~%s (WorkLease)", d, WorkLease)
	}
}

// fakeDDBClient is a partial double for ddbClient. Embedding the nil
// interface means any method this test does not stub panics on use rather
// than silently succeeding — a test that calls FailBlockedWork and never
// reaches TransactWriteItems is a test that proved nothing.
type fakeDDBClient struct {
	ddbClient
	transactWriteItems func(context.Context, *dynamodb.TransactWriteItemsInput, ...func(*dynamodb.Options)) (*dynamodb.TransactWriteItemsOutput, error)
	updateItem         func(context.Context, *dynamodb.UpdateItemInput, ...func(*dynamodb.Options)) (*dynamodb.UpdateItemOutput, error)
}

func (f fakeDDBClient) TransactWriteItems(ctx context.Context, in *dynamodb.TransactWriteItemsInput, optFns ...func(*dynamodb.Options)) (*dynamodb.TransactWriteItemsOutput, error) {
	return f.transactWriteItems(ctx, in, optFns...)
}

func (f fakeDDBClient) UpdateItem(ctx context.Context, in *dynamodb.UpdateItemInput, optFns ...func(*dynamodb.Options)) (*dynamodb.UpdateItemOutput, error) {
	return f.updateItem(ctx, in, optFns...)
}

// withFakeClient stands the package's real DynamoDB client in for the length
// of one test, so an exported function like FailBlockedWork can be called
// directly instead of a test hand-reconstructing the request it would send.
func withFakeClient(t *testing.T, c ddbClient) {
	t.Helper()
	previous := client
	client = c
	t.Cleanup(func() { client = previous })
}

// The reviewer's own regression: this test used to build the transaction
// itself with []TaskStatus{TaskBlocked} hard-coded, which pinned nothing —
// it proved the test author's assumption, not FailBlockedWork's own choice.
// Reverting FailBlockedWork to FinishWork's executing-only guard left the
// suite green. This version calls FailBlockedWork and reads back what it
// actually sent.
func TestFailBlockedWorkClosesFromBlockedNotExecuting(t *testing.T) {
	task := sampleBlockedTask()
	task.Status = TaskBlocked
	receipt := Receipt{ReceiptID: "r_1", UserID: task.UserID, CreatedAt: "2026-09-08T13:00:00Z"}

	var sent *dynamodb.TransactWriteItemsInput
	withFakeClient(t, fakeDDBClient{
		transactWriteItems: func(_ context.Context, in *dynamodb.TransactWriteItemsInput, _ ...func(*dynamodb.Options)) (*dynamodb.TransactWriteItemsOutput, error) {
			sent = in
			return &dynamodb.TransactWriteItemsOutput{}, nil
		},
	})

	if _, _, err := FailBlockedWork(context.Background(), task, receipt); err != nil {
		t.Fatal(err)
	}
	if sent == nil {
		t.Fatal("FailBlockedWork never reached the client")
	}
	update := sent.TransactItems[0].Update
	condition := aws.ToString(update.ConditionExpression)
	if !strings.Contains(condition, ":from0") {
		t.Fatalf("condition does not reference a starting state: %q", condition)
	}
	if got := str(t, update.ExpressionAttributeValues[":from0"], ":from0"); got != "blocked" {
		t.Fatalf(":from0 = %q, want blocked — FailBlockedWork must not reuse FinishWork's executing-only guard", got)
	}
}

// The expiry sweep reads a snapshot, then writes moments later. If an answer
// lands in that window, answering never moves the task's status — it stays
// blocked — so a condition that only checks #status = blocked cannot see the
// answer and would still succeed, discarding it and recording the task as
// "nobody answered" when somebody did. The write itself has to refuse this.
func TestFailBlockedWorkRefusesAQuestionThatWasJustAnswered(t *testing.T) {
	task := sampleBlockedTask()
	task.Status = TaskBlocked
	receipt := Receipt{ReceiptID: "r_1", UserID: task.UserID, CreatedAt: "2026-09-08T13:00:00Z"}

	var sent *dynamodb.TransactWriteItemsInput
	withFakeClient(t, fakeDDBClient{
		transactWriteItems: func(_ context.Context, in *dynamodb.TransactWriteItemsInput, _ ...func(*dynamodb.Options)) (*dynamodb.TransactWriteItemsOutput, error) {
			sent = in
			return &dynamodb.TransactWriteItemsOutput{}, nil
		},
	})

	if _, _, err := FailBlockedWork(context.Background(), task, receipt); err != nil {
		t.Fatal(err)
	}
	update := sent.TransactItems[0].Update
	condition := aws.ToString(update.ConditionExpression)
	if !strings.Contains(condition, "attribute_not_exists(#question.#answer)") {
		t.Fatalf("condition = %q — the sweep must refuse to fail a task whose question was just "+
			"answered, or it silently discards the answer and lies about why the task failed", condition)
	}
	if update.ExpressionAttributeNames["#question"] != "question" || update.ExpressionAttributeNames["#answer"] != "answer" {
		t.Fatalf("names = %+v — question and answer are not aliased", update.ExpressionAttributeNames)
	}
}
