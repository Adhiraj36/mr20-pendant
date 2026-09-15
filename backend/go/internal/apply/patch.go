package apply

import "github.com/MelloB1989/mr20-pendant/backend/internal/types"

// Result is what either path — the agent's validated files, or the Bedrock
// fallback — produces, in the one shape the write step needs regardless of
// where it came from. Both paths populate every field now: the extracted
// path resolves Title/Tags/Summary/CategoryID from summary.json (via
// ResolveCategory for the id), the fallback from enrich.Enrich's own
// Enrichment — see cmd/apply/main.go's processMessage and runFallback
// (Task 10).
type Result struct {
	Tasks      []types.ActionItem
	Memories   []types.Fact
	Title      string
	Tags       []string
	Summary    string
	CategoryID string
	// Speakers is the model's label and description per diarizer index,
	// keyed as a decimal string. Stored as speakerProfiles, never as
	// speakers: that map is the user's own, and the only one memory is ever
	// re-filed with.
	Speakers map[string]types.SpeakerProfile
}

// Patch builds the DynamoDB update for a recording that just finished
// applying. Fields the source left empty are left out of the map entirely,
// so UpdateRecording leaves whatever was already on the row untouched
// rather than clobbering it with a zero value — enrich.go's own fallback()
// can still leave Summary empty when it has nothing honest to say, and a
// null category is a legitimate answer on either path, so Patch stays
// agnostic about why a field is empty, only about whether it is.
func Patch(r Result) map[string]any {
	patch := map[string]any{
		"status":      types.StatusReady,
		"actionItems": r.Tasks,
		"facts":       r.Memories,
		"error":       "",
		// taskCount mirrors how many ddb.Task rows this attempt wrote
		// (writeTasks in cmd/apply mints exactly one row per r.Tasks
		// entry). Set unconditionally, zero included, so a re-run that
		// produces fewer items than an earlier attempt did — and is
		// therefore about to finish here successfully — ratchets the
		// count down for good, not merely in the interim write
		// finishApply already made right after writeTasks succeeded.
		"taskCount": len(r.Tasks),
	}
	if r.Title != "" {
		patch["title"] = r.Title
	}
	if len(r.Tags) > 0 {
		patch["tags"] = r.Tags
	}
	if r.Summary != "" {
		patch["summary"] = r.Summary
	}
	if r.CategoryID != "" {
		patch["categoryId"] = r.CategoryID
	}
	if len(r.Speakers) > 0 {
		patch["speakerProfiles"] = r.Speakers
	}
	return patch
}
