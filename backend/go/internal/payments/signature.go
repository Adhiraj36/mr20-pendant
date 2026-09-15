// Package payments talks to Razorpay: signing, verifying, and the shared
// client that both halves of checkout need.
package payments

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
)

func hmacHex(message, secret string) string {
	m := hmac.New(sha256.New, []byte(secret))
	m.Write([]byte(message))
	return hex.EncodeToString(m.Sum(nil))
}

func equal(a, b string) bool { return hmac.Equal([]byte(a), []byte(b)) }

// VerifyPayment checks the signature Checkout returns for a one-time order.
// An unset keySecret must never verify: hmacHex("", "") is a fixed value
// anyone can compute, so an unconfigured secret would otherwise forge as a
// valid signature.
func VerifyPayment(orderID, paymentID, signature, keySecret string) bool {
	if keySecret == "" {
		return false
	}
	return equal(hmacHex(orderID+"|"+paymentID, keySecret), signature)
}

// VerifySubscription checks the signature Checkout returns for a subscription
// authorisation. Note the operand order differs from an order's.
func VerifySubscription(subscriptionID, paymentID, signature, keySecret string) bool {
	if keySecret == "" {
		return false
	}
	return equal(hmacHex(paymentID+"|"+subscriptionID, keySecret), signature)
}

// VerifyWebhook checks X-Razorpay-Signature over the raw request body. An
// unset webhookSecret must never verify — see VerifyPayment.
func VerifyWebhook(body []byte, signature, webhookSecret string) bool {
	if webhookSecret == "" {
		return false
	}
	return equal(hmacHex(string(body), webhookSecret), signature)
}
