# ink-studio

Monorepo (pnpm) for interactive ink stories, organised with Spec Kit.

- Rules: `.specify/memory/constitution.md` (authority). Picture: `docs/ARCHITECTURE.md`.
- New features: `/speckit-specify` → `/speckit-plan` → `/speckit-tasks` → `/speckit-implement`, one `specs/NNN-name/` each.
- Gate: `pnpm check` (boundaries, typecheck, tests). Run it before saying work is done.
- `packages/ink-core` must stay pure (no DOM, no Node, no host imports); enforced by the compiler and `scripts/check-boundaries.mjs`.
- Adding a package means adding its layer to `scripts/check-boundaries.mjs` in the same change.
- Real-Obsidian testing happens against `sandbox/` (gitignored) and the separate `obs-dev-ink-plugins` vault.
