import "@xyflow/react/dist/style.css";
import "./ui/styles.css";

import { Notice, Plugin } from "obsidian";
import { isInkFile } from "./adapter/storySources";
import { CONFIG } from "./config";
import { DEFAULT_SETTINGS, sanitizeSettings, type InkGraphSettings } from "./settings";
import { InkGraphSettingTab } from "./settingsTab";
import { InkGraphView } from "./ui/InkGraphView";

export default class InkGraphPlugin extends Plugin {
	override settings: InkGraphSettings = { ...DEFAULT_SETTINGS };

	override async onload(): Promise<void> {
		this.settings = sanitizeSettings(await this.loadData());
		this.addSettingTab(new InkGraphSettingTab(this.app, this));
		// Deliberately no registerExtensions("ink"): Ink Player / Ink Language own the .ink editor,
		// and Obsidian throws when an extension is registered twice.
		this.registerView(CONFIG.viewType, (leaf) => new InkGraphView(leaf, () => this.settings));
		this.addRibbonIcon(CONFIG.icon, "Open ink graph", () => void this.openGraph());
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

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		for (const leaf of this.app.workspace.getLeavesOfType(CONFIG.viewType)) {
			if (leaf.view instanceof InkGraphView) leaf.view.settingsChanged();
		}
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
		this.app.workspace.setActiveLeaf(leaf, { focus: true });
		if (leaf.view instanceof InkGraphView) await leaf.view.showStoryOf(file.path);
	}
}
