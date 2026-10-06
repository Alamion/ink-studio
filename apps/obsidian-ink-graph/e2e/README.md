# End-to-end scenarios (real Obsidian)

Behaviour that only exists in a real host (focus, keyboard, drag) is checked here, per the constitution (Principle VI).

- `setup-debug.sh <ink-player main.js>`: builds an isolated copy of the vault for a throw-away flatpak Obsidian
  (`--user-data-dir`, `--remote-debugging-port=9333`). Paths inside are still those of the original vault
  (`obs-dev-ink-plugins`); parameterise them before running from `sandbox/`.
- `delete.e2e.cjs <screenshot-prefix>`: drives the open instance over CDP with playwright-core:
  select links and nodes, Link panel, Delete key, diff previews, blocked deletes, undo. Last run: 21/21 PASS.

The scenario never touches the user's real vault: run it only against the isolated copy.
