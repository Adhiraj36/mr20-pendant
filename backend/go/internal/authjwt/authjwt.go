// Package authjwt verifies Clerk session tokens for the Fiber API.
//
// The API sits behind a bare Function URL (no API Gateway authorizer), so the
// verification an authorizer would do happens here: RS256 signature against
// the instance's JWKS, issuer, and expiry. The JWKS is fetched lazily and
// cached for the container's life; an unknown kid refetches once, which is how
// key rotation is picked up.
//
// Two checks that a user pool would have wanted are deliberately absent. A
// Clerk session token carries no fixed audience — `azp` names the origin that requested it,
// and a native app has no origin to name — and there is no `token_use`, since
// Clerk issues one kind of session token rather than separate id and access
// tokens. Issuer and signature are what distinguish a real token here.
package authjwt

import (
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v5"
)

type jwk struct {
	Kid string `json:"kid"`
	Kty string `json:"kty"`
	N   string `json:"n"`
	E   string `json:"e"`
}

var (
	mu   sync.Mutex
	keys map[string]*rsa.PublicKey
)

// The Clerk instance this API trusts. Derived from the publishable key the app
// ships with: the part after pk_live_ is the base64 of the frontend API host.
const defaultIssuer = "https://clerk.lyzn.ai"

func issuer() string {
	if v := os.Getenv("CLERK_ISSUER"); v != "" {
		return strings.TrimSuffix(v, "/")
	}
	return defaultIssuer
}

func fetchKeys() error {
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Get(issuer() + "/.well-known/jwks.json")
	if err != nil {
		return fmt.Errorf("jwks fetch: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("jwks fetch: status %d", resp.StatusCode)
	}
	var body struct {
		Keys []jwk `json:"keys"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return fmt.Errorf("jwks decode: %w", err)
	}
	next := map[string]*rsa.PublicKey{}
	for _, k := range body.Keys {
		if k.Kty != "RSA" {
			continue
		}
		n, err := base64.RawURLEncoding.DecodeString(k.N)
		if err != nil {
			continue
		}
		e, err := base64.RawURLEncoding.DecodeString(k.E)
		if err != nil {
			continue
		}
		next[k.Kid] = &rsa.PublicKey{
			N: new(big.Int).SetBytes(n),
			E: int(new(big.Int).SetBytes(e).Int64()),
		}
	}
	keys = next
	return nil
}

func keyFor(kid string) (*rsa.PublicKey, error) {
	mu.Lock()
	defer mu.Unlock()
	if key, ok := keys[kid]; ok {
		return key, nil
	}
	// Unknown kid: refetch once — key rotation, or a cold container.
	if err := fetchKeys(); err != nil {
		return nil, err
	}
	if key, ok := keys[kid]; ok {
		return key, nil
	}
	return nil, errors.New("token signed by an unknown key")
}

// Claims carried into handlers via c.Locals.
const (
	LocalSub    = "authSub"
	LocalEmail  = "authEmail"
	LocalClaims = "authClaims"
)

// Sub returns the authenticated user's Clerk id ("user_..."). Handlers never
// take a user id from the request body.
func Sub(c *fiber.Ctx) string {
	sub, _ := c.Locals(LocalSub).(string)
	return sub
}

// Claims returns everything the verified token carried, for the handful of
// handlers that need more than the subject.
//
// What is in there depends on the instance's JWT template: Clerk puts `sub`
// and the expiry in every token and nothing else unless somebody says so. A
// claim's absence is therefore normal, and a caller that needs one has to
// have a second way of finding it — see internal/api/admin.go, which asks
// Clerk directly when the role is not in the token.
func Claims(c *fiber.Ctx) map[string]any {
	claims, _ := c.Locals(LocalClaims).(map[string]any)
	return claims
}

// Validate checks a raw Clerk session token and returns its subject and, when
// the instance's JWT template provides one, the email.
//
// Shared by the HTTP middleware and transports that carry the token elsewhere
// (the voice WebSocket passes it as a query parameter).
func Validate(raw string) (sub, email string, err error) {
	sub, email, _, err = ValidateClaims(raw)
	return sub, email, err
}

// ValidateClaims is Validate plus the rest of the token.
//
// Same verification, one more return: the claim set, for a caller that needs
// something the instance's JWT template adds — `public_metadata`, in
// practice. Nothing is trusted from it that is not signed, because this is
// the parsed form of a token whose signature has just been checked.
func ValidateClaims(raw string) (sub, email string, claims map[string]any, err error) {
	token, err := jwt.Parse(raw, func(t *jwt.Token) (any, error) {
		kid, _ := t.Header["kid"].(string)
		if kid == "" {
			return nil, errors.New("token has no kid")
		}
		return keyFor(kid)
	},
		jwt.WithValidMethods([]string{"RS256"}),
		jwt.WithIssuer(issuer()),
		jwt.WithExpirationRequired(),
	)
	if err != nil {
		return "", "", nil, errors.New("invalid token")
	}
	mapped, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return "", "", nil, errors.New("invalid token")
	}
	sub, _ = mapped["sub"].(string)
	if sub == "" {
		return "", "", nil, errors.New("invalid token")
	}
	// Only present when the instance is configured to include it. Nothing in
	// this API keys on email, so its absence is not a failure.
	email, _ = mapped["email"].(string)
	return sub, email, map[string]any(mapped), nil
}

// Middleware rejects the request unless it carries a valid Clerk session token.
func Middleware() fiber.Handler {
	return func(c *fiber.Ctx) error {
		header := c.Get("Authorization")
		const prefix = "Bearer "
		if len(header) <= len(prefix) || header[:len(prefix)] != prefix {
			return fiber.NewError(fiber.StatusUnauthorized, "missing bearer token")
		}
		sub, email, claims, err := ValidateClaims(header[len(prefix):])
		if err != nil {
			return fiber.NewError(fiber.StatusUnauthorized, err.Error())
		}
		c.Locals(LocalSub, sub)
		if email != "" {
			c.Locals(LocalEmail, email)
		}
		c.Locals(LocalClaims, claims)
		return c.Next()
	}
}
