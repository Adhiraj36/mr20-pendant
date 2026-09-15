# Firmware & Hardware Requirements for the Next Revision

**From:** Lyzn AI app/backend team
**Re:** MR20 pendant — what the current firmware (V1.2) cannot do, and what we
need the next revision to do instead.

Everything below is stated as a requirement plus a **proposed protocol
extension** written in the existing `BLE&…` / `DEV&…` dialect, so it drops into
the current command set without a redesign. Where we have measured numbers, they
are in the text. Where a claim is "the firmware does not support this", it was
established by probing the device, not by reading the spec — the probe scripts
are in `tools/` and named in each section.

Priorities, highest first:

| # | Requirement | Why it is worth silicon |
|---|---|---|
| **1** | On-device **VAD** | Most of what the pendant records is nothing. Every second of that costs storage, BLE time, phone battery and cloud money. |
| **2** | On-device **noise cancellation** | The live path has no cleaning at all, and the batch path spends real CPU on it. Both are far-field mono today. |
| **3** | **Low-latency live stream** | Live transcription is a headline feature and the current audio path fights it. |
| **4** | **WiFi that works** — and ideally **station mode** | BLE at 35 kB/s is the ceiling on everything. Station mode removes the phone from the loop entirely. |
| **5** | **Controllable indicators & modes** | The user cannot tell what the device is doing, and we cannot change it. |
| **6** | **Real pairing security** | Our unit accepted every command from an unpaired central. |

---

## 1. On-device Voice Activity Detection

### 1.1 The problem

The pendant advertises "Voice Activation: Supported". In practice it triggers on
**any noise** — a door, a fan, traffic — and cannot be read, tuned or disabled
over the protocol (`tools/vadwatch.py`, `tools/modes.py`; every probe for a VAD
setting returned `DEV&UNKNOWN`).

The consequence is that we built a second VAD on the phone
(`mobile/src/sync/vad.ts`) and a third in the cloud, and the phone one still has
to pay the full cost of transferring the file before it can judge it:

* ~60 s of BLE time per 2.5 MB file, most of it for silence
* phone radio and CPU for a file that is then deleted
* storage on a 7.6 GB volume filled with nothing

### 1.2 What we need

A **real speech VAD**, not an energy gate — DSP or a small neural model, run on
the captured stream before the encoder.

| Property | Requirement |
|---|---|
| Discrimination | Speech vs. non-speech noise at conversational distance (1–3 m), in a room with HVAC / traffic / music |
| False-accept target | < 5 % of non-speech minutes should open a recording |
| False-reject target | < 1 % of speech onsets missed |
| **Pre-roll buffer** | **≥ 500 ms of audio captured *before* the trigger must be included in the file.** Without it the first word of every conversation is lost — this is non-negotiable, and it is what makes a VAD usable rather than annoying |
| Hangover | Configurable, default ~2 s, so a natural pause does not split one conversation into six files |
| Minimum file length | Configurable; discard anything shorter than the threshold rather than writing a 1 s file |
| Sensitivity | At least 3 levels (low / medium / high), settable and readable over BLE |
| Disable | The user must be able to turn it off and record continuously |

### 1.3 Proposed protocol

```
BLE&VAD                     ->  DEV&VAD&<on|off>&<level>&<hangover_ms>&<preroll_ms>&<min_ms>
BLE&VAD&SET&<on|off>&<level>&<hangover_ms>&<preroll_ms>&<min_ms>
                            ->  DEV&VAD&OK   |  DEV&VAD&ERR&<reason>
BLE&VAD&LIVE                ->  DEV&VAD&LIVE&<0|1>     current instantaneous decision
```

Plus an **unsolicited event** so the app can show a live indicator and drive the
live-transcript UI without polling:

```
DEV&VAD&<0|1>&<rms_dbfs>    pushed on every transition, rate-limited to ~4 Hz
```

We already consume `DEV&STA&<file>` and `DEV&STO`; a VAD event fits the same
handler.

---

## 2. On-device noise cancellation

### 2.1 The problem

