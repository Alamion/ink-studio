# Architecture

The rules live in [`.specify/memory/constitution.md`](../.specify/memory/constitution.md); this document explains the picture behind them.

ink-studio is a set of host-independent packages plus thin hosts (editors, players) around them.
The goal: write the logic once, run it in Obsidian today, in a browser player or a desktop shell later.

## Layers

```
apps/*                 hosts: Obsidian plugins, web player, (later) desktop shell
   │  may import anything below
   ▼
packages/widgets       host-independent UI: character sheet, combat, magic systems   (planned)
   ▼
packages/engine        runtime on top of inkjs: state, saves, events, externals      (planned)
   ▼
packages/core          ink sources in → story graph and verified edit plans out       (exists)
```

Dependencies point down only. A lower layer never knows a higher one exists.

| Layer   | May use                                   | Must not use                                   |
|---------|-------------------------------------------|------------------------------------------------|
| core    | `inkjs`                                   | DOM, Node builtins, React, Obsidian, any other workspace package |
| engine  | `core`, `inkjs`                           | DOM, Node builtins, React, Obsidian            |
| widgets | `core`, `engine`, `react`, `react-dom`    | Obsidian, Node builtins, any app               |
| apps    | everything                                | being imported by a package                    |

Only `apps/*` may import `obsidian`. If a package seems to need it, the package is doing a host's job:
define an interface in the package and implement it in the app (see `StorySources` / `applyEdits` in the plugin).

## How the rules are enforced (not just documented)

- `core` is compiled with `lib: ["ES2022"]` and `types: []`: using `document`, `window`, `process` or `Buffer` is a type error.
- `pnpm check:boundaries` (`scripts/check-boundaries.mjs`) fails on a disallowed dependency in `package.json`,
  a disallowed import in source, a Node builtin in a pure layer, or a relative import that leaves the package.
  A new package must be given a layer in that script before the check passes.
- pnpm is strict (`shamefully-hoist=false`): an undeclared dependency does not resolve.
- `pnpm check` runs boundaries, typecheck and tests; it is the gate for every commit and for CI.

## Extending ink without leaving ink

Stories stay plain `.ink` and keep working in Inky and any other runtime. The engine adds behaviour through
mechanisms the format already has:

- **tags** (`# combat:wolf`) signal that a widget should appear;
- **`EXTERNAL` functions** let ink call into the host;
- **variable observers** feed widgets (`VAR hp`, `VAR mana`).

No custom syntax and no forked compiler. If something cannot be expressed this way, that is a design decision to record
in `docs/decisions/`, not a quiet exception.

## Where things live

- `packages/ink-core`: parser, graph, loops, variables, rename/create/link/delete plans, text edits.
- `apps/obsidian-ink-graph`: the Obsidian graph plugin (adapter to the vault and editor, React canvas, e2e scenarios).
- `fixtures/stories`: sample `.ink` stories shared by all tests.
- `sandbox/`: gitignored local vaults for trying builds in real Obsidian.
