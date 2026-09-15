package ddb

import (
	"testing"
	"time"

	ddbtypes "github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// A claim is a loan. These are the three ways it ends: the daemon finishes,
// the daemon dies, or the daemon is still working and must be left alone.

func TestLeaseExpiredOnlyJudgesHeldWork(t *testing.T) {
	now := time.Date(2026, 9, 9, 12, 0, 0, 0, time.UTC)
	for _, status := range []TaskStatus{TaskApproved, TaskProposed, TaskDone, TaskFailed, TaskDismissed} {
		task := Task{Status: status, LeaseUntil: now.Add(-time.Hour).Format(time.RFC3339)}
		if LeaseExpired(task, now) {
			t.Fatalf("%s is not held by anyone, so its lease cannot have run out", status)
		}
	}
}

func TestLeaseExpiredHoldsWhileTheDaemonIsStillWorking(t *testing.T) {
	now := time.Date(2026, 9, 9, 12, 0, 0, 0, time.UTC)
	task := Task{Status: TaskExecuting, LeaseUntil: now.Add(3 * time.Minute).Format(time.RFC3339)}
	if LeaseExpired(task, now) {
		t.Fatal("a lease with time left must not be taken away underneath a working daemon")
	}
}

func TestLeaseExpiredReleasesWhenTheTimeHasPassed(t *testing.T) {
	now := time.Date(2026, 9, 9, 12, 0, 0, 0, time.UTC)
	task := Task{Status: TaskExecuting, LeaseUntil: now.Add(-time.Second).Format(time.RFC3339)}
	if !LeaseExpired(task, now) {
		t.Fatal("one second past the lease is past the lease")
	}
}

// A task claimed before leases existed, and one whose lease is unreadable,
// are both stranded forever if we give them the benefit of the doubt.
func TestLeaseExpiredTreatsAMissingOrBrokenLeaseAsOver(t *testing.T) {
	now := time.Now().UTC()
	for _, lease := range []string{"", "not a time", "2026-13-45T99:99:99Z"} {
		if !LeaseExpired(Task{Status: TaskExecuting, LeaseUntil: lease}, now) {
			t.Fatalf("a task whose lease reads %q would be held for ever", lease)
		}
	}
}

// A blocked task is deliberately exempt from the lease sweep: it is pinned to
// the daemon that asked, holding context — a question mid-conversation —
// nothing else has. Sweeping it back to approved the way a dead executing
// claim is swept would run the promise a second time out from under an
// answer that might already be on its way. This is the single fact the whole
// blocked design rests on, so it gets its own test: widening LeaseExpired to
// treat blocked as lease-bearing, or repointing the sweep's own query at the
// blocked partition instead of the executing one, must each break it.
func TestTheLeaseSweepNeverTouchesABlockedTask(t *testing.T) {
	// The sweep's query reads exactly one partition.
	in := expiredWorkInput("user_1", DefaultWorkLimit)
	if got := str(t, in.ExpressionAttributeValues[":pk"], ":pk"); got != "TASKSTATUS#user_1#executing" {
		t.Fatalf("the lease sweep reads %q, want the executing partition only — "+
			"a blocked task must never appear in what it scans", got)
	}

	// And even if a blocked task somehow reached that scan, or grew a
	// leaseUntil of its own, the judgment itself must refuse it.
	now := time.Date(2026, 9, 9, 12, 0, 0, 0, time.UTC)
	blocked := Task{Status: TaskBlocked, LeaseUntil: now.Add(-24 * time.Hour).Format(time.RFC3339)}
	if LeaseExpired(blocked, now) {
		t.Fatal("a blocked task must never read as lease-expired: it is pinned to the daemon that asked, not on loan")
	}
}

func TestClaimWritesALeaseInTheFuture(t *testing.T) {
	before := time.Now().UTC()
	input, err := claimWorkInput(Task{UserID: "u", CreatedAt: "c", TaskID: "t"}, "d", nowISO(),
		before.Add(WorkLease).Format(time.RFC3339))
	if err != nil {
		t.Fatal(err)
	}
	value, ok := input.ExpressionAttributeValues[":leaseUntil"]
	if !ok {
		t.Fatal("a claim that writes no lease is a claim nothing can take back")
	}
	text, ok := value.(*ddbtypes.AttributeValueMemberS)
	if !ok {
		t.Fatal("the lease must be written as a string")
	}
	until, err := time.Parse(time.RFC3339, text.Value)
	if err != nil {
		t.Fatalf("the lease must be a readable time, got %q", text.Value)
	}
	if !until.After(before) {
		t.Fatal("a lease that has already expired hands the task straight back")
	}
	if until.Sub(before) > 20*time.Minute {
		t.Fatal("a lease this long outlives the daemon's own run cap by too much to notice a death")
	}
}
