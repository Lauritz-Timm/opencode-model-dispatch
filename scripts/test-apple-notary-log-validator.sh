#!/usr/bin/env bash
set -euo pipefail

fixture_root="$(mktemp -d)"
trap 'rm -rf "$fixture_root"' EXIT

validator="$fixture_root/validate-apple-notary-log"
/usr/bin/xcrun swiftc \
  scripts/validate-apple-notary-log.swift \
  -o "$validator"

printf '%s\n' '{"issues":null}' > "$fixture_root/null.json"
printf '%s\n' '{"issues":[]}' > "$fixture_root/empty.json"
printf '%s\n' '{"issues":[{"severity":"warning"}]}' > "$fixture_root/warning.json"
printf '%s\n' '{"issues":[{"severity":"error"}]}' > "$fixture_root/error.json"

"$validator" "$fixture_root/null.json"
"$validator" "$fixture_root/empty.json"

for rejected in warning error; do
  if "$validator" "$fixture_root/$rejected.json"; then
    echo "Expected $rejected notarization issues to fail validation" >&2
    exit 1
  fi
done

echo "Apple notarization log validator passed null, empty, warning, and error fixtures"
