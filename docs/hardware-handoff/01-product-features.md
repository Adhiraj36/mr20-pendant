# Lyzn AI — Product Feature Documentation

**App:** Lyzn AI
**Package / bundle id:** `com.lyzn.flutter`
**Version:** 4.2.0
**Platforms:** Android (SDK 24+) and iOS 16.4+
**Device:** MR20 AI pendant, BLE name `YLF20_<mac suffix>`

---

## 1. What the product is

A wearable voice recorder and the software that makes its recordings useful.
The pendant captures conversation; the app pulls that audio off the device; a
cloud pipeline cleans it, transcribes it, separates the speakers, summarises it,
and files it into a searchable memory the user can then talk to.

The division of labour today:

| | Pendant | Phone | Cloud |
|---|---|---|---|
| Capture | ✅ MP3 16 kHz mono 32 kbps | — | — |
| Voice activation | ⚠️ crude, triggers on any noise | ✅ speech check before upload | ✅ second opinion |
| Noise reduction | ❌ none | ❌ none | ✅ DeepFilterNet3 |
| Silence removal | ❌ none | ✅ discards silent files | ✅ cuts dead air |
| Transcription | ❌ | ❌ | ✅ Deepgram |
| Storage | 7.6 GB FAT32 | local cache | S3 + DynamoDB |

**The whole point of the next hardware revision is to move the ⚠️ and ❌ rows
leftward.** Everything the pendant does not do, the phone or the cloud must, and
each step costs battery, bandwidth or money that better silicon would not.
See `03-firmware-requirements.md`.

---

## 2. Feature list

### 2.1 Pairing and device management

* **Scan and pair.** The pendant does not advertise its service UUID, so the app
  scans by name prefix `YLF20_`. One tap pairs; the MAC is registered against
  the user's account server-side, so a reinstall re-adopts the same device.
* **Live dashboard.** Battery percentage, free / total storage, recording state,
  link state, WiFi state, MCU and WiFi firmware versions, MAC, device clock.
* **Clock sync on every connect.** The pendant has no RTC backup battery and
  drifts, and its clock is what names every recording. The app rewrites it each
  time it connects, so filenames stay meaningful.
* **Haptic test.** A button that buzzes the pendant's motor — the fastest way for
  a user to confirm they are looking at the right device.
* **Remote record toggle.** Start and stop recording from the phone. Recording
  survives BLE disconnect, so the app only needs the link long enough to arm it.
* **Button and voice-activation awareness.** The pendant announces its own state
  changes; the app listens for them and also polls as a fallback, so the on-screen
  toggle never disagrees with the hardware.
* **Storage cleanup.** Deletes from the pendant only those recordings the backend
  has confirmed it holds. It frees space; it never decides a recording did not matter.
* **Factory reset.** Behind a double confirmation, in a marked danger zone.

### 2.2 Sync

A pass runs automatically whenever a recording closes, and on demand:

1. List every folder and file on the device.
2. Skip anything the local manifest already holds at the right size.
3. Stop any in-progress recording — file transfers and the live audio stream
   share one BLE characteristic, and downloading while recording produces a
   corrupt file (see protocol doc §3).
4. Pull each file, leaving 2 s between transfers because the firmware drops
   back-to-back requests.
5. Restart recording.
6. Upload to S3, which triggers the cloud pipeline.

Steps 1–5 need the BLE link; step 6 does not, and is retried separately with
backoff, so a pass that got the audio off the device is never wasted by a flaky
network. Uploads are deduped server-side on device folder + filename, so a
reinstall that lost the manifest re-registers rather than re-transcribing.

* **BLE path:** ~35 kB/s. A 2.5 MB recording ≈ 60 s. Android raises the
  connection priority for the duration of a pass.
* **WiFi path:** implemented for files ≥ 3 MB, currently **disabled** — see §2.7.

### 2.3 On-device speech gate (phone-side VAD)

The pendant's own voice activation triggers on any noise, and most of what it
captures is nothing. Paying to transfer and transcribe silence was the single
biggest waste in the pipeline.

Every pulled file is decoded to PCM natively and scored with a
windowed-energy heuristic before anything is stored or uploaded:

* 30 ms analysis windows — short enough to catch a single word.
* RMS energy against a noise floor taken from the file's own quietest fifth, so
  a recording made next to a fan is judged against the fan.
* A window counts as speech at 4× the floor **and** above −40 dBFS.
* Below 0.75 s of total detected speech, the recording is noise.

A file judged silent is never stored, never uploaded, and — since the BLE link
is held at that moment — deleted from the pendant on the spot. The bias is
deliberately conservative: deleting a real conversation is a catastrophe,
uploading a silent one costs pennies. Anything ambiguous is treated as speech,
and the cloud remains the second opinion.

### 2.4 Live transcript

