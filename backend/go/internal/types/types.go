// Package types holds the shared domain model.
//
// A "recording" is one MP3 file that lived on the pendant's internal storage.
// The device names files by its own clock ("2026-08-19 17-36-06") and groups
// them into date folders, so those two strings together identify a file on the
// device and are what the app dedupes against.
package types

import "strings"

// RecordingStatus is where a recording sits in the ingest -> transcript pipeline.
type RecordingStatus string

const (
	StatusPending     RecordingStatus = "pending"     // row exists, audio not uploaded yet
	StatusUploaded    RecordingStatus = "uploaded"    // audio in S3, queued for processing
	StatusProcessing  RecordingStatus = "processing"  // processor picked it up
	StatusTranscribed RecordingStatus = "transcribed" // raw transcript written; extraction and enrichment still pending
	StatusReady       RecordingStatus = "ready"       // transcript + enrichment written
	StatusArchived    RecordingStatus = "archived"    // no speech; audio parked under archived/ for 30 days
	StatusFailed      RecordingStatus = "failed"      // gave up; Error says why
)

// MemoryStatus is whether the conversation reached the GitLoom memory store.
// Empty on rows that predate the memory pipeline.
type MemoryStatus string

const (
	MemoryIngested MemoryStatus = "ingested" // GitLoom accepted the transcript (202; extraction is async)
	MemoryFailed   MemoryStatus = "failed"   // all attempts failed; /retry can re-fire just the ingest
	MemorySkipped  MemoryStatus = "skipped"  // nothing to remember (archived / empty transcript)
	// MemorySending is written the moment a send is claimed, before the
	// GitLoom call is even attempted — see cmd/apply's sendFacts. Without a
	// value distinct from MemoryIngested for that claim, a process that died
	// between the claim and the send left the row reading "ingested" with
	// nothing actually sent, and a redelivery reading that value took
	// sendFacts' own "already remembered" shortcut and silently believed it,
	// forever: there was no third state for it to land on instead. A row
	// stuck at "sending" is the honest version of that same outcome — it
	// does not claim success it cannot back up, and does not get silently
	// skipped as already-done on a later read. It does not by itself trigger
	// automatic retry: whether the GitLoom call actually landed before the
	// process died is unknown, and resending is the one thing this whole
	// mechanism exists to prevent doing twice.
	MemorySending MemoryStatus = "sending"
)

// Category is a user-editable conversation category. ID is a stable slug
// minted at creation; recordings store the id, so a rename never orphans them.
type Category struct {
	ID   string `json:"id" dynamodbav:"id"`
	Name string `json:"name" dynamodbav:"name"`
}

// DefaultCategories is the starting set every user gets; editable afterwards.
func DefaultCategories() []Category {
	return []Category{
		{ID: "work", Name: "Work"},
		{ID: "personal", Name: "Personal"},
		{ID: "family", Name: "Family"},
		{ID: "health", Name: "Health"},
		{ID: "ideas", Name: "Ideas"},
		{ID: "errands", Name: "Errands"},
	}
}

// Utterance is one diarized chunk of speech. Deepgram calls these utterances.
type Utterance struct {
	// Speaker index from diarization: 0, 1, 2...
	Speaker    int     `json:"speaker"`
	Start      float64 `json:"start"` // seconds from the start of the recording
	End        float64 `json:"end"`
	Text       string  `json:"text"`
	Confidence float64 `json:"confidence"`
}

// Transcript is stored in S3 rather than DynamoDB because it is large.
type Transcript struct {
	RecordingID string `json:"recordingId"`
	Language    string `json:"language"`
	// Plain running text, no speaker labels.
	Text            string      `json:"text"`
	Utterances      []Utterance `json:"utterances"`
	Model           string      `json:"model"`
	DurationSeconds float64     `json:"durationSeconds"`

	// AltText is the second engine's (Sarvam) independent reading of the same
	// audio, kept for inspection; the utterances above are the merged result.
	AltText string `json:"altText,omitempty"`
	// MergedCorrections counts utterances the two-engine merge changed.
	MergedCorrections int `json:"mergedCorrections,omitempty"`
}

