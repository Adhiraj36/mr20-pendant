// Receipt routes — the roll.
//
//	GET  /receipts?cursor=&limit=   the roll, newest first
//	GET  /receipts/:id              one receipt
//	POST /receipts                  print a pairing or plan proof
//
// A task's receipt is printed by the task, in the same transaction that closed
// it, so there is no route for one here. POST exists for the two proofs the
// app witnesses rather than causes — a pendant paired, a plan unlocked — so
// they land in the same roll as everything else instead of being drawn client
// side and forgotten on reinstall.
package api

import (
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"

	"github.com/MelloB1989/mr20-pendant/backend/internal/authjwt"
	"github.com/MelloB1989/mr20-pendant/backend/internal/ddb"
)

func registerReceiptRoutes(app fiber.Router) {
	app.Get("/receipts", listReceipts)
	app.Get("/receipts/:id", receiptDetail)
	app.Post("/receipts", printReceipt)
}

func listReceipts(c *fiber.Ctx) error {
	user := authjwt.Sub(c)
	limit := int32(0)
	if v, err := strconv.Atoi(c.Query("limit")); err == nil && v > 0 {
		limit = int32(v)
	}
	receipts, cursor, err := ddb.ListReceipts(c.Context(), user, limit, c.Query("cursor"))
	if err != nil {
		return err
	}
	out := fiber.Map{"receipts": receipts}
	if cursor != "" {
		out["cursor"] = cursor
	}
	return c.JSON(out)
}

func receiptDetail(c *fiber.Ctx) error {
	receipt, err := ddb.GetReceipt(c.Context(), authjwt.Sub(c), c.Params("id"))
	if err != nil {
		return err
	}
	if receipt == nil {
		return fiber.NewError(fiber.StatusNotFound, "no such receipt")
	}
	return c.JSON(fiber.Map{"receipt": receipt})
}

// stampFor is the mark each printable kind carries. The kind decides it, not
// the client: a receipt whose stamp the sender chose proves whatever the
// sender wanted it to.
var stampFor = map[ddb.ReceiptKind]ddb.ReceiptStamp{
	ddb.ReceiptPairing: ddb.StampReady,
	ddb.ReceiptPlan:    ddb.StampUnlocked,
}

func printReceipt(c *fiber.Ctx) error {
	user := authjwt.Sub(c)
	var input struct {
		Kind  string           `json:"kind"`
		Title string           `json:"title"`
		Quote string           `json:"quote"`
		Rows  []ddb.ReceiptRow `json:"rows"`
	}
	if err := c.BodyParser(&input); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "request body must be JSON")
	}

	kind := ddb.ReceiptKind(strings.TrimSpace(input.Kind))
	stamp, ok := stampFor[kind]
	if !ok {
		// task receipts come from POST /tasks/:id/done, and a conversation's
		// from the pipeline. Neither is a thing a client may mint.
		return fiber.NewError(fiber.StatusBadRequest, "kind must be pairing or plan")
	}

	title := strings.TrimSpace(input.Title)
	if title == "" {
		return fiber.NewError(fiber.StatusBadRequest, "a receipt needs a title")
	}
	if len(input.Rows) > 24 {
		return fiber.NewError(fiber.StatusBadRequest, "too many rows for a receipt")
	}

	receipt := ddb.Receipt{
		ReceiptID: uuid.NewString(),
		UserID:    user,
		Kind:      kind,
		Title:     truncate(title, 120),
		Quote:     truncate(strings.TrimSpace(input.Quote), 400),
		Rows:      ddb.CleanRows(input.Rows),
		Stamp:     stamp,
		CreatedAt: nowISO(),
	}
	if err := ddb.PutReceipt(c.Context(), user, receipt); err != nil {
		return err
	}
	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"receipt": receipt})
}
