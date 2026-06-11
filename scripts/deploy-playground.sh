#!/usr/bin/env bash
# Rebuilds the playground and stages the standalone deploy artifact.
#
# Why this exists: `next build` regenerates .next (new BUILD_ID + chunk
# hashes) but does NOT copy .next/static or public/ into .next/standalone.
# If the service restarts against a half-staged standalone dir, the canvas
# 404s its chunks ("Loading chunk … failed"). Always deploy through this
# script, then restart the service.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

pnpm build:ui

rm -rf .next/standalone/.next/static
cp -r .next/static .next/standalone/.next/static
cp -r public .next/standalone/ 2>/dev/null || true

# sanity: server entrypoint must exist where flow2code.service expects it
test -f .next/standalone/server.js

echo
echo "✅ Standalone artifact staged. Now restart the service:"
echo "   sudo systemctl restart flow2code"
