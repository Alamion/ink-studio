// Canvas actions: menus and dialogs → core edit plan → applied to the vault, with undo.
// Plans are always made against freshly read sources (editor buffers included), never against
// the graph currently on screen, which may be a few hundred milliseconds old.

import { Menu, Notice, type App } from "obsidian";
import { applyEdits, revertChange, StaleSourceError, type AppliedChange } from "../adapter/applyEdits";
import type { Point } from "../adapter/layoutStore";
import { loadInkSources, openSourceLocation } from "../adapter/storySources";
import {
	buildStoryGraph,
	checkName,
	planCreateKnot,
	planCreateStitch,
	planDeleteLinks,
	planDeleteNode,
	planLink,
	planRename,
	type EditPlan,
	type StoryEdge,
	type StoryGraph,
} from "@ink-studio/core";
import type { InkGraphSettings } from "../settings";
import { askFile, askLink, askName, confirmChanges, showBlocked } from "./modals";

/** What is selected on the canvas: a node, or a visual edge (a bundle of links between two nodes). */
export type GraphSelection = { kind: "node"; id: string } | { kind: "edge"; ids: string[] } | null;

export interface ActionHost {
	readonly app: App;
	settings(): InkGraphSettings;
	rootFile(): string | null;
	/** Pins where a node that is about to be created should appear. */
	placeNode(id: string, position: Point): void;
	/** Moves saved positions from `oldId` (and its stitches) to `newId`. */
	renameLayout(oldId: string, newId: string): void;
	/** Rebuilds the graph right away (instead of waiting for the file watcher). */
	refresh(): Promise<void>;
}

interface HistoryEntry {
	change: AppliedChange;
	undoLayout?: () => void;
}

export class GraphActions {
	private readonly history: HistoryEntry[] = [];

	constructor(private readonly host: ActionHost) {}

	get canUndo(): boolean {
		return this.history.length > 0;
	}

	nodeMenu(event: MouseEvent, nodeId: string, graph: StoryGraph): void {
		const node = graph.nodes.find((n) => n.id === nodeId);
		if (!node) return;
		const menu = new Menu();
		if (node.kind === "knot" || node.kind === "stitch" || node.kind === "function") {
			menu.addItem((i) => i.setTitle("Rename…").setIcon("pencil").onClick(() => void this.rename(nodeId)));
		}
		if (node.kind === "knot") {
			menu.addItem((i) => i.setTitle("Add stitch…").setIcon("plus").onClick(() => void this.createStitch(nodeId)));
		}
		if (node.location) {
			const location = node.location;
			menu.addItem((i) => i.setTitle("Open in editor").setIcon("file-text").onClick(() => void openSourceLocation(this.host.app, location)));
		}
		if (node.kind === "knot" || node.kind === "stitch" || node.kind === "function") {
			menu.addSeparator();
			menu.addItem((i) => i.setTitle("Delete…").setIcon("trash-2").setWarning(true).onClick(() => void this.deleteNode(nodeId)));
		}
		this.addUndoItem(menu);
		menu.showAtMouseEvent(event);
	}

	/** Menu of a visual edge; `edgeIds` are the links bundled in it. */
	edgeMenu(event: MouseEvent, edgeIds: readonly string[], graph: StoryGraph): void {
		const edges = edgeIds.map((id) => graph.edges.find((e) => e.id === id)).filter((e): e is StoryEdge => e !== undefined);
		if (edges.length === 0) return;
		const menu = new Menu();
		for (const edge of edges) {
			const location = edge.location;
			if (!location) continue;
			const title = edges.length > 1 ? `Open “${linkTitle(edge)}”` : "Open in editor";
			menu.addItem((i) => i.setTitle(title).setIcon("file-text").onClick(() => void openSourceLocation(this.host.app, location)));
		}
		menu.addSeparator();
		for (const edge of edges) {
			const title = edges.length > 1 ? `Delete “${linkTitle(edge)}”` : "Delete link";
			menu.addItem((i) => i.setTitle(title).setIcon("trash-2").setWarning(true).onClick(() => void this.deleteLinks([edge.id])));
		}
		if (edges.length > 1) {
			menu.addItem((i) =>
				i.setTitle(`Delete all ${edges.length} links`).setIcon("trash-2").setWarning(true).onClick(() => void this.deleteLinks(edges.map((e) => e.id))),
			);
		}
		this.addUndoItem(menu);
		menu.showAtMouseEvent(event);
	}

