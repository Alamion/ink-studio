// StoryGraph → React Flow nodes/edges. ELK computes a layered layout in story reading order
// (knots are groups around their stitches); saved positions from the sidecar win over computed
// ones. Parallel diverts between the same two nodes are bundled into one visual edge.

import { MarkerType, type Edge, type Node } from "@xyflow/react";
import ELK from "elkjs/lib/elk.bundled.js";
import type { ElkNode } from "elkjs/lib/elk-api";
import { CONFIG } from "../config";
import { ROOT_NODE_ID, type EdgeKind, type StoryEdge, type StoryGraph, type StoryNode } from "@ink-studio/core";
import type { Point } from "../adapter/layoutStore";
import { fitGroups } from "./groupFit";

export interface InkNodeData extends Record<string, unknown> {
	node: StoryNode;
	reads: string[];
	writes: string[];
	/** Part of a choiceless loop: `certain` hangs the story, `possible` depends on conditions. */
	loop: "certain" | "possible" | null;
}
export type InkFlowNode = Node<InkNodeData, "ink" | "inkGroup">;
export type LoopLevel = "certain" | "possible";

export interface InkEdgeData extends Record<string, unknown> {
	/** All diverts from source to target, in source order. */
	edges: StoryEdge[];
	/** Kind used for the line style when the bundle mixes kinds. */
	kind: EdgeKind;
	loop: LoopLevel | null;
	/** Separates detours that share a target so their corridors do not overlap. */
	lane: number;
}
export type InkFlowEdge = Edge<InkEdgeData, "ink">;

/** Which kind styles a mixed bundle: the one that matters most to a reader. */
const KIND_PRIORITY: readonly EdgeKind[] = ["choice", "divert", "dynamic", "tunnel", "thread", "call"];

export interface FlowElements {
	nodes: InkFlowNode[];
	edges: InkFlowEdge[];
}

export interface LayoutOptions {
	showFunctions: boolean;
}

const elk = new ELK();

