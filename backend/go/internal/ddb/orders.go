package ddb

import (
	"context"
	"errors"
	"strconv"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	ddbtypes "github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// Order is one checkout: a pendant or software purchase, one-time or
// recurring. Reference is minted by the caller (LYZN-<n> or similar) and is
// what the user's own history keys off; the Razorpay ids are theirs, and
// exist here so the webhook — which only knows a Razorpay id — can find the
// row without a user id, via GSI1.
// json tags mirror the dynamodbav ones (camelCase, omitempty where the
// dynamodbav tag has it) so `c.JSON(fiber.Map{"order": order})` emits the
// same wire shape the web's checkout/order-history code expects — controller
// Ruling R7. Without them Go's default field-name JSON keys (`Reference`,
// `UserID`, ...) would leak instead.
type Order struct {
	Reference  string `dynamodbav:"reference" json:"reference"`
	UserID     string `dynamodbav:"userId" json:"userId"`
	Plan       string `dynamodbav:"plan" json:"plan"` // capture | act | act-pro
	Quantity   int    `dynamodbav:"quantity" json:"quantity"`
	Automation bool   `dynamodbav:"automation" json:"automation"`
	DueToday   int    `dynamodbav:"dueToday" json:"dueToday"` // rupees; the pre-order deposit, which is what was charged
	Full       int    `dynamodbav:"full" json:"full"`         // rupees; the whole price, so a receipt can say what dispatch still takes
	Monthly    int    `dynamodbav:"monthly" json:"monthly"`   // rupees; always 0 under the tier model, kept for older rows
	Status     string `dynamodbav:"status" json:"status"`     // created | paid | failed

	RazorpayOrderID        string `dynamodbav:"rzpOrderId,omitempty" json:"rzpOrderId,omitempty"`
	RazorpaySubscriptionID string `dynamodbav:"rzpSubscriptionId,omitempty" json:"rzpSubscriptionId,omitempty"`
	RazorpayPaymentID      string `dynamodbav:"rzpPaymentId,omitempty" json:"rzpPaymentId,omitempty"`

	Contact Contact `dynamodbav:"contact" json:"contact"`

	CreatedAt string `dynamodbav:"createdAt" json:"createdAt"`
	PaidAt    string `dynamodbav:"paidAt,omitempty" json:"paidAt,omitempty"`
}

// Contact is the billing and shipping information a checkout collects.
type Contact struct {
	FullName    string   `json:"fullName"`
	Email       string   `json:"email"`
	Phone       string   `json:"phone"`
	Line1       string   `json:"line1"`
	Line2       string   `json:"line2"`
	City        string   `json:"city"`
	State       string   `json:"state"`
	Pin         string   `json:"pin"`
	InvoiceName string   `json:"invoiceName"`
	Gstin       string   `json:"gstin"`
	Address     []string `json:"address"`
}

// Plan is what a user is entitled to right now — derived from their most
// recent paid order, but stored on its own row so reads don't have to
// reconstruct it from order history every time.
type Plan struct {
	Plan           string `dynamodbav:"plan" json:"plan"` // capture | act | act-pro | none
	Automation     bool   `dynamodbav:"automation" json:"automation"`
	SubscriptionID string `dynamodbav:"subscriptionId,omitempty" json:"subscriptionId,omitempty"`
	Status         string `dynamodbav:"status" json:"status"` // active | halted | cancelled | none
	Since          string `dynamodbav:"since,omitempty" json:"since,omitempty"`
	OrderReference string `dynamodbav:"orderReference,omitempty" json:"orderReference,omitempty"`
}

func orderPK(userID string) string    { return userPK(userID) }
func orderSK(reference string) string { return "ORDER#" + reference }
func rzpGSI(id string) string         { return "RZP#" + id }

// razorpayID picks whichever Razorpay id an order was created against — an
// order for a one-time purchase, a subscription for a recurring one. Never
// both, in practice.
func razorpayID(o Order) string {
	if o.RazorpayOrderID != "" {
		return o.RazorpayOrderID
	}
	return o.RazorpaySubscriptionID
}

// PutOrder writes the order row, indexed under its own Razorpay id (GSI1) so
// the webhook can find it later without a user id.
func PutOrder(ctx context.Context, o Order) error {
	item, err := attributevalue.MarshalMap(o)
	if err != nil {
		return err
	}
	item["PK"] = s(orderPK(o.UserID))
	item["SK"] = s(orderSK(o.Reference))
	if id := razorpayID(o); id != "" {
		item["GSI1PK"] = s(rzpGSI(id))
		item["GSI1SK"] = s("ORDER")
	}
	_, err = client.PutItem(ctx, &dynamodb.PutItemInput{TableName: &table, Item: item})
	return err
}

func unmarshalOrder(item map[string]ddbtypes.AttributeValue) (Order, error) {
	stripKeys(item)
	var o Order
	if err := attributevalue.UnmarshalMap(item, &o); err != nil {
		return Order{}, err
	}
	return o, nil
}

// GetOrder returns the zero Order, no error, when the row is absent — a
// caller checking whether a reference is theirs treats "not found" as data,
// not failure.
func GetOrder(ctx context.Context, userID, reference string) (Order, error) {
	out, err := client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: &table,
		Key:       map[string]ddbtypes.AttributeValue{"PK": s(orderPK(userID)), "SK": s(orderSK(reference))},
	})
	if err != nil || out.Item == nil {
		return Order{}, err
	}
	return unmarshalOrder(out.Item)
}

