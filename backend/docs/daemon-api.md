# The LYZN daemon API

This is the contract between LYZN and **KARMAX**, the daemon that runs on the
user's own machine and carries out the commitments their pendant heard.

It is written for the person writing the daemon loop. Everything here is
implemented in `backend/go/internal/api/daemons.go`,
`backend/go/internal/api/daemonauth.go` and `backend/go/internal/ddb/daemons.go`,
and everything in it is covered by tests in the `*_test.go` files beside them.

---

## 1. The shape of the thing

KARMAX has **no login**. It is a program on a laptop, not a person with a
session, so it cannot hold a Clerk token and is never issued one. Instead:

1. The person, signed in on their phone, asks LYZN for a **pairing code** —
   six characters, five minutes, one use.
2. They type it into their daemon. The daemon **redeems** the code and
   receives a **bearer token of its own**, once. That token is the daemon's
   only credential from then on.
3. The daemon **polls**. Nothing is ever pushed at it: a laptop behind a home
   router has no address LYZN could reach.

```
  phone (Clerk)                LYZN                     laptop (no login)
       │                        │                              │
       │ POST /daemons/code     │                              │
       ├───────────────────────►│  mints PAIRCODE#K7QD2M       │
       │◄───────────────────────┤  { code, expiresAt }         │
       │                        │                              │
       │   "type K7QD2M into your laptop"  ──────────────────► │
       │                        │                              │
       │                        │  POST /daemons/claim         │
       │                        │◄─────────────────────────────┤
       │                        │  conditional delete of the   │
       │                        │  code → { daemonId, token }  │
       │                        ├─────────────────────────────►│
       │                        │                              │
       │                        │  POST /daemons/heartbeat     │  every 30 s
       │                        │◄─────────────────────────────┤
       │                        │  GET  /daemons/work          │  when tasks > 0
       │                        │◄─────────────────────────────┤
       │                        │  POST /daemons/work/:id/claim│
       │                        │◄─────────────────────────────┤
       │                        │  … run it …                  │
       │                        │  POST /daemons/work/:id/result
       │                        │◄─────────────────────────────┤
       │◄── push receipt.printed┤  receipt written, task closed│
```

**Base URL.** `https://api.lyzn.ai` (CloudFront in front of the API Lambda).
The raw Function URL,
`https://q5ohcn5mup3gnmfnvgsie7y2xa0jeijv.lambda-url.ap-south-1.on.aws`, also
answers and is what the phone uses. Put it in the daemon's config as
`LYZN_API` and default to the first; never hard-code either in code.

**Credential.** `Authorization: Bearer <token>` on every daemon route except
`POST /daemons/claim`. The token is 32 random bytes, base64url, no padding —
43 characters, URL- and shell-safe. Store it in the daemon's config as
`LYZN_DAEMON_TOKEN`, mode 0600. LYZN stores only its SHA-256, so **it cannot
be recovered**: a lost token means pairing again.

**Errors.** Every non-2xx answer is `{"error": "<a sentence>"}`. The sentence
is for a log or a person, never for a branch — branch on the status code.

---

## 2. Endpoints

### 2.1 The app's half — Clerk session token, and the automation tier

These three are what the phone calls. They are listed so the daemon author
knows where the code comes from; a daemon never calls them.

| Method | Path | Auth | Body | Success |
|---|---|---|---|---|
| `POST` | `/daemons/code` | Clerk | — | `201 {"code","expiresAt","expiresInSeconds"}` |
| `GET` | `/daemons` | Clerk | — | `200 {"daemons": Daemon[]}` |
| `DELETE` | `/daemons/:id` | Clerk | — | `204` |

`POST /daemons/code` answers **`402`** unless the execution feature is on
(`AppConfig.features.execution`, `GET /config`) **and** the account's plan
carries automation. 402 and not 403 because the second gate is a price: the
app opens the plan chooser on it.

Listing and unpairing are **not** gated. A person whose plan has lapsed
still owns the laptop they paired, and taking a machine's access away is
the one thing they must always be able to do: a revocation you have to pay
to perform is not a revocation. `GET /daemons` is open for the same reason —
it is how you find the machine you want gone.

