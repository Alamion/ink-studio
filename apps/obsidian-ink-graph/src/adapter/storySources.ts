// Bridges the Obsidian vault and the core: collects .ink sources and opens source locations.

import { MarkdownView, Notice, TFile, type App, type TAbstractFile, type WorkspaceLeaf } from "obsidian";
import { CONFIG } from "../config";
import type { SourceLocation } from "@ink-studio/core";

export function isInkFile(file: TAbstractFile | null): file is TFile {
	return file instanceof TFile && file.extension === CONFIG.inkExtension;
}

/**
 * Reads every .ink file in the vault. The ink compiler loads INCLUDEs synchronously,
 * so all sources must be in memory before compiling. Files open in an editor are read from the
 * editor: it may be ahead of the disk (autosave), and edits are planned against what the user sees.
 */
export async function loadInkSources(app: App): Promise<Map<string, string>> {
	const files = app.vault.getFiles().filter(isInkFile);
	const texts = await Promise.all(files.map((file) => currentText(app, file)));
	return new Map(files.map((file, i) => [file.path, texts[i]!]));
}

/** Editor buffer if the file is open, otherwise the (cached) file on disk. */
export async function currentText(app: App, file: TFile): Promise<string> {
	return openEditorView(app, file.path)?.editor.getValue() ?? app.vault.cachedRead(file);
}

export function openEditorView(app: App, path: string): MarkdownView | null {
	for (const leaf of app.workspace.getLeavesOfType("markdown")) {
		if (leaf.view instanceof MarkdownView && leaf.view.file?.path === path) return leaf.view;
	}
	return null;
}

/** Opens `location` in a markdown leaf (reusing one that already shows the file) and puts the cursor on the line. */
export async function openSourceLocation(app: App, location: SourceLocation): Promise<void> {
	const file = app.vault.getAbstractFileByPath(location.file);
	if (!(file instanceof TFile)) {
		new Notice(`Ink Graph: file not found — ${location.file}`);
		return;
	}
	const leaf = findLeafShowing(app, file) ?? app.workspace.getLeaf("split", "vertical");
	const line = Math.max(location.line - 1, 0);
	await leaf.openFile(file, { eState: { line } });
	app.workspace.setActiveLeaf(leaf, { focus: true });
	if (leaf.view instanceof MarkdownView) {
		const editor = leaf.view.editor;
		editor.setCursor({ line, ch: 0 });
		editor.scrollIntoView({ from: { line, ch: 0 }, to: { line, ch: 0 } }, true);
	}
}

/** Prefers a leaf already showing the file, then any markdown leaf, so the graph tab is never replaced. */
function findLeafShowing(app: App, file: TFile): WorkspaceLeaf | null {
	const markdownLeaves = app.workspace.getLeavesOfType("markdown");
	return (
		markdownLeaves.find((leaf) => leaf.view instanceof MarkdownView && leaf.view.file?.path === file.path) ??
		markdownLeaves[0] ??
		null
	);
}
