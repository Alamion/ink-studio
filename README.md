# ink-studio

Tooling for interactive [ink](https://github.com/inkle/ink) stories: a pure core (parsing, story graph, safe edits),
and hosts built on it (Obsidian plugins today; web player and widgets planned).

```
pnpm install
pnpm check        # boundaries + typecheck + tests
```

Rules: [constitution](.specify/memory/constitution.md). Picture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Work is organised with [Spec Kit](https://github.com/github/spec-kit) (`specs/`).

## Status

| Package            | State                                        |
|--------------------|----------------------------------------------|
| `@ink-studio/core` | extracted from the ink-graph plugin; 42 tests |
| `apps/obsidian-ink-graph` | moved in; graph, canvas editing, delete; 12 tests + e2e scenario |
| engine, widgets    | planned, designed from the first real widget  |

## Try the plugin in Obsidian

```
pnpm --filter obsidian-ink-graph build
pnpm --filter obsidian-ink-graph install:vault <path to a vault>
```