The pendant has a single microphone, no AEC, no beamforming, no noise
suppression, and no gain control we can reach. Its output is far-field, quiet
and noisy — measurably so: our cloud pipeline has to peak-normalise before it
can even detect silence reliably, because a quiet far-field recording sits
entirely under the silence threshold and would otherwise be archived as "no
speech".

We therefore run **DeepFilterNet3** on every recording in the cloud. That works,
and it costs us:

* Real CPU per recording, on every recording, forever.
* Tuning we should not have to do. Its own default attenuation (100 dB) thinned
  speech into an "underwater" artifact; 35 dB still stripped fricatives, because
  s/sh/f/th are broadband and noise-shaped and are exactly what a denoiser takes
  first. We settled at 20 dB plus a 4 dB presence shelf at 3–7 kHz to put the
  consonants back. There is very little above 6 kHz to work with in the first
  place, because the source is 16 kHz at 32 kbps.
* **It does nothing for live transcription.** The live path streams the pendant's
  MP3 straight to the recogniser. The cleaning happens in the batch pipeline
  only. So the single most latency-sensitive feature in the product gets the
  rawest possible audio.

### 2.2 What we need

| Property | Requirement |
|---|---|
| Microphones | **≥ 2 MEMS mics** with a known, documented spacing, so beamforming is possible. 3 preferred |
| Mic SNR | ≥ 64 dBA |
| Noise suppression | ≥ 15 dB on stationary noise, in the DSP, before the encoder |
| Wind noise | Explicit wind/handling-noise reduction — this is a **worn** device, it rubs on clothing constantly |
| Beamforming | Fixed or adaptive, oriented away from the wearer's chest |
| AGC | Target-level AGC so near and far speakers land at one level. We currently do this in the cloud with dynamic levelling and loudness normalisation |
| AEC | Only if the device gains a speaker; not required otherwise |
| Preserve consonants | Whatever NS is used, cap its attenuation. We learned this the expensive way — over-suppression is worse than noise for ASR accuracy |
| Bypass | A raw/unprocessed mode we can switch to for evaluation |

### 2.3 Proposed protocol

```
BLE&NS                      ->  DEV&NS&<off|low|mid|high>&<agc_on|off>&<wind_on|off>
BLE&NS&SET&<level>&<agc>&<wind>
                            ->  DEV&NS&OK  |  DEV&NS&ERR&<reason>
BLE&MIC                     ->  DEV&MIC&<gain_db>&<count>
BLE&MIC&SET&<gain_db>       ->  DEV&MIC&OK
```

### 2.4 Audio format — please make it configurable

MP3 at 16 kHz / 32 kbps is a poor choice for a speech product and it is welded
in. Requests, in order of value:

1. **Make sample rate and bitrate settable over BLE.** 16 kHz is the floor for
   ASR; 24 kHz would measurably improve both transcription and playback.
2. **Offer Opus.** Opus at 24 kbps is better than MP3 at 32 kbps for speech, and
   it is what every streaming ASR wants. It also has a **20 ms frame** against
   MP3's 72 ms at 16 kHz, which matters enormously for §3.
3. **Offer raw PCM** on the live channel, even if files stay compressed.

```
BLE&FMT                     ->  DEV&FMT&<mp3|opus|pcm>&<rate>&<kbps>
BLE&FMT&SET&<codec>&<rate>&<kbps>   ->  DEV&FMT&OK | DEV&FMT&ERR
```

---

## 3. Live transcription — a low-latency audio path

### 3.1 The problem

Live transcript is a shipped feature: the app taps the pendant's BLE audio
stream and relays the bytes untouched to a Go service that forwards them to
Deepgram. It works. Its latency is set by things only firmware can change:

* **One notification per connection interval.** At Android's balanced ~50 ms
  that is ~35 kB/s and a fixed floor under every chunk's age. iOS gives the app
  **no control at all** over connection parameters — the peripheral's preferred
  values decide, and the pendant's are conservative.
* **MP3 framing.** At 16 kHz an MP3 frame is 1152 samples = **72 ms**, plus
  encoder lookahead. Nothing can arrive sooner than that.
* **Live audio and file transfer share characteristic `…20a1`.** They cannot run
  at once. Downloading during a recording interleaves the two into a corrupt
  file — we shipped that bug and had to stop recording before every sync to
  avoid it. So a user watching a live transcript blocks all syncing, and vice versa.

