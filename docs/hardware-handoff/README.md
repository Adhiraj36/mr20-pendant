# Hardware Team Handoff Package

Everything requested, in one place.

| # | Requested | File |
|---|---|---|
| 1 | Complete product feature documentation | [`01-product-features.md`](01-product-features.md) |
| 2 | APP installation package | `Lyzn-AI-4.2.0-arm64.apk` (see below) |
| 3 | Communication protocol between APP and hardware | [`02-communication-protocol.md`](02-communication-protocol.md) |
| — | *Added:* what we need the next firmware revision to do | [`03-firmware-requirements.md`](03-firmware-requirements.md) |

---

## The APK

Two builds of the same app — take the first one unless you need the second.

| File | Size | ABIs | Use it for |
|---|---|---|---|
| `Lyzn-AI-4.2.0-arm64.apk` | 95 MB | `arm64-v8a` | **Any modern phone.** Start here |
| `Lyzn-AI-4.2.0-universal.apk` | 226 MB | `arm64-v8a`, `armeabi-v7a`, `x86`, `x86_64` | Older 32-bit devices, or an emulator |

**Package:** `com.lyzn.flutter` · **Version:** 4.2.0 (versionCode 1)
**Minimum Android:** 7.0 (SDK 24). Target SDK 36.
**Signing:** debug keystore — this is an internal test build, not a Play Store
release. Android will warn on install; allow installation from unknown sources.

```bash
adb install -r Lyzn-AI-4.2.0-arm64.apk
```

The universal build is more than twice the size only because 92 MB of it is
`x86`/`x86_64` native libraries, which exist for emulators and no shipping phone
uses. To rebuild either variant, see the bottom of this file.

### Permissions it will ask for, and why

| Permission | Why |
|---|---|
| `BLUETOOTH_SCAN` (`neverForLocation`) | Finding the pendant. It advertises as `YLF20_<mac suffix>` and does **not** advertise its service UUID, so it is found by name |
| `BLUETOOTH_CONNECT` | Everything after that |
| `ACCESS_FINE_LOCATION` | **Not for location.** `react-native-wifi-reborn` refuses `connectToProtectedSSID` without it on every Android version, so the WiFi transfer path needs it. Declining costs the fast path and nothing else — sync falls back to BLE |
| `RECORD_AUDIO` | Voice chat with the assistant only. **The pendant records on its own and never uses the phone microphone** |
| `FOREGROUND_SERVICE*`, `WAKE_LOCK` | Syncing continues with the screen off |
| `POST_NOTIFICATIONS` | "Your recording is ready" |
| `CHANGE_WIFI_STATE`, `ACCESS_WIFI_STATE` | Joining the pendant's access point |

### Testing it against hardware

1. Install and open. Sign in (Apple, Google or email).
2. **Pendant tab → Scan.** The pendant must be powered on and nearby. It appears
   as `YLF20_…`.
3. Tap to pair. The dashboard fills in: battery, storage, firmware versions, MAC,
   clock, WiFi state.
4. **Buzz** confirms hardware control end to end — the pendant's motor should
   vibrate immediately.
5. **Record** toggles recording. The filename the device chose appears.
   Pressing the physical button instead should update the app within a second or
   two — that path exercises the unsolicited `DEV&STA` / `DEV&STO` events.
6. **Sync** pulls everything new. Watch the per-file progress; ~35 kB/s is
   expected over BLE.
7. **Live transcript** (from the dashboard) shows what the pendant is hearing as
   text, while it records.

If something fails, the most useful thing you can send back is a BLE packet
capture (Android developer options → "Enable Bluetooth HCI snoop log") together
with the timestamp.

### What is currently disabled

**WiFi fast transfer.** Implemented in full, switched off at
`mobile/src/sync/wifi.ts:WIFI_TRANSFER_ENABLED`. Every transfer in this build
goes over BLE. The reasons, and what we need from you to finish it, are in
`03-firmware-requirements.md` §4.1.

---

## Rebuilding the APK

```bash
cd mobile
npx expo prebuild -p android --clean
cd android

# arm64 only — what you want for a real phone (95 MB)
./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a

# all four ABIs (226 MB)
./gradlew assembleRelease

# -> app/build/outputs/apk/release/app-release.apk
```

`android/` is generated and git-ignored; `app.json` plus
`plugins/with-android-permissions.js` are the source of truth for the native
project. The first build downloads Android NDK 27 and takes a while.

**One gotcha.** The generated `android/gradle.properties` ships
`-Xmx2048m -XX:MaxMetaspaceSize=512m`, which is not enough Metaspace for KSP
across this many Expo modules — `expo-updates:kspReleaseKotlin` dies with
`java.lang.OutOfMemoryError: Metaspace`. Raise it in
`~/.gradle/gradle.properties`, which outranks the project file and, unlike it,
survives `prebuild --clean`:

```properties
org.gradle.jvmargs=-Xmx4g -XX:MaxMetaspaceSize=2g -Dfile.encoding=UTF-8
```

---

## A note on the protocol documentation

Section 1.2 of `02-communication-protocol.md` is worth reading first. The
manufacturer's spreadsheet (`docs/MR20通信协议20260702.xlsx`, 2 July 2026)
documents every command as `XS_BLE&…` with replies as `XS_DEV&…`. **Firmware
V1.2 rejects all of them** with `DEV&UNKNOWN` and uses `BLE&…` / `DEV&…`
instead. Everything in our documents is written in the form the shipped firmware
actually accepts, verified against a real device.

Command semantics are the manufacturer's. The dialect correction, the safety
classifications, the timing constraints and the field notes are ours, and every
"the firmware does not support this" claim is backed by a probe script in
`tools/`, not by the absence of a documented command.
