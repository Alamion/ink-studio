// Canvas actions as text edits. The .ink files stay the source of truth: every action becomes a
// small list of edits, and a plan is only offered when the story still compiles as well as before.

import { buildStoryGraph } from "./storyGraph";
import { MISSING_NODE_PREFIX, ROOT_NODE_ID, type StoryGraph, type StoryNode } from "./model";

/** `line` is 1-based (like ink and our locations), `ch` is a 0-based column. */
export interface TextPosition {
	line: number;
	ch: number;
}

export interface TextEdit {
	file: string;
	from: TextPosition;
	to: TextPosition;
	text: string;
}

export type EditPlan = { ok: true; edits: TextEdit[] } | { ok: false; error: string };

export type LinkKind = "choice" | "sticky" | "divert" | "tunnel";

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RESERVED = new Set(["END", "DONE", "VAR", "CONST", "LIST", "INCLUDE", "EXTERNAL", "temp", "return", "function", "true", "false", "not", "and", "or", "mod", "has", "hasnt", "else"]);
/** Any knot/stitch/function header line: `=== name ===`, `= name`, `== function f(x) ==`. */
export const HEADER = /^\s*=/;
export const KNOT_HEADER = /^\s*={2,}/;
const CHOICE_LINE = /^\s*[*+]/;
const GATHER_LINE = /^\s*-(?!>)/;

/** Validates a new knot/stitch name against ink's rules and the names already in use. */
export function checkName(graph: StoryGraph, name: string, siblingOf: string | null): string | null {
	if (!IDENTIFIER.test(name)) return "Use letters, digits and _ (not starting with a digit).";
	if (RESERVED.has(name)) return `"${name}" is a reserved word in ink.`;
	if (graph.variables.some((v) => v.name === name)) return `"${name}" is already a variable.`;
	const taken = graph.nodes.some((n) =>
		siblingOf === null ? n.parentId === null && n.name === name : n.parentId === siblingOf && n.name === name,
	);
	return taken ? `"${name}" already exists.` : null;
}

/** Appends a new knot to `file` (the story root by default). */
export function planCreateKnot(graph: StoryGraph, sources: ReadonlyMap<string, string>, name: string, file = graph.rootFile): EditPlan {
	const problem = checkName(graph, name, null);
	if (problem) return { ok: false, error: problem };
	const text = sources.get(file);
	if (text === undefined) return { ok: false, error: `File not found: ${file}` };
	return verified(graph, sources, [appendAtEnd(file, text, [`=== ${name} ===`, `// TODO: write ${name}`, "-> END"])], (after) =>
		after.nodes.some((n) => n.id === name),
	);
}

/** Adds a stitch at the end of a knot (after its existing stitches). */
export function planCreateStitch(graph: StoryGraph, sources: ReadonlyMap<string, string>, knotId: string, name: string): EditPlan {
	const knot = graph.nodes.find((n) => n.id === knotId);
	if (!knot || knot.kind !== "knot" || !knot.location) return { ok: false, error: "Stitches can only be added to knots." };
	const problem = checkName(graph, name, knotId);
	if (problem) return { ok: false, error: problem };
	const lines = sources.get(knot.location.file)?.split("\n");
	if (!lines) return { ok: false, error: `File not found: ${knot.location.file}` };
	const end = lastContentLine(lines, knot.location.line, KNOT_HEADER);
	const edit = insertAfterLine(knot.location.file, lines, end, ["", `= ${name}`, `// TODO: write ${name}`, "-> END"]);
	return verified(graph, sources, [edit], (after) => after.nodes.some((n) => n.id === `${knotId}.${name}`));
}

/**
 * Connects two nodes by adding a line at the end of the source's own content (before its
 * stitches). A plain divert after top-level choices would silently become part of the last
 * choice's branch, so it goes after a gather (`- -> target`) instead.
 */
