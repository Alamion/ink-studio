// Deleting knots, stitches and links. Like every edit, a deletion is a list of text edits that
// must leave the story compiling; references that would dangle are redirected or reported.

import { blockEnd, describeEdits, HEADER, KNOT_HEADER, removeLines, verified, type LineChange, type TextEdit } from "./edits";
import { Choice, Conditional, DivertTarget, Divert, FlowBase, Gather, Path, VariableReference, Weave, type Identifier, type ParsedObject } from "./ink";
import { buildFlowGraph } from "./flowGraph";
import { normalizeSourceFile, parseInk } from "./inkParser";
import { ancestorWithinFlow, flowNodeId, owningChoice, walk } from "./inkTree";
import type { SourceLocation, StoryGraph } from "./model";

export type ReferenceKind = "divert" | "choice" | "tunnel" | "thread" | "call" | "read count" | "divert value";

/** A place in the text that points at something being deleted. */
export interface Reference {
	kind: ReferenceKind;
	location: SourceLocation;
	/** The source line, trimmed. */
	text: string;
}

export type DeletePlan =
	| {
			ok: true;
			edits: TextEdit[];
			/** Line-level preview of every edit. */
			changes: LineChange[];
			/** Diverts into the deleted node that now end the story instead. */
			redirected: Reference[];
	  }
	| { ok: false; error: string; blocking?: Reference[] };

/**
 * Deletes a knot (with its stitches), a stitch or a function: its lines up to the next header.
 * Plain diverts and choices pointing into it are redirected to `END`, so they keep compiling
 * and read as dead ends. Tunnels, threads, calls, read counts and divert values have no safe
 * replacement: while any exist, the plan is refused and lists them.
 */
export function planDeleteNode(graph: StoryGraph, sources: ReadonlyMap<string, string>, nodeId: string): DeletePlan {
	const node = graph.nodes.find((n) => n.id === nodeId);
	if (!node || !node.location || !["knot", "stitch", "function"].includes(node.kind)) {
		return { ok: false, error: "Only knots, stitches and functions can be deleted." };
	}
	const file = node.location.file;
	const lines = sources.get(file)?.split("\n");
	if (!lines) return { ok: false, error: `File not found: ${file}` };
	const parsed = parseInk(graph.rootFile, sources);
	if (!parsed.story) return { ok: false, error: "The story could not be parsed." };
	const objects = [...walk(parsed.story)];
	const flow = objects.find((o): o is FlowBase => o instanceof FlowBase && flowNodeId(o) === nodeId);
	if (!flow) return { ok: false, error: `Could not find ${nodeId} in the story.` };

	const first = node.location.line;
	const last = blockEnd(lines, first, node.kind === "stitch" ? HEADER : KNOT_HEADER);
	const deleted = (loc: SourceLocation | null): boolean => loc !== null && loc.file === file && loc.line >= first && loc.line <= last;

	const edits: TextEdit[] = [removeLines(file, lines, first, last)];
	const redirected: Reference[] = [];
	const blocking: Reference[] = [];
	for (const obj of objects) {
		const location = sourceLocation(graph.rootFile, obj);
		if (!location || deleted(location)) continue;
		const reference = (kind: ReferenceKind): Reference => ({ kind, location, text: lineText(sources, location) });
		if (obj instanceof Divert && obj.target && !obj.isEnd && !obj.isDone) {
			if (!isInside(obj.target.ResolveFromContext(obj), flow)) continue;
			if (obj.parent instanceof DivertTarget) blocking.push(reference("divert value"));
			else if (obj.isFunctionCall) blocking.push(reference("call"));
			else if (obj.isTunnel) blocking.push(reference("tunnel"));
			else if (obj.isThread) blocking.push(reference("thread"));
			else {
				const edit = replacePath(graph.rootFile, pathComponents(obj.target), "END");
				if (!edit) blocking.push(reference("divert"));
				else {
					edits.push(edit);
					redirected.push(reference(owningChoice(obj) ? "choice" : "divert"));
				}
			}
		} else if (obj instanceof VariableReference && obj.pathIdentifiers.length > 0) {
			// A plain variable resolves to nothing here; a read count resolves to the flow.
			if (isInside(new Path(obj.pathIdentifiers as Identifier[]).ResolveFromContext(obj), flow)) blocking.push(reference("read count"));
		}
	}
	if (blocking.length > 0) {
		return {
			ok: false,
			error: `${nodeId} is still used in ${blocking.length} place(s) that cannot be redirected automatically.`,
			blocking: dedupeReferences(blocking),
		};
	}
	const plan = verified(graph, sources, edits, (after) => !after.nodes.some((n) => n.id === nodeId));
	if (!plan.ok) return plan;
	return { ok: true, edits, changes: describeEdits(sources, edits), redirected: dedupeReferences(redirected) };
}

/**
 * Deletes links (graph edges) by removing the diverts that make them. A choice whose only exit
 * is the divert goes away as a whole: without it, the choice would still be offered and lead
 * nowhere. A divert among other content of a branch is removed on its own.
 */
