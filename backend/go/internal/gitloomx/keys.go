// A GitLoom credential of a user's own.
//
// Memory is the product. A conversation the pendant heard is filed in GitLoom,
// and everything the assistant knows is read back from there — so a laptop
// carrying out somebody's work has to be able to reach it. Handing that laptop
// this backend's key would hand it every LYZN user's memory, which is why
// GitLoom keys can now be confined to one namespace (MelloB1989/gitloom#2).
//
// One key per paired machine, minted at the moment it pairs and revoked when it
// is unpaired. That shape falls out of GitLoom showing a secret exactly once:
// there is nothing to store here and nothing to leak, and a laptop that lost
// its key pairs again rather than being handed the same one twice.
package gitloomx

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// keyHTTP is its own client: minting is a rare call on a path a person is
// waiting on, and it must not inherit a timeout tuned for ingestion.
var keyHTTP = &http.Client{Timeout: 20 * time.Second}

// ScopedKey is what a machine is given: enough to read and write one
// namespace, and nothing else on the account.
type ScopedKey struct {
	// ID is the public half, stored so the key can be revoked later. The
	// secret is not stored anywhere by us.
	ID string `json:"id"`
	// Secret is the credential itself, and exists in this process exactly
	// once — on the way to the machine that asked for it.
	Secret    string `json:"key"`
	Namespace string `json:"namespace"`
}

// MintScopedKey creates a GitLoom key that can only touch one namespace.
//
// The namespace is created first. A key confined to a namespace that does not
// exist is a credential that silently reaches nothing, and the machine holding
// it would have no way to tell that from an empty memory.
func MintScopedKey(ctx context.Context, userID, name string) (*ScopedKey, error) {
	namespace := Namespace(userID)
	if namespace == "" {
		return nil, fmt.Errorf("gitloom: no namespace for %q", userID)
	}

	client, err := Client(ctx)
	if err != nil {
		return nil, err
	}
	if err := EnsureNamespace(ctx, client, namespace); err != nil {
		return nil, err
	}

	key, err := APIKey(ctx)
	if err != nil {
		return nil, err
	}

	body, err := json.Marshal(map[string]string{"name": name, "namespace": namespace})
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, BaseURL()+"/v1/keys", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Content-Type", "application/json")

	resp, err := keyHTTP.Do(req)
	if err != nil {
		return nil, fmt.Errorf("gitloom: minting a key: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("gitloom: minting a key failed (%d)", resp.StatusCode)
	}

	var out ScopedKey
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, err
	}
	if strings.TrimSpace(out.Secret) == "" {
		return nil, fmt.Errorf("gitloom: a key was created but no secret came back")
	}
	if out.Namespace == "" {
		out.Namespace = namespace
	}
	return &out, nil
}

// RevokeScopedKey takes a machine's key away.
//
// Best effort by design: this runs while somebody is unpairing a laptop, and
// the unpairing itself — deleting the daemon row — is what actually stops the
// machine. A key left behind reaches one namespace and belongs to a machine
// that can no longer ask LYZN for anything.
func RevokeScopedKey(ctx context.Context, id string) error {
	id = strings.TrimSpace(id)
	if id == "" {
		return nil
	}
	key, err := APIKey(ctx)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete,
		BaseURL()+"/v1/keys/"+url.PathEscape(id), nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+key)

	resp, err := keyHTTP.Do(req)
	if err != nil {
		return fmt.Errorf("gitloom: revoking a key: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 && resp.StatusCode != http.StatusNotFound {
		return fmt.Errorf("gitloom: revoking a key failed (%d)", resp.StatusCode)
	}
	return nil
}
