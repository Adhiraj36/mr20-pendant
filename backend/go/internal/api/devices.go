// Device pairing routes.
//
//	POST   /devices            pair (or refresh) a pendant
//	GET    /devices            list paired pendants
//	PATCH  /devices/:mac       push telemetry read over BLE
//	DELETE /devices/:mac       unpair
package api

import (
	"regexp"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"

	"github.com/MelloB1989/mr20-pendant/backend/internal/authjwt"
	"github.com/MelloB1989/mr20-pendant/backend/internal/ddb"
	"github.com/MelloB1989/mr20-pendant/backend/internal/types"
)

func nowISO() string { return time.Now().UTC().Format(time.RFC3339) }

var nonHex = regexp.MustCompile(`[^0-9a-f]`)

// normaliseMac: the device reports its MAC as bare lowercase hex, e.g. 50c0f013d830.
func normaliseMac(raw string) (string, error) {
	mac := nonHex.ReplaceAllString(strings.ToLower(raw), "")
	if len(mac) != 12 {
		return "", fiber.NewError(fiber.StatusBadRequest, "mac must be 12 hex characters, as BLE&MAC reports it")
	}
	return mac, nil
}

func registerDeviceRoutes(app fiber.Router) {
	app.Post("/devices", pairDevice)
	app.Get("/devices", listDevices)
	app.Patch("/devices/:mac", deviceTelemetry)
	app.Delete("/devices/:mac", unpairDevice)
}

type deviceInput struct {
	Mac            string   `json:"mac"`
	PeripheralID   string   `json:"peripheralId"`
	Name           string   `json:"name"`
	Firmware       string   `json:"firmware"`
	WifiFirmware   string   `json:"wifiFirmware"`
	BatteryPercent *float64 `json:"batteryPercent"`
	FreeMb         *float64 `json:"freeMb"`
	TotalMb        *float64 `json:"totalMb"`
}

func pairDevice(c *fiber.Ctx) error {
	user := authjwt.Sub(c)
	var input deviceInput
	if err := c.BodyParser(&input); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "request body must be JSON")
	}
	mac, err := normaliseMac(input.Mac)
	if err != nil {
		return err
	}
	if strings.TrimSpace(input.PeripheralID) == "" {
		return fiber.NewError(fiber.StatusBadRequest, "peripheralId is required and must be a non-empty string")
	}

	existing, err := findDevice(c, user, mac)
	if err != nil {
		return err
	}

	name := strings.TrimSpace(input.Name)
	if name == "" {
		name = "YLF20_" + mac[len(mac)-4:]
	}
	device := types.Device{
		UserID: user,
		Mac:    mac,
		// iOS gives the host a per-device UUID rather than the MAC, so the app
		// has to remember whatever its own BLE stack uses to reconnect.
		PeripheralID: strings.TrimSpace(input.PeripheralID),
		Name:         name,
		Firmware:     input.Firmware,
		WifiFirmware: input.WifiFirmware,
		LastSeenAt:   nowISO(),
		// Re-pairing the same pendant keeps its original pairing date.
		PairedAt: nowISO(),
	}
	if existing != nil {
		device.PairedAt = existing.PairedAt
	}
	if input.BatteryPercent != nil {
		device.BatteryPercent = *input.BatteryPercent
	}
	if input.FreeMb != nil {
		device.FreeMb = *input.FreeMb
	}
	if input.TotalMb != nil {
		device.TotalMb = *input.TotalMb
	}

	if err := ddb.PutDevice(c.Context(), device); err != nil {
		return err
	}
	if existing != nil {
		return c.JSON(device)
	}
	return c.Status(fiber.StatusCreated).JSON(device)
}

func findDevice(c *fiber.Ctx, user, mac string) (*types.Device, error) {
	devices, err := ddb.ListDevices(c.Context(), user)
	if err != nil {
		return nil, err
	}
	for i := range devices {
		if devices[i].Mac == mac {
			return &devices[i], nil
		}
	}
	return nil, nil
}

func listDevices(c *fiber.Ctx) error {
	devices, err := ddb.ListDevices(c.Context(), authjwt.Sub(c))
	if err != nil {
		return err
	}
	return c.JSON(fiber.Map{"devices": devices})
}

func deviceTelemetry(c *fiber.Ctx) error {
	user := authjwt.Sub(c)
	mac, err := normaliseMac(c.Params("mac"))
	if err != nil {
		return err
	}

	var input deviceInput
	if err := c.BodyParser(&input); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "request body must be JSON")
	}

	telemetry := map[string]any{}
	if input.BatteryPercent != nil {
		telemetry["batteryPercent"] = *input.BatteryPercent
	}
	if input.FreeMb != nil {
		telemetry["freeMb"] = *input.FreeMb
	}
	if input.TotalMb != nil {
		telemetry["totalMb"] = *input.TotalMb
	}
	if input.Firmware != "" {
		telemetry["firmware"] = input.Firmware
	}
	if input.WifiFirmware != "" {
		telemetry["wifiFirmware"] = input.WifiFirmware
	}

	if err := ddb.TouchDevice(c.Context(), user, mac, telemetry); err != nil {
		return err
	}
	return c.SendStatus(fiber.StatusNoContent)
}

func unpairDevice(c *fiber.Ctx) error {
	user := authjwt.Sub(c)
	mac, err := normaliseMac(c.Params("mac"))
	if err != nil {
		return err
	}
	existing, err := findDevice(c, user, mac)
	if err != nil {
		return err
	}
	if existing == nil {
		return fiber.NewError(fiber.StatusNotFound, "no such paired device")
	}
	// Recordings already pulled off the pendant stay; they are the user's
	// data, not the device's.
	if err := ddb.DeleteDevice(c.Context(), user, mac); err != nil {
		return err
	}
	return c.SendStatus(fiber.StatusNoContent)
}
