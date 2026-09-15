package api

import (
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v2"
)

func TestWebhookRejectsBadSignature(t *testing.T) {
	app := fiber.New()
	app.Post("/webhooks/razorpay", razorpayWebhook)
	req := httptest.NewRequest("POST", "/webhooks/razorpay", strings.NewReader(`{"event":"payment.captured"}`))
	req.Header.Set("X-Razorpay-Signature", "nope")
	res, _ := app.Test(req)
	if res.StatusCode != 401 {
		t.Fatalf("got %d", res.StatusCode)
	}
}

func TestEventToPlanStatus(t *testing.T) {
	cases := map[string]string{
		"subscription.activated": "active",
		"subscription.charged":   "active",
		"subscription.halted":    "halted",
		"subscription.cancelled": "cancelled",
		"subscription.completed": "cancelled",
	}
	for ev, want := range cases {
		if statusFor(ev) != want {
			t.Fatalf("%s → %s", ev, statusFor(ev))
		}
	}
}
