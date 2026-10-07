// Obsidian view hosting the React graph. Owns the lifecycle: which story is shown, when to
// rebuild (debounced on .ink changes), persisting dragged positions, and routing canvas actions.

import { debounce, ItemView, Scope, type TAbstractFile, type ViewStateResult, type WorkspaceLeaf } from "obsidian";
import { createRoot, type Root } from "react-dom/client";
import type { InkGraphSettings } from "../settings";
import { LayoutStore, type Point, type SavedLayout } from "../adapter/layoutStore";
import { isInkFile, loadInkSources, openSourceLocation } from "../adapter/storySources";
import { CONFIG } from "../config";
import { buildStoryGraph, findStoryRoot, type StoryGraph } from "@ink-studio/core";
import { GraphActions, type GraphSelection } from "./actions";
import { GraphApp } from "./GraphApp";
import { basename } from "./nodes";

export interface InkGraphViewState extends Record<string, unknown> {
	rootFile: string | null;
}

export class InkGraphView extends ItemView {
	private rootFile: string | null = null;
	private graph: StoryGraph | null = null;
	/** Sources the current graph was built from (for line previews in the panel). */
	private sources: ReadonlyMap<string, string> = new Map();
	private selection: GraphSelection = null;
	private layout: SavedLayout | null = null;
	private reactRoot: Root | null = null;
	private readonly layoutStore: LayoutStore;
	readonly actions: GraphActions;
	private readonly scheduleRebuild = debounce(() => void this.rebuild(), CONFIG.rebuildDebounceMs, true);
	private readonly scheduleLayoutSave = debounce(() => void this.saveLayout(), CONFIG.layoutSaveDebounceMs, true);

	constructor(leaf: WorkspaceLeaf, private readonly getSettings: () => InkGraphSettings) {
		super(leaf);
		this.layoutStore = new LayoutStore(this.app.vault.adapter);
		this.actions = new GraphActions({
			app: this.app,
			settings: this.getSettings,
			rootFile: () => this.rootFile,
			placeNode: (id, position) => this.updateLayout((positions) => (positions[id] = position)),
			renameLayout: (oldId, newId) =>
				this.updateLayout((positions) => {
					for (const key of Object.keys(positions)) {
						if (key !== oldId && !key.startsWith(`${oldId}.`)) continue;
						positions[newId + key.slice(oldId.length)] = positions[key]!;
						delete positions[key];
					}
				}),
			refresh: () => this.rebuild(),
		});
		// Ctrl/Cmd+Z while the graph has focus undoes the last canvas edit.
		this.scope = new Scope(this.app.scope);
		this.scope.register(["Mod"], "z", () => {
			void this.actions.undo();
			return false;
		});
		// Delete / Backspace remove the selected node or link (after a preview when it is more than a line).
		for (const key of ["Delete", "Backspace"]) {
			this.scope.register([], key, (event) => {
				if (!this.selection || isTyping(event)) return true;
				void this.actions.deleteSelection(this.selection);
				return false;
			});
		}
	}

	getViewType(): string {
		return CONFIG.viewType;
	}

	getDisplayText(): string {
		return this.rootFile ? `Ink graph: ${basename(this.rootFile)}` : "Ink graph";
	}

	override getIcon(): string {
		return CONFIG.icon;
	}

	override getState(): InkGraphViewState {
		return { rootFile: this.rootFile };
	}

	override async setState(state: unknown, result: ViewStateResult): Promise<void> {
		const rootFile = (state as Partial<InkGraphViewState> | null)?.rootFile ?? null;
		if (rootFile && rootFile !== this.rootFile) await this.showStory(rootFile);
		await super.setState(state, result);
	}

	override async onOpen(): Promise<void> {
		this.contentEl.addClass("ink-graph-view");
		// Clicks on edge labels and panel links do not activate the leaf on their own, and the editor
		// would keep the keyboard focus: Delete must reach the graph, never delete text in the editor.
		this.contentEl.tabIndex = -1;
		this.registerDomEvent(this.contentEl, "pointerdown", (event) => {
			if (this.app.workspace.getActiveViewOfType(InkGraphView) !== this) this.app.workspace.setActiveLeaf(this.leaf, { focus: false });
			if (!isTyping(event)) this.contentEl.focus({ preventScroll: true });
		}, { capture: true });
		this.reactRoot = createRoot(this.contentEl);
		const onInkChange = (file: TAbstractFile): void => {
			if (isInkFile(file)) this.scheduleRebuild();
		};
		this.registerEvent(this.app.vault.on("modify", onInkChange));
		this.registerEvent(this.app.vault.on("create", onInkChange));
		this.registerEvent(this.app.vault.on("delete", onInkChange));
		this.registerEvent(this.app.vault.on("rename", onInkChange));
		this.registerEvent(this.app.workspace.on("css-change", () => this.render()));
		// Live while typing: sources are read from open editors, not only from saved files.
		this.registerEvent(this.app.workspace.on("editor-change", (_editor, info) => {
			if (isInkFile(info.file ?? null)) this.scheduleRebuild();
		}));
		// Follow the story of the .ink file being edited.
		this.registerEvent(this.app.workspace.on("file-open", (file) => void this.followFile(file)));
		this.render();
	}

