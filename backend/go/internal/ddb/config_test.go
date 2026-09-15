package ddb

import (
	"encoding/json"
	"strings"
	"testing"
)

// mustDefault is the shipped configuration, parsed. Every test below starts
// from something valid and breaks exactly one thing, so a failure names the
// rule that caught it rather than the first rule in the list.
func mustDefault(t *testing.T) AppConfig {
	t.Helper()
	cfg, err := DefaultConfig()
	if err != nil {
		t.Fatalf("DefaultConfig: %v", err)
	}
	return cfg
}

// TestDefaultConfigParsesAndValidates is the guard on defaults.go: it is a
// JSON literal, so nothing but a test proves it is still JSON, still this
// shape, and still something PUT /admin/config would accept.
func TestDefaultConfigParsesAndValidates(t *testing.T) {
	cfg := mustDefault(t)
	if err := cfg.Validate(); err != nil {
		t.Fatalf("the built-in configuration is not valid: %v", err)
	}
	if cfg.Version != 1 {
		t.Errorf("version = %d, want 1", cfg.Version)
	}
	if len(cfg.Pricing.Tiers) != 3 {
		t.Fatalf("tiers = %d, want 3", len(cfg.Pricing.Tiers))
	}
	for _, want := range []struct {
		id                     string
		full, deposit, monthly int
	}{
		{"capture", 599900, 99900, 0},
		{"act", 899900, 99900, 0},
		{"act-pro", 1299900, 99900, 49900},
	} {
		tier, ok := cfg.Tier(want.id)
		if !ok {
			t.Errorf("no %q tier", want.id)
			continue
		}
		if tier.Full != want.full || tier.Deposit != want.deposit || tier.Monthly != want.monthly {
			t.Errorf("%s = full %d, deposit %d, monthly %d; want %d, %d, %d",
				want.id, tier.Full, tier.Deposit, tier.Monthly, want.full, want.deposit, want.monthly)
		}
	}
	if _, ok := cfg.Tier("nothing-like-it"); ok {
		t.Error("Tier found a tier that is not there")
	}
}

// TestDefaultConfigRoundTrips: the seed is written to DynamoDB and served as
// JSON, so what comes back out has to be what went in — including the empty
// badge, which is a key the app reads and not an absence.
func TestDefaultConfigRoundTrips(t *testing.T) {
	cfg := mustDefault(t)
	body, err := json.Marshal(cfg)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var back AppConfig
	if err := json.Unmarshal(body, &back); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(back.Pricing.Tiers) != len(cfg.Pricing.Tiers) {
		t.Fatalf("tiers = %d, want %d", len(back.Pricing.Tiers), len(cfg.Pricing.Tiers))
	}
	for _, key := range []string{`"badge"`, `"lines"`, `"monthly"`, `"digestHour"`, `"askLyzn"`} {
		if !strings.Contains(string(body), key) {
			t.Errorf("the response leaves out %s", key)
		}
	}
}

// TestNormalizedFillsInWhatIsMissing: a nil slice marshals to JSON null and
// a client mapping over it faults. Empty is what "none" means on the wire.
func TestNormalizedFillsInWhatIsMissing(t *testing.T) {
	cfg := AppConfig{Pricing: Pricing{Tiers: []Tier{{ID: "capture"}}}}
	got := cfg.Normalized()
	if got.Pricing.Tiers[0].Lines == nil {
		t.Error("a tier's lines are nil after Normalized")
	}
	if (AppConfig{}).Normalized().Pricing.Tiers == nil {
		t.Error("tiers are nil after Normalized")
	}

	body, err := json.Marshal(got)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(body), "null") {
		t.Errorf("a normalized configuration still emits null: %s", body)
	}
}