	/** Delete key on the canvas. */
	async deleteSelection(selection: GraphSelection): Promise<void> {
		if (selection?.kind === "node") await this.deleteNode(selection.id);
		else if (selection?.kind === "edge") await this.deleteLinks(selection.ids);
	}

	async deleteNode(nodeId: string): Promise<void> {
		const fresh = await this.freshGraph();
		const node = fresh?.graph.nodes.find((n) => n.id === nodeId);
		if (!fresh || !node) return;
		const plan = planDeleteNode(fresh.graph, fresh.sources, nodeId);
		if (!plan.ok) {
			if (plan.blocking?.length) showBlocked(this.host.app, `Delete ${nodeId}`, plan.error, plan.blocking, (l) => void openSourceLocation(this.host.app, l));
			else new Notice(`Ink Graph: ${plan.error}`, 6000);
			return;
		}
		const stitches = fresh.graph.nodes.filter((n) => n.parentId === nodeId).length;
		const intro = `Delete ${node.kind} ${nodeId}${stitches ? ` with its ${stitches} stitch(es)` : ""}? This changes the text as shown below.`;
		if (!(await confirmChanges(this.host.app, `Delete ${nodeId}`, intro, plan.changes, plan.redirected))) return;
		await this.run(`delete ${nodeId}`, (g, s) => planDeleteNode(g, s, nodeId));
	}

	async deleteLinks(edgeIds: readonly string[]): Promise<void> {
		const fresh = await this.freshGraph();
		if (!fresh) return;
		const edges = edgeIds.map((id) => fresh.graph.edges.find((e) => e.id === id)).filter((e): e is StoryEdge => e !== undefined);
		if (edges.length === 0) return void new Notice("Ink Graph: the link is no longer in the story");
		const plan = planDeleteLinks(fresh.graph, fresh.sources, edgeIds);
		if (!plan.ok) return void new Notice(`Ink Graph: ${plan.error}`, 6000);
		const label = edges.length === 1 ? `link ${edges[0]!.source} → ${edges[0]!.target}` : `${edges.length} links`;
		// Removing one line is easy to see and to undo; anything bigger is shown first.
		const simple = this.host.settings().confirmDeletes === "multi-line" && plan.changes.length === 1 && plan.changes[0]!.before.length === 1;
		if (!simple && !(await confirmChanges(this.host.app, `Delete ${label}`, `Delete ${label}? This changes the text as shown below.`, plan.changes))) return;
		const ok = await this.run(`delete ${label}`, (g, s) => planDeleteLinks(g, s, edgeIds));
		if (ok && simple) new Notice(`Ink Graph: deleted ${label} — Ctrl+Z to undo`);
	}

	paneMenu(event: MouseEvent, position: Point): void {
		const menu = new Menu();
		menu.addItem((i) => i.setTitle("New knot here…").setIcon("plus-square").onClick(() => void this.createKnot(position)));
		this.addUndoItem(menu);
		menu.showAtMouseEvent(event);
	}

	async connect(sourceId: string, targetId: string): Promise<void> {
		const link = await askLink(this.host.app, sourceId, targetId);
		if (!link) return;
		await this.run(`link ${sourceId} → ${targetId}`, (graph, sources) =>
			planLink(graph, sources, sourceId, targetId, link.kind, link.text),
		);
	}

	async createKnot(position: Point): Promise<void> {
		const graph = await this.freshGraph();
		if (!graph) return;
		const name = await askName(this.host.app, "New knot", "", (n) => checkName(graph.graph, n, null));
		if (!name) return;
		const file = await this.knotFile(graph.graph);
		if (!file) return;
		await this.run(`new knot ${name}`, (g, s) => planCreateKnot(g, s, name, file), () => this.host.placeNode(name, position));
	}

