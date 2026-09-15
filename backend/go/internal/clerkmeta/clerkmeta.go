// Package clerkmeta writes what a user bought onto their Clerk profile, and
// reads back the one claim this backend gives a person authority with.
//
// DynamoDB stays the source of truth for an entitlement — GET /plan reads
// the PLAN row and nothing here changes that. Clerk's public metadata is a
// copy, and it exists for one reason: the app has the user's Clerk session
// the instant they sign in, and can show them the plan they bought on the
// website before a single request to this API has come back. A user with no
// plan in either place is the one who gets the in-app chooser.
//
// Because it is a copy, a failure to write it is a log line and never an
// error the caller propagates: a payment that succeeded must not be reported
// as failed because Clerk was slow.
//
// The secret is the same Clerk secret key the rest of the backend resolves
// (internal/config.ClerkSecretKey — environment first, otherwise the
// CLERK_SECRET_ARN the stack injects, cached per container). It is never
// logged, never returned, and never put in an error message.
package clerkmeta

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"

	clerk "github.com/clerk/clerk-sdk-go/v2"
	clerkuser "github.com/clerk/clerk-sdk-go/v2/user"

	"github.com/MelloB1989/mr20-pendant/backend/internal/config"
)

// The keys this backend owns under a user's public metadata. Everything else
// there belongs to somebody else, which is why every write below merges.
const (
	KeyPlan           = "plan"
	KeyPlanStatus     = "planStatus"
	KeyPlanSince      = "planSince"
	KeyOrderReference = "orderReference"
	// KeyRole is read, never written here. An administrator is made one in
	// the Clerk dashboard; nothing in this API can promote anybody.
	KeyRole = "role"
)

// RoleAdmin is the only role this backend recognises.
const RoleAdmin = "admin"

var (
	mu     sync.Mutex
	client *clerkuser.Client
)

// clientFor dials Clerk once per container, the same way the secrets cache
// does, because a Lambda container serves many requests and the key does not
// change under it.
func clientFor(ctx context.Context) (*clerkuser.Client, error) {
	mu.Lock()
	defer mu.Unlock()
	if client != nil {
		return client, nil
	}
	key, err := config.ClerkSecretKey(ctx)
	if err != nil {
		// config's error names the variable and the ARN, never the value.
		return nil, err
	}
	client = clerkuser.NewClient(&clerk.ClientConfig{
		BackendConfig: clerk.BackendConfig{Key: clerk.String(key)},
	})
	return client, nil
}

// PlanMetadata is the document this backend writes onto a user, and the one
// place the wire names for it are decided. Pure, so the mapping is testable
// without Clerk.
//
// Every key is always present, empty string included: the app reads a fixed
// shape, and a missing key and an empty one should not be two states.
func PlanMetadata(plan, status, since, orderRef string) map[string]string {
	return map[string]string{
		KeyPlan:           plan,
		KeyPlanStatus:     status,
		KeyPlanSince:      since,
		KeyOrderReference: orderRef,
	}
}

// updateMetadata is the one call that reaches Clerk, behind a variable so a
// test can assert what would have been sent without a network or a key.
var updateMetadata = func(ctx context.Context, c *clerkuser.Client, userID string, public json.RawMessage) error {
	_, err := c.UpdateMetadata(ctx, userID, &clerkuser.UpdateMetadataParams{PublicMetadata: &public})
	return err
}

// SetPlanMetadata copies a settled plan onto the user's Clerk profile.
//
// UpdateMetadata *merges*, which is the whole reason it is used rather than
// ReplaceMetadata: a user's public metadata may already carry the `role`
// that PUT /admin/config checks, and replacing the document would quietly
// strip an administrator of their access on their next purchase.
func SetPlanMetadata(ctx context.Context, userID, plan, status, since, orderRef string) error {
	if userID == "" {
		return fmt.Errorf("clerk metadata: no user id")
	}
	c, err := clientFor(ctx)
	if err != nil {
		return err
	}
	body, err := json.Marshal(PlanMetadata(plan, status, since, orderRef))
	if err != nil {
		return err
	}
	if err := updateMetadata(ctx, c, userID, body); err != nil {
		return fmt.Errorf("clerk metadata for %s: %w", userID, err)
	}
	return nil
}

// getUser is Clerk's read, behind a variable for the same reason as above.
var getUser = func(ctx context.Context, c *clerkuser.Client, userID string) (json.RawMessage, error) {
	u, err := c.Get(ctx, userID)
	if err != nil {
		return nil, err
	}
	return u.PublicMetadata, nil
}

// RoleOf reads the role out of a public-metadata document. Pure, and
// forgiving: metadata is a free-form object somebody edits by hand, so
// anything that is not a string role reads as no role rather than an error.
func RoleOf(public json.RawMessage) string {
	if len(public) == 0 {
		return ""
	}
	var parsed map[string]any
	if err := json.Unmarshal(public, &parsed); err != nil {
		return ""
	}
	role, _ := parsed[KeyRole].(string)
	return role
}

// Role fetches the user from Clerk and returns their role, for the case the
// session token does not carry one. A token that already has the claim
// should be believed instead — it is signed, and this costs a round trip.
func Role(ctx context.Context, userID string) (string, error) {
	if userID == "" {
		return "", fmt.Errorf("clerk role: no user id")
	}
	c, err := clientFor(ctx)
	if err != nil {
		return "", err
	}
	public, err := getUser(ctx, c, userID)
	if err != nil {
		return "", fmt.Errorf("clerk role for %s: %w", userID, err)
	}
	return RoleOf(public), nil
}
