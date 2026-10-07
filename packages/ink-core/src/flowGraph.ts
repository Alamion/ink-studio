// Nodes (knots/stitches/functions) and edges (diverts, choices, tunnels, threads, calls).

import {
	Choice,
	Conditional,
	Divert,
	DivertTarget,
	FlowBase,
	FunctionCall,
	Gather,
	Knot,
	Sequence,
	Stitch,
	Text,
	VariableAssignment,
	VariableReference,
	Weave,
	type ParsedObject,
	type ParsedStory,
} from "./ink";
import { locationOf } from "./inkParser";
import { ancestorWithinFlow, enclosingFlow, flowNodeId, owningChoice, precededByChoice, walk } from "./inkTree";
import {
	MISSING_NODE_PREFIX,
	ROOT_NODE_ID,
	type Diagnostic,
	type EdgeKind,
	type SourceLocation,
	type StoryEdge,
	type StoryNode,
} from "./model";

export interface FlowGraph {
	nodes: StoryNode[];
	edges: StoryEdge[];
	diagnostics: Diagnostic[];
	transitions: Transition[];
	/** Parsed diverts behind each edge id (for edits; not part of the serialisable graph). */
	origins: Map<string, Divert[]>;
}

/**
 * A move between (or within) nodes that happens without the player choosing anything:
 * divert, tunnel, thread or dynamic divert not preceded by a choice, or a knot without
 * content of its own falling into its first stitch. Input for loop detection.
 */
export interface Transition {
	source: string;
	/** Equal to `source` for loops inside one node (e.g. back to a gather label). */
	target: string;
	/** Guarded by a condition or sequence: the loop may terminate. */
	conditional: boolean;
	/** Graph edge drawn for this transition, null for moves inside a node. */
	edgeId: string | null;
	location: SourceLocation | null;
}

/** Transitions of these kinds keep the story running on their own. */
const AUTOMATIC_KINDS: ReadonlySet<EdgeKind> = new Set(["divert", "tunnel", "thread", "dynamic"]);

/** Builds the flow graph; `knownDiagnostics` prevents duplicating errors ink already reported. */
export function buildFlowGraph(story: ParsedStory, knownDiagnostics: readonly Diagnostic[]): FlowGraph {
	return new FlowGraphBuilder(story, knownDiagnostics).build();
}

class FlowGraphBuilder {
	private readonly nodes = new Map<string, StoryNode>();
	private readonly edges = new Map<string, StoryEdge>();
	private readonly diagnostics: Diagnostic[] = [];
	private readonly transitions: Transition[] = [];
	private readonly origins = new Map<string, Divert[]>();
	/** Divert-target values assigned to variables: `~ x = -> knot` makes `-> x` a dynamic divert. */
	private readonly divertValues = new Map<string, FlowTarget[]>();

	constructor(
		private readonly story: ParsedStory,
		private readonly knownDiagnostics: readonly Diagnostic[],
	) {}

	build(): FlowGraph {
		this.addNode({ id: ROOT_NODE_ID, name: "(start)", kind: "root", parentId: null, location: null });
		const objects = [...walk(this.story)];
		for (const obj of objects) {
			if (obj instanceof Knot || obj instanceof Stitch) this.addFlowNode(obj);
			else if (obj instanceof VariableAssignment) this.collectDivertValue(obj);
		}
		for (const obj of objects) {
			if (obj instanceof Divert) this.addDivert(obj);
		}
		return {
			nodes: [...this.nodes.values()],
			edges: [...this.edges.values()],
			diagnostics: this.diagnostics,
			transitions: this.transitions,
			origins: this.origins,
		};
	}

	private addFlowNode(flow: Knot | Stitch): void {
		const id = flowNodeId(flow);
		const knot = flow instanceof Stitch && flow.parent ? enclosingFlow(flow.parent) : null;
		const parentId = knot instanceof Knot ? flowNodeId(knot) : null;
		const isFirstStitch = parentId !== null && ![...this.nodes.values()].some((n) => n.parentId === parentId);
		this.addNode({
			id,
			name: flow.identifier?.name ?? "?",
			kind: flow.isFunction ? "function" : flow instanceof Knot ? "knot" : "stitch",
			parentId,
			location: locationOf(flow),
			isEntry: isFirstStitch,
		});
		// A knot with no content of its own (no weave) falls straight into its first stitch.
		if (isFirstStitch && knot instanceof Knot && !knot.content.some((c) => c instanceof Weave)) {
			this.transitions.push({ source: parentId, target: id, conditional: false, edgeId: null, location: locationOf(flow) });
		}
	}

	private addNode(node: Pick<StoryNode, "id" | "name" | "kind" | "parentId" | "location"> & Partial<StoryNode>): StoryNode {
		const existing = this.nodes.get(node.id);
		if (existing) return existing;
		const full: StoryNode = { isEntry: false, terminates: false, internalDiverts: 0, ...node };
		this.nodes.set(full.id, full);
		return full;
	}

	private collectDivertValue(assignment: VariableAssignment): void {
		const expression = assignment.expression;
		if (!(expression instanceof DivertTarget) || !expression.divert.target) return;
		const resolved = resolveTarget(expression.divert);
		if (!resolved) return;
		const list = this.divertValues.get(assignment.variableName) ?? [];
		list.push(resolved);
		this.divertValues.set(assignment.variableName, list);
	}

