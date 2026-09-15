package gitloomx

import (
	"strings"

	gl "github.com/GitLoomHQ/gitloom-go/gitloom"
)

// SearchHit is one memory, as the app reads it: where it lives, how well it
// matched, what it says, and when it was filed. The SDK's Hit carries more —
// scoring arms, git history, graph neighbours — and none of it belongs on a
// citation chip.
type SearchHit struct {
	Path    string  `json:"path"`
	Score   float64 `json:"score"`
	Snippet string  `json:"snippet"`
	When    string  `json:"when"`
}

// AsSearchHits narrows the SDK's hits to what a citation needs.
func AsSearchHits(hits []gl.Hit) []SearchHit {
	out := make([]SearchHit, 0, len(hits))
	for _, h := range hits {
		hit := SearchHit{Path: h.Path, Score: h.Score, Snippet: h.Snippet}
		if h.Provenance != nil {
			hit.When = h.Provenance.When
		}
		out = append(out, hit)
	}
	return out
}

// FilterTombstoned drops hits that trace back to a deleted conversation.
//
// This is suppression standing in for erasure, and it is worth being exact
// about why. GitLoom has no delete for a memory — not by id, not by session,
// not by namespace — so a user who deletes a recording cannot have what was
// extracted from it removed; they can only stop it being served. Retrieval
// also has no source filter, so the session id we send with every ingestion is
// write-only metadata we cannot query back.
//
// What is left is text. A memory that came from a tombstoned conversation
// usually names its recording id somewhere in its path, its commit message or
// its body, because that is what the ingestion was filed under. Matching on
// that is best effort in the strict sense: it will miss memories that mention
// the id nowhere, and it is the reason the plan marks this [GL_ERASE] rather
// than calling deletion done. Erasure proper is a request to GitLoom.
func FilterTombstoned(hits []gl.Hit, tombstoned map[string]bool) []gl.Hit {
	if len(tombstoned) == 0 {
		return hits
	}
	kept := make([]gl.Hit, 0, len(hits))
	for _, h := range hits {
		if mentionsAny(h, tombstoned) {
			continue
		}
		kept = append(kept, h)
	}
	return kept
}

func mentionsAny(h gl.Hit, ids map[string]bool) bool {
	haystack := h.Path + "\n" + h.Snippet
	if h.Provenance != nil {
		haystack += "\n" + h.Provenance.Message
	}
	for id := range ids {
		if id != "" && strings.Contains(haystack, id) {
			return true
		}
	}
	return false
}
