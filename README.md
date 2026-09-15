# MR20 AI Pendant

A white-label "AI pendant" voice recorder sourced from China, and the system
built on it: an iOS/Android app that pairs with the pendant over Bluetooth and
pulls its recordings off, and a serverless AWS backend that transcribes,
diarizes and summarises them.

```
mr20.py       protocol client and CLI          ─┐
mr20sync.py   sync daemon                       │  the reverse-engineering work
selftest.py   79 checks, no device needed       │  that made the rest possible
tools/        discovery scripts                 │
docs/         manufacturer spec + findings     ─┘

mobile/       React Native (Expo) app
backend/      CDK: Lambda, DynamoDB, S3, SQS, Bedrock
web/          lyzn.ai, the marketing site
assets/lyzn/  LYZN logos and app icons
```

The protocol findings below were verified against real hardware running
**firmware V1.2**, not inferred from the manufacturer's document. The app is a
direct port of them — see `mobile/README.md` for what carried across and why.

## Quick start

```bash
# backend
cd backend && npm install && npx cdk deploy
../sync-config.sh

# app — needs a development build, not Expo Go
cd ../mobile && npm install && npx expo run:ios
```

One thing needs doing by hand once: **set the Deepgram key**. See
`backend/README.md`.

Authentication needs nothing: Clerk owns it outright. The API verifies Clerk
session tokens against that instance's JWKS and consults nothing else — there
is no user pool, no password, and no sign-in code to mail.

---

## The headline finding

**The manufacturer's protocol spec does not match the firmware they shipped.**

`docs/MR20通信协议20260702.xlsx` documents every command as `XS_BLE&…` with
replies as `XS_DEV&…`. The device rejects all of them with `DEV&UNKNOWN`. The
shipped build drops the `XS_` prefix entirely:

| Sent | Reply | Result |
|---|---|---|
| `XS_BLE&FW` | `DEV&UNKNOWN` | as documented — rejected |
| `BLE&FW` | `DEV&FW&V1.2` | **correct** |
| `FW` | `DEV&UNKNOWN` | prefix is required |

`mr20.py` probes on connect and adopts whichever dialect answers, so it works
with either build.

---

## Hardware identification

| | |
|---|---|
| SoC vendor | Actions Semiconductor (USB `0x10D6`) |
| USB identity | `10D6:B00B`, product string `MSC Sample` |
| SCSI inquiry | `ZEPHYR` / `ZEPHYR USB DISK` |
| MCU firmware | V1.2 |
| WiFi firmware | V0001 |
| Storage | 7661 MB FAT32, exposed as USB mass storage |
| Audio | MP3, 16 kHz mono, 32 kbps, hardware-encoded |
| BLE name | `YLF20_<mac suffix>` — does **not** advertise its service UUID |

The mass-storage identity strings are Zephyr's, and `MSC Sample` is the name of
Zephyr's stock mass-storage example. **The stock firmware is a Zephyr RTOS
build**, which means custom firmware would be a Zephyr application against an
Actions board port rather than a from-scratch reverse-engineering effort.

---

## What works (verified on device)

| Capability | Evidence |
|---|---|
| Telemetry | battery 98%, 7655/7661 MB free, clock, MAC `50c0f013d830` |
| Start recording | `DEV&STA&2026-08-19 18-34-09` |
| Stop recording | `DEV&STO` |
| Haptic motor | buzz confirmed by hand |
| Folder & file listing | 2 folders, 8 recordings with size and duration |
| File download | 8 files, 5.5 MB, every one byte-exact and valid MP3 |
| Live audio stream | 79,872 bytes in 20 s → 19.9 s of playable MP3 |
| Recording survives BLE disconnect | `STE&1` on a fresh connection after dropping the link |

Transfers averaged **~35 kB/s over BLE** — a 2.5 MB recording took about a
minute. Fast enough that the WiFi transfer path, which takes the host off its
own network, is rarely worth the disruption.

## What does not exist

Backed by probing, not just absence from the spec:

- **LED control** — 21 candidate spellings (`LED&1`, `LED&ON`, `SET&LED`,
  `LIGHT&ON`, `IND&1`, …) all returned `DEV&UNKNOWN`.
