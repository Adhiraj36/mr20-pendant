package payments

import (
	"context"
	"sync"

	razorpay "github.com/razorpay/razorpay-go"

	"github.com/MelloB1989/mr20-pendant/backend/internal/config"
)

var (
	mu     sync.Mutex
	client *razorpay.Client
	keyID  string
	secret string
	whsec  string
)

// Client returns the shared Razorpay client, resolving credentials once per
// container. Live or test keys per environment — the secret name decides.
func Client(ctx context.Context) (*razorpay.Client, error) {
	mu.Lock()
	defer mu.Unlock()
	if client != nil {
		return client, nil
	}
	id, sec, wh, err := config.Razorpay(ctx)
	if err != nil {
		return nil, err
	}
	keyID, secret, whsec = id, sec, wh
	client = razorpay.NewClient(id, sec)
	return client, nil
}

// KeyID is the public half, handed to Checkout on the web.
func KeyID(ctx context.Context) (string, error) {
	if _, err := Client(ctx); err != nil {
		return "", err
	}
	return keyID, nil
}
func KeySecret(ctx context.Context) (string, error) { _, err := Client(ctx); return secret, err }
func WebhookSecret(ctx context.Context) (string, error) { _, err := Client(ctx); return whsec, err }
