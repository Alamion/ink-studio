// Custom React Flow nodes: a leaf card (knot/stitch/function/root/missing) and a knot group around stitches.

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { createContext, useContext } from "react";
import type { NodeKind } from "@ink-studio/core";
import type { InkFlowNode } from "./layout";

export type NodeHighlight = "read" | "write" | "readwrite" | "dimmed" | null;

/** Highlight lives in context, not in node data, so selecting a variable does not reset dragged nodes. */
export const HighlightContext = createContext<(nodeId: string) => NodeHighlight>(() => null);

const KIND_LABEL: Record<NodeKind, string> = {
	root: "start",
	knot: "knot",
	stitch: "stitch",
	function: "function",
	missing: "missing",
};

function Header({ data }: { data: InkFlowNode["data"] }) {
	const { node } = data;
	return (
		<div className="ink-node-title">
			<span className="ink-node-kind">{KIND_LABEL[node.kind]}</span>
			<span className="ink-node-name" title={node.id}>
				{node.name}
			</span>
			{node.isEntry && <span className="ink-tag" title="First stitch: entered when the knot has no content of its own">entry</span>}
			{node.terminates && <span className="ink-tag ink-tag-end">END</span>}
			{data.loop && (
				<span
					className={`ink-tag ink-tag-loop is-${data.loop}`}
					title={
						data.loop === "certain"
							? "Part of a loop without choices: the story hangs here"
							: "Part of a conditional loop without choices: hangs if the condition never changes"
					}
				>
					∞ loop
				</span>
			)}
			{node.internalDiverts > 0 && (
				<span className="ink-tag" title="Diverts that stay inside this node (loops, gathers)">
					↻{node.internalDiverts}
				</span>
			)}
		</div>
	);
}

function classNames(data: InkFlowNode["data"], highlight: NodeHighlight, extra: string): string {
	return ["ink-node", `ink-node-${data.node.kind}`, extra, highlight ? `is-${highlight}` : "", data.loop ? `is-loop-${data.loop}` : ""]
		.filter(Boolean)
		.join(" ");
}

export function InkNode({ id, data }: NodeProps<InkFlowNode>) {
	const highlight = useContext(HighlightContext)(id);
	const { node, reads, writes } = data;
	return (
		<div className={classNames(data, highlight, "ink-leaf")}>
			<Handle type="target" position={Position.Left} isConnectable />
			<Header data={data} />
			<div className="ink-node-meta">{node.location ? `${basename(node.location.file)}:${node.location.line}` : "—"}</div>
			{writes.length > 0 && (
				<div className="ink-node-vars ink-writes" title={`writes: ${writes.join(", ")}`}>
					✎ {writes.join(", ")}
				</div>
			)}
			{reads.length > 0 && (
				<div className="ink-node-vars ink-reads" title={`reads: ${reads.join(", ")}`}>
					◉ {reads.join(", ")}
				</div>
			)}
			<Handle type="source" position={Position.Right} isConnectable />
		</div>
	);
}

export function InkGroupNode({ id, data }: NodeProps<InkFlowNode>) {
	const highlight = useContext(HighlightContext)(id);
	return (
		<div className={classNames(data, highlight, "ink-group")}>
			<Handle type="target" position={Position.Left} isConnectable />
			<Header data={data} />
			<Handle type="source" position={Position.Right} isConnectable />
		</div>
	);
}

export const NODE_TYPES = { ink: InkNode, inkGroup: InkGroupNode };

export function basename(path: string): string {
	return path.slice(path.lastIndexOf("/") + 1);
}