```jsonc
// 201 POST /daemons/code
{
  "code": "K7QD2M",                  // six characters of A-Z2-9, no I O 0 1
  "expiresAt": "2026-09-09T10:05:00Z",
  "expiresInSeconds": 300
}
```

```jsonc
// 200 GET /daemons
{ "daemons": [ {
  "daemonId": "6f1c…",
  "userId": "user_2a…",
  "name": "Kartik's MacBook",
  "hostname": "kartik-mbp.local",
  "os": "darwin/arm64",
  "version": "karmax 0.4.1",
  "status": "online",              // what the daemon last said: online|busy|offline
  "online": true,                  // what the clock says: a beat within 90 s
  "capabilities": ["claude-code"],
  "lastHeartbeatAt": "2026-09-09T10:04:31Z",
  "registeredAt": "2026-09-09T09:00:00Z"
} ] }
```

The token hash is never serialised. `DELETE /daemons/:id` is the revocation:
the row is the token's only anchor, so the daemon's next request is a `401`.

### 2.2 The daemon's half

| Method | Path | Auth | Body | Success | Other |
|---|---|---|---|---|---|
| `POST` | `/daemons/claim` | **none** | `{code, name?, hostname?, os?, version?, capabilities?}` | `201 {"daemonId","token","name","registeredAt"}` | `400` bad/expired/spent code |
| `POST` | `/daemons/heartbeat` | daemon | `{status?, version?, capabilities?}` | `200 {"ok":true,"tasks":n}` | `401` unpaired |
| `GET` | `/daemons/work` | daemon | — | `200 {"tasks": WorkItem[]}` | — |
| `POST` | `/daemons/work/:taskId/claim` | daemon | — | `200 {"task": Task}` | `409` taken · `404` unknown |
| `POST` | `/daemons/work/:taskId/result` | daemon | `{outcome, summary?, startedAt?, finishedAt?, artifacts?}` | `200 {"task": Task, "receipt": Receipt}` | `409` not claimed · `400` bad body · `404` unknown |

---

#### `POST /daemons/claim`

The only unauthenticated write in the API. The code **is** the credential,
and it is spent by being used: redemption is a conditional delete, so two
daemons racing the same six characters produce one `201` and one `400`.

```jsonc
// request — no Authorization header
{
  "code": "k7qd2m",                     // case and - _ spaces are ignored
  "name": "Kartik's MacBook",           // ≤ 80 chars; defaults to hostname, then "LYZN daemon"
  "hostname": "kartik-mbp.local",       // ≤ 120
  "os": "darwin/arm64",                 // ≤ 60
  "version": "karmax 0.4.1",            // ≤ 40
  "capabilities": ["claude-code", "shell"]   // ≤ 12 entries, ≤ 40 chars each
}
```

```jsonc
// 201
{
  "daemonId": "6f1c8e2a-…",
  "token": "3Qz9…",                     // 43 chars. Shown once. Never recoverable.
  "name": "Kartik's MacBook",
  "registeredAt": "2026-09-09T09:00:00Z"
}
```

`400 {"error":"that pairing code is not one we are waiting for"}` is the
answer to a code that is unknown, expired **or** already redeemed — one
answer for all three on purpose, so this endpoint cannot be used to probe.

Capabilities are advisory. Work is handed out by task status, not by
capability: a daemon that cannot do a thing reports the failure rather than
being spared the attempt.

---

#### `POST /daemons/heartbeat`

```jsonc
// request (an empty body is a valid heartbeat)
{ "status": "online",          // online | busy | offline; anything else reads as online
  "version": "karmax 0.4.1",   // optional; updates the row when sent
  "capabilities": ["claude-code"] }   // optional; replaces the list when sent
```

```jsonc
// 200
{ "ok": true, "tasks": 3 }     // how many are waiting, counted up to 10
```

`tasks` is the same number a work poll would hand over — capped at 10, like
the poll itself, and including the **zero** an account that has stopped paying
is handed. Treat it as "is there anything", not as a queue depth. Send a heartbeat every **30
seconds**; the app calls a daemon offline after 90 seconds of silence.

