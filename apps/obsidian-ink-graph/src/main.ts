import "@xyflow/react/dist/style.css";
import "./ui/styles.css";

import { Notice, Plugin } from "obsidian";
import { isInkFile } from "./adapter/storySources";
import { CONFIG } from "./config";
import { InkGraphView } from "./ui/InkGraphView";

export default class InkGraphPlugin extends Plugin {
	override async onload(): Promise<void> {
		// Deliberately no registerExtensions("ink"): Ink Player / Ink Language own the .ink editor,
		// and Obsidian throws when an extension is registered twice.
		this.registerView(CONFIG.viewType, (leaf) => new InkGraphView(leaf));
		this.addRibbonIcon(CONFIG.icon, "Ink Graph: open story graph", () => void this.openGraph());
		this.addCommand({
			id: "open-story-graph",
			name: "Open story graph",
			callback: () => void this.openGraph(),
		});
		this.addCommand({
			id: "undo-graph-edit",
			name: "Undo last graph edit",
			checkCallback: (checking) => {
				const view = this.app.workspace.getActiveViewOfType(InkGraphView);
				if (!view?.actions.canUndo) return false;
				if (!checking) void view.actions.undo();
				return true;
			},
		});
	}

	/** Opens (or reuses) the graph tab for the story of the active .ink file. */
	private async openGraph(): Promise<void> {
		const file = this.app.workspace.getActiveFile();
		if (!isInkFile(file)) {
			new Notice("Ink Graph: open an .ink file first");
			return;
		}
		const existing = this.app.workspace.getLeavesOfType(CONFIG.viewType)[0];
		const leaf = existing ?? this.app.workspace.getLeaf("tab");
		if (!existing) await leaf.setViewState({ type: CONFIG.viewType, active: true });
		await this.app.workspace.revealLeaf(leaf);
		if (leaf.view instanceof InkGraphView) await leaf.view.showStoryOf(file.path);
	}
}
