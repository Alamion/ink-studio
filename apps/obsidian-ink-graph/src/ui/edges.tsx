// Custom edge: routed from live node boxes (see edgeGeometry), with an HTML label that lists the
// bundled choices one per line. Click selects the edge; double click opens that divert in the editor.

import { EdgeLabelRenderer, useInternalNode, useStore, type EdgeProps, type InternalNode } from "@xyflow/react";
import { createContext, useContext } from "react";
import { CONFIG } from "../config";
import type { SourceLocation, StoryEdge } from "@ink-studio/core";
import { routeEdge, type Box } from "./edgeGeometry";
import type { InkFlowEdge, InkFlowNode } from "./layout";

export interface EdgeUi {
	/** Hovered or selected node: its edges are emphasised, all others faded. */
	focusNodeId: string | null;
	/** Selected visual edge: highlighted, the others faded (unless a node is in focus). */
	selectedEdgeId: string | null;
	onSelect: (edgeId: string) => void;
	onMenu?: (event: MouseEvent, edgeId: string) => void;
	onOpen: (location: SourceLocation) => void;
	labelMaxLength: number;
	labelMaxLines: number;
}

export const EdgeUiContext = createContext<EdgeUi>({ focusNodeId: null, selectedEdgeId: null, onSelect: () => {}, onOpen: () => {}, labelMaxLength: CONFIG.choiceLabelMaxLength, labelMaxLines: CONFIG.edges.maxLabelLines });

export const KIND_ICON: Record<StoryEdge["kind"], string> = {
	choice: "›",
	divert: "→",
	tunnel: "↳",
	thread: "⑂",
	call: "ƒ",
	dynamic: "⇢",
};

export function InkEdge({ id, source, target, data, markerEnd }: EdgeProps<InkFlowEdge>) {
	const ui = useContext(EdgeUiContext);
	useStore((s) => s.nodes); // re-route whenever any node moves or resizes
	const sourceNode = useInternalNode<InkFlowNode>(source);
	const targetNode = useInternalNode<InkFlowNode>(target);
	const obstacles = useObstacles(sourceNode, targetNode);
	if (!sourceNode || !targetNode || !data) return null;

	const route = routeEdge(boxOf(sourceNode), boxOf(targetNode), data.lane, obstacles);
	const focus = ui.focusNodeId;
	const selected = ui.selectedEdgeId === id;
	const state = [
		focus ? (source === focus || target === focus ? "is-focused" : "is-faded") : ui.selectedEdgeId && !selected ? "is-faded" : "",
		selected ? "is-selected" : "",
	].join(" ");
	const lines = data.edges.map((e) => describe(e, ui.labelMaxLength)).filter((line): line is LabelLine => line !== null);
	const shown = lines.slice(0, ui.labelMaxLines);
	const hidden = lines.length - shown.length;

	return (
		<>
			<path id={id} className={`react-flow__edge-path ${state}`} d={route.path} markerEnd={markerEnd} fill="none" />
			<path className="react-flow__edge-interaction" d={route.path} fill="none" strokeOpacity={0} strokeWidth={16} />
			{lines.length > 0 && (
				<EdgeLabelRenderer>
					<div
						className={`ink-edge-label nodrag nopan ${state} ${data.loop ? "is-loop" : ""}`}
						style={{ transform: `translate(-50%, -50%) translate(${route.labelX}px, ${route.labelY}px)` }}
						title={`${lines.map((l) => l.full).join("\n")}\n\nClick to select, double-click to open`}
						onClick={() => ui.onSelect(id)}
						onContextMenu={(e) => {
							// Same menu as a right click on the line itself.
							e.preventDefault();
							e.stopPropagation();
							ui.onSelect(id);
							ui.onMenu?.(e.nativeEvent, id);
						}}
					>
						{shown.map((line, i) => (
							<div key={i} className="ink-edge-label-line" onDoubleClick={() => line.location && ui.onOpen(line.location)}>
								<span className="ink-edge-label-icon">{line.icon}</span>
								{line.conditional && <span className="ink-edge-label-if">if</span>}
								<span className="ink-edge-label-text">{line.text}</span>
							</div>
						))}
						{hidden > 0 && <div className="ink-edge-label-more">+{hidden} more</div>}
					</div>
				</EdgeLabelRenderer>
			)}
		</>
	);
}

export const EDGE_TYPES = { ink: InkEdge };

interface LabelLine {
	icon: string;
	text: string;
	full: string;
	conditional: boolean;
	location: SourceLocation | null;
}

/** A plain unconditional divert needs no words: the line says it all. */
function describe(edge: StoryEdge, maxLength: number): LabelLine | null {
	const target = edge.targetLabel ? ` → (${edge.targetLabel})` : "";
	let text: string;
	if (edge.kind === "choice") text = edge.label ?? "(choice)";
	else if (edge.kind === "dynamic") text = `-> ${edge.label ?? "?"}`;
	else if (edge.kind === "tunnel" || edge.kind === "thread") text = edge.kind;
	else if (edge.conditional || edge.targetLabel) text = "";
	else return null;
	const full = `${edge.conditional ? "if " : ""}${text}${target}`.trim();
	return {
		icon: KIND_ICON[edge.kind],
		text: truncate(`${text}${target}`.trim(), maxLength),
		full: `${KIND_ICON[edge.kind]} ${full}`,
		conditional: edge.conditional,
		location: edge.location,
	};
}

function truncate(text: string, max: number): string {
	return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Boxes a detour must avoid: every node except the two ends and the group that holds both. */
function useObstacles(source: InternalNode<InkFlowNode> | undefined, target: InternalNode<InkFlowNode> | undefined): Box[] {
	const lookup = useStore((s) => s.nodeLookup);
	if (!source || !target) return [];
	const shared = source.parentId && source.parentId === target.parentId ? source.parentId : null;
	const boxes: Box[] = [];
	for (const node of lookup.values()) {
		if (node.id === source.id || node.id === target.id || node.id === shared) continue;
		// Inside a shared group, only its siblings are in the way (the rest of the story is outside).
		if (shared && node.parentId !== shared) continue;
		boxes.push(boxOf(node as InternalNode<InkFlowNode>));
	}
	return boxes;
}

function boxOf(node: InternalNode<InkFlowNode>): Box {
	const { x, y } = node.internals.positionAbsolute;
	return {
		x,
		y,
		width: node.measured.width ?? Number(node.style?.width ?? 0),
		height: node.measured.height ?? Number(node.style?.height ?? 0),
	};
}
