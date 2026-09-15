// Package push delivers notifications to the app through Expo's push service.
//
// Expo sits in front of APNs and FCM: one HTTP call with a token that already
// says which of the two it belongs to, so nothing here needs an Apple key or a
// Firebase account — those are registered once with Expo and used on our
// behalf. The cost is a hop we do not control, so nothing in this package is
// allowed to fail a caller: a conversation that is ready is ready whether or
// not its owner could be told about it.
//
// Tokens go stale — an app is deleted, a phone is wiped — and Expo says so per
// message with a DeviceNotRegistered code. Those are the only ones removed;
// a transport failure is retried by the next notification, not punished.
package push

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sort"
	"strings"
	"time"
)

const endpoint = "https://exp.host/--/api/v2/push/send"

// Expo accepts up to 100 messages per request.
const batchSize = 100

var httpClient = &http.Client{Timeout: 15 * time.Second}

// Message is one notification, addressed to one installation.
//
// The fields past Data are what separate a notification the phone treats
// seriously from one it queues behind everything else. Android will not show a
// notification at all without a channel it recognises; iOS will not offer the
// "Mark done" action without a category; and a commitment the user has
// probably already dealt with is worse than no notification, which is what the
// time-to-live is for.
type Message struct {
	To    string `json:"to"`
	Title string `json:"title"`
	Body  string `json:"body"`
	Sound string `json:"sound,omitempty"`
	// Data rides along silently; the app reads it to open the right screen.
	Data map[string]any `json:"data,omitempty"`

	// Priority is "default", "normal" or "high". High wakes the device.
	Priority string `json:"priority,omitempty"`
	// TTL is seconds Expo may keep trying. A pointer so zero — deliver now or
	// never — is expressible and is not the same as unset.
	TTL *int `json:"ttl,omitempty"`
	// ChannelID names the Android channel: the user's own switch for this
	// kind of notification. Unknown channels are dropped by Android outright.
	ChannelID string `json:"channelId,omitempty"`
	// CategoryID names the iOS category, which is what carries the actions.
	CategoryID string `json:"categoryId,omitempty"`
	// Badge is the count on the app icon. A pointer so 0 clears it.
	Badge *int `json:"badge,omitempty"`
}

type ticket struct {
	Status  string `json:"status"`
	Message string `json:"message"`
	Details struct {
		Error string `json:"error"`
	} `json:"details"`
}

// Send delivers every message and returns the tokens Expo reported as no
// longer belonging to an installation, so the caller can forget them.
//
// The error return is for a caller that wants to log it. Partial delivery is
// normal and is not an error: each message carries its own verdict.
func Send(ctx context.Context, messages []Message) (dead []string, err error) {
	if len(messages) == 0 {
		return nil, nil
	}
	accepted, rejected := 0, 0
	for start := 0; start < len(messages); start += batchSize {
		end := start + batchSize
		if end > len(messages) {
			end = len(messages)
		}
		batch := messages[start:end]

		gone, ok, bad, err := sendBatch(ctx, batch)
		if err != nil {
			// Report it, but keep going: the batches are independent and one
			// bad response should not silence the rest.
			log.Printf("push: batch of %d failed: %v", len(batch), err)
			continue
		}
		dead = append(dead, gone...)
		accepted += ok
		rejected += bad
	}
	// The one line proving a send that worked actually happened — nothing
	// here but counts and event types, never a token, title or body.
	log.Printf("push: sent %d, accepted %d, rejected %d%s", len(messages), accepted, rejected, eventTypesOf(messages))
	return dead, nil
}

// eventTypesOf reads the "type" each message's Data carries (see events.go)
// and renders the distinct set for the summary log line.
func eventTypesOf(messages []Message) string {
	seen := make(map[string]bool, len(messages))
	var types []string
	for _, m := range messages {
		t, ok := m.Data["type"].(string)
		if !ok || t == "" || seen[t] {
			continue
		}
		seen[t] = true
		types = append(types, t)
	}
	if len(types) == 0 {
		return ""
	}
	sort.Strings(types)
	return " [" + strings.Join(types, ", ") + "]"
}

func sendBatch(ctx context.Context, batch []Message) (dead []string, accepted, rejected int, err error) {
	body, err := json.Marshal(batch)
	if err != nil {
		return nil, 0, 0, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, 0, 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, 0, 0, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, 0, 0, fmt.Errorf("expo push returned %s", resp.Status)
	}

	var payload struct {
		Data []ticket `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, 0, 0, err
	}

	// Tickets come back in the order they were sent, so position identifies
	// the token. A short reply means the rest simply have no verdict yet.
	for i, t := range payload.Data {
		if i >= len(batch) {
			continue
		}
		if t.Status == "ok" {
			accepted++
			continue
		}
		rejected++
		if t.Details.Error == "DeviceNotRegistered" {
			dead = append(dead, batch[i].To)
			continue
		}
		log.Printf("push: message %d of %d rejected: %s (%s)", i+1, len(batch), t.Message, t.Details.Error)
	}
	return dead, accepted, rejected, nil
}
