// Memory search.
//
//	GET /memory/search?q=&limit=   what is remembered that bears on this
//
// GitLoom's retrieval has been paid for since the first recording and used
// only implicitly, inside a chat turn, where its results reach the model and
// never the user. This is the same call made directly, so "Ask lyzn" can show
// what it is answering from and a search can be answered out of memory without
// spending a model turn to do it.
//
// Deleted conversations are filtered out here rather than at the source,
// because GitLoom cannot delete a memory and retrieval takes no source filter.
// See internal/ddb/tombstones.go for what that costs and why it is still worth
// doing.
package api

import (
	"log"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v2"

	"github.com/MelloB1989/mr20-pendant/backend/internal/authjwt"
	"github.com/MelloB1989/mr20-pendant/backend/internal/ddb"
	"github.com/MelloB1989/mr20-pendant/backend/internal/gitloomx"
)

func registerMemoryRoutes(app fiber.Router) {
	app.Get("/memory/search", searchMemory)
}

const (
	defaultRecallLimit = 8
	maxRecallLimit     = 25
)

func searchMemory(c *fiber.Ctx) error {
	user := authjwt.Sub(c)
	query := strings.TrimSpace(c.Query("q"))
	if query == "" {
		return fiber.NewError(fiber.StatusBadRequest, "q is required")
	}
	if len(query) > 500 {
		return fiber.NewError(fiber.StatusBadRequest, "q is too long")
	}

	limit := defaultRecallLimit
	if v, err := strconv.Atoi(c.Query("limit")); err == nil && v > 0 {
		limit = v
	}
	if limit > maxRecallLimit {
		limit = maxRecallLimit
	}

	// Read the tombstones first: a hit from a deleted conversation must never
	// be the thing that reaches the user because the suppression list was slow.
	tombstoned, err := ddb.TombstonedIDs(c.Context(), user)
	if err != nil {
		return err
	}

	hits, err := gitloomx.Recall(c.Context(), user, query, limit)
	if err != nil {
		log.Printf("memory search failed user=%s err=%v", user, err)
		return fiber.NewError(fiber.StatusBadGateway, "the memory store could not be reached")
	}

	return c.JSON(fiber.Map{"hits": gitloomx.AsSearchHits(gitloomx.FilterTombstoned(hits, tombstoned))})
}