- **Auto-record at power-on** — boot behaviour is firmware. Mitigated by the
  fact that recording *continues* after BLE disconnects, so a host only needs to
  connect long enough to start it.
- **Setting the recording mode** — Call/Conversation can be read, never set.
  Ten command spellings and every button gesture leave it on `CALL`.
- **Tuning audio quality, mic gain, or the voice-activation threshold** — the
  behaviour exists (see below) but nothing exposes its parameters.
- **Reading raw flash or dumping firmware.**

---

## Voice activation works, and it is on by default

The device wakes on speech and stops itself after **~10 seconds of silence**,
in `CALL` mode, with no configuration. Measured under control — recording
started over BLE so no button was involved, then the room kept silent and the
device left alone:

```
 6.54s  START -> 2026-08-20 16-10-18   (started by us over BLE)
16.78s  STOP  (device stopped itself)  <- 10.29s into silence
```

A second, independent run stopped at 10.02s. The live audio rate collapses from
4096 B/s to ~230 B/s at the stop, confirming capture really ends.

The wake half shows up in the file listing as clusters of very short recordings
separated by seconds — speech bursts, not button presses:

```
16-00-05   1s     16-00-16   5s
16-00-12   3s     16-00-23   4s     16-00-27  270s
```

**This was initially recorded here as "no voice activation", which was wrong.**
That conclusion came from watching the device record continuously for 130s and
assuming the room was silent. It was not — ambient sound was holding the
recording open. The lesson generalises: never conclude a feature is absent from
an observation whose key variable was not controlled.

### What it means for consumers of this device

- **Always-on capture needs no custom firmware.** Speech is captured, silence is
  not, so neither the 280 mAh battery nor the 7.6 GB of storage is wasted.
- **Recordings arrive pre-segmented** by utterance, which is a far better input
  to a transcription pipeline than one multi-hour blob.
- **Stitch adjacent files before transcribing.** A natural pause longer than ten
  seconds splits one conversation across several recordings. The file listing
  gives a start timestamp and duration for each, so merging by gap is simple
  arithmetic — do it before diarization, not after.
- **Expect the first moments of speech to be clipped** while the detector wakes.

---

## Gotchas that cost us time

**File transfers and live audio share one notify channel.** Downloading while
the device is recording interleaves the two: our first sync produced files
8–20 kB larger than their declared size — structurally valid MP3, but containing
audio that was never part of the recording. `mr20sync.py` now pauses recording
during sync and restores it afterwards; every transfer since has been byte-exact.

**`BLE&STATUS` silently stops recording.** Undocumented, and it answers
`DEV&STO`. Probing an unknown command space is not side-effect free here.

**File names over BLE carry no `.mp3` extension**, though the same files show one
over USB.

**Back-to-back transfer requests get dropped.** A two-second gap between files
turned four failures out of eight into zero.

**Live captures start mid-frame.** The device streams continuously, so a capture
must be trimmed to the first MP3 frame sync before any player will accept it.

---

## Can we flash custom firmware?

Writing firmware is **not** the blocker — producing an image the bootloader
accepts is.

**Route 1 — OTA over BLE (documented, untested).** The spec describes a complete
upload sequence: `BLE&OTA&<6-digit size>` → `DEV&OTA` → stream 244-byte frames
≥8 ms apart → `BLE&OT&OVER`. A parallel sequence updates the WiFi coprocessor.
Untested because we have no valid image to send.

**Route 2 — ADFU. Confirmed reachable on this device.** Actions parts expose a
recovery bootloader in mask ROM at USB id `10d6:10d6`. Ours enters it reliably:

1. Unplug, then long-press the button until the device powers fully off
2. Hold the button down
3. Plug in USB while still holding
4. Keep holding ~5 seconds

Both LEDs blink once and the motor buzzes, then it enumerates as `10d6:10d6`.
The mass-storage volume does **not** mount — that is correct, not a failure.
A power cycle returns it to normal mode.

What we established there, all read-only:

| | |
|---|---|
| Interface | vendor specific, class/subclass/protocol `0xFF/0xFF/0xFF` |
| Endpoints | bulk IN `0x81`, bulk OUT `0x02`, 64-byte packets |
| Claimable | yes, without `sudo` on macOS — the kernel does not bind it |
| Transport | USB Bulk-Only Transport; CSW returns a valid `USBS` signature |
| Standard SCSI | **rejected** — TEST UNIT READY, INQUIRY and READ CAPACITY all return status `0x02` |

So the transport is understood and the command set is entirely vendor-specific.

**Why we stopped there.** Going further means uploading a chip-specific stub
(`adfus.bin`) into SRAM at a chip-specific address and executing it — for
reference, `0xbfc18000` on ATJ2127 and `0x118000` on ATJ2157, which are MIPS
addresses for a different chip family than ours. We have neither the stub nor
the address for this part, and guessing at either writes into the boot path.

This device makes that especially unattractive: the published tooling warns that
a hung payload leaves the chip "very difficult to reboot and looks like it is
bricked", recoverable only by waiting for the battery to discharge. The pendant
has a sealed battery and a software power switch, so there is no battery pull —
a bad stub could mean days of downtime.

**Zephyr mainline does not support this silicon.** Checked directly against the
source tree: `soc/` carries 60 vendor directories (Nordic, ST, Espressif,
Realtek, Telink, …) and **none** of them is Actions. There is no public Actions
Zephyr SDK either. So although the stock firmware is a Zephyr build, the board
support package that made it buildable is vendor-supplied and not open — knowing
the RTOS does not by itself let us produce an image.

**Still needed**, in order of how much each unblocks:

1. **The exact chip part number.** Cheapest route is opening the case and reading
   the marking. Everything else follows from it.
2. **The matching `adfus.bin` stub and its SRAM load address**, or Actions'
   ADFU tooling for this family.
3. **The board support package**, to build a Zephyr image at all.
4. **The OTA image packaging format**, if we prefer the sanctioned route.
5. Pin mapping for mic, button, LEDs and haptic.

The manufacturer already shared the protocol spec, so asking them is the fastest
route — and worth mentioning that the spec they sent does not match the firmware
they shipped.

The good news buried in all this: because ADFU lives in mask ROM, it cannot be
erased. Once the correct stub is in hand, a bad flash is recoverable rather than
fatal — which makes this the right path to take, just not without the stub.

---

## Usage

```bash
python3 -m venv .venv && ./.venv/bin/pip install bleak
```

Our unit does not advertise the MR20 service UUID, so `scan` will not flag it.
Find the strongest `YLF20_*` device and probe it directly.

```bash
./mr20.py scan                              # list nearby BLE devices
./mr20.py --address <uuid> probe            # dump GATT, confirm it is the pendant
./mr20.py --address <uuid> info             # battery, firmware, storage, clock
./mr20.py --address <uuid> shake            # proves hardware control
./mr20.py --address <uuid> dirs
./mr20.py --address <uuid> files 2026-08-19
./mr20.py --address <uuid> pull 2026-08-19 "2026-08-19 17-36-06"
./mr20.py --address <uuid> listen --seconds 20
./mr20.py --address <uuid> raw FW           # prefix is added for you
```

Continuous sync — keeps the pendant recording and pulls everything into a local
library, skipping what it already has:

```bash
./mr20sync.py --library ~/pendant --address <uuid> --no-wifi
./mr20sync.py --library ~/pendant --address <uuid> --once --passive
```

### Safety

Commands that erase data, unpair, or write firmware are refused unless
`--allow-dangerous` is passed. Two are worth naming:

- `BLE&BLE&RESET` **formats the device**, destroying every recording — and sits
  one character from `BLE&BLE&OFF`, which does not.
- The OTA commands put the device into firmware-write mode.

`mr20sync.py` also refuses to switch the host's WiFi network unless told how to
restore it (`--restore-ssid`), because recent macOS hides the current SSID and
the host would otherwise be stranded on the pendant's access point.

---

## Layout

