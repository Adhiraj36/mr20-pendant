package enrich

import (
	"testing"

	"github.com/MelloB1989/mr20-pendant/backend/internal/types"
)

func mergeFixture(lines ...string) *types.Transcript {
	t := &types.Transcript{}
	for _, l := range lines {
		t.Utterances = append(t.Utterances, types.Utterance{Text: l})
	}
	t.Text = ""
	return t
}

func TestApplyCorrectionsPatchesAndRebuilds(t *testing.T) {
	tr := mergeFixture("hello there", "by two kilos of rice", "see you")
	n := ApplyCorrections(tr, []map[string]any{
		{"i": float64(1), "text": "buy two kilos of rice"},
	})
	if n != 1 {
		t.Fatalf("applied = %d, want 1", n)
	}
	if tr.Utterances[1].Text != "buy two kilos of rice" {
		t.Errorf("utterance not patched: %q", tr.Utterances[1].Text)
	}
	if tr.Text != "hello there buy two kilos of rice see you" {
		t.Errorf("running text not rebuilt: %q", tr.Text)
	}
	if tr.MergedCorrections != 1 {
		t.Errorf("MergedCorrections = %d, want 1", tr.MergedCorrections)
	}
}

func TestApplyCorrectionsRejectsGarbage(t *testing.T) {
	tr := mergeFixture("one", "two")
	original := tr.Text
	n := ApplyCorrections(tr, []map[string]any{
		{"i": float64(9), "text": "out of range"},
		{"i": float64(-1), "text": "negative"},
		{"i": float64(0), "text": ""},           // empty replacement
		{"i": "zero", "text": "not a number"},   // wrong type
		{"i": float64(1), "text": "two"},        // no-op change
	})
	if n != 0 {
		t.Fatalf("applied = %d, want 0", n)
	}
	if tr.Text != original || tr.MergedCorrections != 0 {
		t.Errorf("transcript mutated by rejected corrections")
	}
}

func TestParseJSONArrayFenced(t *testing.T) {
	reply := "Here you go:\n```json\n[{\"i\": 0, \"text\": \"fixed\"}]\n```"
	parsed, err := parseJSONArray(reply)
	if err != nil || len(parsed) != 1 {
		t.Fatalf("parse failed: %v %v", parsed, err)
	}
	if parsed[0]["text"] != "fixed" {
		t.Errorf("wrong content: %v", parsed[0])
	}
}
