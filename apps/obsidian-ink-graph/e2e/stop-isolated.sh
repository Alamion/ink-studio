#!/usr/bin/env bash
# Stops what launch-isolated.sh started and removes its profile. Only processes of the isolated profile are killed.
B="$HOME/.var/app/md.obsidian.Obsidian/cache/ink-debug"
pgrep -f "[i]nk-debug/userdata" | xargs -r kill -9
[ -f "$B/xvfb.pid" ] && kill "$(cat "$B/xvfb.pid")" 2>/dev/null
sleep 1
rm -rf "$B"
echo "Isolated Obsidian stopped."