```
mr20.py         protocol client and CLI
mr20sync.py     sync daemon: keeps recording, pulls everything to a local library
selftest.py     79 checks that run without the device attached
tools/          discovery scripts used to work the protocol out
docs/           manufacturer spec + a written reference of the findings

mobile/         Expo app: onboarding, pairing, sync, library, transcripts
backend/        CDK stack: ingest, transcription, diarization, enrichment
web/            lyzn.ai: the marketing site (Vite + React)
assets/lyzn/    LYZN logos, app icons and favicons — see its own README
sync-config.sh  copies deployed stack outputs into the app's config
```

## CI

Four workflows in `.github/workflows`, each filtered to the paths it owns, so a
change to one product never builds the others.

| Workflow | On | Does |
|---|---|---|
| `backend-ci` | PR / push to `backend/**` | `go test`, `tsc`, `cdk synth`; on main, deploys both stacks, then rebuilds the voice image and forces a new ECS deployment |
| `web-ci` | PR / push to `web/**` | builds the site; on main, syncs to S3 and invalidates CloudFront |
| `mobile-ci` | PR / push to `mobile/**` | typechecks and runs the test suite |
| `mobile-release` | tag `mobile-v*` | EAS production build for both platforms, submitted to TestFlight and Play internal testing, plus a sideloadable APK |
| `preview` | PR labelled `preview` | raises that pull request's own backend and comments its URL; tears it down when the pull request closes |

## Preview backends

Label a pull request **`preview`** and it gets a backend of its own. The URL is
posted as a comment on the pull request and rewritten in place on every push, so
the comment always names the backend built from the current commit rather than
accumulating one per push:

```
### 🧪 Preview backend
https://<id>.lambda-url.ap-south-1.on.aws
```

That URL is a Lambda Function URL with **wildcard CORS**, which production's is
not, so a local build or a branch deploy of the site can call it directly with
no proxy. It streams, exactly as production does.

Closing the pull request — merged or not — deletes the stack, and the teardown
runs whether or not the label is still attached, so removing the label cannot
strand a preview. Re-label a closed-and-reopened pull request and it comes back.

**It is not a copy of production.** The voice service (VPC, ALB, Fargate, ECR,
CodeBuild) and the CloudFront distributions are the slow and costly half of that
stack, about twenty minutes each way, and prove nothing about an API change. A
preview is the data plane and the two Lambdas over it — up in a couple of
minutes — with its own empty table and bucket. There is no voice socket and no
CDN in a preview, so anything reached through `api.lyzn.ai` or the ALB is not
under test.

### The data model cannot drift

Both stacks build their table, bucket and queue from one definition,
`lib/data-plane.ts`, called with the stack as its scope. Add a table, an index
or a sort key there and it reaches previews on their next deploy with nobody
remembering to copy it across — a preview that tests a data model production
does not have is worse than no preview at all.

Only durability differs, never shape: production retains and keeps
point-in-time recovery, a preview deletes and empties its own bucket.

It is a function and not a Construct on purpose. A Construct would nest those
resources and change their logical ids, and CloudFormation reads a changed
logical id as a different resource — it would replace the production table.

### The staging flag

Previews run with `staging: true`, and that flag is what selects credentials —
`ENVIRONMENTS` in `bin/app.ts` maps each side to its own:

| | production | staging |
|---|---|---|
| Clerk issuer | `clerk.lyzn.ai` | the test instance |
| Clerk key | `mr20/clerk/prod` | `mr20/clerk/test` |
| Razorpay | `mr20/razorpay/prod` | `mr20/razorpay/test` |
| Deepgram, Sarvam, GitLoom | production keys | *the same production keys* |

Clerk and Razorpay are genuinely separated. Clerk's test instance is a different
issuer with different signing keys, so a production session token is rejected by
a preview outright rather than merely discouraged, and sign-ins there create
users in the test instance; Razorpay's test keys cannot move money. The Lambda
also carries `STAGING=true` for application code that needs to know which side
it is on — `config.IsStaging()`.

**A preview is how you try a backend change.** Running the backend locally means
standing up DynamoDB, S3, SQS and Bedrock credentials to approximate what a
label gives you in two minutes on the real thing, so the workflow is: open the
pull request, label it `preview`, and work against the URL it comments. The
credentials it runs on are listed above; `internal/config` is the one place that
says what the backend reads from its environment.

