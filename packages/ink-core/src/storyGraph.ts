// Builds the StoryGraph: parse, flow graph, variables, loops.

import { buildFlowGraph } from "./flowGraph";
import { normalizeSourceFile, parseInk } from "./inkParser";
import { findChoicelessLoops } from "./loops";
import type { SourceLocation, StoryGraph } from "./model";
import { analyzeVariables } from "./variables";

/** Parses the story rooted at `rootFile` (vault path) using in-memory `sources` (vault path → text). */
export function buildStoryGraph(rootFile: string, sources: ReadonlyMap<string, string>): StoryGraph {
	const parsed = parseInk(rootFile, sources);
	const empty: StoryGraph = {
		rootFile,
		files: parsed.files,
		nodes: [],
		edges: [],
		variables: [],
		accesses: [],
		diagnostics: parsed.diagnostics,
		loops: [],
		compiled: parsed.compiled,
	};
	if (!parsed.story) return empty;

	try {
		const flow = buildFlowGraph(parsed.story, parsed.diagnostics);
		const vars = analyzeVariables(parsed.story, flow.edges);
		const loops = findChoicelessLoops(flow.transitions);
		const fix = <T extends { location: SourceLocation | null }>(item: T): T => ({
			...item,
			location: normalizeLocation(rootFile, item.location),
		});
		return {
			...empty,
			nodes: flow.nodes.map(fix),
			edges: flow.edges.map((e) => ({
				...fix(e),
				sites: e.sites.map((s) => normalizeLocation(rootFile, s)!),
				choiceLocation: normalizeLocation(rootFile, e.choiceLocation),
			})),
			variables: vars.variables.map((v) => ({ ...v, declaredAt: normalizeLocation(rootFile, v.declaredAt) })),
			accesses: vars.accesses.map(fix),
			diagnostics: [...parsed.diagnostics, ...flow.diagnostics.map(fix), ...loops.diagnostics.map(fix)],
			loops: loops.loops.map(fix),
		};
	} catch (error) {
		// A half-parsed tree can break assumptions of the analysis; report instead of crashing the view.
		const message = `Graph analysis failed: ${error instanceof Error ? error.message : String(error)}`;
		return { ...empty, diagnostics: [...parsed.diagnostics, { severity: "error", message, location: null }] };
	}
}

function normalizeLocation(rootFile: string, location: SourceLocation | null): SourceLocation | null {
	return location && { ...location, file: normalizeSourceFile(rootFile, location.file) };
}