export function planDeleteLinks(graph: StoryGraph, sources: ReadonlyMap<string, string>, edgeIds: readonly string[]): DeletePlan {
	const edges = edgeIds.map((id) => graph.edges.find((e) => e.id === id));
	if (edges.length === 0 || edges.some((e) => !e)) return { ok: false, error: "The link is no longer in the story." };
	if (edges.some((e) => e!.kind === "call")) return { ok: false, error: "Function calls are part of expressions; edit them in the editor." };
	if (edges.some((e) => e!.kind === "dynamic")) {
		return { ok: false, error: "This link comes from a divert to a variable; change the variable or the divert in the editor." };
	}
	const parsed = parseInk(graph.rootFile, sources);
	if (!parsed.story) return { ok: false, error: "The story could not be parsed." };
	const { origins } = buildFlowGraph(parsed.story, parsed.diagnostics);

	const edits: TextEdit[] = [];
	for (const id of edgeIds) {
		const diverts = origins.get(id) ?? [];
		if (diverts.length === 0) return { ok: false, error: "Could not find the link in the text." };
		for (const divert of diverts) {
			const edit = removeDivert(graph.rootFile, sources, divert);
			if (!edit) return { ok: false, error: "This link is written in a way the graph cannot remove; edit it in the editor." };
			edits.push(edit);
		}
	}
	const merged = withoutOverlaps(edits);
	const plan = verified(graph, sources, merged, (after) => !after.edges.some((e) => edgeIds.includes(e.id)));
	if (!plan.ok) return plan;
	return { ok: true, edits: merged, changes: describeEdits(sources, merged), redirected: [] };
}

/** The whole choice (for choice links), otherwise the divert statement — or its line if nothing else is left on it. */
function removeDivert(rootFile: string, sources: ReadonlyMap<string, string>, divert: Divert): TextEdit | null {
	const meta = divert.debugMetadata;
	if (!meta?.fileName || meta.startLineNumber !== meta.endLineNumber) return null;
	const file = normalizeSourceFile(rootFile, meta.fileName);
	const lines = sources.get(file)?.split("\n");
	if (!lines) return null;

	const lineNo = meta.startLineNumber;
	const choice = owningChoice(divert);
	const range = choice && !divert.isThread ? choiceRange(choice) : null;
	if (range && isOnlyExit(lines, range, lineNo)) return removeLines(file, lines, range.first, range.last);

	const line = lines[lineNo - 1]!;
	// ink's span covers the target (and the arrow of a thread); take the arrows and spaces around it too.
	let from = meta.startCharacterNumber - 1;
	let to = meta.endCharacterNumber - 1;
	const before = /(?:->|<-)?\s*$/.exec(line.slice(0, from))!;
	from -= before[0].length;
	if (divert.isTunnel) to += /^\s*->/.exec(line.slice(to))?.[0].length ?? 0;
	const rest = (line.slice(0, from) + line.slice(to)).trimEnd();
	if (rest.trim() === "") {
		const block = emptiedConditional(divert, lines, lineNo);
		return block ? removeLines(file, lines, block.first, block.last) : removeLines(file, lines, lineNo, lineNo);
	}
	if (isRemovableGather(rest, lines, lineNo)) return removeLines(file, lines, lineNo, lineNo);
	// At the end of the line, also drop the spaces before the arrow.
	const atEnd = line.slice(to).trim() === "";
	return { file, from: { line: lineNo, ch: atEnd ? rest.length : from }, to: { line: lineNo, ch: atEnd ? line.length : to }, text: "" };
}

/**
 * `{ cond:` / `-> x` / `}` with nothing else inside: an empty conditional does not compile,
 * and it only existed for the divert, so it goes as a whole.
 */
function emptiedConditional(divert: Divert, lines: readonly string[], divertLine: number): { first: number; last: number } | null {
	const conditional = ancestorWithinFlow(divert, Conditional);
	if (!conditional) return null; // a gather line like `- Итог:` is not a branch
	const branch = emptiedBranch(lines, divertLine);
	if (branch) return branch;
	const meta = ownMeta(conditional);
	if (!meta) return null;
	const first = meta.startLineNumber;
	const last = meta.endLineNumber; // ink ends the conditional right before its closing brace
	if (!/^\s*\{[^{}]*:\s*(\/\/.*)?$/.test(lines[first - 1]!) || !/^\s*\}\s*(\/\/.*)?$/.test(lines[last - 1]!)) return null;
	for (let line = first + 1; line < last; line++) {
		const text = lines[line - 1]!.trim();
		if (line !== divertLine && text !== "" && !text.startsWith("//")) return null;
	}
	return { first, last };
}

/** A `- cond:` / `- else:` branch whose only content is the divert, followed by another branch or `}`. */
function emptiedBranch(lines: readonly string[], divertLine: number): { first: number; last: number } | null {
	const isFiller = (line: number): boolean => {
		const text = lines[line - 1]?.trim() ?? "";
		return text === "" || text.startsWith("//");
	};
	let header = divertLine - 1;
	while (header > 0 && isFiller(header)) header--;
	if (header < 1 || !/^\s*-\s*[^>\s].*:\s*(\/\/.*)?$/.test(lines[header - 1]!)) return null;
	let next = divertLine + 1;
	while (next <= lines.length && isFiller(next)) next++;
	return /^\s*(-(?!>)|\})/.test(lines[next - 1] ?? "") ? { first: header, last: divertLine } : null;
}

