package gitloomx

import (
	"strings"
	"testing"
)

// The bug this file exists for: every Clerk subject was rejected, so memory
// never worked for anybody.
func TestAClerkSubjectBecomesSomethingGitLoomAccepts(t *testing.T) {
	ns := Namespace("user_3J3fsbqIQhi6mqtfNj0JknPdOtO")
	if !valid(ns) {
		t.Fatalf("%q is still not a namespace GitLoom will take", ns)
	}
	if strings.Contains(ns, "_") || strings.ToLower(ns) != ns {
		t.Fatalf("%q kept the characters GitLoom refuses", ns)
	}
}

func TestTheSameAccountAlwaysLandsInTheSamePlace(t *testing.T) {
	id := "user_3J3fsbqIQhi6mqtfNj0JknPdOtO"
	if Namespace(id) != Namespace(id) {
		t.Fatal("a namespace that moves splits one person's memory in two")
	}
}

// Clerk subjects are case-sensitive. Folding case alone would put these two
// accounts in one namespace, which is one person reading another's memory.
func TestTwoSubjectsThatDifferOnlyByCaseStayApart(t *testing.T) {
	a := Namespace("user_AbCdEf")
	b := Namespace("user_abcdef")
	if a == b {
		t.Fatalf("%q and %q collided: two accounts, one memory", a, b)
	}
}

func TestAnIdThatIsAlreadyValidIsLeftAlone(t *testing.T) {
	for _, id := range []string{"abc-123", "a", strings.Repeat("x", 64)} {
		if got := Namespace(id); got != id {
			t.Fatalf("Namespace(%q) = %q, want it untouched", id, got)
		}
	}
}

func TestALongSubjectIsCutToFitAndKeepsItsDigest(t *testing.T) {
	ns := Namespace("USER_" + strings.Repeat("Z", 200))
	if len(ns) > 64 {
		t.Fatalf("namespace is %d characters, GitLoom takes 64", len(ns))
	}
	if !valid(ns) {
		t.Fatalf("%q is not valid", ns)
	}
	// The digest is the part that carries uniqueness, so it must survive.
	other := Namespace("USER_" + strings.Repeat("Y", 200))
	if ns == other {
		t.Fatal("two long subjects collided after trimming")
	}
}

func TestAnEmptySubjectStaysEmpty(t *testing.T) {
	if Namespace("  ") != "" {
		t.Fatal("an empty subject must not be given a namespace of its own")
	}
}
