# App ↔ Pendant Communication Protocol

**Device:** MR20 AI pendant (BLE name `YLF20_<mac suffix>`)
**Verified against:** MCU firmware **V1.2**, WiFi firmware **V0001**
**Source of truth:** direct testing against hardware over BLE and USB, not the
manufacturer's spreadsheet — the two disagree (see §1.2).
**Reference implementation:** `mobile/src/ble/protocol.ts`, `mobile/src/ble/client.ts`,
`mobile/src/sync/wifi.ts` in this repository.

---

## 1. Transport

### 1.1 GATT layout

One vendor service carries everything. The device **does not advertise this
service UUID** — scanning by service finds nothing. It advertises only its
local name, `YLF20_<last 6 hex of MAC>`, and reveals the service after connect.

| Role | UUID | Direction | Properties |
|---|---|---|---|
| Primary service | `001120a0-2233-4455-6677-88995a5b5c5d` | — | — |
| Audio & bulk data | `001120a1-2233-4455-6677-88995a5b5c5d` | device → app | notify |
| Commands | `001120a2-2233-4455-6677-88995a5b5c5d` | app → device | write / write-no-response |
| Replies & events | `001120a3-2233-4455-6677-88995a5b5c5d` | device → app | notify |

The unit also exposes a standard Battery Service and four undocumented vendor
services, including two write/notify pairs under `e49a…` that appear to be
firmware-update channels.

Both notify characteristics must be subscribed before any command is sent.
Replies routinely arrive **before** the app finishes registering a waiter, so
the client buffers unmatched messages rather than discarding them.

### 1.2 Dialect: the spec does not match the firmware

The manufacturer's document (`MR20通信协议20260702.xlsx`) writes every command as
`XS_BLE&…` and every reply as `XS_DEV&…`. Firmware V1.2 **rejects** that form.

| Sent | Reply | Result |
|---|---|---|
| `XS_BLE&FW` | `DEV&UNKNOWN` | as documented — rejected |
| `BLE&FW` | `DEV&FW&V1.2` | **correct** |
| `FW` | `DEV&UNKNOWN` | the prefix is required |

Because other units may ship the documented dialect, the app probes on connect:
it writes `BLE&FW`, and if no `DEV&…` reply arrives within 3 s it retries as
`XS_BLE&FW` and adopts whichever prefix answers. Everything in this document is
written in the shipped V1.2 form.

> **Request to the firmware team:** pick one dialect and state it in the version
> string. If `BLE&`/`DEV&` is final, please update the spreadsheet.

### 1.3 Message framing

* **Encoding:** ASCII, no length prefix, no checksum.
* **Separator:** `&`.
* **Padding:** the device NUL-pads short replies and sometimes appends a
  trailing space. The app strips `\0` and trims before parsing.
* **Field indices:** index 0 is the `DEV` tag, index 1 the verb, index 2 onward
  the payload. `DEV&SPA&007655&007661` → `[DEV, SPA, 007655, 007661]`.
* **Truncation:** the device does send short replies. A parser must return
  "absent" rather than throw on a missing field.
* **Unknown verb:** answered with `DEV&UNKNOWN`.
* **Numbers:** some are zero-padded (`007655`, `002`), some are not. Parse
  numerically, never by string length.

### 1.4 Link parameters and throughput

| Property | Value | Note |
|---|---|---|
| MTU | 517 requested on connect | Android defaults to 23 and must ask. iOS negotiates itself and rejects the call. |
| Notifications | one packet per connection interval | This, not the MTU, is what caps throughput. |
| Measured BLE rate | **~35 kB/s** at Android's balanced (~50 ms) interval | A 2.5 MB recording ≈ 60 s. |
| Fast link | Android `CONNECTION_PRIORITY_HIGH` → ~11–15 ms interval | Several times the byte rate. iOS gives no control; the peripheral's preferred parameters decide. |

> **Request:** the peripheral's preferred connection parameters currently bias
> toward power saving. On iOS the app cannot override them, so the pendant's own
> preference is the ceiling. Please expose a way to request a fast interval for
> the duration of a transfer, or advertise tighter preferred parameters.

### 1.5 Command pacing — mandatory

This firmware **silently drops commands that arrive too close together**. There
is no error; the command simply produces no reply.

| Situation | Minimum gap enforced by the app |
|---|---|
| Consecutive control commands (telemetry sweep) | **120 ms** |
| Consecutive file transfer requests (`U&` / `W&`) | **2000 ms** |
| OTA data frames | 8 ms (20 ms on iOS) |

Without the 2 s gap between transfers, four of eight files failed in testing.
With it, zero failed.

---

## 2. Command reference

Every command below is written to `…20a2` as `BLE&<verb>`; every reply notifies
on `…20a3` as `DEV&<verb>&…`.

