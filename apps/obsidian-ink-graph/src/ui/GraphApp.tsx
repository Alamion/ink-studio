// Story graph: canvas + side panel (variables, selected node or link, diagnostics).

import {
	Background,
	Controls,
	MiniMap,
	ReactFlow,
	ReactFlowProvider,
	useNodesState,
	useReactFlow,
	type ColorMode,
	type Connection,
	type OnNodeDrag,
} from "@xyflow/react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CONFIG } from "../config";
import type { Point } from "../adapter/layoutStore";
import { ROOT_NODE_ID, type LoopWarning, type SourceLocation, type StoryEdge, type StoryGraph, type StoryNode, type VariableAccess } from "@ink-studio/core";
import type { InkGraphSettings } from "../settings";
import type { GraphSelection } from "./actions";
import { EDGE_TYPES, EdgeUiContext, KIND_ICON } from "./edges";
import { fitGroups } from "./groupFit";
import { layoutGraph, type InkFlowEdge, type InkFlowNode } from "./layout";
import { basename, HighlightContext, NODE_TYPES, type NodeHighlight } from "./nodes";

export interface GraphAppProps {
	graph: StoryGraph;
	settings: InkGraphSettings;
	/** Saved positions; read on every layout, never used as a React dependency. */
	positions: Readonly<Record<string, Point>>;
	colorMode: ColorMode;
	onOpen: (location: SourceLocation) => void;
	onPositionsChange: (changed: Record<string, Point>) => void;
	onResetLayout: () => void;
	/** A link was drawn from `source`'s handle to `target` (nothing is edited yet). */
	onConnect: (source: string, target: string) => void;
	onNodeMenu: (event: MouseEvent, nodeId: string) => void;
	/** Right click on a visual edge; `edgeIds` are the story links bundled in it. */
	onEdgeMenu: (event: MouseEvent, edgeIds: string[]) => void;
	/** Tells the host what Delete would act on. */
	onSelectionChange: (selection: GraphSelection) => void;
	onRenameNode: (nodeId: string) => void;
	onDeleteNode: (nodeId: string) => void;
	onDeleteLinks: (edgeIds: string[]) => void;
	/** Text of a source line, for previews in the panel (null if unknown). */
	sourceLine: (location: SourceLocation) => string | null;
	/** Right click on empty canvas; `position` is in graph coordinates (where a new knot would go). */
	onPaneMenu: (event: MouseEvent, position: Point) => void;
}

export function GraphApp(props: GraphAppProps) {
	return (
		<ReactFlowProvider>
			<GraphCanvas {...props} />
		</ReactFlowProvider>
	);
}

