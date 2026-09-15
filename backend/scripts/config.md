# Reading and changing the application configuration

Prices, the tier copy, the feature flags and the notification hour are one
JSON document in DynamoDB (`PK=CONFIG`, `SK=app`). Changing it changes what
the app's plan chooser shows, what the pre-order page prints and — this is
the part worth being careful about — **what a card is charged**. No deploy is
involved; a change is live everywhere within a minute.

- Code: `backend/go/internal/ddb/config.go` (the type, the seeding, the
  validation), `backend/go/internal/config/defaults.go` (what a fresh table is
  seeded with), `backend/go/internal/api/config.go` and `admin.go` (the two
  routes).
- Contract: `docs/superpowers/plans/2026-09-08-app-round-seven.md` §2.4.

Every amount is **paise**, and must be a whole number of rupees — `599900` is
₹5,999. An amount ending in anything but `00` is refused, because the checkout
charges rupees × 100 and the last two digits would be dropped in silence.

## Where

| | |
|---|---|
| Production | `https://api.lyzn.ai` |
| Function URL (production, uncached) | the `ApiUrl` output of `Mr20PendantStack` |
| Preview | the `ApiUrl` output of the PR's `Mr20PendantPreview…` stack |

`https://api.lyzn.ai/config` is served through CloudFront with a sixty-second
cache. When you want to see a change immediately, read the Function URL
instead — it is the origin.

```bash
API=https://api.lyzn.ai
# or, to bypass the CDN:
# API=$(aws cloudformation describe-stacks --stack-name Mr20PendantStack \
#   --query "Stacks[0].Outputs[?OutputKey=='ApiUrl'].OutputValue" --output text)
```

## Read it — `GET /config`

Public. No token, no session, nothing to hide: it is what the website already
prints.

```bash
curl -s "$API/config" | jq .
```

The response headers say how long it may be held and what version you have:

```bash
curl -sD - -o /dev/null "$API/config"
# cache-control: public, max-age=60
# etag: "8f1c0f5b1d0a4e2f9c3b7a6d5e4f3021"
```

Ask again with the tag and get nothing back if nothing changed:

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  -H 'If-None-Match: "8f1c0f5b1d0a4e2f9c3b7a6d5e4f3021"' "$API/config"
# 304
```

## Change it — `PUT /admin/config`

Two things are needed.

**A Clerk session token** in `Authorization: Bearer …`, the same token the app
and the website send. The easiest honest way to get one is from a signed-in
browser on lyzn.ai:

```js
// devtools console on https://lyzn.ai, signed in
await window.Clerk.session.getToken()
```

**The `admin` role**, as `role` in that user's Clerk **public** metadata. It is
set in the Clerk dashboard (Users → the user → Metadata → Public), and nothing
in this API can grant it — which is the property worth having. The backend
reads it from the token when the instance's JWT template includes
`public_metadata`, and asks Clerk's API for it when the token does not carry
it, so the claim is not something you have to configure to make this work.

```json
{ "role": "admin" }
```

Then: read the current document, edit it, send the whole thing back. There is
no partial update — the body is the complete `AppConfig`.

```bash
TOKEN='<a Clerk session token for an admin>'

# 1. take what is live
curl -s "$API/config" > /tmp/config.json

# 2. edit it. Anything jq can do; here, Act's deposit becomes ₹4,499.
jq '(.pricing.tiers[] | select(.id == "act") | .deposit) = 449900' \
  /tmp/config.json > /tmp/config.next.json

# 3. send it back
curl -s -X PUT "$API/admin/config" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  --data @/tmp/config.next.json | jq '{version, updatedAt}'
# { "version": 4, "updatedAt": "2026-09-08T10:04:11Z" }
```

`version` and `updatedAt` in what you send are ignored: the store sets them.
The version in the reply is the one that is now live, and it is one more than
the one you read — if it is not, somebody else saved between your read and
your write, and the request is refused rather than quietly losing their edit.

### Other things you will want to do

Take a tier off sale. It stops being shown **and** stops being sellable — an
old build that still sends `act` gets a 400, not a checkout:

```bash
jq '(.pricing.tiers[] | select(.id == "act-pro") | .enabled) = false' \
  /tmp/config.json > /tmp/config.next.json
