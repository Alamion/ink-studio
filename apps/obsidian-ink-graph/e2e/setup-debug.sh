#!/bin/bash
# Builds an isolated copy of the vault for a debug Obsidian instance. Arg: path to ink-player main.js to use.
set -e
B=~/.var/app/md.obsidian.Obsidian/cache/ink-debug; SRC=/home/JRCD/apps/public_projects/WebstormProjects/obs-dev-ink-plugins
rm -rf $B; mkdir -p $B/vault/.obsidian/plugins $B/userdata
cp -r $SRC/stories $B/vault/
cp $SRC/.obsidian/{app,appearance,community-plugins,core-plugins}.json $B/vault/.obsidian/
printf '{"main":{"id":"m","type":"split","children":[{"id":"t","type":"tabs","children":[{"id":"l","type":"leaf","state":{"type":"empty","state":{}}}]}],"direction":"vertical"},"active":"l"}' > $B/vault/.obsidian/workspace.json
for p in ink-player ink-language ink-graph; do mkdir -p $B/vault/.obsidian/plugins/$p; for f in main.js manifest.json styles.css data.json; do [ -f $SRC/.obsidian/plugins/$p/$f ] && cp $SRC/.obsidian/plugins/$p/$f $B/vault/.obsidian/plugins/$p/; done; done
cp "$1" $B/vault/.obsidian/plugins/ink-player/main.js
cp ~/.var/app/md.obsidian.Obsidian/config/obsidian/obsidian-1.13.7.asar $B/userdata/
python3 -c "import json,time;json.dump({'vaults':{'inkdebugvault0001':{'path':'$B/vault','ts':int(time.time()*1000),'open':True}}},open('$B/userdata/obsidian.json','w'))"
echo "ink-player guard present: $(grep -c 'PATCH:ink-guard' $B/vault/.obsidian/plugins/ink-player/main.js)"
