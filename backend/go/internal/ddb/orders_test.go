package ddb

import (
	"testing"

	"github.com/aws/aws-sdk-go-v2/aws"
	ddbtypes "github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// TestMarkOrderFailedInput checks the UpdateItemInput MarkOrderFailed sends,
// in isolation from any DynamoDB client — there is no client/interface
// abstraction to inject a fake into (client is a concrete *dynamodb.Client),
// so this is the part of MarkOrderFailed that can be exercised without a
// live or mocked table. What it guards: the condition must refuse to
// downgrade a row a concurrent payment.captured already marked paid, closing
// the read-then-Put race the previous handlePaymentFailed had.
func TestMarkOrderFailedInput(t *testing.T) {
	in := markOrderFailedInput("user_1", "LYZN-1")

	pk, ok := in.Key["PK"].(*ddbtypes.AttributeValueMemberS)
	if !ok || pk.Value != "USER#user_1" {
		t.Fatalf("PK: %+v", in.Key["PK"])
	}
	sk, ok := in.Key["SK"].(*ddbtypes.AttributeValueMemberS)
	if !ok || sk.Value != "ORDER#LYZN-1" {
		t.Fatalf("SK: %+v", in.Key["SK"])
	}
	if aws.ToString(in.UpdateExpression) != "SET #status = :failed" {
		t.Fatalf("UpdateExpression: %q", aws.ToString(in.UpdateExpression))
	}
	if in.ExpressionAttributeNames["#status"] != "status" {
		t.Fatalf("ExpressionAttributeNames: %+v", in.ExpressionAttributeNames)
	}
	failed, ok := in.ExpressionAttributeValues[":failed"].(*ddbtypes.AttributeValueMemberS)
	if !ok || failed.Value != "failed" {
		t.Fatalf(":failed: %+v", in.ExpressionAttributeValues[":failed"])
	}
	paid, ok := in.ExpressionAttributeValues[":paid"].(*ddbtypes.AttributeValueMemberS)
	if !ok || paid.Value != "paid" {
		t.Fatalf(":paid: %+v", in.ExpressionAttributeValues[":paid"])
	}
	// The condition, not a status check in Go, is what makes the update
	// atomic: attribute_exists guards a never-created row (MarkOrderPaid's
	// existing guard) and "#status <> :paid" is the new part — a concurrent
	// MarkOrderPaid that commits first makes this condition fail, and that
	// failure is treated as success by MarkOrderFailed, not propagated.
	if aws.ToString(in.ConditionExpression) != "attribute_exists(PK) AND #status <> :paid" {
		t.Fatalf("ConditionExpression: %q", aws.ToString(in.ConditionExpression))
	}
}

// TestMarkOrderPaidInput checks the condition that makes MarkOrderPaid land
// exactly once: a webhook redelivery, or the webhook and the client's own
// verify racing each other, must both refuse to re-fire — not silently
// rewrite paidAt, which is what justPaid=false being distinguishable from
// justPaid=true depends on.
func TestMarkOrderPaidInput(t *testing.T) {
	in := markOrderPaidInput("user_1", "LYZN-1", "pay_1")

	pk, ok := in.Key["PK"].(*ddbtypes.AttributeValueMemberS)
	if !ok || pk.Value != "USER#user_1" {
		t.Fatalf("PK: %+v", in.Key["PK"])
	}
	sk, ok := in.Key["SK"].(*ddbtypes.AttributeValueMemberS)
	if !ok || sk.Value != "ORDER#LYZN-1" {
		t.Fatalf("SK: %+v", in.Key["SK"])
	}
	if aws.ToString(in.UpdateExpression) != "SET #status = :paid, rzpPaymentId = :pid, paidAt = :now" {
		t.Fatalf("UpdateExpression: %q", aws.ToString(in.UpdateExpression))
	}
	pid, ok := in.ExpressionAttributeValues[":pid"].(*ddbtypes.AttributeValueMemberS)
	if !ok || pid.Value != "pay_1" {
		t.Fatalf(":pid: %+v", in.ExpressionAttributeValues[":pid"])
	}
	// The part that changed: not just attribute_exists(PK) any more — a row
	// already paid must fail this condition too, so a redelivered webhook
	// gets justPaid=false instead of a fresh paidAt and a second email.
	if aws.ToString(in.ConditionExpression) != "attribute_exists(PK) AND #status <> :paid" {
		t.Fatalf("ConditionExpression: %q", aws.ToString(in.ConditionExpression))
	}
}

func TestPlanFromOrder(t *testing.T) {
	o := Order{Reference: "LYZN-1", Plan: "pendant", Automation: true, RazorpaySubscriptionID: "sub_1", PaidAt: "2026-09-07T00:00:00Z"}
	p := PlanFromOrder(o)
	if p.Plan != "pendant" || !p.Automation || p.SubscriptionID != "sub_1" || p.Status != "active" || p.OrderReference != "LYZN-1" {
		t.Fatalf("got %+v", p)
	}
	if PlanFromOrder(Order{Plan: "software"}).Status != "active" {
		t.Fatal("a paid one-time plan is active")
	}
}

func TestOrderKeys(t *testing.T) {
	if orderPK("user_1") != "USER#user_1" || orderSK("LYZN-1") != "ORDER#LYZN-1" || rzpGSI("order_9") != "RZP#order_9" {
		t.Fatal("key scheme")
	}
}

// TestIncrementPaidOrderCountInput checks the ADD expression the counter
// relies on to stay correct under concurrent verifies: two payments settling
// at once must both land, not race a read-modify-write.
func TestIncrementPaidOrderCountInput(t *testing.T) {
	in := incrementPaidOrderCountInput()

	pk, ok := in.Key["PK"].(*ddbtypes.AttributeValueMemberS)
	if !ok || pk.Value != "STATS" {
		t.Fatalf("PK: %+v", in.Key["PK"])
	}
	sk, ok := in.Key["SK"].(*ddbtypes.AttributeValueMemberS)
	if !ok || sk.Value != "PAID_ORDERS" {
		t.Fatalf("SK: %+v", in.Key["SK"])
	}
	if aws.ToString(in.UpdateExpression) != "ADD paidCount :one" {
		t.Fatalf("UpdateExpression: %q", aws.ToString(in.UpdateExpression))
	}
	one, ok := in.ExpressionAttributeValues[":one"].(*ddbtypes.AttributeValueMemberN)
	if !ok || one.Value != "1" {
		t.Fatalf(":one: %+v", in.ExpressionAttributeValues[":one"])
	}
}
