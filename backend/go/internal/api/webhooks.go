// The Razorpay webhook: the source of truth for what was actually paid.
//
//	POST /webhooks/razorpay
//
// Registered outside the authenticated group in app.go — Razorpay is not a
// signed-in user, and the HMAC over the raw body, checked against the
// webhook's own secret (never the key secret Checkout's signatures use), is
// the only thing that stands in for auth here.
//
// Razorpay retries a webhook forever until it sees a 2xx, so every path that
// is not a bad signature ends in 200: an event we don't act on, or an id we
// don't recognise, is not something retrying will ever fix.
package api

import (
	"encoding/json"
	"log"

	"github.com/gofiber/fiber/v2"

	"github.com/MelloB1989/mr20-pendant/backend/internal/ddb"
	"github.com/MelloB1989/mr20-pendant/backend/internal/payments"
)

type webhookEvent struct {
	Event   string `json:"event"`
	Payload struct {
		Payment struct {
			Entity struct {
				ID             string `json:"id"`
				OrderID        string `json:"order_id"`
				SubscriptionID string `json:"subscription_id"`
			} `json:"entity"`
		} `json:"payment"`
		Subscription struct {
			Entity struct {
				ID     string `json:"id"`
				Status string `json:"status"`
			} `json:"entity"`
		} `json:"subscription"`
	} `json:"payload"`
}

// statusFor maps a subscription event to the plan status it leaves behind.
// Payment events are handled separately: they change an order's status, not
// a plan's.
func statusFor(event string) string {
	switch event {
	case "subscription.activated", "subscription.charged":
		return "active"
	case "subscription.halted":
		return "halted"
	case "subscription.cancelled", "subscription.completed":
		return "cancelled"
	default:
		return ""
	}
}

func razorpayWebhook(c *fiber.Ctx) error {
	body := c.Body()
	signature := c.Get("X-Razorpay-Signature")

	secret, err := payments.WebhookSecret(c.Context())
	if err != nil {
		log.Printf("webhook: resolving the webhook secret: %v", err)
		return fiber.NewError(fiber.StatusUnauthorized, "signature")
	}
	if secret == "" {
		log.Printf("webhook: no webhook secret configured; refusing every signature")
	}
	if !payments.VerifyWebhook(body, signature, secret) {
		return fiber.NewError(fiber.StatusUnauthorized, "signature")
	}

	var evt webhookEvent
	if err := json.Unmarshal(body, &evt); err != nil {
		log.Printf("webhook: body did not parse as JSON: %v", err)
		return c.SendStatus(fiber.StatusOK)
	}

	switch evt.Event {
	case "payment.captured":
		handlePaymentCaptured(c, evt)
	case "payment.failed":
		handlePaymentFailed(c, evt)
	case "subscription.activated", "subscription.charged", "subscription.halted",
		"subscription.cancelled", "subscription.completed":
		handleSubscriptionEvent(c, evt)
	default:
		log.Printf("webhook: ignoring event %q", evt.Event)
	}

	return c.SendStatus(fiber.StatusOK)
}

// lookupOrder resolves an order by whichever Razorpay id the payment entity
// carries. A subscription's payment.captured payload carries subscription_id
// on the payment entity rather than order_id, so order_id is tried first and
// subscription_id second — never both.
func lookupOrder(c *fiber.Ctx, orderID, subscriptionID string) (ddb.Order, error) {
	if orderID != "" {
		o, err := ddb.OrderByRazorpayID(c.Context(), orderID)
		if err != nil || o.Reference != "" {
			return o, err
		}
	}
	if subscriptionID != "" {
		return ddb.OrderByRazorpayID(c.Context(), subscriptionID)
	}
	return ddb.Order{}, nil
}