### 3.2 What we need

| # | Requirement |
|---|---|
| 3.2.1 | **A separate characteristic for the live stream, distinct from bulk file transfer**, so a download and a live stream can run concurrently without corrupting either |
| 3.2.2 | **Advertise tight preferred connection parameters** (7.5–15 ms interval) or expose a command to request them for the duration of a stream. This is the only lever that exists on iOS |
| 3.2.3 | **Opus or PCM on the live channel** (§2.4) — 20 ms frames instead of 72 ms |
| 3.2.4 | **A stream that does not require recording to disk.** Today audio only streams while the device is recording a file. Let us stream without writing, for a live view that does not fill storage |
| 3.2.5 | **Post-NS audio on the live channel** (§2) — this is the feature that most needs clean input and currently gets the least |
| 3.2.6 | Sequence numbers or timestamps per chunk, so the app can detect and report a gap instead of silently transcribing a discontinuity |

### 3.3 Proposed protocol

```
BLE&STREAM&ON               ->  DEV&STREAM&ON        begin live audio, no file written
BLE&STREAM&OFF              ->  DEV&STREAM&OFF
BLE&FAST&ON                 ->  DEV&FAST&ON          request a 7.5-15 ms connection interval
BLE&FAST&OFF                ->  DEV&FAST&OFF
```

New characteristic, alongside the existing three:

| Role | Proposed UUID | Direction |
|---|---|---|
| Live audio (separate from bulk) | `001120a4-2233-4455-6677-88995a5b5c5d` | notify → app |

### 3.4 The bigger ask

If the device gains WiFi station mode (§4.3), the best live path is **no phone
at all**: the pendant opens a WebSocket to our endpoint and streams directly.
That removes BLE from the critical path, removes the phone's battery cost, and
works when the phone is in a pocket or absent. We would supply the endpoint and
a per-device token.

---

## 4. WiFi

### 4.1 Fix the access-point transfer path — highest immediate value

The AP path is implemented in our app, in full, and **disabled** because a real
device would not complete a transfer. We found and fixed two ordering bugs of
our own on the way, so we are reasonably confident the remaining problem is not
in our code:

* `WIFIO` is acknowledged when the **command is accepted**, not when the radio
  is broadcasting — state `3` ("starting") is the gap. We now poll `WIFIS` until
  `1` or `2` before joining.
* The device only opens its TCP listener **in response to `W&`**. We now request
  the file first and connect second, which is also how the vendor's own tooling
  behaves.

With both fixed, on real hardware, transfers still did not complete.

**What we need from you:**

1. Confirm the exact expected sequence, including whether `W&` must be sent
   before or after the TCP connect, and what the device does if the order is wrong.
2. Confirm the AP timeouts. Our reading of the sheet is: closes after **30 s**
   with no client, **5 s** after a client leaves, and **immediately** on BLE
   disconnect. Is that right, and are they configurable?
3. Confirm the end marker `BA 5A 02 8F 04` and whether the declared length in
   `DEV&W&<len>` includes it. (We strip it and verify the remainder matches.)
4. Confirm resume semantics for `BLE&W&<dir>&<file>&<offset>`.
5. Tell us what a failing transfer looks like from the device side — is there any
   error reply at all? Today it is indistinguishable from silence.
6. A packet capture or debug log from a known-good transfer would settle this in
   an afternoon.

### 4.2 Make the AP path fast enough to be worth it

If the AP is going to take the phone off its own network — which it does, and
which stalls all uploads for the duration — it must be **substantially** faster
than 35 kB/s to be worth the disruption. We would want ≥ 1 MB/s.
Below about 300 kB/s the fast path is not worth having and we would rather you
spent the silicon on §1 and §2.

### 4.3 WiFi station mode — the one that changes the product

The device can only **host** a network. It cannot join one. We probed for it
specifically (`tools/wifistaprobe.py`): `WIFI&STA`, `WIFISTA`, `WIFI&MODE`,
`WIFI&SCAN`, `WIFI&JOIN`, `WIFI&IP`, `WIFI&CONN` and ~20 more spellings — every
one answered `DEV&UNKNOWN`.

