package gitloomx

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
)

// Namespace is the GitLoom namespace for one account.
//
// GitLoom accepts lowercase letters, digits and '-', up to 64 characters. A
// Clerk subject is none of those things: `user_3J3fsbqIQhi6mqtfNj0JknPdOtO`
// carries an underscore and mixed case, and GitLoom answers every call made
// with it `400 invalid_namespace`. That is why memory ingest failed for every
// recording this product has ever processed, and why /chat and /memory/search
// answered 502 — all three send the raw subject.
//
// The mapping has to hold three things at once:
//
//   - **Valid**, obviously.
//   - **Stable**: the same account must land in the same namespace on every
//     call, for ever, or a person's memory splits in two.
//   - **Distinct**: Clerk subjects are case-sensitive, so folding case alone
//     could put two accounts in one namespace. That is not a cosmetic bug —
//     it is one person reading another's memory.
//
// So the readable form is kept and a short digest of the *original* is
// appended to carry the distinction that folding threw away. An id that is
// already valid is returned untouched, so nothing that does work today moves.
func Namespace(userID string) string {
	id := strings.TrimSpace(userID)
	if id == "" {
		return ""
	}
	if valid(id) {
		return id
	}

	var b strings.Builder
	for _, r := range strings.ToLower(id) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9', r == '-':
			b.WriteRune(r)
		default:
			b.WriteByte('-')
		}
	}

	sum := sha256.Sum256([]byte(id))
	suffix := "-" + hex.EncodeToString(sum[:])[:8]

	// The digest is what makes this unique, so the readable half is what gets
	// cut when the two together would run past the limit.
	head := b.String()
	if len(head)+len(suffix) > 64 {
		head = head[:64-len(suffix)]
	}
	return head + suffix
}

func valid(id string) bool {
	if len(id) == 0 || len(id) > 64 {
		return false
	}
	for _, r := range id {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9', r == '-':
		default:
			return false
		}
	}
	return true
}