// ExtractionRequest is what ProcessorFn hands to extractQueue once a raw
// transcript exists, and what ExtractFn forwards (re-serialized, same
// fields) to applyQueue on success. ApplyFn reads the identical shape
// whether it arrives from applyQueue or from extractQueue's own DLQ — see
// internal/apply.ExtractionPrefix's comment for why no field here names
// where ExtractFn's output landed.
//
// Categories is the user's category *names* only — the agent has no
// DynamoDB access (spec's 2026-09-14 amendment on summary.json), so this is
// how it learns what it may choose for summary.json's category field
// without querying a table it cannot reach. ApplyFn resolves the agent's
// choice back to an id itself, via the existing enrich.ResolveCategory.
type ExtractionRequest struct {
	UserID        string            `json:"userId"`
	RecordingID   string            `json:"recordingId"`
	StartedAt     string            `json:"startedAt"`
	TranscriptKey string            `json:"transcriptKey"`
	Speakers      map[string]string `json:"speakers,omitempty"`
	Categories    []string          `json:"categories,omitempty"`
}

// TaskKind is the shape of the thing a commitment asks for. It decides what
// the app offers next to it — a draft to send, an amount to confirm, a file to
// find — and, when execution is switched on, which lane could carry it out.
// Anything the model cannot place honestly is "other", never a guess.
type TaskKind string

const (
	TaskKindMessage  TaskKind = "message"  // say something to someone
	TaskKindSpend    TaskKind = "spend"    // pay, buy, transfer
	TaskKindFile     TaskKind = "file"     // send, sign, submit a document
	TaskKindReminder TaskKind = "reminder" // remember at a time
	TaskKindOther    TaskKind = "other"
)

// TaskKinds is every kind, in the order the prompt lists them.
var TaskKinds = []TaskKind{TaskKindMessage, TaskKindSpend, TaskKindFile, TaskKindReminder, TaskKindOther}

// CoerceTaskKind maps a model's answer onto a kind, defaulting to "other" —
// an unrecognised label is a missing classification, not a new category.
func CoerceTaskKind(raw any) TaskKind {
	name, ok := raw.(string)
	if !ok {
		return TaskKindOther
	}
	for _, k := range TaskKinds {
		if strings.EqualFold(strings.TrimSpace(name), string(k)) {
			return k
		}
	}
	return TaskKindOther
}

// ActionItem is a commitment someone made in the conversation.
type ActionItem struct {
	Text string `json:"text" dynamodbav:"text"`
	// Speaker index the item was assigned to; nil if unassigned.
	Owner *int `json:"owner" dynamodbav:"owner"`
	// Kind is what carrying it out would involve. See TaskKind.
	Kind TaskKind `json:"kind,omitempty" dynamodbav:"kind,omitempty"`
}

// FactKind separates the four things worth remembering from a conversation.
// The distinction is the app's, not GitLoom's: GitLoom's extraction is opaque
// and unaddressable, so the facts a user is shown are ours, derived in the
// same enrichment pass that writes the summary.
type FactKind string

const (
	FactKindFact       FactKind = "fact"       // something true about the world
	FactKindPreference FactKind = "preference" // something the wearer likes or avoids
	FactKindPerson     FactKind = "person"     // who someone is to the wearer
	FactKindDecision   FactKind = "decision"   // something settled in this conversation
)

// FactKinds is every kind, in the order the prompt lists them.
var FactKinds = []FactKind{FactKindFact, FactKindPreference, FactKindPerson, FactKindDecision}

// CoerceFactKind maps a model's answer onto a kind, defaulting to "fact".
func CoerceFactKind(raw any) FactKind {
	name, ok := raw.(string)
	if !ok {
		return FactKindFact
	}
	for _, k := range FactKinds {
		if strings.EqualFold(strings.TrimSpace(name), string(k)) {
			return k
		}
	}
	return FactKindFact
}

// Fact is one thing this conversation taught the app about its wearer. Stored
// on the recording row so a conversation can show what it was remembered for,
// and sent to GitLoom as a second, already-distilled ingestion.
type Fact struct {
	Text string   `json:"text" dynamodbav:"text"`
	Kind FactKind `json:"kind" dynamodbav:"kind"`
}