Station mode would let the pendant upload its own recordings over the user's
WiFi while it charges overnight, with no phone involved. That removes:

* the BLE transfer entirely
* the phone's battery cost for syncing
* the "my recordings did not appear because my phone was in another room" class
  of support ticket
* the whole AP-join disruption

**Proposed protocol:**

```
BLE&WIFI&SCAN               ->  DEV&WIFI&AP&<ssid>&<rssi>&<sec> ... DEV&WIFI&SCAN&<count>
BLE&WIFI&JOIN&<ssid>&<pwd>  ->  DEV&WIFI&JOIN&OK | DEV&WIFI&JOIN&ERR&<reason>
BLE&WIFI&STA                ->  DEV&WIFI&STA&<state>&<ssid>&<ip>&<rssi>
BLE&WIFI&FORGET&<ssid>      ->  DEV&WIFI&FORGET&OK
```

Credentials would be handed over via BLE after the user picks a network in the
app (or scans a QR code). If station mode exists, we would prefer it over the
access point as the primary path, with the AP kept as fallback.

**Upload-direct (the full version):** if the device can also make an outbound
HTTPS/WebSocket connection, we will supply an endpoint and a per-device bearer
token over BLE, and the pendant can `POST` finished recordings itself.

```
BLE&UP&SET&<url>&<token>    ->  DEV&UP&OK
BLE&UP&NOW                  ->  DEV&UP&<queued_count>
DEV&UP&DONE&<dir>&<file>        unsolicited, per file uploaded
```

---

## 5. Indicators, modes and controls

### 5.1 LED

**We cannot drive the LED.** 21 candidate command spellings, all `DEV&UNKNOWN`
(`tools/ledprobe.py`). The indicator is entirely firmware-driven.

This is a wearable with no screen. The LED is the only thing that tells the
wearer what state it is in, and we cannot use it to say "recording", "full",
"syncing", "battery low", or "paired".

```
BLE&LED                     ->  DEV&LED&<pattern>&<r>&<g>&<b>&<brightness>
BLE&LED&SET&<pattern>&<r>&<g>&<b>&<brightness>   ->  DEV&LED&OK
   patterns: off, solid, slow, fast, pulse, double
BLE&LED&AUTO                ->  DEV&LED&AUTO      hand control back to firmware
```

### 5.2 Recording mode

`BLE&REC&SECEN` reads back `CALL` or `CON`. **There is no setter.** We tested
this specifically (`tools/modes.py`): `REC&SECEN&<mode>`, `REC&<mode>`,
`SET&SECEN&<mode>`, `SECEN&<mode>`, `REC&MODE&<mode>`, `MODE&<mode>`,
`REC&SET&<mode>`, `REC&SECEN&0`, `REC&SECEN&1` — the mode never changed.

Please add `BLE&REC&SET&<CALL|CON>` → `DEV&REC&OK`. And please document what the
two modes actually change; we can hear a difference but have no specification.

### 5.3 Button

Please document the button map — tap, double-tap, long-press — and make it
readable and ideally remappable:

```
BLE&BTN                     ->  DEV&BTN&<tap>&<double>&<long>
BLE&BTN&SET&<tap>&<double>&<long>   ->  DEV&BTN&OK
   actions: none, toggle_record, mark, wifi, shutdown
```

A **"mark this moment"** action would be genuinely valuable: the wearer taps
once, the device writes a timestamp into the file's metadata, and the app can
jump straight to it in the transcript.

### 5.4 Boot behaviour

The device cannot arm itself at power-on. Recording *does* survive a BLE
disconnect, which mitigates it — a host only has to connect long enough to start
it — but a pendant that has been charged overnight comes back idle.

```
BLE&BOOT                    ->  DEV&BOOT&<idle|record|vad>
BLE&BOOT&SET&<mode>         ->  DEV&BOOT&OK
```

---

## 6. Files, metadata and storage

