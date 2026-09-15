// The application's own configuration: one row, read by everybody.
//
//	Config  PK CONFIG  SK app
//
// Prices, the tier copy, the feature flags and the notification schedule are
// data rather than code, so a price can change without a deploy and the app
// can be told a feature exists the moment it does. The row is not a user's,
// which is why its partition key is the literal CONFIG rather than a
// USER#<sub>: there is exactly one of it.
//
// Money is paise here and only here. The website and the order rows are in
// rupees, so whoever reads a price for a charge divides by a hundred —
// Validate refuses an amount that is not a whole number of rupees precisely
// so that division is never lossy.
//
// The defaults are internal/config's DefaultAppConfigJSON, seeded on first
// read. Nothing else in this package writes a row it was not asked to write;
// this one is the exception, and it is the same exception GetCategories
// makes, for the same reason: the client should never have to special-case
// an empty account or an empty install.
package ddb

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	ddbtypes "github.com/aws/aws-sdk-go-v2/service/dynamodb/types"

	"github.com/MelloB1989/mr20-pendant/backend/internal/config"
)

// AppConfig is the whole document, exactly as GET /config serves it.
//
// Every field carries a json tag because this type *is* the wire shape, and
// a dynamodbav tag that matches it because the stored row should read the
// same as the response when somebody opens the table in the console.
type AppConfig struct {
	// Version is bumped by every successful PutConfig, starting at 1. A
	// client that has seen a version knows whether what it holds is stale.
	Version int `json:"version" dynamodbav:"version"`
	// UpdatedAt is RFC 3339, stamped by whoever wrote the row.
	UpdatedAt     string        `json:"updatedAt" dynamodbav:"updatedAt"`
	Pricing       Pricing       `json:"pricing" dynamodbav:"pricing"`
	Features      Features      `json:"features" dynamodbav:"features"`
	Notifications Notifications `json:"notifications" dynamodbav:"notifications"`
}

// Pricing is what the plan chooser and the pre-order page are made of.
type Pricing struct {
	// Currency is the ISO code every amount below is in. INR today, and the
	// checkout has no other; it is here so a reader never has to assume.
	Currency string `json:"currency" dynamodbav:"currency"`
	// Preorder says these tiers are sold as deposits against a device that
	// has not shipped, which is what lets a screen say "balance on dispatch".
	Preorder bool        `json:"preorder" dynamodbav:"preorder"`
	Tiers    []Tier      `json:"tiers" dynamodbav:"tiers"`
	Copy     PricingCopy `json:"copy" dynamodbav:"copy"`
}

// Tier is one way to buy the pendant.
type Tier struct {
	ID   string `json:"id" dynamodbav:"id"`
	Name string `json:"name" dynamodbav:"name"`
	// Full is what the device costs, Deposit is what a checkout takes today,
	// and Monthly is what renews from activation — disclosed at checkout,
	// never charged by it. All three in paise.
	Full    int  `json:"full" dynamodbav:"full"`
	Deposit int  `json:"deposit" dynamodbav:"deposit"`
	Monthly int  `json:"monthly" dynamodbav:"monthly"`
	Enabled bool `json:"enabled" dynamodbav:"enabled"`
	// Badge is the one word over the card ("Most chosen"), empty for none.
	// Not omitempty: a client reading a fixed shape should find the key.
	Badge string `json:"badge" dynamodbav:"badge"`
	// Lines is what the tier includes, in the order it is shown.
	Lines []string `json:"lines" dynamodbav:"lines"`
}

// PricingCopy is the sentences around the tiers. They are configuration for
// the same reason the prices are: they change with a campaign, not with a
// release.
type PricingCopy struct {
	ChooserTitle string `json:"chooserTitle" dynamodbav:"chooserTitle"`
	ChooserSub   string `json:"chooserSub" dynamodbav:"chooserSub"`
	DepositNote  string `json:"depositNote" dynamodbav:"depositNote"`
	IndiaOnly    string `json:"indiaOnly" dynamodbav:"indiaOnly"`
	ReceiptTitle string `json:"receiptTitle" dynamodbav:"receiptTitle"`
}