export function planLink(
	graph: StoryGraph,
	sources: ReadonlyMap<string, string>,
	sourceId: string,
	targetId: string,
	kind: LinkKind,
	choiceText = "",
): EditPlan {
	const source = graph.nodes.find((n) => n.id === sourceId);
	const target = graph.nodes.find((n) => n.id === targetId);
	if (!source || !source.location || source.id === ROOT_NODE_ID || source.kind === "missing") {
		return { ok: false, error: "Links can start from a knot or a stitch." };
	}
	if (!target || target.id === ROOT_NODE_ID || target.id.startsWith(MISSING_NODE_PREFIX)) {
		return { ok: false, error: "Links can end at a knot or a stitch." };
	}
	if (target.kind === "function" || source.kind === "function") return { ok: false, error: "Functions are called, not linked." };
	if ((kind === "choice" || kind === "sticky") && !choiceText.trim()) return { ok: false, error: "A choice needs its text." };

	const lines = sources.get(source.location.file)?.split("\n");
	if (!lines) return { ok: false, error: `File not found: ${source.location.file}` };
	const end = lastContentLine(lines, source.location.line, HEADER);
	const own = lines.slice(source.location.line, end);
	const lastMarker = [...own].reverse().find((l) => CHOICE_LINE.test(l) || GATHER_LINE.test(l));
	const afterChoices = lastMarker !== undefined && CHOICE_LINE.test(lastMarker);

	const path = targetPath(source, target);
	const statement = {
		choice: `* [${escapeText(choiceText)}] -> ${path}`,
		sticky: `+ [${escapeText(choiceText)}] -> ${path}`,
		divert: `${afterChoices ? "- " : ""}-> ${path}`,
		tunnel: `${afterChoices ? "- " : ""}-> ${path} ->`,
	}[kind];
	const edit = insertAfterLine(source.location.file, lines, end, [statement]);
	return verified(graph, sources, [edit], (after) => after.edges.some((e) => e.source === sourceId && e.target === targetId));
}

/** Shortest path ink resolves from the source: a sibling stitch by name, otherwise `knot.stitch`. */
export function targetPath(source: StoryNode, target: StoryNode): string {
	const sourceKnot = source.parentId ?? source.id;
	return target.parentId && target.parentId === sourceKnot ? target.name : target.id;
}

/** Applies edits to one file's text (edits must not overlap). */
export function applyTextEdits(text: string, edits: readonly TextEdit[]): string {
	const lineStarts = [0];
	for (let i = 0; i < text.length; i++) if (text[i] === "\n") lineStarts.push(i + 1);
	const offset = (p: TextPosition): number => (lineStarts[p.line - 1] ?? text.length) + p.ch;
	const sorted = [...edits].sort((a, b) => offset(b.from) - offset(a.from));
	let result = text;
	for (const edit of sorted) result = result.slice(0, offset(edit.from)) + edit.text + result.slice(offset(edit.to));
	return result;
}

export function applyToSources(sources: ReadonlyMap<string, string>, edits: readonly TextEdit[]): Map<string, string> {
	const result = new Map(sources);
	for (const file of new Set(edits.map((e) => e.file))) {
		result.set(file, applyTextEdits(result.get(file) ?? "", edits.filter((e) => e.file === file)));
	}
	return result;
}

/**
 * Accepts a plan only if the edited story has no more errors than before and the intended
 * change is really there (e.g. the new edge exists). Protects the story from broken edits.
 */
export function verified(
	graph: StoryGraph,
	sources: ReadonlyMap<string, string>,
	edits: TextEdit[],
	intended: (after: StoryGraph) => boolean,
): EditPlan {
	const after = buildStoryGraph(graph.rootFile, applyToSources(sources, edits));
	const errors = (g: StoryGraph): number => g.diagnostics.filter((d) => d.severity === "error").length;
	if (errors(after) > errors(graph)) {
		const fresh = after.diagnostics.find((d) => d.severity === "error" && !graph.diagnostics.some((b) => b.message === d.message));
		return { ok: false, error: `The story would not compile: ${fresh?.message ?? "new errors"}` };
	}
	if (!intended(after)) return { ok: false, error: "The change did not come out as expected; nothing was edited." };
	return { ok: true, edits };
}