export async function layoutGraph(
	graph: StoryGraph,
	options: LayoutOptions,
	saved: Readonly<Record<string, Point>>,
): Promise<FlowElements> {
	const visible = visiblePart(graph, options);
	const order = storyOrder(visible.nodes, visible.edges);
	const nodes = [...visible.nodes].sort((a, b) => order.get(a.id)! - order.get(b.id)!);
	const bundles = bundleEdges(visible.edges, order);
	const usage = variableUsage(graph);
	const loopOf = loopMembership(graph);
	const groupIds = new Set(nodes.filter((n) => n.parentId).map((n) => n.parentId!));
	const childrenOf = (id: string): StoryNode[] => nodes.filter((n) => n.parentId === id);

	// Phase 1: every knot group on its own, with its internal diverts only — the group reads as a
	// small flow of its stitches, not stretched by edges that leave it.
	const { headerHeight, padding } = CONFIG.group;
	const groups = new Map<string, ElkNode>();
	for (const groupId of groupIds) {
		const children = childrenOf(groupId);
		const inside = new Set(children.map((c) => c.id));
		const result = await elk.layout({
			id: groupId,
			layoutOptions: CONFIG.elk,
			children: children.map((c) => ({ id: c.id, ...leafSize(usage.get(c.id)) })),
			edges: bundles
				.filter((b) => inside.has(b.source) && inside.has(b.target))
				.map((b) => ({ id: b.id, sources: [b.source], targets: [b.target] })),
		});
		const laidChildren = (result.children ?? []).map((c) => ({ ...c, x: (c.x ?? 0) + padding, y: (c.y ?? 0) + headerHeight + padding }));
		groups.set(groupId, {
			id: groupId,
			width: Math.max(...laidChildren.map((c) => c.x + (c.width ?? 0))) + padding,
			height: Math.max(...laidChildren.map((c) => c.y + (c.height ?? 0))) + padding,
			children: laidChildren,
		});
	}

	// Phase 2: the story level, groups as single blocks; edges touching a stitch attach to its knot.
	const topOf = (id: string): string => nodes.find((n) => n.id === id)?.parentId ?? id;
	const topEdges = new Map<string, { id: string; sources: string[]; targets: string[] }>();
	for (const b of bundles) {
		const [from, to] = [topOf(b.source), topOf(b.target)];
		const id = `${from}->${to}`;
		if (from !== to && !topEdges.has(id)) topEdges.set(id, { id, sources: [from], targets: [to] });
	}
	const topLevel = await elk.layout({
		id: "story",
		layoutOptions: CONFIG.elk,
		children: nodes
			.filter((n) => !n.parentId)
			.map((n) => {
				const group = groups.get(n.id);
				return group ? { id: n.id, width: group.width, height: group.height } : { id: n.id, ...leafSize(usage.get(n.id)) };
			}),
		edges: [...topEdges.values()],
	});
	const laidOut: ElkNode = {
		id: "story",
		children: (topLevel.children ?? []).map((n) => ({ ...n, children: groups.get(n.id)?.children ?? [] })),
	};

	const flowNodes: InkFlowNode[] = [];
	const place = (elkNode: ElkNode, parentId: string | null): void => {
		const node = nodes.find((n) => n.id === elkNode.id)!;
		const vars = usage.get(node.id);
		const isGroup = groupIds.has(node.id);
		flowNodes.push({
			id: node.id,
			type: isGroup ? "inkGroup" : "ink",
			position: saved[node.id] ?? { x: elkNode.x ?? 0, y: elkNode.y ?? 0 },
			...(parentId ? { parentId, expandParent: true } : {}),
			data: {
				node,
				reads: [...(vars?.reads ?? [])].sort(),
				writes: [...(vars?.writes ?? [])].sort(),
				loop: loopOf.nodes.get(node.id) ?? null,
			},
			// Group size is derived from the children below (fitGroups).
			style: isGroup ? {} : { width: elkNode.width, height: elkNode.height },
			draggable: true,
			connectable: false,
		});
		// React Flow requires parents before their children.
		for (const child of elkNode.children ?? []) place(child, node.id);
	};
	for (const child of laidOut.children ?? []) place(child, null);

	return {
		nodes: fitGroups(flowNodes),
		edges: bundles.map((b) => toFlowEdge(b, loopOf.edges)),
	};
}

function visiblePart(graph: StoryGraph, { showFunctions }: LayoutOptions): { nodes: StoryNode[]; edges: StoryEdge[] } {
	const nodes = graph.nodes.filter((n) => showFunctions || n.kind !== "function");
	const ids = new Set(nodes.map((n) => n.id));
	const edges = graph.edges.filter((e) => ids.has(e.source) && ids.has(e.target));
	return { nodes, edges };
}

function variableUsage(graph: StoryGraph): Map<string, { reads: Set<string>; writes: Set<string> }> {
	const usage = new Map<string, { reads: Set<string>; writes: Set<string> }>();
	for (const access of graph.accesses) {
		let entry = usage.get(access.nodeId);
		if (!entry) usage.set(access.nodeId, (entry = { reads: new Set(), writes: new Set() }));
		(access.mode === "write" ? entry.writes : entry.reads).add(access.variable);
	}
	return usage;
}

function leafSize(vars: { reads: Set<string>; writes: Set<string> } | undefined): { width: number; height: number } {
	const rows = (vars?.reads.size ? 1 : 0) + (vars?.writes.size ? 1 : 0);
	return { width: CONFIG.node.width, height: CONFIG.node.baseHeight + rows * CONFIG.node.rowHeight };
}