// Features are the slots. Each is a thing the design describes and the
// backend does not have yet: the screens that would use one are written, and
// hidden, until the flag says otherwise.
//
// A struct rather than a map on purpose — the app branches on five named
// booleans, and a partial map sent by an administrator would leave one of
// them absent rather than false.
type Features struct {
	Daemon    bool `json:"daemon" dynamodbav:"daemon"`
	WhatsApp  bool `json:"whatsapp" dynamodbav:"whatsapp"`
	Execution bool `json:"execution" dynamodbav:"execution"`
	AskLyzn   bool `json:"askLyzn" dynamodbav:"askLyzn"`
	// PhoneCapture lets somebody record with the phone when they have no
	// pendant — the plan entitles them to capture, the hardware is simply
	// not in their hand yet.
	PhoneCapture bool `json:"phoneCapture" dynamodbav:"phoneCapture"`
	DarkMode  bool `json:"darkMode" dynamodbav:"darkMode"`
}

// Notifications is when the day's summary goes out, in the user's local
// hour. One field today; it is an object so the second one is not a
// breaking change.
type Notifications struct {
	DigestHour int `json:"digestHour" dynamodbav:"digestHour"`
}

const (
	configPK = "CONFIG"
	configSK = "app"
)

// ErrConfigConflict is what PutConfig returns when somebody else stored a
// version between this caller's read and their write. It is a distinct error
// because the answer is distinct: not "that document is wrong" and not
// "something broke", but "read it again".
var ErrConfigConflict = errors.New("the configuration changed while you were editing it")

// DefaultConfig is the configuration in the code: what a table with no row
// is seeded with, and what a caller that cannot reach DynamoDB should serve
// rather than nothing.
//
// It parses internal/config's JSON every call — a few microseconds, and it
// hands back a value nobody else can mutate.
func DefaultConfig() (AppConfig, error) {
	var cfg AppConfig
	if err := json.Unmarshal([]byte(config.DefaultAppConfigJSON), &cfg); err != nil {
		return AppConfig{}, fmt.Errorf("the built-in configuration does not parse: %w", err)
	}
	return cfg.Normalized(), nil
}

// GetConfig returns the stored configuration, seeding the code's defaults on
// first read.
func GetConfig(ctx context.Context) (AppConfig, error) {
	cfg, found, err := readConfig(ctx)
	if err != nil {
		return AppConfig{}, err
	}
	if found {
		return cfg, nil
	}

	seed, err := DefaultConfig()
	if err != nil {
		return AppConfig{}, err
	}
	seed.UpdatedAt = nowISO()

	// attribute_not_exists is what makes two cold containers racing to seed
	// harmless: the loser reads what the winner wrote rather than
	// overwriting it, which matters once somebody has edited the row and a
	// stale container would otherwise put the defaults back.
	if err := putConfigItem(ctx, seed, aws.String("attribute_not_exists(PK)")); err != nil {
		var exists *ddbtypes.ConditionalCheckFailedException
		if errors.As(err, &exists) {
			if cfg, found, err := readConfig(ctx); err == nil && found {
				return cfg, nil
			}
		}
		return AppConfig{}, err
	}
	return seed, nil
}

// PutConfig validates, bumps the version, stamps the time and stores. It
// returns what was stored, which is what the caller should answer with —
// version and updatedAt are this function's to set, not its caller's.
//
// The write is conditional on the version it read, so two administrators
// saving at once produce one error rather than one silently lost edit.
func PutConfig(ctx context.Context, next AppConfig) (AppConfig, error) {
	if err := next.Validate(); err != nil {
		return AppConfig{}, err
	}
	current, found, err := readConfig(ctx)
	if err != nil {
		return AppConfig{}, err
	}

	next = next.Normalized()
	next.Version = current.Version + 1
	next.UpdatedAt = nowISO()

	condition := aws.String("attribute_not_exists(PK)")
	values := map[string]ddbtypes.AttributeValue{}
	if found {
		condition = aws.String("version = :v")
		values[":v"] = &ddbtypes.AttributeValueMemberN{Value: fmt.Sprint(current.Version)}
	}
	if err := putConfigItem(ctx, next, condition, values); err != nil {
		var raced *ddbtypes.ConditionalCheckFailedException
		if errors.As(err, &raced) {
			return AppConfig{}, fmt.Errorf("%w: re-read GET /config and try again", ErrConfigConflict)
		}
		return AppConfig{}, err
	}
	return next, nil
}