/** The divert is on the choice line, or the branch holds nothing else. */
function isOnlyExit(lines: readonly string[], range: { first: number; last: number }, divertLine: number): boolean {
	if (divertLine === range.first) return true;
	for (let line = range.first + 1; line <= range.last; line++) {
		const text = lines[line - 1]!.trim();
		if (line !== divertLine && text !== "" && !text.startsWith("//")) return false;
	}
	return true;
}

/**
 * A bare `-` gather left behind at the end of a block (as `planLink` writes `- -> target`)
 * gathers nothing; one followed by more content still joins the weave and must stay.
 */
function isRemovableGather(rest: string, lines: readonly string[], lineNo: number): boolean {
	if (!/^\s*-\s*$/.test(rest)) return false;
	for (let i = lineNo; i < lines.length; i++) {
		const next = lines[i]!.trim();
		if (next === "" || next.startsWith("//")) continue;
		return HEADER.test(next);
	}
	return true;
}

/** Lines of a choice and its branch: the weave siblings up to the next choice or gather. */
function choiceRange(choice: Choice): { first: number; last: number } | null {
	const start = ownMeta(choice);
	if (!start) return null;
	let last = lastLine(start);
	const weave = choice.parent;
	if (weave instanceof Weave) {
		const siblings = weave.content;
		for (let i = siblings.indexOf(choice) + 1; i < siblings.length; i++) {
			const sibling = siblings[i]!;
			if (sibling instanceof Choice || sibling instanceof Gather) break;
			for (const obj of walk(sibling)) {
				const meta = ownMeta(obj);
				if (meta && meta.fileName === start.fileName) last = Math.max(last, lastLine(meta));
			}
		}
	}
	return { first: start.startLineNumber, last };
}

type DebugMetadata = NonNullable<ParsedObject["debugMetadata"]>;

/** ink invents objects (implicit gathers, `-> DONE`) that borrow a parent's metadata: skip those. */
function ownMeta(obj: ParsedObject): DebugMetadata | null {
	return obj.hasOwnDebugMetadata ? obj.debugMetadata : null;
}

/** ink ends a whole-line object at column 1 of the next line. */
function lastLine(meta: DebugMetadata): number {
	return meta.endCharacterNumber === 1 && meta.endLineNumber > meta.startLineNumber ? meta.endLineNumber - 1 : meta.endLineNumber;
}

/** Drops edits that sit inside a removed range (e.g. two diverts of one deleted choice). */
function withoutOverlaps(edits: TextEdit[]): TextEdit[] {
	const key = (e: TextEdit): number => e.from.line * 1e6 + e.from.ch;
	const sorted = [...edits].sort((a, b) => a.file.localeCompare(b.file) || key(a) - key(b));
	const result: TextEdit[] = [];
	for (const edit of sorted) {
		const previous = result[result.length - 1];
		if (previous && previous.file === edit.file && key(edit) < previous.to.line * 1e6 + previous.to.ch) {
			// Overlaps the previous edit: keep the larger of the two.
			if (edit.to.line * 1e6 + edit.to.ch > previous.to.line * 1e6 + previous.to.ch) result[result.length - 1] = edit;
			continue;
		}
		result.push(edit);
	}
	return result;
}

function isInside(target: ParsedObject | null | undefined, flow: FlowBase): boolean {
	for (let current = target ?? null; current; current = current.parent) if (current === flow) return true;
	return false;
}

/** Replaces the whole written path (`knot.stitch`) with `text`. */
function replacePath(rootFile: string, components: readonly Identifier[], text: string): TextEdit | null {
	const first = components[0]?.debugMetadata;
	const last = components[components.length - 1]?.debugMetadata;
	if (!first?.fileName || !last || first.startLineNumber !== last.endLineNumber) return null;
	return {
		file: normalizeSourceFile(rootFile, first.fileName),
		from: { line: first.startLineNumber, ch: first.startCharacterNumber - 1 },
		to: { line: last.endLineNumber, ch: last.endCharacterNumber - 1 },
		text,
	};
}

function pathComponents(path: Path): Identifier[] {
	// Not exposed publicly by inkjs; stable across 2.x (pinned).
	return (path as unknown as { components: Identifier[] }).components ?? [];
}

function sourceLocation(rootFile: string, obj: ParsedObject): SourceLocation | null {
	const meta = ownMeta(obj);
	return meta?.fileName ? { file: normalizeSourceFile(rootFile, meta.fileName), line: meta.startLineNumber } : null;
}

function lineText(sources: ReadonlyMap<string, string>, location: SourceLocation): string {
	return sources.get(location.file)?.split("\n")[location.line - 1]?.trim() ?? "";
}

function dedupeReferences(references: Reference[]): Reference[] {
	const seen = new Map<string, Reference>();
	for (const r of references) seen.set(`${r.location.file}:${r.location.line}:${r.kind}`, r);
	return [...seen.values()];
}
