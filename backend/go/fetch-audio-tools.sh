#!/usr/bin/env bash
# Fetch the audio-enhancement binaries the processor Lambda bundles.
#
# Everything lands in lambda-assets/ (gitignored — ~150 MB of third-party
# binaries do not belong in this repository); build.sh copies them into the
# processor's asset directory. All arm64/linux, matching the Lambdas.
set -euo pipefail
# Created rather than assumed: the directory is gitignored, so it does not
# exist in a fresh clone — which is every CI run.
mkdir -p "$(dirname "$0")/lambda-assets"
cd "$(dirname "$0")/lambda-assets"

DF_VERSION=0.5.6

if [ ! -f deep-filter ]; then
  echo "deep-filter $DF_VERSION"
  curl -fsSL -o deep-filter \
    "https://github.com/Rikorose/DeepFilterNet/releases/download/v$DF_VERSION/deep-filter-$DF_VERSION-aarch64-unknown-linux-gnu"
  chmod +x deep-filter
fi

if [ ! -f ffmpeg ]; then
  echo "ffmpeg static arm64"
  curl -fsSL -o ffmpeg.tar.xz "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-arm64-static.tar.xz"
  tar -xf ffmpeg.tar.xz --strip-components=1 -C . --include='*/ffmpeg' 2>/dev/null || \
    tar -xf ffmpeg.tar.xz && mv ffmpeg-*-static/ffmpeg . && rm -rf ffmpeg-*-static
  rm -f ffmpeg.tar.xz
  chmod +x ffmpeg
fi

ls -lh
