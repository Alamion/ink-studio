# Obsidian community-plugin audit: ink-graph (2026-10-06)

Checked against the plugin guidelines and submission requirements. Status of each item:

| Area | Result |
|---|---|
| `innerHTML` / `outerHTML` / `insertAdjacentHTML` | none |
| Global `app`, `window.app` | none (`app` is always passed in) |
| Network, `eval`, `new Function`, telemetry | none |
| Node/Electron builtins in the bundle | none (only `obsidian`), so `isDesktopOnly: false` holds |
| Listeners cleaned on unload | views use `registerEvent` / `registerDomEvent`; modal listeners die with the modal |
| Leaves detached in `onunload` | not done (guideline forbids it) |
| Commands | no plugin name in names, no default hotkeys |
| Popout windows | `window.setTimeout` and `document.body` replaced by `activeWindow` / `activeDocument` (fixed) |
| `console` output | one `console.error` for a failed layout save and one for a failed layout; the noisy `console.warn` was removed (fixed) |
| Inline styles | two, both dynamic positions; static styles live in `styles.css` |
| `Vault` vs `DataAdapter` | the story files use the Vault API; the `.graph.json` sidecar uses the adapter on purpose, because Obsidian does not index unknown extensions (documented in `layoutStore.ts`) |
| Settings | stored through `loadData` / `saveData`, validated on load (`sanitizeSettings`, unit-tested), applied live to open graphs; no heading with the plugin name in the tab |
| Manifest | description was outdated ("read-only") and is now accurate; `authorUrl` added; id/name/description rules enforced by `pnpm check:release` |
| Repository root | the store reads `manifest.json` and `versions.json` from the root: added, and kept equal to the app's manifest by `pnpm check:release` |
| Release | tag equal to the manifest version, assets `main.js`, `manifest.json`, `styles.css`: `.github/workflows/release.yml` |
| Id and name free in the store | checked against `community-plugins.json` on 2026-10-06: `ink-graph` and "Ink Graph" are unused |

## Not verified

- `minAppVersion` 1.4.0 is not checked API by API; `Vault.process` (1.1.0), `Menu`/`Setting` `setWarning` and `getActiveViewOfType` are older, but a full pass is still due.
- Mobile: the bundle has no Node dependency, but nothing was tried on a phone. Delete/Backspace has no touch equivalent (the menus and panel buttons do).
- Sentence case of every UI string was spot-checked, not exhaustively.

## Before submitting to the store

1. Make the repository public.
2. Tag `0.1.0` (the workflow publishes the release).
3. Add the demo GIF to the README (screenshots are in `docs/img`, the GIF line is prepared; see docs/DEVELOPMENT.md).
4. PR to `obsidianmd/obsidian-releases` adding the entry to `community-plugins.json`.
