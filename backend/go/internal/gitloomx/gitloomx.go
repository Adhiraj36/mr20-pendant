// Package gitloomx wires GitLoom (docs.gitloom.cloud) into the backend.
//
// One namespace per user (their Clerk id) — the isolation shape the service
// is built around: each namespace is its own git repository and index, so
// nothing here has to be careful about queries leaking across users.
//
// The API key lives in Secrets Manager (`mr20/gitloom`, created outside the
// stack and referenced by name), cached for the container's life like the
// Deepgram key.
package gitloomx

import (
	"context"
	"strings"
	"sync"
	"time"

	gl "github.com/GitLoomHQ/gitloom-go/gitloom"

	"github.com/MelloB1989/mr20-pendant/backend/internal/config"
	"github.com/MelloB1989/mr20-pendant/backend/internal/deepgram"
	"github.com/MelloB1989/mr20-pendant/backend/internal/types"
)

var (
	mu     sync.Mutex
	client *gl.Client
	// Namespaces this container already ensured exist, so a warm container
	// costs one CreateNamespace per user rather than one per recording.
	ensured = map[string]bool{}
)

// APIKey resolves the GitLoom key: the environment for a local run, Secrets
// Manager on Lambda. Both paths, and the caching, live in internal/config.
func APIKey(ctx context.Context) (string, error) {
	return config.GitLoomAPIKey(ctx)
}

// DefaultBaseURL is GitLoom's hosted API, and the SDK's own default.
const DefaultBaseURL = "https://api.gitloom.cloud"

// BaseURL is the deployment this backend talks to. GITLOOM_BASE_URL points it
// at a dev or self-hosted instance; empty means the hosted one.
//
// It exists because the variable used to be honoured by exactly one call site
// — the raw conversation list — while every SDK call went to production
// regardless. Pointing at a dev GitLoom listed dev's conversations and read
// and wrote everything else against the live account, which is the worst of
// both: a setting that looks applied and is not.
func BaseURL() string {
	if v := strings.TrimSpace(config.Get().GitLoomBaseURL); v != "" {
		return strings.TrimSuffix(v, "/")
	}
	return DefaultBaseURL
}

// Client returns the shared GitLoom client, dialing on first use.
func Client(ctx context.Context) (*gl.Client, error) {
	mu.Lock()
	defer mu.Unlock()
	if client != nil {
		return client, nil
	}
	key, err := APIKey(ctx)
	if err != nil {
		return nil, err
	}
	client = gl.New(key, gl.WithBaseURL(BaseURL()))
	return client, nil
}

// EnsureNamespace creates the user's namespace, idempotently server-side.
func EnsureNamespace(ctx context.Context, c *gl.Client, namespace string) error {
	mu.Lock()
	done := ensured[namespace]
	mu.Unlock()
	if done {
		return nil
	}
	if err := c.CreateNamespace(ctx, namespace); err != nil {
		return err
	}
	mu.Lock()
	ensured[namespace] = true
	mu.Unlock()
	return nil
}

// MaxIngestBytes is the dialogue budget for one ingestion.
//
// GitLoom refuses a payload over 256 KB. The framing preamble, the JSON
// envelope and the transport all sit inside that, so the dialogue itself gets
// 240 KB and the rest is headroom. Counted in bytes, which is what the cap is
// counted in — see deepgram.AsDialogueWith.
const MaxIngestBytes = 240 * 1024

// IngestTranscript hands one diarized conversation to GitLoom's extraction
// pipeline. The dialogue goes as a single user turn — a pendant conversation
// is overheard speech, not a chat — and the date is the recording's real
// startedAt, because a backfill must not claim everything happened today.
//
// `speakers` are the names the user has given the diarizer's indices, if any;
// with them, the memories are filed under real names instead of "Speaker 1".
//
// It returns the dialogue it actually sent, so the caller can store the exact
// text this ingestion was built from. That copy is the only record of what
// GitLoom was told: the API returns no ids, and a later relabel re-sends the
// conversation without any way to supersede what the first send produced
// ([GL_SUPERSEDE]). An empty return means nothing was sent.
//
// GitLoom answers 202 and extracts asynchronously; there is nothing to poll.
func IngestTranscript(ctx context.Context, userID, recordingID, startedAt string, t *types.Transcript, speakers map[string]string) (string, error) {
	c, err := Client(ctx)
	if err != nil {
		return "", err
	}
	if err := EnsureNamespace(ctx, c, Namespace(userID)); err != nil {
		return "", err
	}

	dialogue := deepgram.AsDialogueWith(t, speakers, MaxIngestBytes)
	// Too little was said to hold a fact. Ingesting it anyway spends a model
	// call to manufacture something out of a greeting.
	if len(strings.TrimSpace(dialogue)) < minIngestChars {
		return "", nil
	}

	err = c.Remember(ctx,
		[]gl.Turn{{Role: "user", Content: ambientFraming + dialogue}},
		&gl.RememberOptions{Namespace: Namespace(userID), SessionID: recordingID, Date: ingestDate(startedAt)},
	)
	if err != nil {
		return "", err
	}
	return dialogue, nil
}

