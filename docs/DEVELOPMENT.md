# Development

```
pnpm install
pnpm check        # boundaries + release rules + typecheck + tests
pnpm build        # builds the Obsidian plugin (apps/obsidian-ink-graph)
```

Rules: [constitution](../.specify/memory/constitution.md). Picture: [ARCHITECTURE.md](ARCHITECTURE.md).
Work is organised with [Spec Kit](https://github.com/github/spec-kit) (`specs/`).

## Packages

| Package | State |
|---|---|
| `@ink-studio/core` | parser, story graph, loops, rename/create/link/delete plans; 45 tests |
| `apps/obsidian-ink-graph` | the plugin: canvas, editing, deletion, settings; UI and settings tests plus e2e scenarios |
| engine, widgets | planned, designed from the first real widget |

## Try the plugin in Obsidian

```
pnpm --filter obsidian-ink-graph build
pnpm --filter obsidian-ink-graph install:vault <path to a vault>
```

`pnpm --filter obsidian-ink-graph dev` rebuilds on change; reload the plugin in Obsidian after a rebuild.
`pnpm --filter obsidian-ink-graph preview` builds a browser preview without Obsidian (`dev/out/preview.html`, serve over http).

## Plugin structure

```
packages/ink-core/src/   ink sources -> StoryGraph, and verified edit plans (pure TypeScript)
  ink.ts           the only gateway to inkjs compiler internals (pinned version, load order matters)
  inkParser.ts     compile + diagnostics;  flowGraph.ts  nodes and edges;  variables.ts  reads and writes
  loops.ts         choiceless cycles (Tarjan SCC over automatic transitions)
  edits.ts         canvas actions -> text edits, verified by recompiling
  rename.ts, deletion.ts   parse-tree based rename and delete plans
apps/obsidian-ink-graph/src/
  adapter/         vault sources, opening locations, the layout sidecar
  ui/              ItemView + React Flow + ELK layout (two passes: inside each knot, then the story)
  settings.ts      settings data and validation;  settingsTab.ts  the tab
```

## End-to-end scenarios

Behaviour that only exists in a real Obsidian (focus, keyboard, drag, settings) is checked in
`apps/obsidian-ink-graph/e2e/` against an isolated copy on a virtual display, never against a real vault.
Start it with `e2e/launch-isolated.sh`, stop it with `e2e/stop-isolated.sh`. See its README.

## Screenshots and the demo GIF

- `docs/img/*.png` are taken by `apps/obsidian-ink-graph/e2e/screenshots.e2e.cjs` from the English demo story
  (`fixtures/stories/demo-en`, `loop-demo-en`) in the isolated Obsidian. Re-run it after a visual change.
- The GIF is made from a screen recording: put the video in `docs/media/` (git-ignored) and run
  `pnpm gif docs/media/<video> --start 3 --end 25`. The script picks the largest size that stays under the budget
  (4 MB by default) and writes `docs/img/demo.gif`. The README already points at it.

## Releasing the plugin

1. Bump the version in `apps/obsidian-ink-graph/manifest.json`.
2. Copy that manifest to the root `manifest.json` and add the version to `versions.json`.
3. `pnpm check`, commit, then `git tag x.y.z && git push origin x.y.z` (no `v` prefix).

The release workflow checks tag, manifests and tests, builds, and publishes `main.js`, `manifest.json` and `styles.css`.
Store audit: [obsidian-store-audit.md](obsidian-store-audit.md).
