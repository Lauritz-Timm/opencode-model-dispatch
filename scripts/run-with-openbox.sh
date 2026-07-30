#!/usr/bin/env bash

set -euo pipefail

if (( $# == 0 )); then
  echo "usage: run-with-openbox.sh <command> [args...]" >&2
  exit 64
fi

openbox_log="${MODEL_DISPATCH_OPENBOX_LOG:-/tmp/model-dispatch-openbox.log}"
openbox --sm-disable >"$openbox_log" 2>&1 &
openbox_pid=$!

cleanup() {
  status=$?
  trap - EXIT
  if (( status != 0 )); then
    echo "Openbox log:" >&2
    sed -n '1,200p' "$openbox_log" >&2 || true
  fi
  kill "$openbox_pid" 2>/dev/null || true
  wait "$openbox_pid" 2>/dev/null || true
  exit "$status"
}
trap cleanup EXIT

openbox_ready=0
for _ in {1..100}; do
  if ! kill -0 "$openbox_pid" 2>/dev/null; then
    echo "Openbox exited before becoming ready" >&2
    exit 1
  fi
  if xprop -root _NET_SUPPORTING_WM_CHECK 2>/dev/null |
    grep -q "window id #"; then
    openbox_ready=1
    break
  fi
  sleep 0.1
done

if (( openbox_ready == 0 )); then
  echo "Openbox did not become ready within 10 seconds" >&2
  exit 1
fi

"$@"
