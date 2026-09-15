// Daemon authentication: the bearer token a paired machine holds.
//
// This is the second credential in the API and it is nothing like the first.
// A Clerk session token says which person is asking; a daemon token says
// which *machine* is asking and, through the row it resolves to, which
// account that machine was bound to when somebody typed a pairing code into
// it. KARMAX has no login, no browser and no user — there is nothing here to
// verify with Clerk, and this file deliberately does not import it.
//
// The token itself is never stored. What is stored is its SHA-256, on GSI1,
// so resolving a presented token is one index lookup on the hash of what
// arrived and a table dump hands nobody a working credential.
//
// Unpairing deletes the row, which is what makes the token stop working:
// there is no revocation list to keep in step with anything.
package api

import (
	"strings"

	"github.com/gofiber/fiber/v2"

	"github.com/MelloB1989/mr20-pendant/backend/internal/ddb"
)

// localDaemon is where the resolved daemon is parked for the handler, in the
// same way authjwt parks the subject.
const localDaemon = "authDaemon"

// ddbDaemonByToken indirects the lookup so the middleware can be tested
// without DynamoDB.
var ddbDaemonByToken = ddb.DaemonByToken

// bearerToken pulls the credential out of an Authorization header, or "" if
// there is not one shaped like a bearer token in there.
func bearerToken(header string) string {
	const prefix = "Bearer "
	header = strings.TrimSpace(header)
	if len(header) <= len(prefix) || !strings.EqualFold(header[:len(prefix)], prefix) {
		return ""
	}
	return strings.TrimSpace(header[len(prefix):])
}

// daemonAuth rejects the request unless it carries a token some daemon row
// holds the hash of.
func daemonAuth() fiber.Handler {
	return func(c *fiber.Ctx) error {
		token := bearerToken(c.Get(fiber.HeaderAuthorization))
		if token == "" {
			return fiber.NewError(fiber.StatusUnauthorized, "missing bearer token")
		}
		daemon, err := ddbDaemonByToken(c.Context(), token)
		if err != nil {
			return err
		}
		if daemon == nil {
			// One answer for an unknown token, a revoked one and a
			// mistyped one: anything more specific is a way to probe.
			return fiber.NewError(fiber.StatusUnauthorized, "this token is not paired to an account")
		}
		c.Locals(localDaemon, daemon)
		return c.Next()
	}
}

// daemonOf returns the daemon the middleware resolved. Handlers behind
// daemonAuth can rely on it being there.
func daemonOf(c *fiber.Ctx) *ddb.Daemon {
	daemon, _ := c.Locals(localDaemon).(*ddb.Daemon)
	return daemon
}
