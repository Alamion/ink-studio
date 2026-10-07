#!/usr/bin/env bash
# Starts a throw-away Obsidian (flatpak) on a virtual display, with a copy of the vault and the freshly built plugin.
#   e2e/launch-isolated.sh <path to ink-player main.js>      (build first: pnpm --filter obsidian-ink-graph build)
# Remote debugging is on port 9333 for the *.e2e.cjs scripts. Stop it with e2e/stop-isolated.sh.
#
# Why a virtual display: on Wayland a window that loses focus gets minimized and then throttled, and Playwright's
# actions hang. Xvfb has no such behaviour. The user's own Obsidian is never touched.
set -euo pipefail

player="${1:?path to ink-player main.js}"
here="$(cd "$(dirname "$0")" && pwd)"
app="$here/.."
B="$HOME/.var/app/md.obsidian.Obsidian/cache/ink-debug"

bash "$here/setup-debug.sh" "$player"
for f in main.js manifest.json styles.css; do cp "$app/$f" "$B/vault/.obsidian/plugins/ink-graph/"; done

Xvfb :99 -screen 0 1700x900x24 -ac >/dev/null 2>&1 &
echo $! > "$B/xvfb.pid"
sleep 2
# DISPLAY must be set for flatpak itself (it decides which X socket to share), not only inside the sandbox.
env -u WAYLAND_DISPLAY DISPLAY=:99 flatpak run --nosocket=wayland --socket=x11 md.obsidian.Obsidian \
	--ozone-platform=x11 --force-device-scale-factor=1.5 \
	--user-data-dir="$B/userdata" --remote-debugging-port=9333 >"$B/obsidian.log" 2>&1 &

for _ in $(seq 1 40); do
	curl -sf http://127.0.0.1:9333/json/version >/dev/null && { echo "Isolated Obsidian is up on :9333"; exit 0; }
	sleep 1
done
echo "Obsidian did not come up; see $B/obsidian.log" >&2
exit 1