`401` means the daemon was unpaired (or the token revoked): **stop the loop
and ask to be paired again.** Do not retry a 401.

---

#### `GET /daemons/work`

Approved tasks nobody has claimed, **oldest first**, at most 10 per poll.

```jsonc
// 200
{ "tasks": [ {
  "taskId": "rec_1-0",
  "text": "send Priya the deck",              // what to do, as the model phrased it
  "kind": "message",                          // message | spend | file | reminder | other
  "quote": "I'll send you the deck tonight",  // the transcript's own words
  "dueAt": "",                                // RFC3339, or "" for none
  "recordingId": "rec_1",
  "createdAt": "2026-09-09T09:00:00Z",        // when the promise was made
  "context": {
    "title": "Dinner with Priya",
    "summary": "They agreed Kartik would send the deck before the pitch.",
    "facts": [ { "text": "Priya is the wearer's sister", "kind": "person" } ]
  }
} ] }
```

Every key is always present — no field is omitted, `facts` is always an
array, `tasks` is always an array. `context` is what the orchestrator is
given to act on; it comes off the conversation the promise was made in and is
empty-stringed if that conversation could not be read.

**An empty list is normal**, and it is also what an account whose plan lapsed
receives: the daemon was paired while the plan was live and is not the party
who stopped paying, so it is handed nothing rather than a 402. Keep
heartbeating.

---

#### `POST /daemons/work/:taskId/claim`

Takes a task off the queue: `approved → executing`, conditionally.

- `200 {"task": Task}` — it is yours. The task now carries `daemonId` and
  `claimedAt`, and no other daemon will be offered it.
- `200` again if **you** already hold it (a restarted loop re-claiming its own
  task is not an error and costs no second write).
- `409 {"error":"this task is not waiting to be claimed"}` — somebody else got
  there first, or the user dismissed it between your poll and your claim.
  Drop it and move on.
- `404` — no such task on this account.

**Claim before you run.** The claim is what makes your run *the* run.

---

#### `POST /daemons/work/:taskId/result`

```jsonc
// request
{
  "outcome": "success",                       // "success" | "failure" — required
  "summary": "Drafted and sent the deck to Priya.",   // ≤ 1000 chars; prints on the receipt
  "startedAt": "2026-09-09T11:00:00Z",        // RFC3339; defaults to finishedAt
  "finishedAt": "2026-09-09T11:02:00Z",       // RFC3339; defaults to now
  "artifacts": [                              // ≤ 24 sent, first 6 printed
    { "name": "deck.pdf", "uri": "file:///Users/k/deck.pdf" }
  ]
}
```

```jsonc
// 200
{
  "task": { "taskId": "rec_1-0", "status": "done", "receiptId": "b2…", "doneAt": "2026-09-09T11:02:00Z", … },
  "receipt": {
    "receiptId": "b2…", "kind": "task", "taskId": "rec_1-0", "recordingId": "rec_1",
    "title": "send Priya the deck",
    "quote": "Drafted and sent the deck to Priya.",
    "stamp": "DONE",                          // DONE on success, FAILED on failure
    "rows": [
      {"k":"KIND","v":"MESSAGE"}, {"k":"PROMISED","v":"2026-09-09T09:00:00Z"},
      {"k":"RAN ON","v":"Kartik's MacBook"},
      {"k":"STARTED","v":"2026-09-09T11:00:00Z"}, {"k":"FINISHED","v":"2026-09-09T11:02:00Z"},
      {"k":"PRODUCED","v":"deck.pdf · file:///Users/k/deck.pdf"},
      {"k":"STATUS","v":"DONE","ok":true}
    ],
    "createdAt": "2026-09-09T11:02:00Z"
  }
}
```

What happens server-side, in **one** `TransactWriteItems`: the receipt is
written and the task is flipped to `done` (or `failed`), both or neither. Then
`receipt.printed` goes to the user's phone.

**Idempotent.** Post it again — a reply lost on the way back, a daemon that
restarted mid-flight — and you get **the same receipt**, `200`, with no second
receipt printed and no second notification. This is the intended recovery: on
any network error after sending a result, **retry the same POST**.

