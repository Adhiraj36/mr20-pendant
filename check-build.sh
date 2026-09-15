#!/usr/bin/env bash
# Show what the remote Android build is doing right now.
#   ./check-build.sh          one snapshot
#   ./check-build.sh -f       follow until it ends
set -uo pipefail

HOST="${BUILD_HOST:-nikhil@192.168.29.222}"
SSH_OPTS=(-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=20)
: "${SSHPASS:?export SSHPASS='<build host password>' first}"

snapshot() {
  sshpass -e ssh "${SSH_OPTS[@]}" "$HOST" '
    if pgrep -f GradleWrapperMain >/dev/null; then
      echo "STATUS   building"
      echo "STEP     $(grep -aE "^> Task" ~/build.log | tail -1 | tr -d "\r" | sed "s/^> Task //")"
      echo "TASKS    $(grep -acE "^> Task" ~/build.log) done"
      echo "CPU      $(ps -eo pcpu,args --sort=-pcpu | grep "[j]ava" | head -1 | awk "{print \$1\"%\"}")"
    else
      echo "STATUS   $(grep -aoE "BUILD SUCCESSFUL in [0-9a-z ]+|BUILD FAILED in [0-9a-z ]+" ~/build.log | tail -1 || echo "not running, no result yet")"
      apk=$(find ~/mr20-build/android -name app-debug.apk 2>/dev/null | head -1)
      [ -n "$apk" ] && echo "APK      $(du -h "$apk" | cut -f1)  $apk" || echo "APK      none"
      grep -a -A8 "What went wrong" ~/build.log | tail -8 | tr -d "\r" | sed "s/^/ERROR    /"
    fi
  ' 2>/dev/null | grep -v "Warning: Perm"
}

if [[ "${1:-}" == "-f" ]]; then
  while :; do
    clear; date "+%H:%M:%S"; snapshot
    snapshot | grep -qE "BUILD (SUCCESSFUL|FAILED)" && break
    sleep 30
  done
else
  snapshot
fi
