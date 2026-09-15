#!/usr/bin/env bash
# Build the Android dev-client APK on the Linux build box and fetch it here.
#
# The dev client is a shell: it contains the native modules (BLE, secure store,
# audio, filesystem) but loads the JS from Metro on your Mac. Rebuild it only
# when a native dependency or app.json changes — day-to-day JS edits just
# reload.
#
#   ./build-apk.sh              # incremental
#   ./build-apk.sh --clean      # wipe the generated android/ project first
set -euo pipefail

HOST="${BUILD_HOST:-nikhil@192.168.29.222}"
REMOTE_DIR="${REMOTE_DIR:-~/mr20-build}"
OUT="${OUT:-./pendant-dev.apk}"
SSH_OPTS=(-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null)

: "${SSHPASS:?set SSHPASS to the build host password, or swap this script to key auth}"

CLEAN=""
[[ "${1:-}" == "--clean" ]] && CLEAN="--clean"

echo "==> syncing source to $HOST"
sshpass -e rsync -az --delete -e "ssh ${SSH_OPTS[*]}" \
  --exclude node_modules --exclude .expo --exclude .test-build \
  --exclude dist --exclude ios --exclude android --exclude .git \
  ./mobile/ "$HOST:$REMOTE_DIR/"

echo "==> building"
sshpass -e ssh "${SSH_OPTS[@]}" "$HOST" "
  set -e
  source ~/android-env.sh
  cd $REMOTE_DIR
  npm install --legacy-peer-deps --no-audit --no-fund >/dev/null
  npx expo prebuild --platform android --no-install $CLEAN
  cd android
  ./gradlew assembleDebug --no-daemon -PreactNativeArchitectures=arm64-v8a,armeabi-v7a
"

echo "==> fetching APK"
sshpass -e scp "${SSH_OPTS[@]}" \
  "$HOST:$REMOTE_DIR/android/app/build/outputs/apk/debug/app-debug.apk" "$OUT"

ls -lh "$OUT"
echo
echo "Install it:  adb install -r $OUT"
echo "Then run:    cd mobile && npx expo start --dev-client"
