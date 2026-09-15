package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v2"
	razorpay "github.com/razorpay/razorpay-go"

	"github.com/MelloB1989/mr20-pendant/backend/internal/ddb"
)

func init() {
	// Dummy Razorpay credentials so payments.Client resolves from the
	// environment (config.Razorpay prefers Direct over the Secrets Manager
	// ARN) instead of needing AWS. Nothing below ever reaches Razorpay or
	// DynamoDB: createRazorpayOrder/createRazorpaySubscription and putOrder
	// are stubbed per test, and razorpay.NewClient itself makes no network
	// call — it only builds a struct.
	os.Setenv("RAZORPAY_KEY_ID", "rzp_test_dummy")
	os.Setenv("RAZORPAY_KEY_SECRET", "dummy_secret")
}

// stubOrderBody is a full request body: everything the older checkout
// collected, which a pre-order still accepts and still stores.
const stubOrderBody = `{"plan":"capture","quantity":1,"contact":{"fullName":"A B","email":"a@b.com","phone":"9876543210","line1":"1 Road","city":"Pune","state":"MH","pin":"411001"}}`

// stubPreOrderBody is what the pre-order flow actually sends: an email and a
// phone, no name and no address.
const stubPreOrderBody = `{"plan":"act","quantity":1,"contact":{"email":"asha.rao@example.in","phone":"9876543210"}}`

// stubLegacyBody is what a client built before the tier model sends: the
// old plan name is refused, and the `automation` flag is ignored rather
// than starting a subscription.
const stubLegacyBody = `{"plan":"act","quantity":1,"automation":true,"contact":{"fullName":"A B","email":"a@b.com","phone":"9876543210","line1":"1 Road","city":"Pune","state":"MH","pin":"411001"}}`