/** A line-level view of one edit, for previews: `before` lines are replaced by `after` lines. */
export interface LineChange {
	file: string;
	line: number;
	before: string[];
	after: string[];
}

/** What each edit does to whole lines (unchanged trailing context is left out). */
export function describeEdits(sources: ReadonlyMap<string, string>, edits: readonly TextEdit[]): LineChange[] {
	return [...edits]
		.sort((a, b) => a.file.localeCompare(b.file) || a.from.line - b.from.line || a.from.ch - b.from.ch)
		.map((edit) => {
			const lines = (sources.get(edit.file) ?? "").split("\n");
			const segment = lines.slice(edit.from.line - 1, edit.to.line);
			const joined = segment.join("\n");
			let to = edit.to.ch;
			for (let i = 0; i < edit.to.line - edit.from.line; i++) to += segment[i]!.length + 1;
			const before = segment;
			const after = (joined.slice(0, edit.from.ch) + edit.text + joined.slice(to)).split("\n");
			while (before.length > 1 && after.length > 0 && before[before.length - 1] === after[after.length - 1]) {
				before.pop();
				after.pop();
			}
			return { file: edit.file, line: edit.from.line, before, after };
		});
}

/** Removes whole lines `first..last` (1-based, inclusive). */
export function removeLines(file: string, lines: readonly string[], first: number, last: number): TextEdit {
	if (last < lines.length) return { file, from: { line: first, ch: 0 }, to: { line: last + 1, ch: 0 }, text: "" };
	// The block runs to the end of the file: take the newline before it instead.
	const from = first > 1 ? { line: first - 1, ch: lines[first - 2]!.length } : { line: 1, ch: 0 };
	return { file, from, to: { line: lines.length, ch: lines[lines.length - 1]!.length }, text: first > 1 ? "\n" : "" };
}

/** 1-based index of the last line before the next line matching `stopAt` (or the file end). */
export function blockEnd(lines: readonly string[], headerLine: number, stopAt: RegExp): number {
	for (let i = headerLine; i < lines.length; i++) if (stopAt.test(lines[i]!)) return i;
	return lines.length;
}

/** 1-based index of the last non-blank line of the block that starts at `headerLine`. */
function lastContentLine(lines: readonly string[], headerLine: number, stopAt: RegExp): number {
	let next = lines.length;
	for (let i = headerLine; i < lines.length; i++) {
		if (stopAt.test(lines[i]!)) {
			next = i;
			break;
		}
	}
	let last = next; // 1-based line before `next` (0-based) is `next`
	while (last > headerLine && lines[last - 1]!.trim() === "") last--;
	return last;
}

function insertAfterLine(file: string, lines: readonly string[], line: number, newLines: readonly string[]): TextEdit {
	const at = { line, ch: lines[line - 1]?.length ?? 0 };
	return { file, from: at, to: at, text: newLines.map((l) => `\n${l}`).join("") };
}

function appendAtEnd(file: string, text: string, newLines: readonly string[]): TextEdit {
	const lines = text.split("\n");
	const at = { line: lines.length, ch: lines[lines.length - 1]!.length };
	const lead = text.trim() === "" ? "" : text.endsWith("\n\n") ? "" : text.endsWith("\n") ? "\n" : "\n\n";
	return { file, from: at, to: at, text: `${lead}${newLines.join("\n")}\n` };
}

/** Choice text is ink markup: escape what would change its meaning. */
function escapeText(text: string): string {
	return text.trim().replace(/[\\[\]{}|#]/g, (c) => `\\${c}`).replace(/\/\//g, "/\\/").replace(/->/g, "-\\>").replace(/<-/g, "<\\-");
}
