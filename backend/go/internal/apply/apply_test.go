package apply

import "testing"

func TestExtractionPrefixMatchesThePythonSideScheme(t *testing.T) {
	if got := ExtractionPrefix("user_1", "rec_1"); got != "extract/user_1/rec_1/" {
		t.Fatalf("got %q", got)
	}
}