func postOrder(t *testing.T, body string) *http.Response {
	t.Helper()
	app := fiber.New()
	app.Post("/orders", createOrder)
	req := httptest.NewRequest("POST", "/orders", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	res, err := app.Test(req)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	return res
}

// TestCreateOrderRejectsRazorpayBadRequest covers finding 1: the pinned
// razorpay-go v1.3.2 returns a 400's error body as (map, nil), not a Go
// error, so client.Order.Create's response has to be inspected, not just its
// error. A rejected create must never be treated as success — no row
// written, and the caller told the provider rejected it.
func TestCreateOrderRejectsRazorpayBadRequest(t *testing.T) {
	origCreate, origPut := createRazorpayOrder, putOrder
	defer func() { createRazorpayOrder, putOrder = origCreate, origPut }()

	createRazorpayOrder = func(client *razorpay.Client, data map[string]interface{}) (map[string]interface{}, error) {
		return map[string]interface{}{
			"error": map[string]interface{}{"code": "BAD_REQUEST_ERROR", "description": "the amount is invalid"},
		}, nil
	}
	putOrderCalled := false
	putOrder = func(ctx context.Context, o ddb.Order) error {
		putOrderCalled = true
		return nil
	}

	res := postOrder(t, stubOrderBody)
	if res.StatusCode != fiber.StatusBadGateway {
		t.Fatalf("got %d, want %d", res.StatusCode, fiber.StatusBadGateway)
	}
	if putOrderCalled {
		t.Fatal("PutOrder must not be called when Razorpay rejects the create")
	}
}

// TestAutomationFlagIsIgnored: under the tier model there is no subscription
// branch. A body that still says automation:true must go through the Order
// path and never touch the Subscription API.
func TestAutomationFlagIsIgnored(t *testing.T) {
	origOrder, origSub, origPut := createRazorpayOrder, createRazorpaySubscription, putOrder
	defer func() { createRazorpayOrder, createRazorpaySubscription, putOrder = origOrder, origSub, origPut }()

	subCalled := false
	createRazorpaySubscription = func(client *razorpay.Client, data map[string]interface{}) (map[string]interface{}, error) {
		subCalled = true
		return map[string]interface{}{"id": "sub_should_not_happen"}, nil
	}
	createRazorpayOrder = func(client *razorpay.Client, data map[string]interface{}) (map[string]interface{}, error) {
		if got := data["amount"]; got != 99900 {
			t.Errorf("order amount = %v, want 99900 paise — act's deposit, not its price", got)
		}
		return map[string]interface{}{"id": "order_1"}, nil
	}
	putOrder = func(ctx context.Context, o ddb.Order) error {
		if o.RazorpaySubscriptionID != "" {
			t.Errorf("order row carries a subscription id: %q", o.RazorpaySubscriptionID)
		}
		if !o.Automation {
			t.Errorf("act must be recorded as an acting tier")
		}
		return nil
	}

	res := postOrder(t, stubLegacyBody)
	if res.StatusCode != fiber.StatusCreated {
		t.Fatalf("status = %d, want 201", res.StatusCode)
	}
	if subCalled {
		t.Fatal("the subscription API was called; every tier is a one-time order")
	}
}

func TestRzpID(t *testing.T) {
	cases := []struct {
		name string
		resp map[string]interface{}
		want bool
	}{
		{"success", map[string]interface{}{"id": "order_abc123"}, true},
		{"error body", map[string]interface{}{"error": map[string]interface{}{"code": "BAD_REQUEST_ERROR"}}, false},
		{"error body with stray id", map[string]interface{}{"error": map[string]interface{}{"code": "BAD_REQUEST_ERROR"}, "id": ""}, false},
		{"missing id", map[string]interface{}{}, false},
		{"blank id", map[string]interface{}{"id": ""}, false},
		{"nil response", nil, false},
	}
	for _, c := range cases {
		if _, ok := rzpID(c.resp); ok != c.want {
			t.Errorf("%s: got ok=%v, want %v", c.name, ok, c.want)
		}
	}
}

// TestQuoteMatchesPricing pins the deposits — what a checkout takes today —
// and the full prices recorded beside them, against the configuration the
// backend ships with, which is the website's pricing.ts in paise.
//
// It goes through quoteChecked rather than the arithmetic alone, so what is
// under test is the whole lookup: tier id → configured tier → rupees.
func TestQuoteMatchesPricing(t *testing.T) {
	useDefaultConfig(t)

	cases := []struct {
		plan     string
		quantity int
		today    int
		full     int
		monthly  int
	}{
		{"capture", 2, 1998, 11998, 0},
		{"act", 1, 999, 8999, 0},
		{"act", 9, 4995, 44995, 0}, // clamped to five
		// Clamped to one. The renewal is per account, so it is not
		// multiplied out — and it is disclosed here, not charged: the
		// checkout takes the deposit and nothing else.
		{"act-pro", 0, 999, 12999, 499},
	}
	for _, c := range cases {
		q, err := quoteChecked(context.Background(), c.plan, c.quantity)
		if err != nil {
			t.Fatalf("quoteChecked(%q): %v", c.plan, err)
		}
		if q.dueToday != c.today || q.full != c.full || q.monthly != c.monthly {
			t.Errorf("quoteChecked(%q, %d) = %+v, want dueToday %d, full %d, monthly %d",
				c.plan, c.quantity, q, c.today, c.full, c.monthly)
		}
	}
}

// TestQuoteRefusesADisabledTier: switching a tier off in the configuration
// has to stop it being sold, not merely stop it being shown — the tier id
// comes from a client, and an old build will keep sending one.
func TestQuoteRefusesADisabledTier(t *testing.T) {
	cfg := defaultConfigOrFail(t)
	for i := range cfg.Pricing.Tiers {
		if cfg.Pricing.Tiers[i].ID == "act" {
			cfg.Pricing.Tiers[i].Enabled = false
		}
	}
	useConfig(t, cfg)

	if _, err := quoteChecked(context.Background(), "act", 1); err == nil {
		t.Fatal("a disabled tier must not be priced")
	}
	if _, err := quoteChecked(context.Background(), "capture", 1); err != nil {
		t.Fatalf("the tiers still on sale must still price: %v", err)
	}
}

// TestOrderRefusesADisabledTier is the same refusal at the HTTP edge, where
// it has to be a 400 and not a 500 or a free pendant.
func TestOrderRefusesADisabledTier(t *testing.T) {
	cfg := defaultConfigOrFail(t)
	for i := range cfg.Pricing.Tiers {
		cfg.Pricing.Tiers[i].Enabled = cfg.Pricing.Tiers[i].ID != "act"
	}
	useConfig(t, cfg)

	origCreate, origPut := createRazorpayOrder, putOrder
	defer func() { createRazorpayOrder, putOrder = origCreate, origPut }()
	createRazorpayOrder = func(client *razorpay.Client, data map[string]interface{}) (map[string]interface{}, error) {
		t.Error("Razorpay was asked for a checkout on a tier that is not on sale")
		return map[string]interface{}{"id": "order_1"}, nil
	}
	putOrder = func(ctx context.Context, o ddb.Order) error {
		t.Error("an order row was written for a tier that is not on sale")
		return nil
	}

	res := postOrder(t, stubPreOrderBody) // plan: act
	if res.StatusCode != fiber.StatusBadRequest {
		t.Fatalf("status = %d, want 400", res.StatusCode)
	}
}

// TestOrderChargesTheConfiguredPrice: the amount Razorpay is asked for is
// the one in the configuration, not one in the code and not one in the
// request. Changing the deposit changes the charge, with no deploy.
func TestOrderChargesTheConfiguredPrice(t *testing.T) {
	cfg := defaultConfigOrFail(t)
	for i := range cfg.Pricing.Tiers {
		if cfg.Pricing.Tiers[i].ID == "act" {
			cfg.Pricing.Tiers[i].Deposit = 100000 // ₹1,000
		}
	}
	useConfig(t, cfg)

	origCreate, origPut := createRazorpayOrder, putOrder
	defer func() { createRazorpayOrder, putOrder = origCreate, origPut }()
	createRazorpayOrder = func(client *razorpay.Client, data map[string]interface{}) (map[string]interface{}, error) {
		if got := data["amount"]; got != 100000 {
			t.Errorf("order amount = %v, want 100000 paise — the configured deposit", got)
		}
		return map[string]interface{}{"id": "order_1"}, nil
	}
	var written ddb.Order
	putOrder = func(ctx context.Context, o ddb.Order) error {
		written = o
		return nil
	}

	if res := postOrder(t, stubPreOrderBody); res.StatusCode != fiber.StatusCreated {
		t.Fatalf("status = %d, want 201", res.StatusCode)
	}
	if written.DueToday != 1000 {
		t.Errorf("order row dueToday = %d, want 1000", written.DueToday)
	}
}

// TestValidateContactWantsOnlyEmailAndPhone: a pre-order asks for the two
// things it cannot do without. A name is optional and an address is not
// collected until dispatch is near, so neither may refuse an order.
func TestValidateContactWantsOnlyEmailAndPhone(t *testing.T) {
	cases := []struct {
		name    string
		contact contactInput
		ok      bool
	}{
		{"email and phone", contactInput{Email: "a@b.com", Phone: "9876543210"}, true},
		{"no name", contactInput{Email: "a@b.com", Phone: "98765 43210"}, true},
		{"no address", contactInput{FullName: "A B", Email: "a@b.com", Phone: "+91 9876543210"}, true},
		{"full address still fine", contactInput{
			FullName: "A B", Email: "a@b.com", Phone: "9876543210",
			Line1: "1 Road", City: "Pune", State: "MH", Pin: "411001",
		}, true},
		{"no email", contactInput{Phone: "9876543210"}, false},
		{"bad email", contactInput{Email: "a@b", Phone: "9876543210"}, false},
		{"no phone", contactInput{Email: "a@b.com"}, false},
		{"country code", contactInput{Email: "a@b.com", Phone: "+919876543210"}, true},
		{"trunk zero", contactInput{Email: "a@b.com", Phone: "09876543210"}, true},
		{"landline", contactInput{Email: "a@b.com", Phone: "02012345678"}, false},
		{"short phone", contactInput{Email: "a@b.com", Phone: "98765432"}, false},
	}
	for _, c := range cases {
		err := validateContact(c.contact)
		if (err == nil) != c.ok {
			t.Errorf("%s: validateContact err = %v, want ok=%v", c.name, err, c.ok)
		}
	}
}

// TestContactNameFallsBackToTheEmail: with no name given, the confirmation
// is addressed to the email's local part rather than to nobody.
func TestContactNameFallsBackToTheEmail(t *testing.T) {
	cases := []struct {
		in   contactInput
		want string
	}{
		{contactInput{FullName: "  Asha Rao ", Email: "asha.rao@example.in"}, "Asha Rao"},
		{contactInput{Email: "asha.rao@example.in"}, "asha.rao"},
		{contactInput{FullName: "   ", Email: " asha.rao@example.in "}, "asha.rao"},
	}
	for _, c := range cases {
		if got := contactName(c.in); got != c.want {
			t.Errorf("contactName(%+v) = %q, want %q", c.in, got, c.want)
		}
	}
}

// TestPreOrderRecordsBothFigures: the row keeps what was taken and what the
// device costs, because the receipt has to say what dispatch will still ask
// for. The sheet is opened for the deposit only.
func TestPreOrderRecordsBothFigures(t *testing.T) {
	origCreate, origPut := createRazorpayOrder, putOrder
	defer func() { createRazorpayOrder, putOrder = origCreate, origPut }()

	createRazorpayOrder = func(client *razorpay.Client, data map[string]interface{}) (map[string]interface{}, error) {
		if got := data["amount"]; got != 99900 {
			t.Errorf("order amount = %v, want 99900 paise — the deposit", got)
		}
		return map[string]interface{}{"id": "order_1"}, nil
	}
	var written ddb.Order
	putOrder = func(ctx context.Context, o ddb.Order) error {
		written = o
		return nil
	}

	res := postOrder(t, stubPreOrderBody)
	if res.StatusCode != fiber.StatusCreated {
		t.Fatalf("status = %d, want 201", res.StatusCode)
	}
	if written.DueToday != 999 || written.Full != 8999 {
		t.Errorf("order row = dueToday %d, full %d; want 999 and 8999", written.DueToday, written.Full)
	}
	if written.Contact.FullName != "asha.rao" {
		t.Errorf("contact name = %q, want the email's local part", written.Contact.FullName)
	}
	if len(written.Contact.Address) != 0 {
		t.Errorf("address = %v, want none — the pre-order did not ask for one", written.Contact.Address)
	}
}

// TestPlanLabelSaysPreOrder: the label is what Razorpay's sheet and the card
// statement show, and the amount beside it is a deposit.
func TestPlanLabelSaysPreOrder(t *testing.T) {
	useDefaultConfig(t)

	name := planName(context.Background(), "act")
	if name != "LYZN Act" {
		t.Errorf("planName(act) = %q", name)
	}
	if got := planLabel(name, 1); got != "LYZN Act · pre-order" {
		t.Errorf("planLabel(act, 1) = %q", got)
	}
	if got := planLabel(name, 2); got != "2 × LYZN Act · pre-order" {
		t.Errorf("planLabel(act, 2) = %q", got)
	}
}

// TestPlanNameFallsBackToTheConfiguredTier: a tier added in configuration is
// sellable without a deploy, so the label Razorpay shows has to come from
// somewhere when the code's table has never heard of it.
func TestPlanNameFallsBackToTheConfiguredTier(t *testing.T) {
	cfg := defaultConfigOrFail(t)
	cfg.Pricing.Tiers = append(cfg.Pricing.Tiers, ddb.Tier{
		ID: "watch", Name: "Watch", Full: 299900, Deposit: 99900, Enabled: true, Lines: []string{"A wrist"},
	})
	useConfig(t, cfg)

	if got := planName(context.Background(), "watch"); got != "LYZN Watch" {
		t.Errorf("planName(watch) = %q, want LYZN Watch", got)
	}
}

func TestQuoteRejectsUnknownPlan(t *testing.T) {
	useDefaultConfig(t)

	// The old plan names are unknown too: a stale client must not be able
	// to buy "pendant" at whatever price the configuration no longer has.
	for _, plan := range []string{"gold", "pendant", "software", ""} {
		if _, err := quoteChecked(context.Background(), plan, 1); err == nil {
			t.Errorf("plan %q must be refused", plan)
		}
	}
}

func TestRupeesToPaise(t *testing.T) {
	if paise(999) != 99900 {
		t.Fatal()
	}
}

// TestDisplayedOrderCount pins the counter's floor and cap: it must never
// read below what the landing page shows on day one, and never so close to
// "100" that Batch 01 looks sold out.
func TestDisplayedOrderCount(t *testing.T) {
	cases := []struct {
		real int
		want int
	}{
		{real: 0, want: 36},
		{real: -5, want: 31}, // never sent by ddb, but the clamp shouldn't hide a negative bug either
		{real: 10, want: 46},
		{real: 59, want: 95},
		{real: 60, want: 95},
		{real: 1000, want: 95},
	}
	for _, tc := range cases {
		if got := displayedOrderCount(tc.real); got != tc.want {
			t.Fatalf("displayedOrderCount(%d) = %d, want %d", tc.real, got, tc.want)
		}
	}
}

func TestGetOrderCount(t *testing.T) {
	original := loadPaidOrderCount
	defer func() { loadPaidOrderCount = original }()

	loadPaidOrderCount = func(context.Context) (int, error) { return 12, nil }

	app := fiber.New()
	app.Get("/orders/count", getOrderCount)
	res, err := app.Test(httptest.NewRequest("GET", "/orders/count", nil))
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	var body struct {
		Count int `json:"count"`
		Of    int `json:"of"`
	}
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Count != 48 || body.Of != 100 {
		t.Fatalf("got %+v", body)
	}
}

// TestGetOrderCountFallsBackOnError covers appConfig's own posture: a
// DynamoDB read that fails must still answer with the floor, not a 500 — a
// landing page counter is not worth breaking the page over.
func TestGetOrderCountFallsBackOnError(t *testing.T) {
	original := loadPaidOrderCount
	defer func() { loadPaidOrderCount = original }()

	loadPaidOrderCount = func(context.Context) (int, error) { return 0, errors.New("boom") }

	app := fiber.New()
	app.Get("/orders/count", getOrderCount)
	res, err := app.Test(httptest.NewRequest("GET", "/orders/count", nil))
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	if res.StatusCode != fiber.StatusOK {
		t.Fatalf("got %d, want 200", res.StatusCode)
	}
	var body struct {
		Count int `json:"count"`
	}
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Count != counterFloor {
		t.Fatalf("got count %d, want floor %d", body.Count, counterFloor)
	}
}