	override async onClose(): Promise<void> {
		this.scheduleLayoutSave.run();
		this.reactRoot?.unmount();
		this.reactRoot = null;
	}

	/** Shows the story that `file` belongs to (resolving INCLUDEs up to the root). */
	async showStoryOf(file: string): Promise<void> {
		const sources = await loadInkSources(this.app);
		await this.showStory(findStoryRoot(file, sources));
	}

	private async followFile(file: TAbstractFile | null): Promise<void> {
		if (!isInkFile(file) || this.graph?.files.includes(file.path)) return;
		await this.showStoryOf(file.path);
	}

	private async showStory(rootFile: string): Promise<void> {
		if (rootFile === this.rootFile) return;
		this.scheduleLayoutSave.run(); // flush positions of the previous story
		this.rootFile = rootFile;
		this.layout = await this.layoutStore.load(rootFile);
		// Refresh the tab title; ItemView has no public API for this.
		(this.leaf as WorkspaceLeaf & { updateHeader?: () => void }).updateHeader?.();
		await this.rebuild();
	}

	private async rebuild(): Promise<void> {
		const rootFile = this.rootFile;
		if (!rootFile) return;
		const sources = await loadInkSources(this.app);
		if (rootFile !== this.rootFile) return; // switched story while reading
		this.graph = buildStoryGraph(rootFile, sources);
		this.sources = sources;
		this.render();
	}

	/** Called by the plugin after a setting changed. */
	settingsChanged(): void {
		this.render();
	}

	private render(): void {
		if (!this.reactRoot) return;
		if (!this.graph || !this.layout) {
			this.reactRoot.render(<div className="ink-graph-empty">Open an .ink file and run “Ink Graph: Open story graph”.</div>);
			return;
		}
		const layout = this.layout;
		this.reactRoot.render(
			<GraphApp
				graph={this.graph}
				settings={this.getSettings()}
				positions={layout.positions}
				colorMode={activeDocument.body.hasClass("theme-dark") ? "dark" : "light"}
				onOpen={(location) => void openSourceLocation(this.app, location)}
				onPositionsChange={(changed: Record<string, Point>) => {
					Object.assign(layout.positions, changed);
					this.scheduleLayoutSave();
				}}
				onResetLayout={() => {
					layout.positions = {};
					this.render(); // hand the new (empty) positions object to React
					this.scheduleLayoutSave();
				}}
				onConnect={(source, target) => void this.actions.connect(source, target)}
				onConnectToNew={(source, drop) => void this.actions.connectToNew(source, drop)}
				onNodeMenu={(event, nodeId) => this.graph && this.actions.nodeMenu(event, nodeId, this.graph)}
				onPaneMenu={(event, position) => this.actions.paneMenu(event, position)}
				onEdgeMenu={(event, edgeIds) => this.graph && this.actions.edgeMenu(event, edgeIds, this.graph)}
				onSelectionChange={this.onSelectionChange}
				onRenameNode={(nodeId) => void this.actions.rename(nodeId)}
				onDeleteNode={(nodeId) => void this.actions.deleteNode(nodeId)}
				onDeleteLinks={(edgeIds) => void this.actions.deleteLinks(edgeIds)}
				sourceLine={(location) => this.sources.get(location.file)?.split("\n")[location.line - 1] ?? null}
			/>,
		);
	}

	/** Stable identity: GraphApp reports through it from an effect. */
	private readonly onSelectionChange = (selection: GraphSelection): void => {
		this.selection = selection;
	};

	private updateLayout(change: (positions: Record<string, Point>) => void): void {
		if (!this.layout) return;
		change(this.layout.positions);
		this.scheduleLayoutSave();
	}

	private async saveLayout(): Promise<void> {
		if (!this.rootFile || !this.layout) return;
		try {
			await this.layoutStore.save(this.rootFile, this.layout);
		} catch (error) {
			console.error("[ink-graph] Could not save layout", error);
		}
	}
}

/** Keys typed into an input (e.g. a panel checkbox or a future search field) are not commands. */
function isTyping(event: Event): boolean {
	const target = event.target as HTMLElement | null;
	return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
}