### 2.1 Read-only state

| Command | Reply | Returns |
|---|---|---|
| `BLE&STE` | `DEV&STE&1` | Recording now? `1` or `0` |
| `BLE&BAT` | `DEV&BAT&98` | Battery percentage |
| `BLE&SPACE` | `DEV&SPA&007655&007661` | Free MB, total MB (zero-padded) |
| `BLE&FW` | `DEV&FW&V1.2` | MCU firmware version |
| `BLE&WF` | `DEV&WF&V0001` | WiFi coprocessor firmware version |
| `BLE&MAC` | `DEV&MAC&50c0f013d830` | Bluetooth MAC; matches the advertised name suffix |
| `BLE&GT` | `DEV&CT&20260819182902` | Device clock, `YYYYMMDDHHMMSS`. **Note the reply verb is `CT`, not `GT`.** |
| `BLE&WIFIS` | `DEV&WIFIS&0` | WiFi state, `0`–`7` (§4.1) |
| `BLE&GET&USB` | `DEV&USB&1` | Is USB mass-storage access enabled |
| `BLE&REC&SECEN` | `DEV&REC&CALL` | Recording mode: `CALL` or `CON`. **Getter only** — see §5 |

**`STE` must not be treated as a boolean.** A missing reply means "the device
did not answer", which is *not* the same as "not recording". Collapsing the two
is what made the app's recording toggle appear inverted: a dropped reply forced
the switch off while the pendant was still recording.

### 2.2 Recording

| Command | Reply | Meaning |
|---|---|---|
| `BLE&STA` | `DEV&STA&<filename>` | Begin recording; the device returns the filename it chose |
| `BLE&STO` | `DEV&STO` | Stop and save |
| `BLE&T&<YYYYMMDDHHMMSS>` | `DEV&T&OK` | Set the device clock |

Recording **survives BLE disconnect** — confirmed by reading `DEV&STE&1` on a
fresh connection after dropping the link. A host only needs to connect long
enough to start it.

The device has no RTC backup battery and drifts, and the clock is what names
every recording. The app sets it on every connect.

### 2.3 Files

| Command | Reply | Meaning |
|---|---|---|
| `BLE&LIST_DIRS` | `DEV&DIRS&<name>` × N, then `DEV&DIRS_SUM&002` | One message per date folder, then the count |
| `BLE&LIST&<dir>` | `DEV&F&<dir>&<file>&<secs>&<bytes>` × N, then `DEV&LIST&001` | One per recording, then the count |
| `BLE&U&<dir>&<file>` | `DEV&U&<len>`, then data on `…20a1`, ending `DEV&OFF` | Download over BLE |
| `BLE&W&<dir>&<file>[&<offset>]` | `DEV&W&<len>` | Download over the WiFi socket (§4) |
| `BLE&SHUT` | `DEV&SHUT` | Abort an in-flight transfer, BLE or WiFi |
| `BLE&D&<dir>&<file>` | `DEV&D` | **Delete a recording** |

Parsing notes that cost real time:

* `DIRS_SUM` starts with `DIRS`. A prefix match on the item verb will swallow
  the terminator and hang the collector. Check the end tag **first**.
* `DEV&D` must be matched **exactly** (or as `DEV&D&…`). A `startsWith` treats a
  stale `DEV&DIRS` folder listing as a delete confirmation.
* **File names over BLE carry no `.mp3` extension**, though the same files show
  one over USB mass storage.
* macOS writes AppleDouble sidecars (`._name`) onto the FAT32 volume when the
  pendant is mounted over USB. They appear in `LIST&` but the device cannot open
  them, so a transfer request for one always fails. Filter names starting `._`
  and zero-byte entries.

### 2.4 Hardware control

| Command | Reply | Meaning |
|---|---|---|
| `BLE&SHAKE` | *(silent)* | Buzz the haptic motor. Confirmed working; sends no reply |
| `BLE&SK&<16-char key>` | `DEV&SK&OK` | Bind with a pairing key. **Our unit accepted every command unpaired** |

### 2.5 Destructive — the app refuses these by default

The client carries a blocklist checked **before the write reaches the wire**.
Each has exactly one audited call path, or none.

| Command | Effect | App policy |
|---|---|---|
| `BLE&BLE&RESET` | Unpair **and format storage** — every recording destroyed | One audited path, behind a double confirmation in the device screen |
| `BLE&BLE&OFF` | Drop the link and clear the pairing key (recordings survive) | Never sent |
| `BLE&D&<dir>&<file>` | Delete one recording | One audited path: files the backend has confirmed it holds, or files judged silent |
| `BLE&OTA&<len>` | Put the MCU into firmware-write mode | Never sent |
| `BLE&WIFI&OTA` | Put the WiFi coprocessor into firmware-write mode | Never sent |
| `BLE&OT&OVER` | Commit a firmware write | Never sent |
| `BLE&WIFI&CH` | Change the device's WiFi credentials | Never sent |
| `BLE&STATUS` | **Undocumented. Silently stops an in-progress recording** and answers `DEV&STO` | Never sent |