// ingestDate is the day a conversation happened, in the form GitLoom files
// memories under. Empty when the timestamp cannot be read, which GitLoom reads
// as today — the right fallback for a row with no usable startedAt.
func ingestDate(startedAt string) string {
	if parsed, err := time.Parse(time.RFC3339, startedAt); err == nil {
		return parsed.UTC().Format("2006-01-02")
	}
	return ""
}

// RememberFacts sends the facts our own enrichment pass distilled, as a second
// ingestion against the same session.
//
// GitLoom extracts what it likes from the transcript and tells us nothing
// about what it made — no ids, no list, no way to ask ([GL_FACT_IDS]). The
// facts the app shows are therefore ours, and this hands them over as
// already-distilled statements so retrieval can reach them too. Best-effort by
// design: the facts are safe on the recording row whether or not this lands.
func RememberFacts(ctx context.Context, userID, recordingID, startedAt string, facts []types.Fact) error {
	if len(facts) == 0 {
		return nil
	}
	c, err := Client(ctx)
	if err != nil {
		return err
	}
	if err := EnsureNamespace(ctx, c, Namespace(userID)); err != nil {
		return err
	}

	var b strings.Builder
	b.WriteString(factFraming)
	for _, f := range facts {
		b.WriteString("- (")
		b.WriteString(string(f.Kind))
		b.WriteString(") ")
		b.WriteString(f.Text)
		b.WriteByte('\n')
	}
	return c.Remember(ctx,
		[]gl.Turn{{Role: "user", Content: b.String()}},
		&gl.RememberOptions{Namespace: Namespace(userID), SessionID: recordingID, Date: ingestDate(startedAt)},
	)
}

// Recall is retrieval, surfaced.
//
// GitLoom's /v1/retrieve has been paid for since the first recording and used
// only implicitly, inside a chat turn. This is the same call made directly, so
// "Ask lyzn" can cite what it knows and a search can answer from memory
// without spending a model turn to do it.
func Recall(ctx context.Context, userID, query string, limit int) ([]gl.Hit, error) {
	c, err := Client(ctx)
	if err != nil {
		return nil, err
	}
	res, err := c.Recall(ctx, query, &gl.RecallOptions{Namespace: Namespace(userID), Limit: limit})
	if err != nil {
		return nil, err
	}
	return res.Hits, nil
}

// factFraming tells the extractor that what follows is already distilled, so
// it files the statements rather than mining them for more.
const factFraming = `The following are facts already extracted from one conversation captured by
the wearer's pendant. They are stated plainly and are about the wearer's own
life. File them as they are; do not elaborate on them or infer beyond them.

`

// A pendant hears everything near it, not a conversation addressed to an
// assistant. Handing the raw transcript over as the user's own words is what
// turned a documentary playing in the room into "Kartik has an Al-Qaeda
// interview", filed under travel: every overheard voice was read as the
// wearer speaking about their own life. The framing says what this recording
// actually is, so unattributable talk stays unattributed.
const ambientFraming = `The following is ambient audio captured by a wearable pendant. It is not a
conversation with an assistant and it is not addressed to anyone reading it.

Speaker labels are anonymous indices from a diarizer, not identities, and
Speaker 0 is not necessarily the wearer. What was captured may include the
wearer talking, other people talking near them, or audio from a phone,
television, podcast or film playing nearby.

Record a fact about the wearer only when the transcript itself makes that
attribution clear. Content that is plainly media, fiction, someone else's
story, or a public figure's words is not a fact about the wearer's life and
should not be stored as one. When in doubt, store nothing.

Transcript:

`

// Below this there is not enough said to carry a fact worth keeping.
const minIngestChars = 240

// IngestWithRetry wraps IngestTranscript in the pipeline's retry policy:
// 3 attempts with 1s/4s backoff between them. The caller decides what a final
// failure means — in the processor it must never fail the SQS message, because
// a redelivery would re-run Deepgram at real cost.
func IngestWithRetry(ctx context.Context, userID, recordingID, startedAt string, t *types.Transcript, speakers map[string]string) (string, error) {
	var (
		dialogue string
		err      error
	)
	for attempt := 0; attempt < 3; attempt++ {
		if attempt > 0 {
			select {
			case <-time.After(time.Duration(attempt*attempt) * time.Second):
			case <-ctx.Done():
				return "", ctx.Err()
			}
		}
		if dialogue, err = IngestTranscript(ctx, userID, recordingID, startedAt, t, speakers); err == nil {
			return dialogue, nil
		}
	}
	return "", err
}