func handlePaymentCaptured(c *fiber.Ctx, evt webhookEvent) {
	entity := evt.Payload.Payment.Entity
	order, err := lookupOrder(c, entity.OrderID, entity.SubscriptionID)
	if err != nil {
		log.Printf("webhook: payment.captured: looking up %s/%s: %v", entity.OrderID, entity.SubscriptionID, err)
		return
	}
	if order.Reference == "" {
		// Not a row we have. Nothing here retrying would fix.
		log.Printf("webhook: payment.captured for unknown order/subscription %s/%s", entity.OrderID, entity.SubscriptionID)
		return
	}
	justPaid, err := ddb.MarkOrderPaid(c.Context(), order.UserID, order.Reference, entity.ID)
	if err != nil {
		log.Printf("webhook: payment.captured: MarkOrderPaid %s: %v", order.Reference, err)
		return
	}
	order.Status = "paid"
	order.RazorpayPaymentID = entity.ID
	order.PaidAt = nowISO()
	plan := ddb.PlanFromOrder(order)
	if err := ddb.PutPlan(c.Context(), order.UserID, plan); err != nil {
		log.Printf("webhook: payment.captured: PutPlan for %s: %v", order.Reference, err)
		return
	}
	// The same copy onto the Clerk profile the verify handler makes — this
	// is the other way an order settles, and a payment that only Razorpay
	// told us about should leave the user in the same state. It cannot fail
	// the webhook: Razorpay retries anything that is not a 2xx, and there is
	// nothing a retry would fix here.
	copyPlanToClerk(c, order.UserID, plan)

	// Gated on justPaid: Razorpay redelivers a webhook until it sees a 2xx,
	// and this same event can also lose the race to the client's own verify
	// — either way, a call that did not just flip the row to paid is not
	// the one that gets to count it or email the receipt.
	if justPaid {
		if err := ddb.IncrementPaidOrderCount(c.Context()); err != nil {
			log.Printf("webhook: payment.captured: paid-order counter for %s: %v", order.Reference, err)
		}
		sendPreorderConfirmation(c.Context(), order)
	}
}

func handlePaymentFailed(c *fiber.Ctx, evt webhookEvent) {
	entity := evt.Payload.Payment.Entity
	order, err := lookupOrder(c, entity.OrderID, entity.SubscriptionID)
	if err != nil {
		log.Printf("webhook: payment.failed: looking up %s/%s: %v", entity.OrderID, entity.SubscriptionID, err)
		return
	}
	if order.Reference == "" {
		log.Printf("webhook: payment.failed for unknown order/subscription %s/%s", entity.OrderID, entity.SubscriptionID)
		return
	}
	// A conditional update, not a read-then-Put of the whole row: a
	// concurrent payment.captured's MarkOrderPaid can commit between the
	// lookupOrder read above and here, and a full-row Put built from the
	// stale copy would clobber the paid row. MarkOrderFailed's own condition
	// refuses to downgrade an order that is already paid, and treats that
	// refusal as success.
	if err := ddb.MarkOrderFailed(c.Context(), order.UserID, order.Reference); err != nil {
		log.Printf("webhook: payment.failed: MarkOrderFailed for %s: %v", order.Reference, err)
	}
}

func handleSubscriptionEvent(c *fiber.Ctx, evt webhookEvent) {
	entity := evt.Payload.Subscription.Entity
	status := statusFor(evt.Event)
	if status == "" || entity.ID == "" {
		return
	}
	order, err := ddb.OrderByRazorpayID(c.Context(), entity.ID)
	if err != nil {
		log.Printf("webhook: %s: looking up %s: %v", evt.Event, entity.ID, err)
		return
	}
	if order.Reference == "" {
		log.Printf("webhook: %s for unknown subscription %s", evt.Event, entity.ID)
		return
	}
	plan, err := ddb.GetPlan(c.Context(), order.UserID)
	if err != nil {
		log.Printf("webhook: %s: GetPlan for %s: %v", evt.Event, order.UserID, err)
		return
	}
	// A full overwrite, same as everywhere else PutPlan is used: a replayed
	// event sets the same status to the same value rather than needing a
	// conditional check to be idempotent.
	plan.Status = status
	if err := ddb.PutPlan(c.Context(), order.UserID, plan); err != nil {
		log.Printf("webhook: %s: PutPlan for %s: %v", evt.Event, order.UserID, err)
	}
}
