package api

import "testing"

func TestMintIDSlugs(t *testing.T) {
	taken := map[string]bool{}
	if got := mintID("Side Projects!", taken); got != "side-projects" {
		t.Fatalf("mintID = %q", got)
	}
}

func TestMintIDCollision(t *testing.T) {
	taken := map[string]bool{}
	first := mintID("Work", taken)
	second := mintID("Work", taken)
	if first != "work" {
		t.Fatalf("first = %q", first)
	}
	if second == first || len(second) <= len("work-") {
		t.Fatalf("collision not resolved: %q vs %q", first, second)
	}
}

func TestMintIDEmptyName(t *testing.T) {
	taken := map[string]bool{}
	if got := mintID("!!!", taken); got != "category" {
		t.Fatalf("mintID = %q", got)
	}
}
