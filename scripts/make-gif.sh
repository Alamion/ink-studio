#!/usr/bin/env bash
# Turns a screen recording into a README-sized GIF: docs/img/demo.gif
#
#   pnpm gif docs/media/recording.mp4 [--start 3] [--end 25] [--max-kb 4000] [--out docs/img/demo.gif]
#
# Trims to [start, end] seconds, then tries decreasing width / frame rate until the GIF fits the budget
# (two-pass palette: much smaller and cleaner than a plain conversion). Needs ffmpeg.
set -euo pipefail

input=""; start=""; end=""; max_kb=4000; out="docs/img/demo.gif"
while [[ $# -gt 0 ]]; do
	case "$1" in
		--start) start="$2"; shift 2 ;;
		--end) end="$2"; shift 2 ;;
		--max-kb) max_kb="$2"; shift 2 ;;
		--out) out="$2"; shift 2 ;;
		-h|--help) sed -n '2,9p' "$0"; exit 0 ;;
		*) input="$1"; shift ;;
	esac
done
[[ -f "$input" ]] || { echo "Usage: pnpm gif <video> [--start s] [--end s] [--max-kb n] [--out file]" >&2; exit 1; }
command -v ffmpeg >/dev/null || { echo "ffmpeg is required" >&2; exit 1; }

trim=()
[[ -n "$start" ]] && trim+=(-ss "$start")
[[ -n "$end" ]] && trim+=(-to "$end")
mkdir -p "$(dirname "$out")"
palette="$(mktemp --suffix=.png)"; trap 'rm -f "$palette"' EXIT

# Candidates from best to smallest: width in px, frames per second.
for candidate in "1280 15" "1200 12" "1100 12" "1000 10" "900 10" "800 8" "700 8" "600 6"; do
	read -r width fps <<<"$candidate"
	filters="fps=${fps},scale=${width}:-1:flags=lanczos"
	ffmpeg -v error -y "${trim[@]}" -i "$input" -vf "${filters},palettegen=stats_mode=diff:max_colors=128" "$palette"
	ffmpeg -v error -y "${trim[@]}" -i "$input" -i "$palette" \
		-lavfi "${filters}[x];[x][1:v]paletteuse=dither=sierra2_4a:diff_mode=rectangle" -loop 0 "$out"
	size_kb=$(( $(stat -c %s "$out") / 1024 ))
	echo "width ${width}px, ${fps} fps: ${size_kb} KB"
	if (( size_kb <= max_kb )); then
		echo "Wrote $out (${size_kb} KB, budget ${max_kb} KB)"
		exit 0
	fi
done
echo "Even the smallest setting is over ${max_kb} KB: trim the clip (--start/--end) or raise --max-kb." >&2
exit 2