// SpeakerProfile is what the model made of one diarized voice: a short label
// and a one-line description. The label is a name only when the transcript
// itself establishes it (someone is addressed by name, or introduces
// themselves); otherwise it is the role the voice plays in this conversation
// ("Doctor", "Auto driver", "Colleague"). It is a guess about a voice, never
// an identity, which is why it lives beside Recording.Speakers rather than in
// it: the user's own names always win, and only those are ever sent to
// memory.
type SpeakerProfile struct {
	Label       string `json:"label" dynamodbav:"label"`
	Description string `json:"description,omitempty" dynamodbav:"description,omitempty"`
}

// Enrichment is what the model derives from a transcript.
type Enrichment struct {
	Title       string
	Tags        []string
	Summary     string
	ActionItems []ActionItem
	Facts       []Fact
	// One of the user's category ids, or "" when none fits.
	CategoryID string
	// Speakers is keyed by the diarizer index as a decimal string, the same
	// shape Recording.Speakers uses.
	Speakers map[string]SpeakerProfile
}

// Recording is a recording row as the API returns it. dynamodbav tags keep the
// stored attribute names identical to what the TS backend wrote, so the port
// reads every existing row unchanged.
type Recording struct {
	RecordingID     string          `json:"recordingId" dynamodbav:"recordingId"`
	UserID          string          `json:"userId" dynamodbav:"userId"`
	Status          RecordingStatus `json:"status" dynamodbav:"status"`
	DeviceFolder    string          `json:"deviceFolder" dynamodbav:"deviceFolder"`
	DeviceFile      string          `json:"deviceFile" dynamodbav:"deviceFile"`
	DeviceMac       string          `json:"deviceMac" dynamodbav:"deviceMac"`
	StartedAt       string          `json:"startedAt" dynamodbav:"startedAt"`
	DurationSeconds float64         `json:"durationSeconds" dynamodbav:"durationSeconds"`
	SizeBytes       int64           `json:"sizeBytes" dynamodbav:"sizeBytes"`

	AudioKey string `json:"audioKey,omitempty" dynamodbav:"audioKey,omitempty"`
	// CleanKey is the enhanced audio: denoised (DeepFilterNet) with the
	// silent stretches cut. Playback and transcription prefer it; AudioKey
	// keeps the untouched original for the "hear the raw audio" option.
	CleanKey      string            `json:"cleanKey,omitempty" dynamodbav:"cleanKey,omitempty"`
	TranscriptKey string            `json:"transcriptKey,omitempty" dynamodbav:"transcriptKey,omitempty"`
	Title         string            `json:"title,omitempty" dynamodbav:"title,omitempty"`
	Tags          []string          `json:"tags,omitempty" dynamodbav:"tags,omitempty"`
	Summary       string            `json:"summary,omitempty" dynamodbav:"summary,omitempty"`
	ActionItems   []ActionItem      `json:"actionItems,omitempty" dynamodbav:"actionItems,omitempty"`
	Facts         []Fact            `json:"facts,omitempty" dynamodbav:"facts,omitempty"`
	Speakers      map[string]string `json:"speakers,omitempty" dynamodbav:"speakers,omitempty"`
	// SpeakerProfiles is the model's own reading of each diarized voice,
	// keyed like Speakers. The app shows a profile's label wherever the user
	// has not named that index themselves; Speakers stays the user's, and is
	// the only map memory is ever re-filed with.
	SpeakerProfiles map[string]SpeakerProfile `json:"speakerProfiles,omitempty" dynamodbav:"speakerProfiles,omitempty"`
	SpeakerCount    int                       `json:"speakerCount,omitempty" dynamodbav:"speakerCount,omitempty"`
	CategoryID      string                    `json:"categoryId,omitempty" dynamodbav:"categoryId,omitempty"`
	// MemoryStatus is whether ProcessorFn's whole-dialogue ingest
	// (gitloomx.IngestWithRetry) reached GitLoom. FactsMemoryStatus is the
	// same three values for a separate, later send: ApplyFn's own
	// already-distilled facts (gitloomx.RememberFacts — see Fact's doc
	// comment above). The two ingests are independent GitLoom calls made at
	// different pipeline stages, so each gets its own field rather than
	// sharing one a later write could stomp.
	MemoryStatus      MemoryStatus `json:"memoryStatus,omitempty" dynamodbav:"memoryStatus,omitempty"`
	FactsMemoryStatus MemoryStatus `json:"factsMemoryStatus,omitempty" dynamodbav:"factsMemoryStatus,omitempty"`
	// TaskCount is how many ddb.Task rows ApplyFn's own writeTasks call
	// wrote for this recording, persisted in its own write immediately
	// after that call succeeds — before anything later in finishApply gets
	// a chance to fail and cause a redelivery. Task ids are positional
	// (recordingId-0, -1, -2, ...), so a re-run that produces fewer items
	// than an earlier attempt did overwrites the rows the new count still
	// covers and simply never touches the higher-numbered ones — this is
	// what lets the retry discover exactly which of its own earlier rows
	// are now orphaned, without a way to list or delete rows by
	// recordingId, which internal/ddb does not expose.
	TaskCount int    `json:"taskCount,omitempty" dynamodbav:"taskCount,omitempty"`
	Error     string `json:"error,omitempty" dynamodbav:"error,omitempty"`

	// What was actually handed to memory, and in whose names.
	//
	// GitLoom cannot update or delete a memory, so a speaker relabel can only
	// re-ingest the same conversation with the names substituted — which may
	// supersede the earlier memories or may sit beside them; the vendor does
	// not say which ([GL_SUPERSEDE]). Keeping the exact dialogue, the speaker
	// map as it stood, and a version counter is what would let a future
	// update API be pointed at the right memories, and is what lets the
	// detail screen say REMEMBERED · v2 honestly.
	MemoryIngestVersion int               `json:"memoryIngestVersion,omitempty" dynamodbav:"memoryIngestVersion,omitempty"`
	MemoryDialogueKey   string            `json:"memoryDialogueKey,omitempty" dynamodbav:"memoryDialogueKey,omitempty"`
	MemorySpeakers      map[string]string `json:"memorySpeakers,omitempty" dynamodbav:"memorySpeakers,omitempty"`

	CreatedAt string `json:"createdAt" dynamodbav:"createdAt"`
	UpdatedAt string `json:"updatedAt" dynamodbav:"updatedAt"`
}