function GraphCanvas({
	graph,
	settings,
	positions,
	colorMode,
	onOpen,
	onPositionsChange,
	onResetLayout,
	onConnect,
	onNodeMenu,
	onPaneMenu,
	onEdgeMenu,
	onSelectionChange,
	...panelActions
}: GraphAppProps) {
	const [nodes, setNodes, onNodesChange] = useNodesState<InkFlowNode>([]);
	const [edges, setEdges] = useState<InkFlowEdge[]>([]);
	const [showFunctions, setShowFunctions] = useState(false);
	const [layoutNonce, setLayoutNonce] = useState(0);
	const [selectedVariable, setSelectedVariable] = useState<string | null>(null);
	const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
	const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
	const [panelOpen, setPanelOpen] = useState(settings.sidePanel !== "closed");
	const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
	const { fitView, getNodes, screenToFlowPosition } = useReactFlow<InkFlowNode, InkFlowEdge>();
	const fittedRoot = useRef<string | null>(null);
	const appRef = useRef<HTMLDivElement>(null);

	// In a narrow pane the panel would leave no room for the canvas.
	useLayoutEffect(() => {
		const width = appRef.current?.clientWidth ?? 0;
		if (settings.sidePanel === "auto" && width > 0 && width < CONFIG.panelAutoCollapseBelowPx) setPanelOpen(false);
	}, []);

	useEffect(() => {
		let cancelled = false;
		layoutGraph(graph, { showFunctions }, positions)
			.then((elements) => {
				if (cancelled) return;
				setNodes(elements.nodes);
				setEdges(elements.edges);
				// Fit once per story (and after an explicit re-layout), not on every edit of the text.
				if (fittedRoot.current !== graph.rootFile) {
					fittedRoot.current = graph.rootFile;
					requestAnimationFrame(() => void fitView({ padding: 0.1 }));
				}
			})
			.catch((error: unknown) => console.error("[ink-graph] layout failed", error));
		return () => {
			cancelled = true;
		};
		// `positions` is intentionally not a dependency: dragging must not trigger a re-layout.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [graph, showFunctions, layoutNonce, setNodes, fitView]);

	const highlight = useMemo(() => highlighter(graph, selectedVariable), [graph, selectedVariable]);

	// After a drag, re-fit knot groups (they only auto-grow while dragging) and persist every moved node.
	const onNodeDragStop: OnNodeDrag<InkFlowNode> = useCallback(
		(_event, _node, dragged) => {
			const before = getNodes();
			const fitted = fitGroups(before);
			const moved = new Set(dragged.map((n) => n.id));
			fitted.forEach((n, i) => n !== before[i] && moved.add(n.id));
			setNodes(fitted);
			const byId = new Map(fitted.map((n) => [n.id, n]));
			onPositionsChange(Object.fromEntries([...moved].map((id) => [id, byId.get(id)!.position])));
		},
		[getNodes, setNodes, onPositionsChange],
	);

	const selectNode = useCallback((id: string | null) => {
		setSelectedNodeId(id);
		setSelectedEdgeId(null);
	}, []);

	const selectEdge = useCallback(
		(id: string) => {
			setSelectedEdgeId(id);
			setSelectedNodeId(null);
			// The label lives outside React Flow's selection handling: drop its node selection by hand.
			setNodes((current) => current.map((n) => (n.selected ? { ...n, selected: false } : n)));
		},
		[setNodes],
	);

	const selectedBundle = edges.find((e) => e.id === selectedEdgeId) ?? null;
	const selectedLinks = useMemo(
		() => (selectedBundle?.data?.edges ?? []).map((e) => graph.edges.find((g) => g.id === e.id)).filter((e): e is StoryEdge => e !== undefined),
		[selectedBundle, graph],
	);
	const selectedNode = graph.nodes.find((n) => n.id === selectedNodeId) ?? null;

	// Report what Delete would act on; a selection that vanished after an edit reports nothing.
	const selectionKey = selectedNode ? `n:${selectedNode.id}` : selectedLinks.length > 0 ? `e:${selectedLinks.map((e) => e.id).join("|")}` : "";
	useEffect(() => {
		if (selectionKey.startsWith("n:")) onSelectionChange({ kind: "node", id: selectionKey.slice(2) });
		else if (selectionKey.startsWith("e:")) onSelectionChange({ kind: "edge", ids: selectionKey.slice(2).split("|") });
		else onSelectionChange(null);
	}, [selectionKey, onSelectionChange]);

	const showEdgeMenu = useCallback(
		(event: MouseEvent, edgeId: string) => {
			const bundle = edges.find((e) => e.id === edgeId);
			if (bundle?.data) onEdgeMenu(event, bundle.data.edges.map((e) => e.id));
		},
		[edges, onEdgeMenu],
	);

	const edgeUi = useMemo(
		() => ({
			focusNodeId: hoveredNodeId ?? selectedNodeId,
			selectedEdgeId,
			onSelect: selectEdge,
			onMenu: showEdgeMenu,
			onOpen,
			labelMaxLength: settings.labelMaxLength,
			labelMaxLines: settings.labelMaxLines,
		}),
		[hoveredNodeId, selectedNodeId, selectedEdgeId, selectEdge, showEdgeMenu, onOpen, settings.labelMaxLength, settings.labelMaxLines],
	);

	const openNode = useCallback(
		(node: StoryNode) => {
			// Missing targets have no location of their own: jump to the divert that points at them.
			const location = node.location ?? graph.edges.find((e) => e.target === node.id)?.location ?? null;
			if (location) onOpen(location);
		},
		[graph, onOpen],
	);

	const resetLayout = (): void => {
		onResetLayout();
		fittedRoot.current = null;
		setLayoutNonce((n) => n + 1);
	};

	return (
		<div className="ink-graph-app" ref={appRef}>
			<HighlightContext.Provider value={highlight}>
			<EdgeUiContext.Provider value={edgeUi}>
				<ReactFlow<InkFlowNode, InkFlowEdge>
					nodes={nodes}
					edges={edges}
					nodeTypes={NODE_TYPES}
					edgeTypes={EDGE_TYPES}
					nodesConnectable
					onConnect={(c: Connection) => c.source && c.target && onConnect(c.source, c.target)}
					// Dropping the link anywhere on a node counts, not only on its tiny handle.
					onConnectEnd={(event, state) => {
						if (state.isValid || !state.fromNode) return;
						const point = "changedTouches" in event ? event.changedTouches[0]! : event;
						const targetId = document
							.elementFromPoint(point.clientX, point.clientY)
							?.closest(".react-flow__node")
							?.getAttribute("data-id");
						if (targetId && targetId !== state.fromNode.id && isLinkable(graph, targetId)) onConnect(state.fromNode.id, targetId);
					}}
					isValidConnection={(c) => c.source !== c.target && isLinkable(graph, c.source) && isLinkable(graph, c.target)}
					onNodeContextMenu={(e, node) => {
						e.preventDefault();
						onNodeMenu(e.nativeEvent, node.id);
					}}
					onEdgeClick={(_e, edge) => selectEdge(edge.id)}
					onEdgeDoubleClick={(_e, edge) => {
						const location = edge.data?.edges[0]?.location;
						if (location) onOpen(location);
					}}
					onEdgeContextMenu={(e, edge) => {
						e.preventDefault();
						selectEdge(edge.id);
						showEdgeMenu(e.nativeEvent, edge.id);
					}}
					onPaneContextMenu={(e) => {
						e.preventDefault();
						onPaneMenu("nativeEvent" in e ? e.nativeEvent : e, screenToFlowPosition({ x: e.clientX, y: e.clientY }));
					}}
					onNodeMouseEnter={(_e, node) => setHoveredNodeId(node.id)}
					onNodeMouseLeave={() => setHoveredNodeId(null)}
					onNodesChange={onNodesChange}
					onNodeDragStop={onNodeDragStop}
					onNodeClick={(_e, node) => selectNode(node.id)}
					onNodeDoubleClick={(_e, node) => openNode(node.data.node)}
					onPaneClick={() => selectNode(null)}
					edgesReconnectable={false}
					deleteKeyCode={null}
					colorMode={colorMode}
					minZoom={0.1}
					onlyRenderVisibleElements
				>
					<Background gap={24} />
					<Controls showInteractive={false} />
					<MiniMap pannable zoomable />
				</ReactFlow>
			</EdgeUiContext.Provider>
			</HighlightContext.Provider>
			<LoopBanner
				loops={graph.loops}
				onOpen={(loop) => {
					selectNode(loop.nodeIds[0] ?? null);
					if (loop.location) onOpen(loop.location);
				}}
			/>
			<button
				className="ink-panel-toggle clickable-icon"
				onClick={() => setPanelOpen((open) => !open)}
				title={panelOpen ? "Hide panel" : "Show panel"}
				style={{ right: panelOpen ? "var(--ink-panel-width)" : 0 }}
			>
				{panelOpen ? "›" : "‹"}
			</button>
			{panelOpen && <SidePanel
				graph={graph}
				showFunctions={showFunctions}
				onToggleFunctions={() => setShowFunctions((v) => !v)}
				onResetLayout={resetLayout}
				selectedVariable={selectedVariable}
				onSelectVariable={(name) => setSelectedVariable((current) => (current === name ? null : name))}
				selectedNode={selectedNode}
				selectedLinks={selectedLinks}
				onSelectNode={selectNode}
				onOpen={onOpen}
				onOpenNode={openNode}
				{...panelActions}
			/>}
		</div>
	);
}

/** Always-visible warning over the canvas: choiceless loops freeze Ink Player. */
function LoopBanner({ loops, onOpen }: { loops: LoopWarning[]; onOpen: (loop: LoopWarning) => void }) {
	if (loops.length === 0) return null;
	const first = loops.find((l) => l.certain) ?? loops[0]!;
	const path = [...first.nodeIds, first.nodeIds[0]].join(" → ");
	const more = loops.length > 1 ? ` (+${loops.length - 1})` : "";
	return (
		<button
			className={`ink-loop-banner is-${first.certain ? "certain" : "possible"}`}
			onClick={() => onOpen(first)}
			title="Open the divert that closes the loop"
		>
			∞ {first.certain ? "Infinite loop without choices" : "Possible loop without choices"}: {path}
			{more}
		</button>
	);
}

/** Links connect story nodes: not the start, missing targets or functions. */
function isLinkable(graph: StoryGraph, id: string): boolean {
	const node = graph.nodes.find((n) => n.id === id);
	return node !== undefined && (node.kind === "knot" || node.kind === "stitch");
}

function highlighter(graph: StoryGraph, variable: string | null): (nodeId: string) => NodeHighlight {
	if (!variable) return () => null;
	const reads = new Set<string>();
	const writes = new Set<string>();
	for (const access of graph.accesses) {
		if (access.variable === variable) (access.mode === "write" ? writes : reads).add(access.nodeId);
	}
	return (id) => {
		if (reads.has(id) && writes.has(id)) return "readwrite";
		if (writes.has(id)) return "write";
		if (reads.has(id)) return "read";
		return "dimmed";
	};
}

interface SidePanelProps {
	graph: StoryGraph;
	showFunctions: boolean;
	onToggleFunctions: () => void;
	onResetLayout: () => void;
	selectedVariable: string | null;
	onSelectVariable: (name: string) => void;
	selectedNode: StoryNode | null;
	/** Links of the selected visual edge (empty when none is selected). */
	selectedLinks: StoryEdge[];
	onSelectNode: (id: string) => void;
	onOpen: (location: SourceLocation) => void;
	onOpenNode: (node: StoryNode) => void;
	onRenameNode: (nodeId: string) => void;
	onDeleteNode: (nodeId: string) => void;
	onDeleteLinks: (edgeIds: string[]) => void;
	sourceLine: (location: SourceLocation) => string | null;
}

function SidePanel(props: SidePanelProps) {
	const { graph, selectedVariable, selectedNode, onOpen } = props;
	const nodeName = (id: string): string => graph.nodes.find((n) => n.id === id)?.id ?? id;
	const accessesOf = (variable: string): VariableAccess[] => graph.accesses.filter((a) => a.variable === variable);
	const flowCount = graph.nodes.filter((n) => n.kind === "knot" || n.kind === "stitch").length;

	return (
		<aside className="ink-panel">
			<section>
				<div className="ink-panel-title">{basename(graph.rootFile)}</div>
				<div className="ink-muted">
					{flowCount} knots/stitches · {graph.edges.length} links · {graph.files.length} files
					{!graph.compiled && <span className="ink-error-text"> · has errors</span>}
				</div>
				<div className="ink-panel-actions">
					<label>
						<input type="checkbox" checked={props.showFunctions} onChange={props.onToggleFunctions} /> functions
					</label>
					<button onClick={props.onResetLayout} title="Forget saved positions and lay out again">
						Auto layout
					</button>
				</div>
			</section>

			{selectedNode && (
				<section>
					<div className="ink-panel-heading">Node</div>
					<a className="ink-link" onClick={() => props.onOpenNode(selectedNode)}>
						{selectedNode.id}
					</a>
					<span className="ink-muted"> ({selectedNode.kind})</span>
					{isEditable(selectedNode) && (
						<div className="ink-panel-actions">
							<button onClick={() => props.onRenameNode(selectedNode.id)}>Rename…</button>
							<button className="mod-warning" onClick={() => props.onDeleteNode(selectedNode.id)} title="Delete (Del)">
								Delete…
							</button>
						</div>
					)}
					<AccessList
						accesses={graph.accesses.filter((a) => a.nodeId === selectedNode.id)}
						label={(a) => a.variable}
						onOpen={onOpen}
					/>
					<LinkList
						title="In"
						edges={graph.edges.filter((e) => e.target === selectedNode.id)}
						end={(e) => e.source}
						onSelectNode={props.onSelectNode}
					/>
					{graph.edges.some((e) => e.source === selectedNode.id) && <div className="ink-panel-subheading">Out</div>}
					<ul className="ink-list">
						{graph.edges
							.filter((e) => e.source === selectedNode.id)
							.map((e) => (
								<li key={e.id}>
									<a className="ink-link" onClick={() => e.location && onOpen(e.location)}>
										{e.kind} → {e.target}
										{e.targetLabel ? `.${e.targetLabel}` : ""}
									</a>
									{e.label && <span className="ink-muted"> “{e.label}”</span>}
								</li>
							))}
					</ul>
				</section>
			)}

			{props.selectedLinks.length > 0 && <LinkPanel {...props} links={props.selectedLinks} />}

			<section>
				<div className="ink-panel-heading">Variables</div>
				<ul className="ink-list">
					{graph.variables.map((v) => {
						const accesses = accessesOf(v.name);
						const writers = new Set(accesses.filter((a) => a.mode === "write").map((a) => a.nodeId)).size;
						const readers = new Set(accesses.filter((a) => a.mode === "read").map((a) => a.nodeId)).size;
						const active = selectedVariable === v.name;
						return (
							<li key={v.name} className={active ? "is-active" : ""}>
								<a className="ink-link" onClick={() => props.onSelectVariable(v.name)}>
									{v.name}
								</a>
								<span className="ink-muted">
									{" "}
									{v.kind} · ✎{writers} ◉{readers}
								</span>
								{active && (
									<>
										{v.declaredAt && (
											<div>
												<a className="ink-link ink-muted" onClick={() => onOpen(v.declaredAt!)}>
													declared {basename(v.declaredAt.file)}:{v.declaredAt.line}
												</a>
											</div>
										)}
										<AccessList accesses={accesses} label={(a) => nodeName(a.nodeId)} onOpen={onOpen} />
									</>
								)}
							</li>
						);
					})}
				</ul>
			</section>

			{graph.diagnostics.length > 0 && (
				<section>
					<div className="ink-panel-heading">Problems ({graph.diagnostics.length})</div>
					<ul className="ink-list">
						{graph.diagnostics.map((d, i) => (
							<li key={i} className={`ink-diag ink-diag-${d.severity}`}>
								{d.location ? (
									<a className="ink-link" onClick={() => onOpen(d.location!)}>
										{basename(d.location.file)}:{d.location.line}
									</a>
								) : null}{" "}
								{d.message}
							</li>
						))}
					</ul>
				</section>
			)}
		</aside>
	);
}

function AccessList({
	accesses,
	label,
	onOpen,
}: {
	accesses: VariableAccess[];
	label: (a: VariableAccess) => string;
	onOpen: (location: SourceLocation) => void;
}) {
	if (accesses.length === 0) return null;
	return (
		<ul className="ink-list ink-access-list">
			{accesses.map((a, i) => (
				<li key={i}>
					<span className={a.mode === "write" ? "ink-writes" : "ink-reads"}>{a.mode === "write" ? "✎" : "◉"}</span>{" "}
					<a className="ink-link" onClick={() => a.location && onOpen(a.location)}>
						{label(a)}
					</a>
					{a.via && <span className="ink-muted"> via {a.via}()</span>}
				</li>
			))}
		</ul>
	);
}

function isEditable(node: StoryNode): boolean {
	return node.kind === "knot" || node.kind === "stitch" || node.kind === "function";
}

function LinkList({
	title,
	edges,
	end,
	onSelectNode,
}: {
	title: string;
	edges: StoryEdge[];
	end: (edge: StoryEdge) => string;
	onSelectNode: (id: string) => void;
}) {
	if (edges.length === 0) return null;
	return (
		<>
			<div className="ink-panel-subheading">{title}</div>
			<ul className="ink-list">
				{edges.map((e) => (
					<li key={e.id}>
						<a className="ink-link" onClick={() => onSelectNode(end(e))}>
							{KIND_ICON[e.kind]} {end(e) === ROOT_NODE_ID ? "(start)" : end(e)}
						</a>
						{e.label && <span className="ink-muted"> “{e.label}”</span>}
					</li>
				))}
			</ul>
		</>
	);
}

const KIND_DESCRIPTION: Record<StoryEdge["kind"], string> = {
	choice: "Player choice: offered as an option, picking it goes to the target.",
	divert: "Divert: the story continues to the target by itself.",
	tunnel: "Tunnel: runs the target, then comes back here (->->).",
	thread: "Thread: pulls the target’s content and choices in here.",
	call: "Function call.",
	dynamic: "Divert through a variable: goes here when the variable points at the target.",
};

/** Details of the selected visual edge: every link it bundles, where it is written, and actions. */
function LinkPanel(props: SidePanelProps & { links: StoryEdge[] }) {
	const { graph, links, onOpen } = props;
	const first = links[0]!;
	const loops = graph.loops.filter((l) => links.some((e) => l.edgeIds.includes(e.id)));
	const certain = loops.some((l) => l.certain);
	const deletable = links.filter((e) => e.kind !== "call" && e.kind !== "dynamic");
	const nameOf = (id: string): string => (id === ROOT_NODE_ID ? "(start)" : (graph.nodes.find((n) => n.id === id)?.id ?? id));
	return (
		<section>
			<div className="ink-panel-heading">{links.length === 1 ? "Link" : `Links (${links.length})`}</div>
			<div>
				<a className="ink-link" onClick={() => props.onSelectNode(first.source)}>
					{nameOf(first.source)}
				</a>
				{" → "}
				<a className="ink-link" onClick={() => props.onSelectNode(first.target)}>
					{nameOf(first.target)}
				</a>
			</div>
			{loops.length > 0 && (
				<div className={`ink-link-loop is-${certain ? "certain" : "possible"}`}>
					∞ part of a loop without choices{certain ? "" : " (conditional)"}
				</div>
			)}
			<ul className="ink-list ink-link-details">
				{links.map((edge) => (
					<li key={edge.id}>
						<div className="ink-link-head">
							<span className="ink-edge-label-icon">{KIND_ICON[edge.kind]}</span> <b>{edge.kind}</b>
							{edge.label && <span> “{edge.label}”</span>}
							{edge.conditional && <span className="ink-edge-label-if"> if</span>}
							{edge.targetLabel && <span className="ink-muted"> → ({edge.targetLabel})</span>}
							{links.length > 1 && deletable.includes(edge) && (
								<button className="ink-link-delete clickable-icon" onClick={() => props.onDeleteLinks([edge.id])} title="Delete this link">
									✕
								</button>
							)}
						</div>
						<div className="ink-muted ink-link-desc">
							{KIND_DESCRIPTION[edge.kind]}
							{edge.conditional ? " Only when its condition holds." : ""}
						</div>
						{edge.sites.map((site, i) => (
							<div key={i} className="ink-link-site">
								<a className="ink-link ink-muted" onClick={() => onOpen(site)} title="Open in editor">
									{basename(site.file)}:{site.line}
								</a>
								<Snippet edge={edge} site={site} first={i === 0} sourceLine={props.sourceLine} />
							</div>
						))}
					</li>
				))}
			</ul>
			{deletable.length > 0 && (
				<div className="ink-panel-actions">
					<button className="mod-warning" onClick={() => props.onDeleteLinks(deletable.map((e) => e.id))} title="Delete (Del)">
						{deletable.length === 1 ? "Delete link" : `Delete all ${deletable.length}`}
					</button>
				</div>
			)}
		</section>
	);
}

/** The divert's line, preceded by its choice line when the divert sits in the choice's branch. */
function Snippet({
	edge,
	site,
	first,
	sourceLine,
}: {
	edge: StoryEdge;
	site: SourceLocation;
	first: boolean;
	sourceLine: (location: SourceLocation) => string | null;
}) {
	const own = sourceLine(site);
	if (own === null) return null;
	const choice = first && edge.choiceLocation && edge.choiceLocation.line < site.line ? edge.choiceLocation : null;
	const lines: (string | null)[] = []; // null = skipped lines
	if (choice) {
		lines.push(sourceLine(choice) ?? "");
		if (site.line - choice.line > 1) lines.push(null);
	}
	lines.push(own);
	const text = lines.filter((l): l is string => l !== null && l.trim() !== "");
	const indent = Math.min(...text.map((l) => /^\s*/.exec(l)![0].length));
	return <pre className="ink-snippet">{lines.map((l) => (l === null ? "⋮" : l.slice(indent))).join("\n")}</pre>;
}
