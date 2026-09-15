package clerkmeta

import (
	"encoding/json"
	"testing"
)

// TestPlanMetadataIsTheWholeShape: the app reads these four keys off the
// Clerk session the moment somebody signs in, so all four are always there —
// an absent key and an empty one must not be two different states.
func TestPlanMetadataIsTheWholeShape(t *testing.T) {
	got := PlanMetadata("act-pro", "active", "2026-09-08T10:04:00Z", "LYZN-4KP2Z9Q")
	want := map[string]string{
		"plan":           "act-pro",
		"planStatus":     "active",
		"planSince":      "2026-09-08T10:04:00Z",
		"orderReference": "LYZN-4KP2Z9Q",
	}
	if len(got) != len(want) {
		t.Fatalf("metadata = %v, want %v", got, want)
	}
	for key, value := range want {
		if got[key] != value {
			t.Errorf("%s = %q, want %q", key, got[key], value)
		}
	}

	// A user who has never paid still gets every key.
	empty := PlanMetadata("none", "none", "", "")
	for _, key := range []string{KeyPlan, KeyPlanStatus, KeyPlanSince, KeyOrderReference} {
		if _, ok := empty[key]; !ok {
			t.Errorf("an unpaid user's metadata leaves out %q", key)
		}
	}

	// And it has to be JSON Clerk will take: an object of strings.
	body, err := json.Marshal(got)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var back map[string]string
	if err := json.Unmarshal(body, &back); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
}

// TestPlanMetadataWritesNoRole: the document is merged into what Clerk
// already holds, and `role` — which is what PUT /admin/config trusts — is
// somebody else's to set. Naming it here would be a privilege escalation
// waiting for a typo.
func TestPlanMetadataWritesNoRole(t *testing.T) {
	if _, ok := PlanMetadata("act", "active", "", "")[KeyRole]; ok {
		t.Fatal("the plan document carries a role")
	}
}

// TestRoleOf reads a role out of whatever a human left in the metadata.
func TestRoleOf(t *testing.T) {
	cases := []struct {
		name string
		raw  string
		want string
	}{
		{"nothing", "", ""},
		{"empty object", `{}`, ""},
		{"an admin", `{"role":"admin"}`, "admin"},
		{"an admin with a plan beside it", `{"plan":"act","role":"admin"}`, "admin"},
		{"somebody else", `{"role":"support"}`, "support"},
		{"a role that is not a string", `{"role":42}`, ""},
		{"not an object", `"admin"`, ""},
		{"not JSON at all", `{`, ""},
	}
	for _, c := range cases {
		if got := RoleOf(json.RawMessage(c.raw)); got != c.want {
			t.Errorf("%s: RoleOf(%s) = %q, want %q", c.name, c.raw, got, c.want)
		}
	}
}

// TestSetPlanMetadataNeedsAUser: the id comes from a verified token
// everywhere it is called, but an empty one must fail here rather than
// become a request to Clerk for /users//metadata.
func TestSetPlanMetadataNeedsAUser(t *testing.T) {
	if err := SetPlanMetadata(t.Context(), "", "act", "active", "", ""); err == nil {
		t.Fatal("an empty user id was accepted")
	}
	if _, err := Role(t.Context(), ""); err == nil {
		t.Fatal("an empty user id was accepted")
	}
}
