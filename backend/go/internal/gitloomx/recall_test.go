package gitloomx

import (
	"testing"

	gl "github.com/GitLoomHQ/gitloom-go/gitloom"
)

func hits() []gl.Hit {
	return []gl.Hit{
		{Path: "facts/rec_deleted/lease.md", Snippet: "the lease ends in March"},
		{Path: "facts/people/priya.md", Snippet: "Priya is the wearer's sister"},
		{
			Path:       "facts/work/office.md",
			Snippet:    "they settled on the Mumbai office",
			Provenance: &gl.Provenance{Message: "ingest session rec_gone", When: "2026-09-01T09:00:00Z"},
		},
	}
}

// Suppression standing in for erasure: GitLoom has no delete, so a hit that
// traces back to a deleted conversation is dropped on the way out.
func TestFilterTombstonedByPath(t *testing.T) {
	got := FilterTombstoned(hits(), map[string]bool{"rec_deleted": true})
	if len(got) != 2 {
		t.Fatalf("hits = %d, want 2: %+v", len(got), got)
	}
	for _, h := range got {
		if h.Path == "facts/rec_deleted/lease.md" {
			t.Fatal("a tombstoned conversation's memory was served")
		}
	}
}

// Provenance names a commit, not a session, so the match reaches into the
// commit message too — best effort, and the reason this is [GL_ERASE].
func TestFilterTombstonedByProvenanceMessage(t *testing.T) {
	got := FilterTombstoned(hits(), map[string]bool{"rec_gone": true})
	if len(got) != 2 {
		t.Fatalf("hits = %d, want 2", len(got))
	}
	for _, h := range got {
		if h.Path == "facts/work/office.md" {
			t.Fatal("a hit whose provenance names a tombstoned session was served")
		}
	}
}

func TestFilterTombstonedEmptySetIsANoOp(t *testing.T) {
	if got := FilterTombstoned(hits(), nil); len(got) != 3 {
		t.Fatalf("hits = %d, want all 3", len(got))
	}
	// An empty id must never match everything.
	if got := FilterTombstoned(hits(), map[string]bool{"": true}); len(got) != 3 {
		t.Fatalf("an empty tombstone id swallowed the results: %d", len(got))
	}
}

func TestAsSearchHits(t *testing.T) {
	got := AsSearchHits([]gl.Hit{
		{Path: "facts/a.md", Score: 0.9, Snippet: "s",
			Provenance: &gl.Provenance{When: "2026-09-01T09:00:00Z", Diff: "not for the client"}},
		{Path: "facts/b.md", Score: 0.1, Snippet: "t"},
	})
	if len(got) != 2 {
		t.Fatalf("hits = %d", len(got))
	}
	if got[0].Path != "facts/a.md" || got[0].Score != 0.9 || got[0].Snippet != "s" {
		t.Fatalf("hit = %+v", got[0])
	}
	if got[0].When != "2026-09-01T09:00:00Z" {
		t.Fatalf("when = %q", got[0].When)
	}
	// No provenance is not an error: a citation without a date is still a
	// citation.
	if got[1].When != "" {
		t.Fatalf("when = %q, want empty", got[1].When)
	}
}

func TestBaseURLDefaults(t *testing.T) {
	// With GITLOOM_BASE_URL unset, every call goes to the hosted API — the
	// point of the fix being that it is now every call, not just one.
	if got := BaseURL(); got != DefaultBaseURL {
		t.Fatalf("BaseURL = %q, want %q", got, DefaultBaseURL)
	}
}