	/** The root file, or (when the setting asks and the story has several files) one picked by the user. */
	private async knotFile(graph: StoryGraph): Promise<string | null> {
		if (this.host.settings().newKnotTarget !== "ask" || graph.files.length < 2) return graph.rootFile;
		const files = [graph.rootFile, ...graph.files.filter((f) => f !== graph.rootFile)];
		return askFile(this.host.app, "Add the new knot to…", files);
	}

	async createStitch(knotId: string): Promise<void> {
		const graph = await this.freshGraph();
		if (!graph) return;
		const name = await askName(this.host.app, `New stitch in ${knotId}`, "", (n) => checkName(graph.graph, n, knotId));
		if (!name) return;
		await this.run(`new stitch ${knotId}.${name}`, (g, s) => planCreateStitch(g, s, knotId, name));
	}

	async rename(nodeId: string): Promise<void> {
		const fresh = await this.freshGraph();
		const node = fresh?.graph.nodes.find((n) => n.id === nodeId);
		if (!fresh || !node) return;
		const name = await askName(this.host.app, `Rename ${nodeId}`, node.name, (n) =>
			n === node.name ? "The name did not change." : checkName(fresh.graph, n, node.parentId),
		);
		if (!name) return;
		const newId = node.parentId ? `${node.parentId}.${name}` : name;
		await this.run(
			`rename ${nodeId} → ${newId}`,
			(g, s) => planRename(g, s, nodeId, name),
			() => this.host.renameLayout(nodeId, newId),
			() => this.host.renameLayout(newId, nodeId),
		);
	}

	async undo(): Promise<void> {
		const entry = this.history.pop();
		if (!entry) return void new Notice("Ink Graph: nothing to undo");
		try {
			await revertChange(this.host.app, entry.change);
			entry.undoLayout?.();
			new Notice(`Ink Graph: undone ${entry.change.label}`);
			await this.host.refresh();
		} catch (error) {
			new Notice(`Ink Graph: ${message(error)}`);
		}
	}

	/** Plans against fresh sources, applies, records undo, refreshes the graph. Resolves true when applied. */
	private async run(
		label: string,
		plan: (graph: StoryGraph, sources: Map<string, string>) => EditPlan,
		beforeApply?: () => void,
		undoLayout?: () => void,
	): Promise<boolean> {
		const fresh = await this.freshGraph();
		if (!fresh) return false;
		const result = plan(fresh.graph, fresh.sources);
		if (!result.ok) {
			new Notice(`Ink Graph: ${result.error}`, 6000);
			return false;
		}
		try {
			beforeApply?.();
			const change = await applyEdits(this.host.app, label, result.edits, fresh.sources);
			this.history.push({ change, undoLayout });
			await this.host.refresh();
			return true;
		} catch (error) {
			if (undoLayout) undoLayout();
			new Notice(`Ink Graph: ${error instanceof StaleSourceError ? error.message : `could not apply the edit — ${message(error)}`}`);
			return false;
		}
	}

	private async freshGraph(): Promise<{ graph: StoryGraph; sources: Map<string, string> } | null> {
		const root = this.host.rootFile();
		if (!root) return null;
		const sources = await loadInkSources(this.host.app);
		return { graph: buildStoryGraph(root, sources), sources };
	}

	private addUndoItem(menu: Menu): void {
		const last = this.history[this.history.length - 1];
		if (!last) return;
		menu.addSeparator();
		menu.addItem((i) => i.setTitle(`Undo ${last.change.label}`).setIcon("undo").onClick(() => void this.undo()));
	}
}

function linkTitle(edge: StoryEdge): string {
	const text = edge.label ?? `${edge.kind} → ${edge.target}`;
	return text.length > 40 ? `${text.slice(0, 39)}…` : text;
}

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