```

Turn a slot on, once the thing behind it exists:

```bash
jq '.features.execution = true' /tmp/config.json > /tmp/config.next.json
```

Move the daily digest to seven in the morning:

```bash
jq '.notifications.digestHour = 7' /tmp/config.json > /tmp/config.next.json
```

Change a sentence the chooser shows:

```bash
jq '.pricing.copy.chooserSub = "Three ways to buy it."' \
  /tmp/config.json > /tmp/config.next.json
```

### Add a tier

Nothing in the code names the three tiers as a fixed list, so a fourth is a
document change. Razorpay's sheet will call it `LYZN <name> · pre-order`.

```bash
jq '.pricing.tiers += [{
      "id": "act-max", "name": "Act Max",
      "full": 1499900, "deposit": 599900, "monthly": 99900,
      "enabled": true, "badge": "",
      "lines": ["Everything in Act Pro", "Two pendants"]
    }]' /tmp/config.json > /tmp/config.next.json
```

## Turning the laptop daemon on

Two flags, and they have to move together.

| flag | what it gates |
|---|---|
| `execution` | the backend. `POST /daemons/code`, `POST /tasks/:id/approve` and the work queue all sit behind it, and answer `402` while it is down |
| `daemon` | the app. Settings → Laptop daemon, the pairing screen behind it, and Home's banner about approved work with nobody to do it |

The app requires **both** before it draws the row (`showsDaemonRow`), and that
is deliberate: with only `daemon` on, every tap of "Pair a laptop" would hit a
`402` and open the plan chooser at somebody whose plan is perfectly good.

```bash
# read, flip the two, send the whole document back
curl -s "$API/config" > /tmp/config.json
jq '.features.execution = true | .features.daemon = true' /tmp/config.json > /tmp/next.json
curl -sX PUT "$API/admin/config" \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  --data @/tmp/next.json | jq '.features'
```

Turning `execution` on also unlocks approving tasks, the approval-gates row and
the execution wording throughout the app, because they are the same feature.
An account still needs a plan that carries automation — the flag is the
deployment's half of the gate, not the account's.

There is an environment override, `EXECUTION_ENABLED`, and it wins either way.
It exists so a preview stack can run the whole daemon flow while production
has the flag down, and so production can be switched off in one console edit
if something goes wrong. It is not the way to turn this on for good.

Who is on the other end once it is up: `backend/docs/daemon-api.md` §3.5.

---

## What the validator refuses

The message comes back as the 400's `error`, written for whoever sent the
document.

- a tier id that is not lowercase letters, digits and hyphens
- the same tier id twice
- a negative amount, or one that is not a whole number of rupees
- a deposit larger than the full price
- a tier with no name, or a bullet line that is empty
- no tiers, more than twelve of them, or **no tier enabled** — nothing to buy
  is not a configuration, it is an outage
- a currency that is not a three-letter uppercase ISO code
- an empty `chooserTitle` or `receiptTitle`
- a `digestHour` outside 0–23

## Putting it back

The document that a fresh table is seeded with is
`backend/go/internal/config/defaults.go` — the JSON literal in it is exactly
what `PUT /admin/config` takes, so restoring the shipped configuration is a
copy and a paste. Deleting the `CONFIG`/`app` row also works: the next read
seeds it again.

## Notes

- Never paste a Clerk secret key, a session token or an ARN's contents into a
  shared channel or a commit. The token above is short-lived; treat it as a
  password anyway.
- A preview stack has its own table and its own configuration, seeded with the
  same defaults. Editing production does not touch it, and vice versa.
- The backend keeps its own copy for sixty seconds per Lambda container, so a
  change reaches a checkout within a minute of the `PUT`. The container that
  served the `PUT` drops its copy immediately, which is why an admin reading
  `/config` straight after their own write usually sees it at once.