- `409 {"error":"this task is not being executed; claim it first"}` — the task
  was never claimed, or is not in `executing`. Claim it, then post again.
- `400` — the outcome is missing or is not `success`/`failure`, a timestamp is
  not RFC3339, or more than 24 artifacts were sent.

A failure **still prints a receipt**, stamped `FAILED`. A roll that records
only the wins proves nothing. Report `failure` honestly; anything that is not
the exact word `success` is treated as a failure.

---


## The claim is a loan, not a transfer

A claim writes a **lease**: fifteen minutes, because the daemon's own run cap
is twelve. While it holds, no other machine is offered the task and the
person is told, honestly, that their work is running.

Past it, the task goes back on the queue. Both `GET /daemons/work` and
`POST /daemons/heartbeat` sweep before they answer, so an abandoned promise
is offered again by the next poll from *any* paired machine — including the
one that dropped it, once it comes back.

Three consequences worth knowing:

- **Finish inside the lease.** A daemon that will take longer should post a
  result of `failure` with a summary saying so, rather than holding on.
- **A release always loses a race.** It is conditional on the task still
  being `executing`, so a daemon that finishes in the same instant keeps its
  result and its receipt. Releasing can never undo work that happened.
- **A task claimed by a build older than leases is treated as expired**, so
  nothing from before this change stays stranded.

## 3. The task's life

```
 proposed ──approve (app, paid tier)──► approved ──claim (daemon)──► executing
     │                                     │                            │
     └──dismiss──► dismissed               └──dismiss──► dismissed       ├─ result success ─► done
                                                                        └─ result failure ─► failed
```

- Only **approved** tasks are ever offered to a daemon. Approval is the user's
  act, in the app, and requires the paid tier.
- "Not already claimed" is not a filter anyone applies: claiming moves the row
  to the `executing` index partition, so the next poll cannot see it.
- `done` and `failed` are terminal, and both carry a `receiptId` and a
  `doneAt` — the moment the run ended, whichever way it went.

---

## 3.5 Who speaks this, today

Three clients, in the order somebody meets them.

**The app** mints the code. Settings → Laptop daemon → Pair a laptop shows the
six characters, counts the five minutes down, lists the machines already
paired with what each one is doing, and unpairs one. It is the only surface
that touches the Clerk half of this API, and the whole of that half.

**KARMAX's `lyzn` connector** is the first-party laptop client
(`internal/connectors/lyzn` in the KARMAX repository, pull request 2). The
operator pastes the code into KARMAX's console; `CompleteCredentials` redeems
it, stores the token where KARMAX keeps credentials, and from then on a poll
source beats every minute and raises `lyzn.task.approved` for each approved
task. It also gives the agent four tools — list, claim, report, status — so a
task can be carried out without a loop at all.

**The `lyzn-tasks` loop** (karmax-loops, pull request 3) is the other build:
a recipe in YAML for an install that wants the sequence written down and
editable, and a signed WASM workflow for one that wants it verified. Both
speak this API directly with a token in their own configuration, which is why
the three affordances at the bottom of this document exist.

A note for whoever writes the fourth: nothing here is privileged. The claim is
the only unauthenticated call, the token it hands back is the whole
credential, and everything else is one bearer header away.

---

### `GET /daemons/history`

What this account's machines have done, for a window rather than for a loop.

```json
{
  "waiting":  [ { …work item…, "status": "approved", "mine": false, "receipt": null } ],
  "running":  [ { …work item…, "status": "executing", "mine": true, "claimedAt": "…" } ],
  "finished": [ { …work item…, "status": "done", "mine": true, "finishedAt": "…",
                  "receipt": { "receiptId": "…", "title": "…", "stamp": "DONE", "rows": [] } } ]
}
```

Three states, `?limit=` up to 100 each, newest first. `finished` folds done
and failed together because somebody looking at it wants the last thing that
happened, whichever way it went.

`mine` is whether the machine asking is the one that ran it. An account can
have several paired laptops, and a window that claimed credit for all of them
would be lying.

Every other endpoint here answers what a loop needs next. This one exists
because "nothing waiting" and "nothing ever happened" look identical through
`GET /daemons/work`, and a screen has to tell them apart. It is also the only
endpoint on this half that returns receipts.