/** Node and edge ids on choiceless loops; `certain` wins when an id is on several loops. */
function loopMembership(graph: StoryGraph): {
	nodes: Map<string, "certain" | "possible">;
	edges: Map<string, "certain" | "possible">;
} {
	const nodes = new Map<string, "certain" | "possible">();
	const edges = new Map<string, "certain" | "possible">();
	for (const loop of graph.loops) {
		const level = loop.certain ? "certain" : "possible";
		for (const id of loop.nodeIds) if (nodes.get(id) !== "certain") nodes.set(id, level);
		for (const id of loop.edgeIds) if (edges.get(id) !== "certain") edges.set(id, level);
	}
	return { nodes, edges };
}

interface EdgeBundle {
	id: string;
	source: string;
	target: string;
	edges: StoryEdge[];
	lane: number;
}

/** One bundle per (source, target) pair; lanes number the bundles entering the same target. */
export function bundleEdges(edges: readonly StoryEdge[], order: ReadonlyMap<string, number>): EdgeBundle[] {
	const bundles = new Map<string, EdgeBundle>();
	for (const edge of edges) {
		const id = `${edge.source}->${edge.target}`;
		const bundle = bundles.get(id) ?? { id, source: edge.source, target: edge.target, edges: [], lane: 0 };
		bundle.edges.push(edge);
		bundles.set(id, bundle);
	}
	const byTarget = new Map<string, EdgeBundle[]>();
	for (const bundle of bundles.values()) byTarget.set(bundle.target, [...(byTarget.get(bundle.target) ?? []), bundle]);
	for (const group of byTarget.values()) {
		group.sort((a, b) => (order.get(a.source) ?? 0) - (order.get(b.source) ?? 0));
		group.forEach((bundle, index) => (bundle.lane = index));
	}
	return [...bundles.values()];
}

/**
 * Reading order: breadth-first from the story start along the diverts, so ELK lays the story out
 * left to right the way a player meets it. Unreachable nodes follow in source order.
 */
export function storyOrder(nodes: readonly StoryNode[], edges: readonly StoryEdge[]): Map<string, number> {
	const next = new Map<string, string[]>();
	for (const edge of edges) next.set(edge.source, [...(next.get(edge.source) ?? []), edge.target]);
	// Entering a knot leads into its first stitch.
	for (const n of nodes) if (n.isEntry && n.parentId) next.set(n.parentId, [n.id, ...(next.get(n.parentId) ?? [])]);
	const parentOf = new Map(nodes.map((n) => [n.id, n.parentId]));
	const order = new Map<string, number>();
	const visit = (id: string): void => {
		if (order.has(id) || !parentOf.has(id)) return;
		// A stitch is reached through its knot: keep the knot (group) ahead of its children.
		const parent = parentOf.get(id);
		if (parent && !order.has(parent)) order.set(parent, order.size);
		order.set(id, order.size);
	};
	const queue = [ROOT_NODE_ID];
	visit(ROOT_NODE_ID);
	while (queue.length > 0) {
		for (const target of next.get(queue.shift()!) ?? []) {
			if (order.has(target)) continue;
			visit(target);
			queue.push(target);
		}
	}
	for (const node of nodes) visit(node.id);
	return order;
}

function toFlowEdge(bundle: EdgeBundle, loops: ReadonlyMap<string, LoopLevel>): InkFlowEdge {
	const levels = bundle.edges.map((e) => loops.get(e.id)).filter((l): l is LoopLevel => l !== undefined);
	const loop: LoopLevel | null = levels.includes("certain") ? "certain" : (levels[0] ?? null);
	const kind = KIND_PRIORITY.find((k) => bundle.edges.some((e) => e.kind === k)) ?? bundle.edges[0]!.kind;
	return {
		id: bundle.id,
		type: "ink",
		source: bundle.source,
		target: bundle.target,
		className: [
			"ink-edge",
			`ink-edge-${kind}`,
			bundle.edges.every((e) => e.conditional) ? "ink-edge-conditional" : "",
			loop ? `ink-edge-loop ink-edge-loop-${loop}` : "",
		]
			.filter(Boolean)
			.join(" "),
		markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
		data: { edges: bundle.edges, kind, loop, lane: bundle.lane },
		focusable: true,
	};
}
