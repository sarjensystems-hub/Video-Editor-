#!/usr/bin/env bash
# Vercel "Ignored Build Step" (vercel.json ignoreCommand).
# Exit 0 = skip this deployment, exit 1 = build it.
#
# Skips:
#  - any branch other than main (no preview deployments; main is production)
#  - pushes that change nothing the deployed app is built from: the
#    self-hosted render worker, SQL migrations, docs, tests and CI config.
# Always builds when it cannot tell (first deploy, unknown base commit) and
# on a redeploy of the same commit, which is how env var changes go live.
set -u

if [ "${VERCEL_GIT_COMMIT_REF:-}" != "main" ]; then
  echo "Skipping: branch '${VERCEL_GIT_COMMIT_REF:-unknown}' is not main."
  exit 0
fi

base="${VERCEL_GIT_PREVIOUS_SHA:-}"
head="${VERCEL_GIT_COMMIT_SHA:-HEAD}"
if [ -z "$base" ] || [ "$base" = "$head" ]; then
  echo "Building: no earlier deployed commit to compare with, or a redeploy."
  exit 1
fi

if ! git cat-file -e "$base^{commit}" 2>/dev/null; then
  git fetch --quiet --depth=100 origin main 2>/dev/null || true
fi
if ! git cat-file -e "$base^{commit}" 2>/dev/null; then
  echo "Building: last deployed commit $base is not in the clone."
  exit 1
fi

if git diff --quiet "$base" "$head" -- . \
  ':(glob,exclude)render-worker/**' \
  ':(glob,exclude)supabase/**' \
  ':(glob,exclude).github/**' \
  ':(glob,exclude)**/*.md' \
  ':(glob,exclude)**/*.test.ts' \
  ':(glob,exclude)**/*.test.tsx' \
  ':(glob,exclude)**/*.test.mjs'; then
  echo "Skipping: nothing the deployed app is built from changed since $base."
  exit 0
fi

echo "Building: app source changed since $base."
exit 1