> `BLE&RESET` formats the device and sits **one character** from `BLE&OFF`,
> which does not. `BLE&STATUS` reads like a status query and is not.
> **Request:** please rename or gate these. Probing an unknown command space on
> this firmware is not side-effect free.

### 2.6 Unsolicited events

The device pushes state it changed on its own, on `…20a3`, with no request
behind it. An app that only reads replies to its own commands will show stale
state the moment the user touches the button.

| Event | Meaning |
|---|---|
| `DEV&STA&<filename>` | Recording started by the device (button press, or voice activation) |
| `DEV&STO` | Recording stopped by the device |
| `DEV&RT&<file>&<secs>` | Recording in progress, with elapsed seconds |
| `DEV&DISK&ERR` | Storage full; the device cannot record until files are freed |

Not every firmware build emits these reliably, so the app also polls `STE` on a
timer while the link is idle as a fallback.

---

## 3. File transfer over BLE

```
app  → BLE&U&<dir>&<file>
dev  → DEV&U&<len>                      declared length in bytes
dev  → [binary]  on characteristic …20a1   (many notifications)
dev  → DEV&OFF                          end of transfer
```

Rules learned the hard way:

1. **File data and the live audio stream share characteristic `…20a1`.**
   Downloading while the device is recording interleaves the two. Our first sync
   run produced files 8–20 kB **larger** than their declared size — structurally
   valid MP3, containing audio that was never part of that recording. The app
   now stops recording before any transfer and restarts it after. With recording
   stopped, every transfer was byte-exact (8 files, 5.5 MB, verified by md5
   against an independently captured copy).
2. `DEV&OFF` marks the end of a transfer **that finished short**. A normal
   transfer is complete when the declared byte count has arrived; do not wait
   for `DEV&OFF` as the only completion signal.
3. Anything received past the declared length is another stream bleeding in and
   must be trimmed.
4. Leave **2 s** between consecutive `U&` requests.
5. A live capture (as opposed to a file download) almost always begins partway
   through an MP3 frame, because the device streams continuously. Players reject
   the result until the leading fragment is trimmed to the first frame sync
   (`FF Ex`). File downloads start clean and need no alignment.

**Audio format:** MP3, 16 kHz, mono, 32 kbps, hardware-encoded. Fixed — see §5.

---

## 4. File transfer over WiFi

The pendant hosts an access point. The phone joins it, the file is requested
**over BLE**, and the bytes arrive on a TCP socket.

```
app  → BLE&WIFIO                        raise the access point
dev  → DEV&WIFIO                        accepted — NOT yet broadcasting
app  → BLE&WIFIS   (poll)               wait for state 1 or 2
dev  → DEV&WIFIS&2
app  → BLE&WIFI                         read credentials
dev  → DEV&WIFI&<ssid>&<password>
     … phone joins the SSID, waits ~1.2 s for the route to settle …
app  → BLE&W&<dir>&<file>[&<have>]      ASK FIRST
dev  → DEV&W&<len>
     … phone connects TCP 192.168.200.1:8475 …
dev  → [binary] … then the 5-byte end marker
app  → BLE&WIFIC                        stop the access point, leave the SSID
```

| Property | Value |
|---|---|
| Socket | `192.168.200.1:8475`, TCP |
| End marker | `BA 5A 02 8F 04` — **not part of the file**, strip it |
| Resume | `BLE&W&<dir>&<file>&<bytes already held>` |
| Abort | `BLE&SHUT` — otherwise the device keeps the socket open |

### 4.1 Access point state machine (`DEV&WIFIS&n`)

| Value | Meaning |
|---|---|
| `0` | off |
| `1` | connected |
| `2` | on, no client |
| `3` | starting |
| `4` | changing password |
| `5` | OTA |
| `6` | password changed, resetting |
| `7` | auto-closed |

### 4.2 Timing — the AP closes itself

* **30 s** with no client → closed.
* **5 s** after the client leaves → closed.
* **Immediately** when BLE disconnects → closed. **The BLE link must be held for
  the entire transfer.**

The app budgets 28 s for the whole join, of which the "wait for the radio" phase
gets at most 8 s and the join itself gets at least 10 s.

### 4.3 Two ordering bugs, for anyone reimplementing this

