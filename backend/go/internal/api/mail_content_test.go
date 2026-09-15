package api

import (
	"strings"
	"testing"

	"github.com/MelloB1989/mr20-pendant/backend/internal/ddb"
)

func TestFormatRupees(t *testing.T) {
	cases := map[int]string{
		0:     "₹0",
		999:   "₹999",
		8999:  "₹8,999",
		12999: "₹12,999",
		100:   "₹100",
	}
	for amount, want := range cases {
		if got := formatRupees(amount); got != want {
			t.Fatalf("formatRupees(%d) = %q, want %q", amount, got, want)
		}
	}
}

// TestPreorderConfirmationEmail pins the two facts a receipt cannot get
// wrong: it goes to the address the order was placed under, and the balance
// it quotes is what is actually still owed — full minus the deposit
// already taken, not the deposit or the full price standing in for it.
func TestPreorderConfirmationEmail(t *testing.T) {
	order := ddb.Order{
		Reference: "LYZN-ABC12",
		Plan:      "act",
		DueToday:  999,
		Full:      8999,
		Contact:   ddb.Contact{Email: "asha.rao@example.in"},
	}

	msg := preorderConfirmationEmail("LYZN Act", order)

	if msg.To != "asha.rao@example.in" {
		t.Fatalf("To: %q", msg.To)
	}
	if !strings.Contains(msg.Subject, "LYZN Act") || !strings.Contains(msg.Subject, "LYZN-ABC12") {
		t.Fatalf("Subject: %q", msg.Subject)
	}
	if !strings.Contains(msg.Text, "₹999") {
		t.Fatalf("Text is missing the deposit paid today: %q", msg.Text)
	}
	if !strings.Contains(msg.Text, "₹8,000") {
		t.Fatalf("Text is missing the correct balance (8999-999=8000): %q", msg.Text)
	}
	// The exact line the paysheet itself prints once payment completes —
	// see web/src/data/content.ts, PRICING.form.done.line.
	if !strings.Contains(msg.Text, "Reserved. Your place in Batch 01 is held.") {
		t.Fatalf("Text does not match the paysheet's own confirmation line: %q", msg.Text)
	}
	if !strings.Contains(msg.HTML, "₹8,000") || !strings.Contains(msg.HTML, "LYZN-ABC12") {
		t.Fatalf("HTML: %q", msg.HTML)
	}
}