func configKey() map[string]ddbtypes.AttributeValue {
	return map[string]ddbtypes.AttributeValue{"PK": s(configPK), "SK": s(configSK)}
}

// readConfig returns the stored row. A missing row is data, not failure, so
// it reports found rather than an error.
func readConfig(ctx context.Context) (AppConfig, bool, error) {
	out, err := client.GetItem(ctx, &dynamodb.GetItemInput{TableName: &table, Key: configKey()})
	if err != nil {
		return AppConfig{}, false, err
	}
	if out.Item == nil {
		return AppConfig{}, false, nil
	}
	stripKeys(out.Item)
	var cfg AppConfig
	if err := attributevalue.UnmarshalMap(out.Item, &cfg); err != nil {
		return AppConfig{}, false, err
	}
	if err := fillAbsentFeatures(out.Item, &cfg); err != nil {
		return AppConfig{}, false, err
	}
	return cfg.Normalized(), true, nil
}

// fillAbsentFeatures gives a flag the stored document has never heard of the
// value the code ships with.
//
// A bool that is not in the item unmarshals to false, so **adding a feature
// flag silently switches it off in every environment that already has a
// configuration row** — which is exactly what happened to `phoneCapture`:
// shipped as true, read as false, and nothing said so. The stored document
// is the authority only for the flags it actually names; everything else
// falls back to the default the deployment was built with, the way the app's
// own coercion already does it.
func fillAbsentFeatures(item map[string]ddbtypes.AttributeValue, cfg *AppConfig) error {
	stored, ok := item["features"].(*ddbtypes.AttributeValueMemberM)
	if !ok {
		return nil
	}
	defaults, err := DefaultConfig()
	if err != nil {
		return err
	}

	// Named one by one on purpose: a flag added to the struct and forgotten
	// here is a compile-time nothing, so the test beside this walks the type
	// and fails when a field is missing from this list.
	for name, apply := range map[string]func(){
		"daemon":       func() { cfg.Features.Daemon = defaults.Features.Daemon },
		"whatsapp":     func() { cfg.Features.WhatsApp = defaults.Features.WhatsApp },
		"execution":    func() { cfg.Features.Execution = defaults.Features.Execution },
		"askLyzn":      func() { cfg.Features.AskLyzn = defaults.Features.AskLyzn },
		"phoneCapture": func() { cfg.Features.PhoneCapture = defaults.Features.PhoneCapture },
		"darkMode":     func() { cfg.Features.DarkMode = defaults.Features.DarkMode },
	} {
		if _, present := stored.Value[name]; !present {
			apply()
		}
	}
	return nil
}

func putConfigItem(ctx context.Context, cfg AppConfig, condition *string, values ...map[string]ddbtypes.AttributeValue) error {
	item, err := attributevalue.MarshalMap(cfg)
	if err != nil {
		return err
	}
	item["PK"] = s(configPK)
	item["SK"] = s(configSK)
	in := &dynamodb.PutItemInput{TableName: &table, Item: item, ConditionExpression: condition}
	if len(values) == 1 && len(values[0]) > 0 {
		in.ExpressionAttributeValues = values[0]
	}
	_, err = client.PutItem(ctx, in)
	return err
}

/* ─────────────────────────────────────────────────────────────
   Shape

   Normalized and Validate are pure: everything below this line can be
   tested, and is, without an AWS account.
   ───────────────────────────────────────────────────────────── */

// Normalized fills in what a document may leave out, so the response is one
// fixed shape whatever was stored. A nil slice would marshal to JSON null
// and a client mapping over it would fault; an empty one is what "none"
// means on the wire.
func (c AppConfig) Normalized() AppConfig {
	if c.Pricing.Tiers == nil {
		c.Pricing.Tiers = []Tier{}
	}
	tiers := make([]Tier, len(c.Pricing.Tiers))
	for i, tier := range c.Pricing.Tiers {
		if tier.Lines == nil {
			tier.Lines = []string{}
		}
		tiers[i] = tier
	}
	c.Pricing.Tiers = tiers
	return c
}

// Tier returns the tier with this id, and whether there is one.
func (c AppConfig) Tier(id string) (Tier, bool) {
	for _, tier := range c.Pricing.Tiers {
		if tier.ID == id {
			return tier, true
		}
	}
	return Tier{}, false
}

