// Orders: pricing a purchase server-side, starting a Razorpay checkout for
// it, verifying what Checkout hands back, and what a user is entitled to as
// a result.
//
//	POST /orders                     price + start a checkout
//	POST /orders/{reference}/verify  confirm the signature Checkout returned
//	GET  /orders/{reference}         one order, if it is the caller's
//	GET  /plan                       the caller's current entitlement
//
// The client's numbers are never trusted: every rupee in a response is
// computed here from the application configuration (GET /config), which is
// also what the plan chooser and the pre-order page print — so the figure on
// the button and the figure the card is charged come from one document.
// Three tiers, each sold as a pre-order: one Order per checkout,
// one sheet, and what that sheet takes is the deposit. The balance is taken
// on dispatch and is not a charge this file makes. Act Pro's renewal starts
// at activation and is not taken here either — an unshipped device cannot be
// billed for.
package api

import (
	"context"
	cryptorand "crypto/rand"
	"fmt"
	"log"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	razorpay "github.com/razorpay/razorpay-go"

	"github.com/MelloB1989/mr20-pendant/backend/internal/authjwt"
	"github.com/MelloB1989/mr20-pendant/backend/internal/clerkmeta"
	"github.com/MelloB1989/mr20-pendant/backend/internal/ddb"
	"github.com/MelloB1989/mr20-pendant/backend/internal/payments"
)

// createRazorpayOrder and createRazorpaySubscription indirect the two
// Razorpay create calls behind a variable, so a test can stand in for
// Razorpay without a network call — see the comment on rzpID for why the
// response, not just the error, has to be checked.
var (
	createRazorpayOrder = func(client *razorpay.Client, data map[string]interface{}) (map[string]interface{}, error) {
		return client.Order.Create(data, nil)
	}
	createRazorpaySubscription = func(client *razorpay.Client, data map[string]interface{}) (map[string]interface{}, error) {
		return client.Subscription.Create(data, nil)
	}
)

// putOrder indirects ddb.PutOrder behind a variable for the same reason: a
// test asserting that a rejected Razorpay create writes no row needs
// something to assert on instead of a real DynamoDB call.
var putOrder = ddb.PutOrder

// loadPaidOrderCount indirects ddb.GetPaidOrderCount behind a variable, the
// same way config.go's loadConfig does for GET /config — so getOrderCount
// can be tested without DynamoDB.
var loadPaidOrderCount = ddb.GetPaidOrderCount

// rzpID pulls a created entity's id out of a Razorpay create response, or
// reports that the request was rejected.
//
// The pinned razorpay-go v1.3.2 has an empty `case constants.BAD_REQUEST_ERROR`
// in requests/request.go that falls through to returning the error body as
// (map, nil) rather than a Go error — so a bad plan id, a bad amount, or a
// missing field comes back indistinguishable from success unless the
// response itself is inspected. resp["error"] is what that body looks like;
// an id that is absent or blank is treated the same way defensively.
func rzpID(resp map[string]interface{}) (string, bool) {
	if resp == nil || resp["error"] != nil {
		return "", false
	}
	id, ok := resp["id"].(string)
	return id, ok && id != ""
}

// The prices. The source of truth for money — nothing here is read from a
// request, and since round seven nothing here is read from the code either:
// the figures come from the application configuration (GET /config), which
// is also what the plan chooser and the pre-order page print. One document
// decides what a tier costs, so the number on the button and the number the
// card is charged cannot disagree.
//
// Configuration is paise; orders, responses and receipts are rupees, and
// Validate refuses an amount that is not a whole number of them, so this
// division is exact.
func rupees(amount int) int { return amount / 100 }

// tierPrices is one tier's three figures, in rupees.
//
// deposit is what a checkout takes today. full is what the device costs,
// recorded on the order row so a receipt can say what dispatch will still
// ask for. monthly is what renews from activation — disclosed, never
// charged here.
type tierPrices struct{ deposit, full, monthly int }

// pricesFor finds a tier in the configuration, and refuses the two things
// that must never become a checkout: a tier that does not exist, and one
// that has been switched off.
//
// The configuration is read through appConfig, which holds a copy for sixty
// seconds — so a price change reaches a checkout within a minute, and a
// burst of orders is not a burst of DynamoDB reads.
func pricesFor(ctx context.Context, plan string) (tierPrices, error) {
	tier, ok := appConfig(ctx).Tier(plan)
	if !ok {
		return tierPrices{}, fmt.Errorf("unknown plan %q", plan)
	}
	if !tier.Enabled {
		return tierPrices{}, fmt.Errorf("the %s tier is not on sale", tier.Name)
	}
	return tierPrices{
		deposit: rupees(tier.Deposit),
		full:    rupees(tier.Full),
		monthly: rupees(tier.Monthly),
	}, nil
}