The others have no test tenant yet, so **staging does spend production quota on
Deepgram, Sarvam and GitLoom**. Create test secrets and point `ENVIRONMENTS` at
them when that matters; nothing else has to change.

### Who can raise one

Deploying a preview carries the same AWS rights as a merge to main, so the gate
is a label, which only write access can attach. A fork's pull request cannot
reach it twice over: GitHub withholds the OIDC token from a fork, and the
workflow checks the head repository rather than resting on that alone.

Releases are tagged per product, because this repository holds three of them:
`mobile-v4.3.0`, not `v4.3.0`. The tag must match `expo.version` in
`mobile/app.json` or the release workflow refuses to build. Build numbers are
not in the repository at all — `eas.json` sets `appVersionSource: remote`, so
EAS holds `buildNumber` and `versionCode` and increments them per build. Local
numbers cannot work here: every tagged build would reuse the ones committed,
and both stores reject a duplicate.

Deploys authenticate with GitHub's OIDC provider, not a stored key. The role is
`mr20-pendant-gh-actions-deploy`, trusted only for this repository on `main`,
and it holds no permissions of its own beyond assuming the CDK bootstrap roles
and the handful of S3, CloudFront, CodeBuild and ECS calls the deploys make.
Its ARN is the `AWS_DEPLOY_ROLE_ARN` repository variable. The one secret that
does have to be stored is `EXPO_TOKEN`.

A note on that trust policy, because the failure is silent and the error names
nothing useful: GitHub sends **immutable subject claims** here, so the `sub` is
`repo:MelloB1989@63499572/mr20-pendant@1339585989:ref:refs/heads/main` — with
the numeric owner and repository ids — not the classic `repo:owner/name:ref:...`
that every example shows. A policy written against the classic form fails every
assume with a bare `AccessDenied`. The role accepts both.

`main` is protected: one approving review from a code owner, stale approvals
dismissed on a new push, no force-pushes and no deletion. Admins are exempt, so
the owner is not locked out of their own pull requests — GitHub does not let
anyone approve their own.

## Where it runs

| | |
|---|---|
| Site | `lyzn.ai` — S3 behind CloudFront (`LyznWebStack`) |
| API | `api.lyzn.ai` — CloudFront in front of the Lambda Function URL |
| Voice | an ALB in front of the Fargate service |

The API keeps its Function URL alongside the custom domain, and must: releases
already in the App Store have that address compiled into
`mobile/src/api/config.ts`, and only a new build moves them. The domain is
CloudFront rather than API Gateway because the chat endpoint streams, and API
Gateway buffers a Lambda's response instead of passing it through.

Certificates are issued by hand and passed to the stacks by ARN, because
lyzn.ai's DNS is at Cloudflare and nothing in CDK can write the validation
records there. `www` is not served yet: it still points at Vercel, whose CNAME
target publishes CAA records naming four issuers, none of them Amazon, and a
name holding a CNAME cannot hold a CAA of its own to override that. It can be
added once it is repointed here.

## Brand assets

`assets/lyzn/` holds the mark, the wordmark and the app icons, copied out of
`lyzn.core` and each one checked by eye — several files there carry other
companies' branding under LYZN filenames. See `assets/lyzn/README.md`.

`tools/` is how the findings were produced, kept for reproducibility:
`probecmds.py` found the dialect, `discover.py` and `ledprobe.py` mapped the
undocumented command space, `usbwatch.py` watches for the ADFU bootloader, and
`scandetail.py` / `watchble.py` located the device over BLE.

## Tests

```bash
./selftest.py
```

79 checks covering protocol parsing against every documented reply, the
dangerous-command gate (including proof a blocked command never reaches the
wire), MP3 frame alignment, library round-trips, and the network guard. No
device required.

The TypeScript port carries its own suite over the same ground:

```bash
cd mobile && npm test
```

---

## Note on recordings

Audio pulled off the device is deliberately **not** committed — see
`.gitignore`. It is real recorded audio from whoever wore the pendant.