	private addDivert(divert: Divert): void {
		// `-> knot` used as a value (VAR x = -> knot) is data, not control flow.
		if (!divert.target || divert.parent instanceof DivertTarget) return;
		const sourceFlow = enclosingFlow(divert);
		const sourceId = flowNodeId(sourceFlow);

		if (divert.isEnd || divert.isDone) {
			// ink appends an implicit `-> DONE` to the root weave; only count the author's own.
			if (divert.hasOwnDebugMetadata) this.nodes.get(sourceId)!.terminates = true;
			return;
		}

		const targetName = divert.target.firstComponent ?? "";
		if (divert.isFunctionCall && (FunctionCall.IsBuiltIn(targetName) || this.story.IsExternal(targetName))) return;

		const target = resolveTarget(divert);
		if (target) {
			this.addResolvedEdge(divert, sourceFlow, target, edgeKind(divert), null);
			return;
		}

		const variableName = divert.PathAsVariableName();
		const possibleTargets = variableName ? this.divertValues.get(variableName) : undefined;
		if (variableName && possibleTargets) {
			for (const possible of possibleTargets) this.addResolvedEdge(divert, sourceFlow, possible, "dynamic", variableName);
			return;
		}
		this.addMissingEdge(divert, sourceId, divert.target.dotSeparatedComponents);
	}

	private addResolvedEdge(divert: Divert, sourceFlow: FlowBase, target: FlowTarget, kind: EdgeKind, label: string | null): void {
		const sourceId = flowNodeId(sourceFlow);
		const targetId = flowNodeId(target.flow);
		const choice = owningChoice(divert);
		const conditional = Boolean(choice?.condition) || ancestorWithinFlow(divert, Conditional) !== null;
		const internal = target.flow === sourceFlow;
		if (internal) this.nodes.get(sourceId)!.internalDiverts++;
		const edgeId = internal
			? null
			: this.addEdge(divert, {
					source: sourceId,
					target: targetId,
					kind,
					label: kind === "choice" && choice ? choiceText(choice) : label,
					targetLabel: target.label,
					conditional,
					choiceLocation: kind === "choice" && choice ? locationOf(choice) : null,
				});
		if (AUTOMATIC_KINDS.has(kind) && !precededByChoice(divert)) {
			this.transitions.push({
				source: sourceId,
				target: targetId,
				// Diverts inside a sequence ({a|b}, {&...}) only run on some visits.
				conditional: conditional || ancestorWithinFlow(divert, Sequence) !== null,
				edgeId,
				location: locationOf(divert),
			});
		}
	}

	private addMissingEdge(divert: Divert, sourceId: string, targetPath: string): void {
		const id = MISSING_NODE_PREFIX + targetPath;
		this.addNode({ id, name: targetPath, kind: "missing", parentId: null, location: null });
		const location = locationOf(divert);
		const kind = edgeKind(divert);
		const choice = kind === "choice" ? owningChoice(divert) : null;
		this.addEdge(divert, { source: sourceId, target: id, kind, label: null, targetLabel: null, conditional: false, choiceLocation: locationOf(choice) });
		const alreadyReported = this.knownDiagnostics.some(
			(d) => d.location?.file === location?.file && d.location?.line === location?.line,
		);
		if (!alreadyReported) {
			this.diagnostics.push({ severity: "error", message: `Divert target not found: ${targetPath}`, location });
		}
	}

	/** Adds the edge (or another site of an existing one) and returns its id. */
	private addEdge(divert: Divert, edge: Omit<StoryEdge, "id" | "location" | "sites">): string {
		const id = `${edge.kind}:${edge.source}->${edge.target}#${edge.targetLabel ?? ""}#${edge.label ?? ""}`;
		const location = locationOf(divert);
		const existing = this.edges.get(id);
		if (!existing) this.edges.set(id, { id, ...edge, location, sites: location ? [location] : [] });
		else if (location && !existing.sites.some((s) => s.file === location.file && s.line === location.line)) existing.sites.push(location);
		this.origins.set(id, [...(this.origins.get(id) ?? []), divert]);
		return id;
	}
}

interface FlowTarget {
	flow: FlowBase;
	/** Gather/choice label when the divert points inside a flow. */
	label: string | null;
}

function resolveTarget(divert: Divert): FlowTarget | null {
	const resolved = divert.target?.ResolveFromContext(divert);
	if (!resolved) return null;
	if (resolved instanceof FlowBase) return { flow: resolved, label: null };
	const label = resolved instanceof Gather || resolved instanceof Choice ? resolved.name : null;
	return { flow: enclosingFlow(resolved), label };
}

function edgeKind(divert: Divert): EdgeKind {
	if (divert.isFunctionCall) return "call";
	if (divert.isTunnel) return "tunnel";
	if (divert.isThread) return "thread";
	return owningChoice(divert) ? "choice" : "divert";
}

/** Visible choice text (start + bracketed part), with inline logic shown as `{…}`. */
function choiceText(choice: Choice): string {
	const parts: string[] = [];
	const collect = (list: ParsedObject | null | undefined): void => {
		if (!list) return;
		for (const obj of walk(list)) {
			if (obj instanceof Text) parts.push(obj.text);
			else if (obj instanceof VariableReference) parts.push(`{${obj.name}}`);
		}
	};
	collect(choice.startContent);
	collect(choice.choiceOnlyContent);
	const text = parts.join("").replace(/\s+/g, " ").trim();
	return text || (choice.isInvisibleDefault ? "(fallback)" : "(choice)");
}