// OrderByRazorpayID looks an order up by the id Razorpay's webhook carries —
// the only handle a webhook has, since it never sees our user id.
func OrderByRazorpayID(ctx context.Context, id string) (Order, error) {
	out, err := client.Query(ctx, &dynamodb.QueryInput{
		TableName:              &table,
		IndexName:              aws.String("GSI1"),
		KeyConditionExpression: aws.String("GSI1PK = :pk AND GSI1SK = :sk"),
		ExpressionAttributeValues: map[string]ddbtypes.AttributeValue{
			":pk": s(rzpGSI(id)), ":sk": s("ORDER"),
		},
	})
	if err != nil {
		return Order{}, err
	}
	if len(out.Items) == 0 {
		return Order{}, nil
	}
	return unmarshalOrder(out.Items[0])
}

// markOrderPaidInput builds MarkOrderPaid's UpdateItemInput as its own step,
// the same reason markOrderFailedInput does: the expression can be checked
// without a DynamoDB client.
func markOrderPaidInput(userID, reference, paymentID string) *dynamodb.UpdateItemInput {
	return &dynamodb.UpdateItemInput{
		TableName:                &table,
		Key:                      map[string]ddbtypes.AttributeValue{"PK": s(orderPK(userID)), "SK": s(orderSK(reference))},
		UpdateExpression:         aws.String("SET #status = :paid, rzpPaymentId = :pid, paidAt = :now"),
		ExpressionAttributeNames: map[string]string{"#status": "status"},
		ExpressionAttributeValues: map[string]ddbtypes.AttributeValue{
			":paid": s("paid"), ":pid": s(paymentID), ":now": s(nowISO()),
		},
		ConditionExpression: aws.String("attribute_exists(PK) AND #status <> :paid"),
	}
}

// MarkOrderPaid records the payment that settled an order, exactly once.
// justPaid is true only for the call that actually flips the row to paid —
// a webhook retry, or the webhook and the client's own verify racing each
// other, land on the same already-paid row and get justPaid=false back
// instead of a rewritten paidAt. Callers gate anything that must happen
// once per order — the pre-order counter, the confirmation email — on
// justPaid rather than on their own read of the order beforehand, which
// cannot see a write that lands in between.
//
// The condition failing is not an error, the same way MarkOrderFailed's is
// not: ConditionalCheckFailedException here means "already paid", which is
// the correct, expected outcome of a retry, not a bug to propagate.
func MarkOrderPaid(ctx context.Context, userID, reference, paymentID string) (justPaid bool, err error) {
	_, err = client.UpdateItem(ctx, markOrderPaidInput(userID, reference, paymentID))
	var conditionFailed *ddbtypes.ConditionalCheckFailedException
	if errors.As(err, &conditionFailed) {
		return false, nil
	}
	return err == nil, err
}

// markOrderFailedInput builds MarkOrderFailed's UpdateItemInput as its own
// step so the expression/attribute-value construction can be unit-tested
// without a DynamoDB client.
func markOrderFailedInput(userID, reference string) *dynamodb.UpdateItemInput {
	return &dynamodb.UpdateItemInput{
		TableName:                &table,
		Key:                      map[string]ddbtypes.AttributeValue{"PK": s(orderPK(userID)), "SK": s(orderSK(reference))},
		UpdateExpression:         aws.String("SET #status = :failed"),
		ExpressionAttributeNames: map[string]string{"#status": "status"},
		ExpressionAttributeValues: map[string]ddbtypes.AttributeValue{
			":failed": s("failed"), ":paid": s("paid"),
		},
		ConditionExpression: aws.String("attribute_exists(PK) AND #status <> :paid"),
	}
}

