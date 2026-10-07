// Renaming a knot or stitch: every place ink resolves to it is found in the parsed tree (not by
// text search), so equal words in prose, comments or other scopes are left alone.

import { checkName, verified, type EditPlan, type TextEdit } from "./edits";
import { Divert, FlowBase, Path, VariableReference, type Identifier, type ParsedObject } from "./ink";
import { normalizeSourceFile, parseInk } from "./inkParser";
import { flowNodeId, walk } from "./inkTree";
import type { StoryGraph } from "./model";

/** Renames node `nodeId` (a knot `k` or stitch `k.s`) to `newName` across all story files. */
export function planRename(graph: StoryGraph, sources: ReadonlyMap<string, string>, nodeId: string, newName: string): EditPlan {
	const node = graph.nodes.find((n) => n.id === nodeId);
	if (!node || !["knot", "stitch", "function"].includes(node.kind)) return { ok: false, error: "Only knots, stitches and functions can be renamed." };
	if (newName === node.name) return { ok: false, error: "The name did not change." };
	const problem = checkName(graph, newName, node.parentId);
	if (problem) return { ok: false, error: problem };

	const parsed = parseInk(graph.rootFile, sources);
	if (!parsed.story) return { ok: false, error: "The story could not be parsed." };
	const objects = [...walk(parsed.story)];
	const flow = objects.find((o): o is FlowBase => o instanceof FlowBase && flowNodeId(o) === nodeId);
	if (!flow?.identifier) return { ok: false, error: `Could not find ${nodeId} in the story.` };

	const identifiers: Identifier[] = [flow.identifier];
	for (const obj of objects) {
		if (obj instanceof Divert && obj.target) identifiers.push(...namesResolvingTo(pathComponents(obj.target), obj, flow));
		else if (obj instanceof VariableReference) identifiers.push(...namesResolvingTo(obj.pathIdentifiers, obj, flow)); // read counts
	}

	const edits = dedupe(identifiers.map((id) => toEdit(graph.rootFile, id, newName)).filter((e): e is TextEdit => e !== null));
	const newId = node.parentId ? `${node.parentId}.${newName}` : newName;
	return verified(graph, sources, edits, (after) => after.nodes.some((n) => n.id === newId) && !after.nodes.some((n) => n.id === nodeId));
}

/** Path components whose prefix resolves to `flow`: in `-> k.s`, `k` names the knot and `s` the stitch. */
function namesResolvingTo(components: readonly Identifier[], context: ParsedObject, flow: FlowBase): Identifier[] {
	const hits: Identifier[] = [];
	for (let i = 0; i < components.length; i++) {
		const prefix = new Path(components.slice(0, i + 1));
		if (prefix.ResolveFromContext(context) === flow) hits.push(components[i]!);
	}
	return hits;
}

function pathComponents(path: Path): Identifier[] {
	// Not exposed publicly by inkjs; stable across 2.x (pinned).
	return (path as unknown as { components: Identifier[] }).components ?? [];
}

function toEdit(rootFile: string, id: Identifier, text: string): TextEdit | null {
	const meta = id.debugMetadata;
	if (!meta?.fileName || meta.startLineNumber !== meta.endLineNumber) return null;
	// ink columns are 1-based with an exclusive end.
	return {
		file: normalizeSourceFile(rootFile, meta.fileName),
		from: { line: meta.startLineNumber, ch: meta.startCharacterNumber - 1 },
		to: { line: meta.endLineNumber, ch: meta.endCharacterNumber - 1 },
		text,
	};
}

function dedupe(edits: TextEdit[]): TextEdit[] {
	const seen = new Map<string, TextEdit>();
	for (const e of edits) seen.set(`${e.file}:${e.from.line}:${e.from.ch}`, e);
	return [...seen.values()];
}
