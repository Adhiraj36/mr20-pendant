#!/usr/bin/env bash
# Build the dictation helper into resources/, where electron-builder picks it up.
#
# It is a small app bundle rather than a bare binary because macOS reads a
# bundle's Info.plist to decide whether it may use the microphone and speech
# recognition. macOS only; elsewhere the composer simply has no microphone.
#
#   scripts/build-dictate.sh              this Mac's architecture
#   DICTATE_ARCHS="arm64 x86_64" scripts/build-dictate.sh
set -euo pipefail

if [ "$(uname -s)" != "Darwin" ]; then
  echo "dictation is macOS only; nothing to build"
  exit 0
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/resources/dictate/LYZN Dictation.app"
ARCHS="${DICTATE_ARCHS:-$(uname -m)}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
cp "$ROOT/native/dictate/Info.plist" "$APP/Contents/Info.plist"

slices=()
for arch in $ARCHS; do
  swiftc -O -target "$arch-apple-macos13" -o "$TMP/lyzn-dictate-$arch" "$ROOT/native/dictate/main.swift"
  slices+=("$TMP/lyzn-dictate-$arch")
done
lipo -create "${slices[@]}" -output "$APP/Contents/MacOS/lyzn-dictate"

# Ad hoc, so it runs in development. A release build is signed again, with the
# app's identity, by electron-builder.
codesign --force --sign - "$APP" >/dev/null
echo "built $APP ($ARCHS)"
