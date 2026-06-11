#!/usr/bin/env bash
# Converts docs/assets/demo.webm into a README-friendly GIF.
# Uses Playwright's bundled ffmpeg so no system install is needed.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FF="${FFMPEG:-$HOME/.cache/ms-playwright/ffmpeg-1011/ffmpeg-linux}"
IN="$ROOT/docs/assets/demo.webm"
OUT="$ROOT/docs/assets/demo.gif"
WIDTH="${WIDTH:-960}"
FPS="${FPS:-12}"

"$FF" -y -i "$IN" \
  -vf "fps=$FPS,scale=$WIDTH:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=4" \
  "$OUT"

ls -lh "$OUT"
