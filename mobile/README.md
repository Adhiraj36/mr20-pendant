# Pendant app

React Native (Expo SDK 57) client for the MR20 pendant.

## You cannot run this in Expo Go

It talks to a BLE peripheral, which needs native modules Expo Go does not
contain. You install a **development client** once — a shell holding the native
modules — and it loads the JS from Metro like Expo Go does. Day-to-day work is
then the normal reload loop; the client only needs rebuilding when a native
dependency or `app.json` changes.

### Android

`../build-apk.sh` builds it on the Linux box and drops `pendant-dev.apk` in the
repo root:

```bash
export SSHPASS='...'          # build host password
../build-apk.sh               # or --clean to regenerate android/
adb install -r ../pendant-dev.apk
```

### iOS

Needs Xcode locally, or EAS for a device build without it:

```bash
npx expo run:ios
# or
npx eas build --profile development --platform ios
```

On the simulator, read [`docs/local-dev-client.md`](docs/local-dev-client.md)
first — the dev-server deep link is keyed to the Expo *slug*, so any older
build of this app still installed will intercept it and fail in a way that
looks like a bundling error.

### Then, every session

```bash
npx expo start --dev-client
```

Scan the QR code with the **dev client app itself** (not the Expo Go app, and
not the system camera). Your phone has to be on the same network as the machine
running Metro.

A simulator is no use for the BLE parts — it has no Bluetooth radio. Pairing,
syncing and device control all need a real phone with the pendant nearby.

## Layout

```
app/                      expo-router screens
  onboarding/             welcome → sign-in → pair → ready
  (tabs)/                 library, search, pendant
  recording/[id].tsx      player, diarized transcript, summary, speakers
src/
  ble/protocol.ts         constants and pure functions, ported from mr20.py
  ble/client.ts           the protocol over react-native-ble-plx
  ble/manager.ts          permissions, scanning, connect/reconnect
  sync/library.ts         local audio cache + manifest
  sync/engine.ts          pendant → phone → S3
  api/                    the typed backend client (Clerk owns auth)
  state/store.ts          zustand: auth, link, sync, library
tests/                    protocol tests, no device needed
```

## The BLE layer

`src/ble/protocol.ts` is a direct port of the Python client in the repo root and
carries the same hard-won details:

- **Dialect detection.** The manufacturer's spec says `XS_BLE&…`; firmware V1.2
  answers `BLE&…` and rejects the documented form. The client probes on connect
  and adopts whichever answers.
- **Recording is paused during sync.** File transfers and the live audio stream
  share one notify characteristic. Downloading while recording interleaves them
  into a file that is longer than declared and contains audio that was never
  part of the recording.
- **Two seconds between transfers.** The device drops transfer requests that
  arrive back to back — this turned four failures out of eight into zero.
- **Over-reads are trimmed.** Anything past the declared length is another
  stream bleeding in.
- **Captures are aligned to an MP3 frame sync.** The device streams
  continuously, so a live capture starts mid-frame and players reject it.
- **Dangerous commands cannot be sent.** `BLE&RESET` formats the device and sits
  one character from `BLE&OFF`, which does not. Unlike the Python CLI there is
  no override flag, because the app has no legitimate use for any of them.
  `BLE&STATUS` is refused too: undocumented, and it silently stops recording.

```bash
npm test    # 24 checks, no device or native module required
```

## How a sync pass runs

1. List folders and files over BLE
2. Skip anything the local manifest already holds at the right size
3. Stop any in-progress recording
4. Pull each file, two seconds apart, ~35 kB/s
5. Restart recording
6. Register each file with the backend and PUT it to S3

Step 6 needs no BLE link and is retried separately, so a pass that got the audio
off the device is never wasted by a flaky network. The backend dedupes on
device folder + file name, so a reinstall that lost the manifest re-registers
rather than re-transcribing.

## When a sync pass runs

Without being asked, so the library stays current on its own:

- **On connect**, including every automatic reconnect.
- **A few seconds after a recording ends.** The pendant stops itself after ~10s
  of silence and announces `DEV&STO`; the finished file is pulled while the
  link is idle. This is what makes a conversation appear in the library moments
  after it happened.
- **Every five minutes while connected.** When nothing is new this is only a
  file listing; recording is paused only when there is something to pull.
- **On pull-to-refresh** in the library, when the link is up.

A sync restores the recording state it found — and if the user explicitly
switched recording off, no pass restarts it behind their back.

## Staying connected

- The link **reconnects with backoff** (2s doubling to a 60s cap) after any
  unexpected drop or failed attempt, and immediately on foregrounding.
- The **Bluetooth adapter is watched**: turning it off is reported as exactly
  that rather than a generic failure, and turning it back on reconnects at
  once instead of waiting out a backoff timer.
- If a direct connect to the stored peripheral id fails, a **short scan by
  advertised name** finds the pendant under whatever id the platform knows it
  by today — iOS rotates its per-host UUIDs — and the fresh id is adopted.

## Background behaviour

`UIBackgroundModes: bluetooth-central` on iOS and a foreground-service
permission on Android let the link survive backgrounding, but neither platform
guarantees a long bulk transfer while the app is not in front. The design leans
on the pendant instead: it records to its own storage regardless, and syncing
resumes whenever the app is next opened in range. That is why the library
reconnects on focus.

## Configuration

`src/api/config.ts` is generated — run `../sync-config.sh` after any deploy that
changes a stack output. It holds only public identifiers (API URL, user pool and
client ids), all of which ship inside the app binary anyway.
