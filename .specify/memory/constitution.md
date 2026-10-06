<!--
Sync Impact Report
==================
Version change: (template) → 1.0.0
Bump rationale (1.0.0, MAJOR): first ratification. Principles carried over from docs/RULES.md and the layer
table of docs/ARCHITECTURE.md, which now describe and defer to this document.

Added principles: I–VI. Added sections: Technical Constraints, Development Workflow, Governance.

Templates / dependent files:
  ✅ .specify/templates/*.md — no constitution-specific slots; no edit needed
  ✅ CLAUDE.md, README.md — point here
  ✅ docs/ARCHITECTURE.md — keeps the layer diagram; this file is the authority on the rules
  ✅ scripts/check-boundaries.mjs — implements Principles I and II mechanically
-->

# ink-studio Constitution

## Core Principles

### I. Dependencies Point Down (NON-NEGOTIABLE)

Layers are `apps → widgets → engine → core`. A package imports only from its own layer's allow-list
(see `docs/ARCHITECTURE.md` and `scripts/check-boundaries.mjs`); a lower layer never knows a higher one
exists, and nothing imports from `apps/*`. Only `apps/*` may import `obsidian` or any other host API.
When a package seems to need a host capability, it defines an interface and the app implements it.
A new package MUST be given its layer in `scripts/check-boundaries.mjs` in the same change.

### II. Core Is Pure (NON-NEGOTIABLE)

`@ink-studio/core` depends on `inkjs` only: no DOM, no Node builtins, no UI, no other workspace package.
The compiler enforces the type-level half (`lib: ["ES2022"]`, `types: []`); `pnpm check:boundaries`
enforces imports. Hosts pass data in and apply results; core never reads or writes files.

### III. Edits Are Verified Plans

Anything that changes a story is a plan of text edits, not a side effect. Every plan is recompiled
and MUST be refused if it adds compile errors. Operations that cannot be done safely
(for example deleting a knot that is still used as a tunnel) refuse with a reason and the blocking
places, instead of guessing. Hosts apply plans through the editor's own undo.

### IV. Ink Stays Ink

Stories remain plain `.ink` that works in Inky and any other runtime. Interactivity is added through
what the format already has: tags, `EXTERNAL` functions, and variable observers. No custom syntax and no
forked compiler. A need that cannot be met this way is recorded as a decision in `docs/decisions/`
before any exception is made.

### V. Design From Real Use

No abstraction before a second user. `engine` and `widgets` are designed from the first real widget,
living inside the app that needs it until a second consumer exists, and only then extracted.
Speculative packages, plugin systems and configuration options are rejected in review.

### VI. Tests Decide, Fixtures Are Shared

A bug fix starts with a failing test. Package tests live in the package; sample stories live in
`fixtures/stories` and are shared by every package. Behaviour that only exists in a real host
(focus, keyboard, drag) is verified end-to-end in that host, and the scenario is kept in the repo.

## Technical Constraints

- TypeScript strict (`noUncheckedIndexedAccess` on), ESM, tabs for indentation; comments explain why.
- pnpm workspace, strict dependency resolution (`shamefully-hoist=false`), Node ≥ 22.
- `inkjs` is pinned to an exact version in `core`; upgrades are their own change with the full suite run.
- Licence MIT. Third-party code is attributed in `THIRD_PARTY_NOTICES.md` when it is copied, not merely used.
- Obsidian plugins follow the community-plugin guidelines (no `innerHTML`, listeners registered through the
  plugin so unload cleans up, no stray `console` output in releases).

## Development Workflow

- Non-trivial work is a spec under `specs/NNN-name/` (`/speckit-specify` → `plan` → `tasks` → `implement`).
  Every plan carries a Constitution Check against Principles I–VI.
- Small fixes and chores (moving code, dependency bumps, typos) do not need a spec.
- The gate is `pnpm check`: boundaries, typecheck, tests. Nothing is reported done while it is red.
- Docs describe; this constitution decides. If they disagree, the docs are wrong.

## Governance

This constitution supersedes other practices in the repository. Amendments are made through
`/speckit-constitution`, versioned semantically (MAJOR: a principle removed or redefined; MINOR: a principle
or section added or materially expanded; PATCH: wording), and carry a Sync Impact Report. A principle may be
relaxed only in a commit that says so and names the reason.

**Version**: 1.0.0 | **Ratified**: 2026-10-06 | **Last Amended**: 2026-10-06
