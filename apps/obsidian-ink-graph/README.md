# Ink Graph (prototype)

Read-only graph of an ink story inside Obsidian: knots, stitches (grouped inside their knot),
diverts / choices / tunnels / threads / function calls, and where global variables are read or written.

Works alongside Ink Player and Ink Language and does not register the `.ink` extension itself.

## Use

Open any `.ink` file → command **Ink Graph: Open story graph** (or the ribbon icon).
The story root is found by following `INCLUDE`s upwards.

- double-click a node → jump to its source line
- click a variable in the side panel → writers (orange) / readers (blue) are highlighted
- parallel diverts between two nodes are one line; its label lists the choices (click a line → source)
- edges going back in the story detour around the nodes; hover or select a node to focus its edges
- drag nodes → positions are saved to `<root>.graph.json` next to the story (commit it);
  knot groups re-fit to their stitches after a drag
- **Auto layout** → forget saved positions
- red nodes / edges and the banner on top mark **loops without choices**: solid = the story hangs
  as soon as it gets there, dashed = conditional (fine if the condition really changes, e.g. a counter)
- the side panel collapses in narrow panes (toggle in the top-right corner)

### Editing on the canvas

Every action is turned into edits of the .ink text; nothing else stores the story.

- **new knot** — right click on empty canvas → *New knot here…* (appended to the story root file)
- **new stitch** — right click on a knot → *Add stitch…*
- **link** — drag from a node's right handle onto another node → choice / sticky choice / divert / tunnel.
  The line goes at the end of the source's own content; a divert after choices gets a gather (`- -> x`)
- **rename** — right click → *Rename…*: every reference ink resolves to the node is renamed,
  across files (diverts, `knot.stitch` paths, read counts like `{knot > 1}`); prose and comments are untouched
- **select** — click a node, or a link (its line or label): the side panel shows the details.
  For a link: kind, condition, every place it is written with the source line (a choice's line too),
  and whether it is part of a loop without choices. Double click opens the text in the editor
- **delete** — Delete/Backspace on the selection, the panel button, or the right-click menu.
  - node: its lines up to the next header go (a knot with its stitches). Diverts and choices into it
    are redirected to `-> END`. Tunnels, threads, calls, read counts (`{knot}`) and divert values
    (`VAR x = -> knot`) cannot be redirected: the delete is refused and lists them (click to open)
  - link: a choice whose only exit is the link goes as a whole (with its branch); a divert among other
    content goes alone, together with an `{ cond: }` / `- else:` wrapper that would be left empty
  - anything bigger than one line is previewed as a diff first; one-line deletes happen at once
- **undo** — Ctrl/Cmd+Z while the graph is focused, or the command *Undo last graph edit*
  (works for files that are not open too; the history lives until the graph tab is closed)

An edit is refused (with a notice) if the story would get new compile errors, or if the file
changed while the edit was being prepared.

## Third-party plugin patches

`node tools/patch-plugins.mjs` (vault root) patches Ink Language (duplicate `.ink` registration)
and Ink Player (unbounded story loop that froze and crashed Obsidian). Re-run it after updating them.

## Develop

```bash
npm install
npm run dev        # esbuild watch → main.js / styles.css (reload the plugin in Obsidian)
npm test           # core + layout tests (vitest)
npm run build      # typecheck + production bundle
npm run preview    # browser preview without Obsidian → dev/out/preview.html (serve over http)
```

## Structure

```
src/core/      ink sources → StoryGraph (pure TS, no Obsidian/DOM, tested)
  ink.ts         the only gateway to inkjs compiler internals (pinned version, load order matters)
  inkParser.ts   compile + diagnostics;  flowGraph.ts  nodes/edges;  variables.ts  reads/writes
  loops.ts       choiceless cycles (Tarjan SCC over automatic transitions)
  edits.ts       canvas actions → text edits, verified by recompiling;  rename.ts  parse-tree rename;  deletion.ts  delete nodes/links
src/adapter/   vault sources, opening locations, layout sidecar
src/ui/        ItemView + React Flow + ELK layout (two passes: inside each knot, then the story)
  edgeGeometry.ts  edge routes (curves / obstacle-aware detours);  groupFit.ts  knot group sizing
```

## Known limits

- Rebuild runs on the main thread (debounced); a Web Worker is the next step for large stories.
- An unclosed `{` can swallow following lines while typing, so parts of the graph briefly disappear.
- Nested INCLUDEs are resolved relative to the including file when looking for the root.
- Knot-level usage of variables is not shown on the knot group header (see the side panel).