---

### `POST /daemons/memory`

A machine's own way into the memory layer.

```json
{ "apiKey": "gl_live_…", "namespace": "user-3j3f…-a947a597", "baseUrl": "https://api.gitloom.cloud" }
```

The same grant comes back on the claim, under `memory`, because a machine that
has to ask separately is a machine that runs for a while without memory — and
LYZN without what the pendant heard is a worse product than LYZN that failed to
pair. This route is for the machine that lost it: a reinstall, or a mint that
failed while the network was down.

**The key is confined to that person's namespace.** It is a GitLoom key with a
namespace scope (MelloB1989/gitloom#2), minted per machine at pairing and
revoked when the machine is unpaired. This backend's own key is never given
out: it reaches every LYZN user's memory, and one copy of it on one laptop
would be all of them.

`402` when the plan carries no automation, `502` when GitLoom could not be
reached. Nothing is stored here but the key's public id, because GitLoom shows
a secret exactly once — a machine that loses it asks again and gets a new one,
and the old one is revoked as soon as its replacement exists.

---

## 4. The loop, as it should be written

```
every 30s:
    POST /daemons/heartbeat {status: busy? "busy" : "online", version}
        401 → stop; this daemon has been unpaired
        5xx/network → back off, try again
    if response.tasks == 0: continue

    GET /daemons/work
    for each task (oldest first):
        POST /daemons/work/{taskId}/claim
            409 → someone else has it; next task
            404 → gone; next task
        started = now
        run the task with the orchestrator (Claude Code / Codex),
            given task.text, task.quote and task.context
        POST /daemons/work/{taskId}/result {outcome, summary, startedAt, finishedAt, artifacts}
            network error → retry the identical POST; it is idempotent
            409 → re-claim, or accept that it was closed elsewhere
```

Notes worth keeping:

- **One at a time.** The work poll hands over at most ten; claim one, run it,
  report it, then take the next. A claimed task that a closed laptop never
  finishes is worse than a task left waiting.
- **The orchestrator's credentials are the customer's.** Nothing in this API
  supplies a model key, and nothing in it should be hard-coded on the daemon's
  side either: which base URL and key the orchestrator is configured with is
  the Act / Act Pro split, and it must stay configuration.
- **Never log the token.** Not at startup, not at debug level.

---

## 5. A walkthrough with curl

Everything below is a real sequence. `$API` is `https://api.lyzn.ai`.

**1. The phone mints a code** (this one is done by the app; the Clerk session
token is `$CLERK`):

```bash
curl -sS -X POST "$API/daemons/code" \
  -H "Authorization: Bearer $CLERK" \
  -H 'Content-Type: application/json'
# 201
# {"code":"K7QD2M","expiresAt":"2026-09-09T10:05:00Z","expiresInSeconds":300}
```

**2. The daemon redeems it.** No Authorization header at all:

```bash
curl -sS -X POST "$API/daemons/claim" \
  -H 'Content-Type: application/json' \
  -d '{
        "code": "K7QD2M",
        "name": "Kartik'"'"'s MacBook",
        "hostname": "'"$(hostname)"'",
        "os": "'"$(uname -s)/$(uname -m)"'",
        "version": "karmax 0.4.1",
        "capabilities": ["claude-code", "shell"]
      }'
# 201
# {"daemonId":"6f1c8e2a-…","token":"3Qz9…","name":"Kartik's MacBook","registeredAt":"…"}
```

Save the token — it is never shown again:

```bash
export TOKEN=3Qz9…
mkdir -p ~/.config/karmax
( umask 077; printf 'LYZN_DAEMON_TOKEN=%s\n' "$TOKEN" >> ~/.config/karmax/lyzn.env )
```

**3. Heartbeat:**

```bash
curl -sS -X POST "$API/daemons/heartbeat" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"status":"online","version":"karmax 0.4.1"}'
# 200 {"ok":true,"tasks":1}
```

**4. Take the work:**

```bash
curl -sS "$API/daemons/work" -H "Authorization: Bearer $TOKEN"
# 200 {"tasks":[{"taskId":"rec_1-0","text":"send Priya the deck","kind":"message",
#      "quote":"I'll send you the deck tonight","dueAt":"","recordingId":"rec_1",
#      "createdAt":"2026-09-09T09:00:00Z",
#      "context":{"title":"Dinner with Priya","summary":"…","facts":[…]}}]}
```

**5. Claim it:**

```bash
curl -sS -X POST "$API/daemons/work/rec_1-0/claim" -H "Authorization: Bearer $TOKEN"
# 200 {"task":{"taskId":"rec_1-0","status":"executing","daemonId":"6f1c8e2a-…","claimedAt":"…"}}
# 409 {"error":"this task is not waiting to be claimed"}   ← someone else got there first
```

**6. Report the result:**

```bash
curl -sS -X POST "$API/daemons/work/rec_1-0/result" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
        "outcome": "success",
        "summary": "Drafted and sent the deck to Priya.",
        "startedAt": "2026-09-09T11:00:00Z",
        "finishedAt": "2026-09-09T11:02:00Z",
        "artifacts": [{"name":"deck.pdf","uri":"file:///Users/k/deck.pdf"}]
      }'
# 200 {"task":{…,"status":"done","receiptId":"b2…"},"receipt":{…,"stamp":"DONE"}}
```

Send it a second time and the same receipt comes back, unchanged, with no
second notification on the phone.

**7. When the person unpairs the machine**, the very next request is:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' "$API/daemons/work" -H "Authorization: Bearer $TOKEN"
# 401
```

Stop the loop, delete the stored token, and ask for a new pairing code.

---

## 6. Where it lives

| Concern | File |
|---|---|
| Rows, keys, pairing codes, token hashing, the transaction | `backend/go/internal/ddb/daemons.go` |
| Bearer-token middleware (touches no Clerk) | `backend/go/internal/api/daemonauth.go` |
| Handlers, entitlement, the push | `backend/go/internal/api/daemons.go` |
| Task states and their conditional writes | `backend/go/internal/ddb/tasks.go` |
| The receipt a run prints | `backend/go/internal/ddb/daemons.go` (`ReceiptFromWork`) |
| `receipt.printed` | `backend/go/internal/push/events.go` |

Storage, for the curious: one DynamoDB table.
`Daemon` is `PK USER#<sub>` / `SK DAEMON#<daemonId>` with
`GSI1PK DTOKEN#<sha256(token)>`; the pairing code is a top-level
`PK PAIRCODE#<code>` / `SK PAIRCODE` item carrying the user id, an expiry it
enforces itself and the table's `ttl` attribute so an unredeemed code sweeps
itself away.


## Three affordances for the recipe tier

KARMAX has two kinds of loop. A **workflow** is signed WebAssembly: it can
read any JSON and needs nothing here. A **recipe** is one YAML file that
installs by being copied into a directory — no toolchain, no signing, no
restart — and it is how an operator will actually run this on day one.

A recipe's whole language can iterate *a JSON array of scalars* and cannot
reach inside an object. Three additions meet it where it is. None of them
changes an existing shape.

### `GET /daemons/work?format=ids`

Answers with a bare array — `["t_1","t_2"]` — and reads no conversations
while doing it, so it is also the cheap way to ask "is there anything".

### The claim hands back the work

`POST /daemons/work/:taskId/claim` now answers `{task, work}`, where `work`
is exactly what the poll's `tasks[]` entry would have been: the text, the
sentence the person said, the due date and the conversation's context. A
caller that took a task by id alone still gets the words to act on.

### A result may be the harness's own reply

`POST /daemons/work/:taskId/result` accepts `Content-Type: text/plain`
carrying the harness's whole answer, and reads it for the contract the loop's
prompt demands:

```
STATUS: done | blocked | failed
SUMMARY: <one sentence>
```

`STATUS: done` is the only thing that prints a *done* receipt. Anything else
— blocked, failed, a refusal, an empty reply — prints a **failed** receipt
carrying what the harness actually said. That asymmetry is deliberate: a
coding harness that refuses prints prose and exits zero, and a receipt for
work nobody did is worse than no receipt at all.