A screen that shows what the pendant is hearing, as text, while it records.

The pendant streams MP3 over BLE whenever it is recording. The app taps that
stream and relays the bytes **untouched** over a WebSocket to a Go service on
Fargate, which forwards them to Deepgram and streams text back. Nothing is
decoded on the phone — decoding to send something several times larger would
burn battery for nothing.

Text arrives as *partials* (revised constantly, which is what makes it read as
live) and *finals* (settled). The screen renders every final plus at most one
trailing partial.

**Current latency is dominated by the BLE link and the MP3 frame size.** This is
the second-biggest thing better hardware fixes — see `03-firmware-requirements.md` §3.

### 2.5 Cloud pipeline

S3 upload → SQS → processor Lambda. Every step is written to be safe to repeat,
because SQS delivers at least once.

1. **Clean.** DeepFilterNet3 removes noise (attenuation capped at 20 dB — its
   own default of 100 dB thinned speech into an "underwater" artifact), then a
   presence shelf puts back the consonants a denoiser takes first.
2. **Cut.** Peak-normalise, then `silencedetect` removes the parts where nobody
   speaks. Energy-based detection is unreliable on noisy audio, which is exactly
   why it runs *after* the denoiser: with the noise floor gone, silence is
   actually silent, and the detector becomes close to a neural VAD at none of
   the packaging cost. A 0.25 s breath is kept around each stretch and pauses
   under 0.5 s are bridged, so the sentence rhythm survives.
3. **Level.** High-pass, dynamic levelling, loudness normalisation — so near and
   far speakers come out at one proper volume.
4. **Transcribe and diarize.** Deepgram, on the cleaned audio, so transcript
   timestamps line up with what the ear hears and dead air is simply gone.
5. **Enrich.** Title, summary, topics, action items, speaker labels.
6. **Remember.** The transcript is ingested into a GitLoom-backed memory graph.
7. **Notify.** A push notification when a recording is ready.

The original audio is never modified; the cleaned file is what the app plays and
what the transcript refers to.

### 2.6 App surfaces

| Screen | What it does |
|---|---|
| Onboarding | welcome → sign in → pair → ready |
| **Chats** | Conversations with Mira, the assistant that has read everything the pendant heard |
| **Library** | Every recording: title, summary, duration, state; search and categories |
| **Pendant** | The device dashboard of §2.1 |
| Recording detail | Player, diarized transcript, summary, action items, speaker naming |
| Live transcript | §2.4 |
| Voice chat | Full-duplex spoken conversation with Mira, over a WebSocket to Fargate |
| Profile | Account, avatar, categories, sign-out |

Sign-in is Clerk (Apple, Google, email). Push notifications via Expo /
FCM + APNs.

### 2.7 WiFi fast transfer — built, disabled

The pendant hosts an access point; the phone joins it and pulls file bytes from
a TCP socket at `192.168.200.1:8475` far faster than BLE allows.

It is implemented in full (`mobile/src/sync/wifi.ts`), and **turned off.** Two
real ordering bugs were found and fixed — opening the socket before requesting
the file, and joining before the radio had finished coming up — and a real
device still would not complete a transfer end to end. BLE moves a 3 MB
recording in ~90 s and never fails, so the fast path was disabled rather than
shipped broken.

It costs something even when it works: joining the pendant's AP takes the phone
off its own network, so uploads only resume after the session closes.

**We need the firmware team to help us close this out.** See §4 of the
requirements document.

---

## 3. Known constraints of the current hardware

Confirmed by probing firmware V1.2, not inferred:

* **Audio is fixed** at MP3 16 kHz mono 32 kbps. No control over sample rate,
  bitrate, or microphone gain.
* **No noise reduction, no AEC, single microphone.** Everything is far-field and
  quiet; the cloud does all the work.
* **Voice activation cannot be configured or read.** It triggers on any noise.
* **The LED cannot be driven.** 21 candidate commands, all refused.
* **The recording mode (CALL / CON) can be read but never set.**
* **The device cannot join a WiFi network** — only host its own. No station
  mode, no scan, no IP reporting.
* **It cannot arm itself at power-on.**
* **File transfer and live audio share one BLE characteristic**, so the two
  cannot run at once.
* **Commands sent back to back are silently dropped.**

---

## 4. Documents in this handoff

| File | Contents |
|---|---|
| `01-product-features.md` | This document |
| `02-communication-protocol.md` | The full app ↔ hardware protocol, verified against firmware V1.2 |
| `03-firmware-requirements.md` | What we need the next revision to do, with proposed protocol extensions |
| `Lyzn-AI-<version>.apk` | Installable Android build, `com.lyzn.flutter` |
| `docs/mr20-reference.html` | Our earlier standalone protocol reference (same findings, different format) |
| `tools/*.py` | The discovery scripts behind every claim in these documents |
