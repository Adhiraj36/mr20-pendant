// Seed a local table with everything the daemon flow needs, and print a
// pairing code.
//
// The daemon half of this API is the one part nobody can exercise from the
// app: it wants a laptop with a bearer token, and the token only exists once
// a code has been redeemed. This program makes that possible without an AWS
// account and without touching anybody's data — it writes an account with a
// plan that carries automation, a conversation, two approved promises and a
// pairing code into whatever table TABLE_NAME names, which is meant to be
// DynamoDB Local.
//
// Runbook: backend/scripts/daemon-local.md.
//
// It writes through the ddb package rather than hand-rolled item JSON, so the
// rows are keyed exactly the way the API's own queries expect. It refuses to
// run against anything but a local endpoint, because the one thing it must
// never do is mint a free plan on production.
package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"github.com/MelloB1989/mr20-pendant/backend/internal/ddb"
	"github.com/MelloB1989/mr20-pendant/backend/internal/types"
)

// user is a fixed id so a second run tops up the same account rather than
// leaving a trail of abandoned ones.
const user = "user_local_test"

func main() {
	requireLocal()

	ctx := context.Background()
	if err := ddb.Init(ctx); err != nil {
		log.Fatal(err)
	}

	// The account half of the automation gate. The deployment half is the
	// EXECUTION_ENABLED environment variable the API is started with.
	if err := ddb.PutPlan(ctx, user, ddb.Plan{
		Plan: "act", Automation: true, Status: "active", Since: now(),
	}); err != nil {
		log.Fatal(err)
	}

	// The conversation the promises were made in. Without it the work still
	// goes out, but with an empty context — which is worth being able to see.
	rec := types.Recording{
		RecordingID: "rec_local_1", UserID: user, Status: types.StatusReady,
		DeviceFolder: "PHONE", DeviceFile: "20260909-180000.m4a", DeviceMac: "local",
		StartedAt: now(), DurationSeconds: 612, SizeBytes: 1024,
		Title:   "Pricing call with Rahul",
		Summary: "Agreed the number for the Capture tier and who sends the quote.",
		Facts: []types.Fact{
			{Text: "Rahul prefers a PDF over a link", Kind: types.FactKindPreference},
		},
	}
	if err := ddb.PutRecording(ctx, rec); err != nil {
		log.Fatal(err)
	}

	// Two, so "oldest first" and "one at a time" are both visible in a run.
	for i, text := range []string{
		"send Rahul the quote tonight",
		"put the pricing call in the shared notes",
	} {
		if err := ddb.PutTask(ctx, ddb.Task{
			TaskID: fmt.Sprintf("task_local_%d", i+1), UserID: user,
			RecordingID: rec.RecordingID, Text: text, Kind: types.TaskKindMessage,
			Status: ddb.TaskApproved, Quote: "I'll send it tonight, promise.",
			CreatedAt: time.Now().UTC().Add(time.Duration(i) * time.Minute).Format(time.RFC3339),
			UpdatedAt: now(),
		}); err != nil {
			log.Fatal(err)
		}
	}

	code, err := ddb.MintPairCode(ctx, user)
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println("PAIRCODE", code.Code)
	fmt.Println("USER", user)
}

// requireLocal is the guard, and it is the reason this can live in the tree.
//
// Every other safeguard here is a convention somebody can forget at two in the
// morning; this is the one that cannot be. An endpoint override that does not
// point at a loopback address means the caller is aimed at real infrastructure,
// and the answer to that is to stop rather than to grant a free plan.
func requireLocal() {
	endpoint := strings.TrimSpace(os.Getenv("AWS_ENDPOINT_URL_DYNAMODB"))
	if endpoint == "" {
		endpoint = strings.TrimSpace(os.Getenv("AWS_ENDPOINT_URL"))
	}
	if endpoint == "" {
		log.Fatal("refusing to run without AWS_ENDPOINT_URL: this seeds test data and must only ever see DynamoDB Local")
	}
	if !strings.Contains(endpoint, "127.0.0.1") && !strings.Contains(endpoint, "localhost") {
		log.Fatalf("refusing to run against %s: this seeds test data and must only ever see DynamoDB Local", endpoint)
	}
}

func now() string { return time.Now().UTC().Format(time.RFC3339) }
