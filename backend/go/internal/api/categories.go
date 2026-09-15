// Category routes.
//
//	GET /categories     the user's set, seeded with the defaults on first read
//	PUT /categories     replace the full list
//
// A category is {id, name}: the id is a stable slug minted here at creation,
// and recordings store the id, so a rename never orphans them. Deleting one
// leaves its recordings uncategorized, which the client renders as such.
package api

import (
	"regexp"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"

	"github.com/MelloB1989/mr20-pendant/backend/internal/authjwt"
	"github.com/MelloB1989/mr20-pendant/backend/internal/ddb"
	"github.com/MelloB1989/mr20-pendant/backend/internal/types"
)

const (
	maxCategories   = 24
	maxCategoryName = 32
)

func registerCategoryRoutes(app fiber.Router) {
	app.Get("/categories", listCategories)
	app.Put("/categories", putCategories)
}

func listCategories(c *fiber.Ctx) error {
	categories, err := ddb.GetCategories(c.Context(), authjwt.Sub(c))
	if err != nil {
		return err
	}
	return c.JSON(fiber.Map{"categories": categories})
}

var slugStrip = regexp.MustCompile(`[^a-z0-9]+`)

// mintID derives a readable slug from the name, suffixed for uniqueness so
// "Work" deleted and re-created never collides with rows still pointing at
// the old id.
func mintID(name string, taken map[string]bool) string {
	base := strings.Trim(slugStrip.ReplaceAllString(strings.ToLower(name), "-"), "-")
	if base == "" {
		base = "category"
	}
	id := base
	if taken[id] {
		id = base + "-" + uuid.NewString()[:8]
	}
	taken[id] = true
	return id
}

func putCategories(c *fiber.Ctx) error {
	user := authjwt.Sub(c)
	var input struct {
		Categories []types.Category `json:"categories"`
	}
	if err := c.BodyParser(&input); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "request body must be JSON")
	}
	if len(input.Categories) == 0 {
		return fiber.NewError(fiber.StatusBadRequest, "at least one category is required")
	}
	if len(input.Categories) > maxCategories {
		return fiber.NewError(fiber.StatusBadRequest, "too many categories")
	}

	// Existing ids may only be reused if the user actually has them — the
	// client edits its own list, it does not get to invent ids.
	existing, err := ddb.GetCategories(c.Context(), user)
	if err != nil {
		return err
	}
	owned := map[string]bool{}
	for _, cat := range existing {
		owned[cat.ID] = true
	}

	taken := map[string]bool{}
	clean := make([]types.Category, 0, len(input.Categories))
	for _, cat := range input.Categories {
		name := strings.TrimSpace(cat.Name)
		if name == "" || len(name) > maxCategoryName {
			return fiber.NewError(fiber.StatusBadRequest, "category names must be 1-32 characters")
		}
		id := cat.ID
		if id == "" || !owned[id] || taken[id] {
			id = mintID(name, taken)
		} else {
			taken[id] = true
		}
		clean = append(clean, types.Category{ID: id, Name: name})
	}

	if err := ddb.PutCategories(c.Context(), user, clean); err != nil {
		return err
	}
	return c.JSON(fiber.Map{"categories": clean})
}