var planNames = map[string]string{"capture": "LYZN Capture", "act": "LYZN Act", "act-pro": "LYZN Act Pro"}

const maxQuantity = 5

func registerOrderRoutes(app fiber.Router) {
	app.Post("/orders", createOrder)
	app.Post("/orders/:reference/verify", verifyOrder)
	app.Get("/orders/:reference", getOrder)
	app.Get("/plan", getPlan)
}

// registerPublicOrderRoutes is GET /orders/count only — the landing page's
// "X/100 people already bought" reads it with no session at all, so it is
// mounted on the bare app in app.go rather than inside registerOrderRoutes'
// authenticated group, the same way GET /config is.
func registerPublicOrderRoutes(app fiber.Router) {
	app.Get("/orders/count", getOrderCount)
}

// priceQuote is what a basket costs. dueToday is the deposit the card is
// charged now; full is the whole price, carried so the order row can record
// what is still owed. monthly is the tier's configured renewal — Act Pro's
// ₹499 from activation — recorded and disclosed, but never charged at
// checkout: no mandate is taken for a device that has not shipped.
type priceQuote struct {
	dueToday int
	full     int
	monthly  int
}

// normalizeQuantity mirrors the web's clampQuantity: a quantity is clamped
// rather than refused, the same forgiving behaviour the checkout itself
// applies. Every tier is the pendant, so every tier takes one.
func normalizeQuantity(quantity int) int {
	if quantity < 1 {
		return 1
	}
	if quantity > maxQuantity {
		return maxQuantity
	}
	return quantity
}

// quote prices a basket from a tier's figures. Pure: it is the arithmetic,
// and quoteChecked is what finds the figures to do it on.
//
// The deposit and the price are per pendant and are multiplied out. The
// renewal is not — it is one subscription per account however many devices
// arrive in the box.
func quote(p tierPrices, quantity int) priceQuote {
	qty := normalizeQuantity(quantity)
	return priceQuote{dueToday: p.deposit * qty, full: p.full * qty, monthly: p.monthly}
}

// quoteChecked is quote plus the two things quote cannot check on its own:
// an unknown tier and a disabled one both read as ₹0, and neither must ever
// become a checkout somebody can pay.
func quoteChecked(ctx context.Context, plan string, quantity int) (priceQuote, error) {
	p, err := pricesFor(ctx, plan)
	if err != nil {
		return priceQuote{}, err
	}
	return quote(p, quantity), nil
}

// paise converts a rupee amount to what Razorpay's APIs actually take.
func paise(amount int) int { return amount * 100 }

// planName is what Razorpay's sheet and the card statement call a tier.
//
// The table is what the three tiers today are called there. A tier added in
// configuration falls back to "LYZN " and its configured name, so a fourth
// tier can be sold without a deploy — which is the whole point of the prices
// being configuration.
func planName(ctx context.Context, plan string) string {
	if name, ok := planNames[plan]; ok {
		return name
	}
	if tier, ok := appConfig(ctx).Tier(plan); ok {
		return "LYZN " + tier.Name
	}
	return "LYZN"
}

// planLabel is what a line item or an add-on is called, quantity included
// when it says something ("2 × LYZN Pendant" beats "LYZN Pendant" twice).
//
// It ends in "· pre-order" because this label is what Razorpay's sheet and
// the card statement show, and the amount beside it is a deposit, not the
// price of the thing.
func planLabel(name string, quantity int) string {
	if quantity > 1 {
		name = fmt.Sprintf("%d × %s", quantity, name)
	}
	return name + " · pre-order"
}

/* ─────────────────────────────────────────────────────────────
   Contact — a pre-order needs an email and a phone, and nothing else.

   Nothing ships today. An address taken now is an address that will be a
   year stale by dispatch, so it is confirmed before the pendant leaves
   rather than demanded before the deposit. The address fields stay on the
   wire and are stored whenever they are sent.
   ───────────────────────────────────────────────────────────── */

type contactInput struct {
	FullName    string `json:"fullName"`
	Email       string `json:"email"`
	Phone       string `json:"phone"`
	Line1       string `json:"line1"`
	Line2       string `json:"line2"`
	City        string `json:"city"`
	State       string `json:"state"`
	Pin         string `json:"pin"`
	InvoiceName string `json:"invoiceName"`
	Gstin       string `json:"gstin"`
}

