#!/usr/bin/env bash
# Generates the AV1 test videos used by tests/e2e/smoke.mjs (needs ffmpeg with libsvtav1).
# A red square marks the CODED top-left corner so the test can check rotation.
set -euo pipefail
out="${1:?usage: make-videos.sh <outDir>}"
mkdir -p "$out"
ffmpeg -hide_banner -loglevel error -y -f lavfi \
  -i "color=c=gray:s=320x180:r=240:d=3.6,drawbox=x=0:y=0:w=24:h=24:color=red:t=fill" \
  -c:v libsvtav1 -preset 10 -g 120 -pix_fmt yuv420p "$out/tmp.mp4"
# Display matrix rotated 90° clockwise (ffprobe reports "rotation of -90.00 degrees").
ffmpeg -hide_banner -loglevel error -y -display_rotation -90 -i "$out/tmp.mp4" -c copy "$out/cmj_240_rot.mp4"
rm "$out/tmp.mp4"
ffmpeg -hide_banner -loglevel error -y -f lavfi \
  -i "color=c=gray:s=180x320:r=30:d=11.1,drawbox=x=0:y=0:w=24:h=24:color=red:t=fill" \
  -c:v libsvtav1 -preset 10 -g 60 -pix_fmt yuv420p "$out/squat_30.mp4"
echo "Wrote $out/cmj_240_rot.mp4 and $out/squat_30.mp4"