var tierIDRe = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,31}$`)

const (
	maxTiers     = 12
	maxTierLines = 12
	maxLineChars = 160
	maxCopyChars = 400
)

// Validate is the whole schema, and it is deliberately strict: this document
// decides what a card is charged, and the only thing standing between a
// typo and a wrong charge is what follows.
//
// The error is written to be read by the person who sent the document —
// PUT /admin/config returns it verbatim.
func (c AppConfig) Validate() error {
	p := c.Pricing

	if code := strings.TrimSpace(p.Currency); len(code) != 3 || strings.ToUpper(code) != code {
		return fmt.Errorf("pricing.currency must be a three-letter ISO code, got %q", p.Currency)
	}
	if len(p.Tiers) == 0 {
		return errors.New("pricing.tiers must list at least one tier")
	}
	if len(p.Tiers) > maxTiers {
		return fmt.Errorf("pricing.tiers must hold at most %d tiers, got %d", maxTiers, len(p.Tiers))
	}

	seen := map[string]bool{}
	enabled := 0
	for i, tier := range p.Tiers {
		where := fmt.Sprintf("pricing.tiers[%d]", i)
		if !tierIDRe.MatchString(tier.ID) {
			return fmt.Errorf("%s.id must be lowercase letters, digits and hyphens, got %q", where, tier.ID)
		}
		if seen[tier.ID] {
			return fmt.Errorf("%s.id %q appears twice; tier ids are what an order is priced by and must be unique", where, tier.ID)
		}
		seen[tier.ID] = true

		if name := strings.TrimSpace(tier.Name); name == "" || len(tier.Name) > 40 {
			return fmt.Errorf("%s.name must be 1-40 characters, got %q", where, tier.Name)
		}
		// A slice, not a map: the message names the first field that is
		// wrong, and which one that is should not depend on Go's map order.
		for _, amount := range []struct {
			field string
			value int
		}{{"full", tier.Full}, {"deposit", tier.Deposit}, {"monthly", tier.Monthly}} {
			if amount.value < 0 {
				return fmt.Errorf("%s.%s must not be negative, got %d", where, amount.field, amount.value)
			}
			// Paise, but the checkout charges rupees × 100. An amount that
			// is not a whole rupee would lose its last two digits silently.
			if amount.value%100 != 0 {
				return fmt.Errorf("%s.%s is in paise and must be a whole number of rupees, got %d", where, amount.field, amount.value)
			}
		}
		if tier.Deposit > tier.Full {
			return fmt.Errorf("%s.deposit (%d) is more than its full price (%d)", where, tier.Deposit, tier.Full)
		}
		if len(tier.Badge) > 24 {
			return fmt.Errorf("%s.badge must be at most 24 characters", where)
		}
		if len(tier.Lines) > maxTierLines {
			return fmt.Errorf("%s.lines must hold at most %d lines, got %d", where, maxTierLines, len(tier.Lines))
		}
		for j, line := range tier.Lines {
			if strings.TrimSpace(line) == "" || len(line) > maxLineChars {
				return fmt.Errorf("%s.lines[%d] must be 1-%d characters", where, j, maxLineChars)
			}
		}
		if tier.Enabled {
			enabled++
		}
	}
	if enabled == 0 {
		// Nothing to buy is not a configuration, it is an outage.
		return errors.New("at least one tier must be enabled")
	}

	if strings.TrimSpace(p.Copy.ChooserTitle) == "" {
		return errors.New("pricing.copy.chooserTitle must not be empty")
	}
	if strings.TrimSpace(p.Copy.ReceiptTitle) == "" {
		return errors.New("pricing.copy.receiptTitle must not be empty")
	}
	for _, entry := range []struct {
		field string
		text  string
	}{
		{"chooserTitle", p.Copy.ChooserTitle}, {"chooserSub", p.Copy.ChooserSub},
		{"depositNote", p.Copy.DepositNote}, {"indiaOnly", p.Copy.IndiaOnly},
		{"receiptTitle", p.Copy.ReceiptTitle},
	} {
		if len(entry.text) > maxCopyChars {
			return fmt.Errorf("pricing.copy.%s must be at most %d characters", entry.field, maxCopyChars)
		}
	}

	if h := c.Notifications.DigestHour; h < 0 || h > 23 {
		return fmt.Errorf("notifications.digestHour must be an hour of the day (0-23), got %d", h)
	}
	return nil
}