func TestValidate(t *testing.T) {
	cases := []struct {
		name  string
		spoil func(*AppConfig)
		// want is a fragment of the message, so a failure says which rule
		// fired rather than only that one did.
		want string
	}{
		{"as shipped", func(*AppConfig) {}, ""},
		{"duplicate tier ids", func(c *AppConfig) {
			c.Pricing.Tiers[1].ID = "capture"
		}, "appears twice"},
		{"a negative amount", func(c *AppConfig) {
			c.Pricing.Tiers[0].Deposit = -1
		}, "must not be negative"},
		{"an amount that is not whole rupees", func(c *AppConfig) {
			c.Pricing.Tiers[0].Deposit = 99950
		}, "whole number of rupees"},
		{"a deposit larger than the price", func(c *AppConfig) {
			c.Pricing.Tiers[0].Deposit = c.Pricing.Tiers[0].Full + 100
		}, "more than its full price"},
		{"nothing on sale", func(c *AppConfig) {
			for i := range c.Pricing.Tiers {
				c.Pricing.Tiers[i].Enabled = false
			}
		}, "at least one tier must be enabled"},
		{"one on sale is enough", func(c *AppConfig) {
			for i := range c.Pricing.Tiers {
				c.Pricing.Tiers[i].Enabled = i == 0
			}
		}, ""},
		{"no tiers at all", func(c *AppConfig) {
			c.Pricing.Tiers = nil
		}, "at least one tier"},
		{"a tier id with a space in it", func(c *AppConfig) {
			c.Pricing.Tiers[0].ID = "act pro"
		}, "lowercase letters"},
		{"an empty tier id", func(c *AppConfig) {
			c.Pricing.Tiers[0].ID = ""
		}, "lowercase letters"},
		{"a nameless tier", func(c *AppConfig) {
			c.Pricing.Tiers[0].Name = "  "
		}, "must be 1-40 characters"},
		{"an empty line", func(c *AppConfig) {
			c.Pricing.Tiers[0].Lines[1] = ""
		}, "lines[1]"},
		{"too many lines", func(c *AppConfig) {
			c.Pricing.Tiers[0].Lines = make([]string, maxTierLines+1)
		}, "at most"},
		{"no currency", func(c *AppConfig) {
			c.Pricing.Currency = ""
		}, "three-letter ISO code"},
		{"a lowercase currency", func(c *AppConfig) {
			c.Pricing.Currency = "inr"
		}, "three-letter ISO code"},
		{"no chooser title", func(c *AppConfig) {
			c.Pricing.Copy.ChooserTitle = " "
		}, "chooserTitle"},
		{"no receipt title", func(c *AppConfig) {
			c.Pricing.Copy.ReceiptTitle = ""
		}, "receiptTitle"},
		{"an essay for a chooser title", func(c *AppConfig) {
			c.Pricing.Copy.ChooserTitle = strings.Repeat("x", maxCopyChars+1)
		}, "at most"},
		{"an hour that is not one", func(c *AppConfig) {
			c.Notifications.DigestHour = 24
		}, "hour of the day"},
		{"midnight is an hour", func(c *AppConfig) {
			c.Notifications.DigestHour = 0
		}, ""},
	}

	for _, c := range cases {
		cfg := mustDefault(t)
		c.spoil(&cfg)
		err := cfg.Validate()
		switch {
		case c.want == "" && err != nil:
			t.Errorf("%s: Validate = %v, want nil", c.name, err)
		case c.want != "" && err == nil:
			t.Errorf("%s: Validate = nil, want an error about %q", c.name, c.want)
		case c.want != "" && err != nil && !strings.Contains(err.Error(), c.want):
			t.Errorf("%s: Validate = %q, want it to mention %q", c.name, err, c.want)
		}
	}
}

// TestValidateRefusesTooManyTiers is separate because building one is not a
// one-line break of the shipped document.
func TestValidateRefusesTooManyTiers(t *testing.T) {
	cfg := mustDefault(t)
	base := cfg.Pricing.Tiers[0]
	cfg.Pricing.Tiers = nil
	for i := 0; i <= maxTiers; i++ {
		tier := base
		tier.ID = string(rune('a'+i)) + "-tier"
		cfg.Pricing.Tiers = append(cfg.Pricing.Tiers, tier)
	}
	if err := cfg.Validate(); err == nil || !strings.Contains(err.Error(), "at most") {
		t.Errorf("Validate = %v, want a refusal of %d tiers", err, len(cfg.Pricing.Tiers))
	}
}