| # | Request | Why |
|---|---|---|
| 6.1 | **Put the `.mp3` extension in the BLE listing.** Names over BLE have no extension; the same files show one over USB. Two representations of one name is a bug factory | Cost us real debugging time |
| 6.2 | **Allow file transfer while recording**, or say clearly that it is forbidden. Today they share one characteristic and interleave into a corrupt file that is still structurally valid MP3 — the worst possible failure mode | We shipped this bug; files came back 8–20 kB over their declared length containing audio from a different recording |
| 6.3 | **Stop dropping back-to-back commands.** We enforce 120 ms between control commands and **2 s** between transfers. Without the 2 s, four of eight transfers failed | A queue in firmware would remove a whole class of app-side workarounds |
| 6.4 | **Per-file metadata**: start timestamp as a real field, duration, VAD confidence, mark points, battery at capture | Today the only timestamp is parsed out of the filename |
| 6.5 | **Ignore/hide AppleDouble sidecars.** macOS writes `._name` files onto the FAT32 volume over USB; they appear in `LIST&` and the device cannot open them, so every transfer request for one fails | Trivial firmware-side filter |
| 6.6 | **A real RTC with backup power.** No RTC battery means the clock drifts, and the clock names every recording. We rewrite it on every connect as a workaround | |
| 6.7 | **An error reply for a failed transfer.** Today a failure is silence | |

---

## 7. Security and pairing

`BLE&SK&<16-char key>` exists and answers `DEV&SK&OK`. **Our unit accepted every
command without ever being paired.**

Anyone within BLE range can currently list, download and **delete** every
recording on a stranger's pendant, and `BLE&BLE&RESET` formats it. For a device
whose entire purpose is recording private conversations, this is the most
serious issue in this document.

| # | Requirement |
|---|---|
| 7.1 | **Enforce the pairing key.** An unbound central gets `DEV&AUTH&ERR` for everything except firmware version and the bind command itself |
| 7.2 | **Use BLE bonding with LE Secure Connections** (numeric comparison or passkey), not a plaintext 16-character key over an unencrypted link |
| 7.3 | **Encrypt the characteristics.** Require an encrypted link for the command and data characteristics |
| 7.4 | **Gate the destructive commands** behind bonding *and* a physical confirmation (button hold), especially `BLE&RESET` |
| 7.5 | **Rename the dangerous commands.** `BLE&RESET` formats the device and is one character from `BLE&OFF`, which does not. `BLE&STATUS` reads like a status query and silently **stops recording** instead. We maintain a hard-coded blocklist in the app because of this |
| 7.6 | **At-rest encryption** for the audio on the FAT32 volume would be a genuine differentiator. Today anyone with a USB cable reads everything |

---

## 8. Things that would be nice, in rough value order

* **Speaker/haptic feedback for state changes** — a distinct buzz for "started",
  "stopped", "full". `BLE&SHAKE` works and is the only feedback channel we have.
* **Battery in mV as well as percent**, plus charging state and cycle count.
  `DEV&BAT&98` is all we get, and percentage estimates on cheap fuel gauges lie.
* **Temperature** — the device is worn against a body and we have no telemetry.
* **A debug/log channel** — `BLE&LOG&ON` streaming firmware log lines would have
  saved us weeks. Every failure we have chased has been silent.
* **Sequence numbers on bulk data**, so a dropped notification is detectable
  rather than showing up as a corrupt file.
* **A documented, gated way into ADFU**, and the board support package. The stock
  build is Zephyr (`ZEPHYR USB DISK`, product string `MSC Sample`, USB
  `10D6:B00B`), so custom firmware would be a Zephyr application against an
  Actions board port. We need the BSP for the exact part, the image packaging
  format, and the pin map for microphone, button, LED and haptic.

---

## 9. What we can offer you

* Our full protocol implementation in TypeScript and Python, tested against real
  hardware, with a device-free test suite on both sides (42 TypeScript checks
  passing as of this handoff).
* The discovery scripts in `tools/` — the probes behind every "absent" claim here.
* Test devices, packet captures, and log traces from any failing case.
* We will implement and ship app support for any of the above within days of a
  firmware build we can test against.

The fastest way to unblock the most work: a firmware build with **§1 (VAD)**,
**§3.2.1 (a separate live characteristic)** and an answer on **§4.1 (why WiFi
transfers do not complete)**.
