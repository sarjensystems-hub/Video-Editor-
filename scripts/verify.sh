#!/usr/bin/env bash
#
# The full gate, on exit codes.
#
# Written because grepping build output lied twice: `next build` prints
# "Compiled successfully" and typechecks afterwards, so a grep of the first
# lines reports a passing build while the typecheck below it fails. Vercel runs
# the whole thing and rejected a commit this repo believed was green.
#
# Usage: bash scripts/verify.sh
# Exits non-zero if anything fails, and says which thing.

set -uo pipefail
cd "$(dirname "$0")/.."

fail=0
report() {
  if [ "$2" -eq 0 ]; then
    printf '  %-8s PASS\n' "$1"
  else
    printf '  %-8s FAIL (exit %s)\n' "$1" "$2"
    fail=1
  fi
}

echo "verifying $(git rev-parse --short HEAD)"

npx tsc --noEmit > /tmp/verify-tsc.log 2>&1
report "tsc" $?

npx vitest run > /tmp/verify-tests.log 2>&1
report "tests" $?

npx next build > /tmp/verify-build.log 2>&1
report "build" $?

count=$(grep -oE 'Tests +[0-9]+ passed' /tmp/verify-tests.log | grep -oE '[0-9]+' | tail -1)
echo "  tests passing: ${count:-unknown}"

if [ "$fail" -ne 0 ]; then
  echo
  echo "logs: /tmp/verify-tsc.log /tmp/verify-tests.log /tmp/verify-build.log"
fi
exit "$fail"
