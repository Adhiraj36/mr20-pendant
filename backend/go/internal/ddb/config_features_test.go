package ddb

import (
	"reflect"
	"testing"

	ddbtypes "github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// The bug: a bool absent from the stored item unmarshals to false, so adding
// a feature flag switched it off everywhere that already had a configuration
// row. phoneCapture shipped as true and production read it as false.
func TestAFlagTheStoredDocumentNeverHeardOfKeepsItsShippedValue(t *testing.T) {
	defaults, err := DefaultConfig()
	if err != nil {
		t.Fatal(err)
	}
	if !defaults.Features.PhoneCapture {
		t.Fatal("this test is about a flag that ships true")
	}

	// A document written before the flag existed: it names the others.
	item := map[string]ddbtypes.AttributeValue{
		"features": &ddbtypes.AttributeValueMemberM{Value: map[string]ddbtypes.AttributeValue{
			"daemon":    &ddbtypes.AttributeValueMemberBOOL{Value: false},
			"whatsapp":  &ddbtypes.AttributeValueMemberBOOL{Value: false},
			"execution": &ddbtypes.AttributeValueMemberBOOL{Value: false},
			"askLyzn":   &ddbtypes.AttributeValueMemberBOOL{Value: true},
			"darkMode":  &ddbtypes.AttributeValueMemberBOOL{Value: true},
		}},
	}
	var cfg AppConfig // every flag false, as an unmarshal would leave it
	if err := fillAbsentFeatures(item, &cfg); err != nil {
		t.Fatal(err)
	}
	if !cfg.Features.PhoneCapture {
		t.Fatal("the absent flag was left off; adding a flag would disable it in production")
	}
}

// A flag the document *does* name is the document's to decide, including when
// it turns something off that ships on.
func TestAStoredFlagWins(t *testing.T) {
	item := map[string]ddbtypes.AttributeValue{
		"features": &ddbtypes.AttributeValueMemberM{Value: map[string]ddbtypes.AttributeValue{
			"phoneCapture": &ddbtypes.AttributeValueMemberBOOL{Value: false},
		}},
	}
	cfg := AppConfig{}
	cfg.Features.PhoneCapture = false // what the unmarshal produced
	if err := fillAbsentFeatures(item, &cfg); err != nil {
		t.Fatal(err)
	}
	if cfg.Features.PhoneCapture {
		t.Fatal("a flag the operator turned off was turned back on")
	}
}

// The fallback names its flags one at a time, so a new field added to the
// struct and forgotten there would be silently wrong — which is the whole
// bug this fixes. This walks the type and refuses to let that happen twice.
func TestEveryFeatureFlagIsCoveredByTheFallback(t *testing.T) {
	features := reflect.TypeOf(Features{})
	item := map[string]ddbtypes.AttributeValue{
		"features": &ddbtypes.AttributeValueMemberM{Value: map[string]ddbtypes.AttributeValue{}},
	}
	defaults, err := DefaultConfig()
	if err != nil {
		t.Fatal(err)
	}
	var cfg AppConfig
	if err := fillAbsentFeatures(item, &cfg); err != nil {
		t.Fatal(err)
	}
	for i := range features.NumField() {
		name := features.Field(i).Name
		got := reflect.ValueOf(cfg.Features).FieldByName(name)
		want := reflect.ValueOf(defaults.Features).FieldByName(name)
		if got.Interface() != want.Interface() {
			t.Fatalf("%s is not in fillAbsentFeatures: an empty document left it %v, ships %v",
				name, got.Interface(), want.Interface())
		}
	}
}
