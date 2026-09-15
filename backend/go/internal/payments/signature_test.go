package payments

import "testing"

func TestVerifyPaymentOrder(t *testing.T) {
	// hmac_sha256("order_abc|pay_xyz", "secret") — computed once, pinned.
	sig := hmacHex("order_abc|pay_xyz", "secret")
	if !VerifyPayment("order_abc", "pay_xyz", sig, "secret") {
		t.Fatal("a correct signature must verify")
	}
	if VerifyPayment("order_abc", "pay_xyz", sig, "wrong") {
		t.Fatal("the wrong secret must not verify")
	}
	if VerifyPayment("order_abc", "pay_other", sig, "secret") {
		t.Fatal("a signature for another payment must not verify")
	}
	emptySig := hmacHex("order_abc|pay_xyz", "")
	if VerifyPayment("order_abc", "pay_xyz", emptySig, "") {
		t.Fatal("an unset key secret must never verify, even against its own empty-key HMAC")
	}
}

func TestVerifySubscription(t *testing.T) {
	sig := hmacHex("pay_xyz|sub_abc", "secret")
	if !VerifySubscription("sub_abc", "pay_xyz", sig, "secret") {
		t.Fatal("subscription signatures are payment|subscription")
	}
	emptySig := hmacHex("pay_xyz|sub_abc", "")
	if VerifySubscription("sub_abc", "pay_xyz", emptySig, "") {
		t.Fatal("an unset key secret must never verify, even against its own empty-key HMAC")
	}
}

func TestVerifyWebhook(t *testing.T) {
	body := []byte(`{"event":"payment.captured"}`)
	sig := hmacHex(string(body), "whsec")
	if !VerifyWebhook(body, sig, "whsec") {
		t.Fatal("a webhook signed with the webhook secret must verify")
	}
	if VerifyWebhook([]byte(`{"event":"tampered"}`), sig, "whsec") {
		t.Fatal("a changed body must not verify")
	}
	emptySig := hmacHex(string(body), "")
	if VerifyWebhook(body, emptySig, "") {
		t.Fatal("an unset webhook secret must never verify, even against its own empty-key HMAC")
	}
}
