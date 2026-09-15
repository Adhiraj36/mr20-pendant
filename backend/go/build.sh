#!/usr/bin/env bash
# Compile every Lambda to dist/<name>/bootstrap for provided.al2023 on arm64.
#
# The event-driven functions build with lambda.norpc (they use the runtime API
# directly). cmd/api is a plain web server that the Lambda Web Adapter fronts,
# so it is just a static binary.
set -euo pipefail
cd "$(dirname "$0")"

export GOOS=linux GOARCH=arm64 CGO_ENABLED=0
FLAGS=(-ldflags="-s -w" -trimpath)

for name in processor dlqreaper apply; do
  echo "building $name"
  go build "${FLAGS[@]}" -tags lambda.norpc -o "dist/$name/bootstrap" "./cmd/$name"
done

# The processor execs bundled audio tools: ffmpeg (decode, silence cut) and
# DeepFilterNet (denoise). They ship inside its asset zip under bin/.
[ -f lambda-assets/ffmpeg ] && [ -f lambda-assets/deep-filter ] || ./fetch-audio-tools.sh
mkdir -p dist/processor/bin
cp -f lambda-assets/ffmpeg lambda-assets/deep-filter dist/processor/bin/
chmod +x dist/processor/bin/ffmpeg dist/processor/bin/deep-filter

echo "building api"
go build "${FLAGS[@]}" -o "dist/api/bootstrap" "./cmd/api"

echo "done: $(du -sh dist | cut -f1)"