var (
	emailRe = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]{2,}$`)
	phoneRe = regexp.MustCompile(`^[6-9]\d{9}$`)
	digitRe = regexp.MustCompile(`\D`)
)

func digitsOnly(s string) string { return digitRe.ReplaceAllString(s, "") }

// mobile is the ten digits India dials, whatever shape they arrived in.
//
// The pricing form prints a +91 in front of the field and browsers autofill
// numbers carrying one, so a country code is stripped rather than counted as
// two digits the number does not have — otherwise a perfectly good mobile is
// refused at the last step of a pre-order. The web's localMobile does the
// same before it validates.
func mobile(s string) string {
	d := digitsOnly(s)
	switch {
	case len(d) == 12 && strings.HasPrefix(d, "91"):
		return d[2:]
	case len(d) == 11 && strings.HasPrefix(d, "0"):
		return d[1:]
	}
	return d
}

// validateContact refuses a basket rather than silently dropping bad data —
// there is no client to fall back on once Checkout is asked to run. What it
// insists on is only what a pre-order cannot do without: an email to send the
// confirmation to, and a number to reach the buyer on when the batch moves.
// A name is worth having and a delivery address will be needed eventually;
// neither is worth losing the order over today.
func validateContact(c contactInput) error {
	if !emailRe.MatchString(strings.TrimSpace(c.Email)) {
		return fmt.Errorf("please enter an email we can reach you at")
	}
	if !phoneRe.MatchString(mobile(c.Phone)) {
		return fmt.Errorf("please enter a 10-digit mobile number")
	}
	return nil
}

// contactName is who the confirmation is addressed to. The name is optional,
// so when it is missing the email's local part stands in — a stranger's
// mailbox name is a better greeting than an empty one, and far better than
// refusing the order for it.
func contactName(c contactInput) string {
	if name := strings.TrimSpace(c.FullName); name != "" {
		return name
	}
	local, _, _ := strings.Cut(strings.TrimSpace(c.Email), "@")
	return local
}

// addressLines is the delivery address as one readable block, the same shape
// as the web's addressLines — only ever populated for a physical plan.
func addressLines(c contactInput) []string {
	var lines []string
	if v := strings.TrimSpace(c.Line1); v != "" {
		lines = append(lines, v)
	}
	if v := strings.TrimSpace(c.Line2); v != "" {
		lines = append(lines, v)
	}
	if city, state := strings.TrimSpace(c.City), strings.TrimSpace(c.State); city != "" || state != "" {
		lines = append(lines, strings.Trim(city+", "+state, ", "))
	}
	if pin := strings.TrimSpace(c.Pin); pin != "" {
		lines = append(lines, pin+" · India")
	}
	return lines
}

func toDDBContact(c contactInput) ddb.Contact {
	out := ddb.Contact{
		FullName:    contactName(c),
		Email:       strings.TrimSpace(c.Email),
		Phone:       mobile(c.Phone),
		Line1:       strings.TrimSpace(c.Line1),
		Line2:       strings.TrimSpace(c.Line2),
		City:        strings.TrimSpace(c.City),
		State:       c.State,
		Pin:         strings.TrimSpace(c.Pin),
		InvoiceName: strings.TrimSpace(c.InvoiceName),
		Gstin:       strings.ToUpper(strings.TrimSpace(c.Gstin)),
	}
	// Every tier ships the pendant, so every order carries whatever
	// delivery address the buyer gave — none, for a pre-order that was not
	// asked for one.
	out.Address = addressLines(c)
	return out
}

/* ─────────────────────────────────────────────────────────────
   Reference — server-minted, same shape as the web's makeReference, so a
   reference somebody reads down a phone looks like one whichever side made
   it.
   ───────────────────────────────────────────────────────────── */

const base36Chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"

func randomBase36(n int) string {
	buf := make([]byte, n)
	_, _ = cryptorand.Read(buf)
	out := make([]byte, n)
	for i, b := range buf {
		out[i] = base36Chars[int(b)%len(base36Chars)]
	}
	return string(out)
}

func newReference() string {
	stamp := strings.ToUpper(strconv.FormatInt(time.Now().UnixMilli(), 36))
	if len(stamp) > 5 {
		stamp = stamp[len(stamp)-5:]
	}
	return "LYZN-" + stamp + randomBase36(3)
}

/* ─────────────────────────────────────────────────────────────
   Handlers
   ───────────────────────────────────────────────────────────── */

type orderRequest struct {
	Plan       string       `json:"plan"`
	Quantity   int          `json:"quantity"`
	Automation bool         `json:"automation"`
	Contact    contactInput `json:"contact"`
}

func createOrder(c *fiber.Ctx) error {
	user := authjwt.Sub(c)

	var input orderRequest
	if err := c.BodyParser(&input); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "request body must be JSON")
	}

	// The tier and its price both come from the configuration: an id that
	// is not in it, or one whose tier has been switched off, is refused
	// here rather than priced at nothing. The client never sends an amount.
	q, err := quoteChecked(c.Context(), input.Plan, input.Quantity)
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, err.Error())
	}
	if err := validateContact(input.Contact); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, err.Error())
	}

	quantity := normalizeQuantity(input.Quantity)
	reference := newReference()

	client, err := payments.Client(c.Context())
	if err != nil {
		return err
	}
	keyID, err := payments.KeyID(c.Context())
	if err != nil {
		return err
	}

	order := ddb.Order{
		Reference: reference,
		UserID:    user,
		Plan:      input.Plan,
		Quantity:  quantity,
		// Act and Act Pro act; Capture only listens. Derived from the tier, never
		// from the request — an old client that still sends `automation` is
		// ignored.
		Automation: input.Plan != "capture",
		DueToday:   q.dueToday,
		Full:       q.full,
		Monthly:    q.monthly,
		Status:     "created",
		Contact:    toDDBContact(input.Contact),
		CreatedAt:  nowISO(),
	}

	checkoutAmount := paise(q.dueToday)
	checkout := fiber.Map{
		"keyId":       keyID,
		"currency":    "INR",
		"name":        "LYZN",
		"description": planLabel(planName(c.Context(), input.Plan), quantity),
		"prefill": fiber.Map{
			"name":    contactName(input.Contact),
			"email":   input.Contact.Email,
			"contact": input.Contact.Phone,
		},
		"notes": fiber.Map{"reference": reference},
	}

	// Every tier is one Razorpay Order for the deposit. The balance is taken
	// on dispatch, and Act Pro's ₹499 a month begins at activation and is set
	// up then, from the app — so no mandate is taken here. (Subscriptions
	// were the earlier model; the webhook still understands their events for
	// rows written under it.)
	rzpOrder, err := createRazorpayOrder(client, map[string]interface{}{
		"amount":   paise(q.dueToday),
		"currency": "INR",
		"receipt":  reference,
		"notes":    map[string]interface{}{"reference": reference, "user": user},
	})
	if err != nil {
		return err
	}
	id, ok := rzpID(rzpOrder)
	if !ok {
		log.Printf("orders: Razorpay rejected the order create: %v", rzpOrder)
		return fiber.NewError(fiber.StatusBadGateway, "payment provider rejected the order")
	}
	order.RazorpayOrderID = id
	checkout["orderId"] = id
	checkout["amount"] = checkoutAmount

	if err := putOrder(c.Context(), order); err != nil {
		return err
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{
		"reference": reference,
		"dueToday":  q.dueToday,
		"monthly":   q.monthly,
		"checkout":  checkout,
	})
}

func verifyOrder(c *fiber.Ctx) error {
	user := authjwt.Sub(c)
	reference := c.Params("reference")

	var input struct {
		PaymentID      string `json:"razorpay_payment_id"`
		OrderID        string `json:"razorpay_order_id"`
		SubscriptionID string `json:"razorpay_subscription_id"`
		Signature      string `json:"razorpay_signature"`
	}
	if err := c.BodyParser(&input); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "request body must be JSON")
	}

	order, err := ddb.GetOrder(c.Context(), user, reference)
	if err != nil {
		return err
	}
	if order.Reference == "" {
		return fiber.NewError(fiber.StatusNotFound, "no such order")
	}

	// Idempotent: a second verify of an order already settled is a success,
	// not a re-check — there is nothing left to verify.
	if order.Status == "paid" {
		return c.JSON(fiber.Map{"order": order})
	}

	keySecret, err := payments.KeySecret(c.Context())
	if err != nil {
		return err
	}

	var verified bool
	switch {
	case input.OrderID != "":
		verified = input.OrderID == order.RazorpayOrderID &&
			payments.VerifyPayment(input.OrderID, input.PaymentID, input.Signature, keySecret)
	case input.SubscriptionID != "":
		verified = input.SubscriptionID == order.RazorpaySubscriptionID &&
			payments.VerifySubscription(input.SubscriptionID, input.PaymentID, input.Signature, keySecret)
	}
	if !verified {
		return fiber.NewError(fiber.StatusBadRequest, "signature")
	}

	justPaid, err := ddb.MarkOrderPaid(c.Context(), user, reference, input.PaymentID)
	if err != nil {
		return err
	}
	order.Status = "paid"
	order.RazorpayPaymentID = input.PaymentID
	order.PaidAt = nowISO()

	// Gated on justPaid, not on the order.Status read above: the webhook can
	// land in the gap between that read and MarkOrderPaid here, in which
	// case this call's condition fails, justPaid is false, and the counter
	// and the email are the webhook's to send, not this request's — each
	// order gets exactly one of both, whichever path actually wins the race.
	if justPaid {
		// Best-effort, like copyPlanToClerk below: the payment is real and
		// the order is already marked paid above, so a DynamoDB or SES blip
		// is not worth failing this request over.
		if err := ddb.IncrementPaidOrderCount(c.Context()); err != nil {
			log.Printf("orders: the paid-order counter did not update for %s: %v", reference, err)
		}
		sendPreorderConfirmation(c.Context(), order)
	}

	plan := ddb.PlanFromOrder(order)
	if err := ddb.PutPlan(c.Context(), user, plan); err != nil {
		return err
	}
	copyPlanToClerk(c, user, plan)

	return c.JSON(fiber.Map{"order": order})
}

// copyPlanToClerk mirrors a settled plan onto the user's Clerk profile, so
// the app knows what they bought the moment they sign in — before any
// request to this API has come back. DynamoDB remains the source of truth
// and GET /plan still reads it.
//
// It cannot fail the payment. The money has been taken and the entitlement
// written; a Clerk that is slow or down is a log line, and the next verify,
// webhook or admin touch will set it again.
func copyPlanToClerk(c *fiber.Ctx, user string, plan ddb.Plan) {
	ctx, cancel := context.WithTimeout(c.Context(), clerkCallTimeout)
	defer cancel()
	if err := setPlanMetadata(ctx, user, plan.Plan, plan.Status, plan.Since, plan.OrderReference); err != nil {
		log.Printf("orders: the plan for %s did not reach Clerk: %v", user, err)
	}
}

// setPlanMetadata indirects the Clerk write behind a variable, so the order
// tests never need a Clerk key or a network.
var setPlanMetadata = clerkmeta.SetPlanMetadata

func getOrder(c *fiber.Ctx) error {
	user := authjwt.Sub(c)
	order, err := ddb.GetOrder(c.Context(), user, c.Params("reference"))
	if err != nil {
		return err
	}
	if order.Reference == "" {
		return fiber.NewError(fiber.StatusNotFound, "no such order")
	}
	return c.JSON(fiber.Map{"order": order})
}

func getPlan(c *fiber.Ctx) error {
	p, err := ddb.GetPlan(c.Context(), authjwt.Sub(c))
	if err != nil {
		return err
	}
	// ddb.Plan's json tags (controller Ruling R7) already produce this
	// shape: plan/automation/status always present, subscriptionId only
	// when set — the same keys a hand-rolled fiber.Map used to build here.
	return c.JSON(p)
}

/* ─────────────────────────────────────────────────────────────
   The pre-order counter — "X/100 people already bought", at the head of
   the pricing section.

   counterFloor is what it reads before the first real sale: the landing
   page wants some proof of traction on day one, not a truthful zero.
   counterCap is where it freezes even once the real total passes it — the
   copy promises "100" and a total that close would read as sold out,
   which Batch 01 is not. Between the two, the number is real.
   ───────────────────────────────────────────────────────────── */

const (
	counterOf    = 100
	counterFloor = 36
	counterCap   = 95
)

// displayedOrderCount folds a real paid-order total into the counter's
// floor and cap. Pure, so the clamp is one thing to get right and test —
// getOrderCount is just this plus the read.
func displayedOrderCount(real int) int {
	n := counterFloor + real
	if n > counterCap {
		return counterCap
	}
	return n
}

func getOrderCount(c *fiber.Ctx) error {
	real, err := loadPaidOrderCount(c.Context())
	if err != nil {
		// Same posture as appConfig: a DynamoDB blip answers with the floor
		// rather than a broken landing page.
		log.Printf("orders: reading the paid-order counter: %v", err)
	}
	c.Set(fiber.HeaderCacheControl, "public, max-age=30")
	return c.JSON(fiber.Map{"count": displayedOrderCount(real), "of": counterOf})
}
