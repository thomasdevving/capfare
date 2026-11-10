#!/usr/bin/env bash
# Encodes rendered frames + mixed audio into an MP4 (H.264 High, BT.709, AAC, loudness -15 LUFS).
#   video/render/encode.sh full     -> video/out/full/full.mp4
#   video/render/encode.sh x        -> video/out/x/x.mp4
set -euo pipefail
cut="${1:-full}"
cd "$(dirname "$0")/.."
mkdir -p "out/$cut"
ffmpeg -y -hide_banner -loglevel warning -stats \
  -framerate 60 -i "frames/$cut/f%05d.jpg" -i "audio/$cut/mix.wav" \
  -vf "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p" \
  -c:v libx264 -preset slow -crf 17 -profile:v high \
  -colorspace bt709 -color_primaries bt709 -color_trc bt709 \
  -af "loudnorm=I=-15:TP=-2:LRA=11" -ar 48000 -c:a aac -b:a 192k \
  -shortest -movflags +faststart "out/$cut/$cut.mp4"
echo "wrote video/out/$cut/$cut.mp4"