// Device is a pendant the user has paired.
// PushToken is one installation of the app that has agreed to be notified.
//
// Keyed by the token itself rather than by user or device: a person may carry
// the app on more than one phone, and a reinstall issues a new token while the
// old one keeps resolving until Expo reports it gone. Both cases want a row
// each, and the stale one is removed when a send comes back
// DeviceNotRegistered rather than on a guess.
type PushToken struct {
	UserID string `json:"userId" dynamodbav:"userId"`
	// An Expo push token, "ExponentPushToken[...]".
	Token string `json:"token" dynamodbav:"token"`
	// ios | android — only for reading the table; Expo routes by the token.
	Platform     string `json:"platform,omitempty" dynamodbav:"platform,omitempty"`
	RegisteredAt string `json:"registeredAt" dynamodbav:"registeredAt"`
}

type Device struct {
	UserID string `json:"userId" dynamodbav:"userId"`
	// Lowercase hex, no separators, as BLE&MAC reports it.
	Mac string `json:"mac" dynamodbav:"mac"`
	// BLE peripheral id. On iOS a per-host UUID, on Android the MAC.
	PeripheralID   string  `json:"peripheralId" dynamodbav:"peripheralId"`
	Name           string  `json:"name" dynamodbav:"name"`
	Firmware       string  `json:"firmware,omitempty" dynamodbav:"firmware,omitempty"`
	WifiFirmware   string  `json:"wifiFirmware,omitempty" dynamodbav:"wifiFirmware,omitempty"`
	BatteryPercent float64 `json:"batteryPercent,omitempty" dynamodbav:"batteryPercent,omitempty"`
	FreeMb         float64 `json:"freeMb,omitempty" dynamodbav:"freeMb,omitempty"`
	TotalMb        float64 `json:"totalMb,omitempty" dynamodbav:"totalMb,omitempty"`
	LastSeenAt     string  `json:"lastSeenAt,omitempty" dynamodbav:"lastSeenAt,omitempty"`
	PairedAt       string  `json:"pairedAt" dynamodbav:"pairedAt"`
}
