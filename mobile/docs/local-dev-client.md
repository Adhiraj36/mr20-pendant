# A local iOS dev client, on the simulator

Xcode builds the shell; Metro serves the JS. Nothing here needs EAS, and
nothing here needs a phone. The BLE screens are still no use on a simulator —
it has no radio — but every other route renders, which is what the screenshot
passes need.

## The one thing that will waste your afternoon

**Uninstall every other build of this app from the simulator first.**

`expo run:ios` builds and installs `com.lyzn.flutter`, launches it, and then
opens

```
exp+mr20-pendant://expo-development-client/?url=http://<lan-ip>:8081
```

to point the client at Metro. That scheme is derived from the Expo **slug**
(`mr20-pendant` — see `app.json`), not from the bundle identifier, so *every*
build this project has ever produced claims it. If an older client is still on
the device, iOS is free to hand the URL to that one instead. It happily
connects to Metro, loads today's JS into a binary from before half the native
modules existed, and throws something that reads like a bundling problem but
is not:

```
iOS Bundled 11290ms node_modules/expo-router/entry.js (4412 modules)
 ERROR  [Error: Cannot find native module 'ExpoWebBrowser']
```

The build was fine. The module is in `LYZN.app`. The URL simply went to the
wrong app. (One such client — `in.mellob.pendant` / `Pendant.app`, from before
the LYZN rename — sat on the iPhone 17 Pro simulator and swallowed the dev
server for the whole of round seven's first pass.)

List what is installed, and remove anything that is not `com.lyzn.flutter`:

```bash
xcrun simctl listapps booted | grep -B4 'ApplicationType = User'   # or:
xcrun simctl listapps booted | grep CFBundleIdentifier | grep -v com.apple

xcrun simctl uninstall booted in.mellob.pendant                    # example
```

To check which app is actually talking to Metro, ask the dev server — the
title is the bundle identifier:

```bash
curl -s http://localhost:8081/json/list | grep -o '"title":"[^"]*"'
# "title":"com.lyzn.flutter (iPhone 17 Pro)"
```

## Build and run

```bash
cd mobile
bun install --frozen-lockfile
xcrun simctl boot "iPhone 17 Pro"      # skip if one is already booted
open -a Simulator

npx expo run:ios --device "iPhone 17 Pro"
```

First run takes ~15 minutes: `expo prebuild` writes `ios/` (git-ignored),
CocoaPods installs, Xcode compiles every pod. It ends with `Build Succeeded`,
installs the app, and stays in the foreground as the Metro server — leave it
running. Later runs reuse DerivedData and take a minute or two.

If `ios/` is stale — a native dependency changed, or `app.json` did — redo it
from scratch:

```bash
npx expo prebuild --clean --platform ios
```

Requires Xcode (26.6 here) and CocoaPods (`brew install cocoapods`, 1.17.0).

## Quiet the dev client down

Two simulator-side defaults, written once per install. The first skips the
"This is the developer menu" sheet that otherwise covers the first screen; the
other two keep the floating gear button out of every screenshot.

```bash
xcrun simctl spawn booted defaults write com.lyzn.flutter EXDevMenuIsOnboardingFinished -bool true
xcrun simctl spawn booted defaults write com.lyzn.flutter EXDevMenuShowsAtLaunch -bool false
xcrun simctl spawn booted defaults write com.lyzn.flutter EXDevMenuShowFloatingActionButton -bool false
```

## Relaunching

The dev client remembers the last dev-server URL, so once Metro is up this is
the whole loop — no deep link, no QR code:

```bash
xcrun simctl terminate booted com.lyzn.flutter
xcrun simctl launch    booted com.lyzn.flutter
```

Give it ~8 seconds: the client reconnects, Metro serves a cached bundle in
~100 ms, and the app lands on the launch gate and then on welcome.

## Opening a route

```bash
npx uri-scheme open "lyzn:///onboarding/sign-in" --ios
```

Use **`lyzn://`**, not `pendant://`: `app.json` registers `pendant`, `karma`
and `lyzn`, and `pendant` is the one an older client also claims. Three
slashes — `lyzn://` + the absolute route path.

iOS then asks *Open in "LYZN"?* and waits for a tap. There is no `simctl`
command for a tap, so click the button through the window:

```bash
osascript -e 'tell application "System Events" to tell process "Simulator" to get {position, size} of window 1'
# → 628, 44, 452, 963

osascript -e 'tell application "Simulator" to activate' \
          -e 'delay 0.5' \
          -e 'tell application "System Events" to click at {932, 580}'
```

The device screen is letterboxed inside that window under the title bar. With
the window at `(628, 44)` and 452 × 963, the screen starts at about
`(639, 72)` and one device point is about 1.07 screen points, which puts the
*Open* button — device `(274, 475)` on a 402 × 874 pt iPhone 17 Pro — at
`(932, 580)`. Recompute if the window moves; the button is large, so being a
few points out is fine.

## Fixtures, and the storage path that wastes an hour

Every screen below the launch gate is behind a Clerk session, and a simulator
has none. Switch the fixtures on and the app answers its own requests, seeds a
session and seeds a pendant:

```bash
app=$(xcrun simctl get_app_container booted com.lyzn.flutter data)
F="$app/Library/Application Support/com.lyzn.flutter/RCTAsyncLocalStorage_V1/manifest.json"
# set lyzn.fixtures to "on", and lyzn.theme to "light" or "dark", in that JSON
xcrun simctl terminate booted com.lyzn.flutter
xcrun simctl launch    booted com.lyzn.flutter
```

**The path matters.** AsyncStorage is under `Library/Application Support/<bundle
id>/`, *not* at the container root — there is a decoy `RCTAsyncLocalStorage_V1`
directory there that nothing reads. Writing to the decoy looks exactly like
fixtures being off, which is an hour nobody gets back.

## Screenshots

```bash
xcrun simctl io booted screenshot /path/to/shot.png
```

1206 × 2622 for the iPhone 17 Pro, which is 402 × 874 pt at 3×. Take it a good
ten seconds after a launch — the 3D pendant needs about 400 ms to reach its
first frame and the entrance animations run for 420 ms after that.

## Known simulator-only oddity

The two routes that mount `PendantVisual` — `onboarding/welcome` and
`onboarding/pair` — render only their chrome on the simulator: the step rail
and the footer button are there, the screen's own copy is not, and the footer
sits hard against the bottom edge. Routes without it (`onboarding/sign-in`,
the tabs) render in full. Sampling the pixels shows the whole middle band as
one flat ink colour, so nothing is being drawn there rather than being drawn
too dark. `expo-gl` is software-emulated on the simulator and logs
`EXT_color_buffer_float extension not supported`. Not a dev-client problem —
the same bundle in the same client renders every other screen — but worth
knowing before you file a bug against a screen.