1. **`WIFIO` is acknowledged when the command is accepted, not when the radio is
   up.** The state machine has a distinct `3` = "starting" for exactly that gap.
   Joining during it fails, and iOS reports only "Unable to connect to `<ssid>`"
   — indistinguishable from a wrong passphrase. Poll `WIFIS` until `1` or `2`.
2. **Request the file before opening the socket.** The device opens its listener
   *in response to* `W&`. A socket opened first knocks on a port that does not
   exist yet and waits out its timeout with no error to explain it.

### 4.4 Current status in the app: disabled

WiFi transfer is implemented, correct as far as we can determine, and **turned
off** (`WIFI_TRANSFER_ENABLED = false` in `mobile/src/sync/wifi.ts`). Both
ordering bugs above are fixed, yet a real device still would not complete a
transfer end to end, and BLE moves a 3 MB recording in ~90 s without ever
failing. Diagnosing the remainder needs the firmware team.

**This is the single highest-value thing the hardware team can help us fix.**
See `03-firmware-requirements.md` §4.

---

## 5. Confirmed limits of firmware V1.2

Everything here was probed against hardware, not inferred from the absence of a
documented command.

| Capability | Evidence | Status |
|---|---|---|
| LED control | 21 candidate spellings, all `DEV&UNKNOWN` | **absent** |
| Set recording mode | No setter exists; the getter ignores extra arguments. `REC&SECEN&CON` echoes the *current* mode | **absent** |
| Microphone gain | Every probe returned `DEV&UNKNOWN` | **absent** |
| Audio bitrate / sample rate | Fixed at 16 kHz mono 32 kbps | **absent** |
| Voice-activation tuning | Every probe returned `DEV&UNKNOWN` | **absent** |
| Arm at power-on | Boot behaviour is fixed | **absent** |
| WiFi station mode (join our network) | `WIFI&STA`, `WIFI&SCAN`, `WIFI&JOIN`, `WIFI&IP` and 20 more all `DEV&UNKNOWN` | **absent** |
| Read raw flash / dump firmware | No path found | **absent** |

Confirmed **working**: telemetry, start/stop recording, haptics, clock set,
folder and file listing, byte-exact download, live audio stream (79,872 bytes in
20 s → 19.9 s of playable MP3), recording surviving disconnect, delete, factory
reset, WiFi AP raise/lower and credential read.

---

## 6. OTA firmware update (documented, untested)

We have never run this — we have no image the bootloader would accept.

| Step | Message | Detail |
|---|---|---|
| 1. Announce | `BLE&OTA&<len>` | Image size as **exactly six digits** |
| 2. Device ready | `DEV&OTA` | Send nothing else until finished, or it fails |
| 3. Stream | — | **244-byte frames, ≥8 ms apart; 20 ms on iOS** |
| 4. Commit | `BLE&OT&OVER` | `DEV&OT&OVER` on success, `DEV&OT&ERR` on refusal |

A second route exists: **ADFU**, the recovery bootloader in the Actions SoC ROM,
exposed at USB `10d6:10d6`, usually entered by holding a button while connecting
power. It rewrites flash wholesale, bypassing whatever validation OTA enforces.
We have not confirmed this pendant enters it.

**What we need to use either path:** the board support package for the exact
part, the image packaging format, and the pin mapping for microphone, button,
LED and haptic. The stock build is **Zephyr RTOS** — the mass-storage identity
strings (`ZEPHYR`, `ZEPHYR USB DISK`, product string `MSC Sample`, which is the
name of Zephyr's stock mass-storage sample) say so outright. That means custom
firmware is a Zephyr application against an Actions board port, not a
from-scratch effort.

---

## 7. Hardware identification

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
| Measured BLE throughput | ~35 kB/s |

---

## 8. Reference client

A complete, tested implementation of everything above:

| File | What it holds |
|---|---|
| `mobile/src/ble/protocol.ts` | Constants, framing, parsing — transport-free and unit tested |
| `mobile/src/ble/client.ts` | The protocol over `react-native-ble-plx` |
| `mobile/src/ble/manager.ts` | Permissions, scanning, connect and reconnect |
| `mobile/src/sync/wifi.ts` | The WiFi AP session and TCP pull |
| `mobile/src/sync/engine.ts` | A full sync pass, in order, with the reasons |
| `mobile/tests/protocol.test.ts` | Parsing, framing, MP3 alignment, safety gate |
| `tools/*.py` | The discovery scripts: `modes.py`, `vadwatch.py`, `buttonmap.py`, `ledprobe.py`, `wifistaprobe.py` |

The Python client (`mr20.py`) and sync daemon (`mr20sync.py`) that the app was
ported from are also in this repository. Both suites run without a device: the
TypeScript one is 42 checks covering framing, parsing, MP3 alignment, the speech
gate and the safety blocklist, and all 42 pass as of this handoff.