// MarkOrderFailed records a failed payment as a narrow, conditional update —
// never a read-then-Put of the whole row. The condition is what closes the
// race a full overwrite has: a concurrent payment.captured's MarkOrderPaid
// can commit between a read and a later Put, and the stale copy would then
// clobber the paid row. Here, a captured payment that lands first simply
// fails the "#status <> :paid" condition, and that failure — like
// MarkOrderPaid's on a missing row — is the correct outcome, not an error, so
// ConditionalCheckFailedException is swallowed the same way TouchDevice's
// pairing guard is.
func MarkOrderFailed(ctx context.Context, userID, reference string) error {
	_, err := client.UpdateItem(ctx, markOrderFailedInput(userID, reference))
	var conditionFailed *ddbtypes.ConditionalCheckFailedException
	if errors.As(err, &conditionFailed) {
		return nil
	}
	return err
}

// PutPlan writes the user's current entitlement.
func PutPlan(ctx context.Context, userID string, p Plan) error {
	item, err := attributevalue.MarshalMap(p)
	if err != nil {
		return err
	}
	item["PK"] = s(userPK(userID))
	item["SK"] = s("PLAN")
	_, err = client.PutItem(ctx, &dynamodb.PutItemInput{TableName: &table, Item: item})
	return err
}

// GetPlan returns Plan{Plan:"none",Status:"none"} for a user who has never
// paid for anything — absence is a state, not an error.
func GetPlan(ctx context.Context, userID string) (Plan, error) {
	out, err := client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: &table,
		Key:       map[string]ddbtypes.AttributeValue{"PK": s(userPK(userID)), "SK": s("PLAN")},
	})
	if err != nil {
		return Plan{}, err
	}
	if out.Item == nil {
		return Plan{Plan: "none", Status: "none"}, nil
	}
	stripKeys(out.Item)
	var p Plan
	if err := attributevalue.UnmarshalMap(out.Item, &p); err != nil {
		return Plan{}, err
	}
	return p, nil
}

// PlanFromOrder derives the entitlement a paid order grants. It is pure and
// assumes the order is paid — callers only reach for it once MarkOrderPaid
// has succeeded.
func PlanFromOrder(o Order) Plan {
	return Plan{
		Plan:           o.Plan,
		Automation:     o.Automation,
		SubscriptionID: o.RazorpaySubscriptionID,
		Status:         "active",
		Since:          o.PaidAt,
		OrderReference: o.Reference,
	}
}

/* ─────────────────────────────────────────────────────────────
   Pre-order counter — one row outside any user's partition, counting
   orders that have been paid. It backs the landing page's "X/100 people
   already bought": the API layer folds this raw total into the copy's
   floor and cap, this package just keeps the true count.
   ───────────────────────────────────────────────────────────── */

func statsKey() map[string]ddbtypes.AttributeValue {
	return map[string]ddbtypes.AttributeValue{"PK": s("STATS"), "SK": s("PAID_ORDERS")}
}

// incrementPaidOrderCountInput is IncrementPaidOrderCount's UpdateItemInput,
// split out so the expression can be checked without a DynamoDB client.
func incrementPaidOrderCountInput() *dynamodb.UpdateItemInput {
	return &dynamodb.UpdateItemInput{
		TableName:                 &table,
		Key:                       statsKey(),
		UpdateExpression:          aws.String("ADD paidCount :one"),
		ExpressionAttributeValues: map[string]ddbtypes.AttributeValue{":one": &ddbtypes.AttributeValueMemberN{Value: "1"}},
	}
}

// IncrementPaidOrderCount bumps the running total of paid orders by one.
// ADD on a row that does not exist yet creates it at the delta, so there is
// nothing to seed — the first paid order writes paidCount = 1 itself.
func IncrementPaidOrderCount(ctx context.Context) error {
	_, err := client.UpdateItem(ctx, incrementPaidOrderCountInput())
	return err
}

// GetPaidOrderCount reads the running total — zero for a table that has
// never had a paid order, the same "absence is a state" reading GetPlan
// gives a user with no plan.
func GetPaidOrderCount(ctx context.Context) (int, error) {
	out, err := client.GetItem(ctx, &dynamodb.GetItemInput{TableName: &table, Key: statsKey()})
	if err != nil || out.Item == nil {
		return 0, err
	}
	n, ok := out.Item["paidCount"].(*ddbtypes.AttributeValueMemberN)
	if !ok {
		return 0, nil
	}
	count, err := strconv.Atoi(n.Value)
	if err != nil {
		return 0, nil
	}
	return count, nil
}
