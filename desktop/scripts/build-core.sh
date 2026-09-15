#!/usr/bin/env bash
# Build the engine and drop it where electron-builder will pick it up.
#
# The app ships the daemon rather than asking anyone to install Go, so this is
# a required step before packaging — but it is deliberately NOT part of
# `npm run build`, because the UI has to be buildable on a machine that has no
# Go toolchain and no engine checkout.
#
# ONE BINARY PER PLATFORM, BUILT ON THAT PLATFORM. The engine needs cgo for
# SQLite, so a Linux binary cannot be produced on a Mac without a cross
# toolchain nobody wants to install. The release workflow therefore runs this
# on a runner per operating system, and this script refuses a target it cannot
# honestly build rather than emitting something that will not start.
#
# The one exception is macOS, where the platform SDK carries both architectures
# and clang cross-compiles with a flag — which is what lets one Mac runner
# produce the universal build that Intel Macs need.
#
#   scripts/build-core.sh                 the host
#   scripts/build-core.sh darwin/arm64 darwin/amd64
#
set -euo pipefail

SRC="${KARMAX_SRC:-$HOME/code/KARMAX}"
OUT="$(cd "$(dirname "$0")/.." && pwd)/resources"

if [ ! -f "$SRC/go.mod" ]; then
  echo "no engine checkout at $SRC" >&2
  echo "set KARMAX_SRC to the directory holding karmax's go.mod" >&2
  exit 1
fi

case "$(uname -s)" in
  Linux)  HOST_OS=linux ;;
  Darwin) HOST_OS=darwin ;;
  *)      HOST_OS=windows ;;
esac
case "$(uname -m)" in
  x86_64|amd64)  HOST_ARCH=amd64 ;;
  arm64|aarch64) HOST_ARCH=arm64 ;;
  *)             HOST_ARCH="$(uname -m)" ;;
esac

TARGETS=("$@")
[ ${#TARGETS[@]} -eq 0 ] && TARGETS=("$HOST_OS/$HOST_ARCH")

mkdir -p "$OUT"
BUILT=()

for target in "${TARGETS[@]}"; do
  GOOS="${target%%/*}"
  GOARCH="${target##*/}"

  # What the app looks for: electron's platform and arch names, not Go's.
  case "$GOOS" in
    darwin)  NODE_OS=darwin ;;
    linux)   NODE_OS=linux ;;
    windows) NODE_OS=win32 ;;
    *) echo "unknown os in target $target" >&2; exit 1 ;;
  esac
  case "$GOARCH" in
    amd64) NODE_ARCH=x64 ;;
    arm64) NODE_ARCH=arm64 ;;
    *) echo "unknown arch in target $target" >&2; exit 1 ;;
  esac

  CC_FLAGS=()
  if [ "$GOOS" != "$HOST_OS" ]; then
    echo "cannot build $target on $HOST_OS: the engine needs cgo, so each" >&2
    echo "platform is built on a runner of its own (see .github/workflows)." >&2
    exit 1
  fi
  if [ "$GOARCH" != "$HOST_ARCH" ]; then
    if [ "$GOOS" = "darwin" ]; then
      # The macOS SDK is universal; clang just needs telling which slice.
      case "$GOARCH" in
        amd64) CC_FLAGS=(CC="clang -arch x86_64" CXX="clang++ -arch x86_64") ;;
        arm64) CC_FLAGS=(CC="clang -arch arm64" CXX="clang++ -arch arm64") ;;
      esac
    else
      echo "cannot build $GOARCH on $HOST_ARCH: cgo needs a cross toolchain" >&2
      exit 1
    fi
  fi

  BIN="$OUT/karmax-$NODE_OS-$NODE_ARCH"
  [ "$NODE_OS" = "win32" ] && BIN="$BIN.exe"

  echo "building $target from $SRC"
  ( cd "$SRC" && env GOOS="$GOOS" GOARCH="$GOARCH" CGO_ENABLED=1 \
      ${CC_FLAGS[@]+"${CC_FLAGS[@]}"} \
      go build -trimpath -ldflags "-s -w" -o "$BIN" ./cmd/karmax )
  BUILT+=("$NODE_OS-$NODE_ARCH")
  echo "wrote $BIN"
done

REV="$( cd "$SRC" && git rev-parse --short HEAD 2>/dev/null || echo unknown )"
printf '{\n  "source": "%s",\n  "revision": "%s",\n  "built": [%s],\n  "builtAt": "%s"\n}\n' \
  "$SRC" "$REV" \
  "$(printf '"%s",' "${BUILT[@]}" | sed 's/,$//')" \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$OUT/core.json"
