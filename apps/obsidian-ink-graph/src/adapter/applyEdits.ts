// Applies core edit plans to the vault. Open files are edited through the editor (so the user's
// own Ctrl+Z works there too), closed ones through vault.process. Every applied change keeps the
// before/after texts, which makes "undo the last graph edit" work for closed files as well.

import { TFile, type App } from "obsidian";
import { applyTextEdits, type TextEdit } from "@ink-studio/core";
import { currentText, openEditorView } from "./storySources";

export interface AppliedChange {
	label: string;
	files: Map<string, { before: string; after: string }>;
}

export class StaleSourceError extends Error {}

/**
 * Applies `edits`, planned against `planned` texts. Refuses if a file changed since planning
 * (the user kept typing): offsets would land in the wrong place.
 */
export async function applyEdits(
	app: App,
	label: string,
	edits: readonly TextEdit[],
	planned: ReadonlyMap<string, string>,
): Promise<AppliedChange> {
	const change: AppliedChange = { label, files: new Map() };
	const files = [...new Set(edits.map((e) => e.file))];
	for (const path of files) {
		const before = await textOf(app, path);
		if (before !== planned.get(path)) throw new StaleSourceError(`${path} changed while the edit was prepared — try again.`);
	}
	for (const path of files) {
		const mine = edits.filter((e) => e.file === path);
		const before = planned.get(path)!;
		const after = applyTextEdits(before, mine);
		await writeText(app, path, after, mine);
		change.files.set(path, { before, after });
	}
	return change;
}

/** Restores the texts from before `change`, if nothing else touched those files since. */
export async function revertChange(app: App, change: AppliedChange): Promise<void> {
	for (const [path, { after }] of change.files) {
		if ((await textOf(app, path)) !== after) throw new StaleSourceError(`${path} was edited since — cannot undo "${change.label}".`);
	}
	for (const [path, { before }] of change.files) await writeText(app, path, before, null);
}

async function textOf(app: App, path: string): Promise<string> {
	const file = app.vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile)) throw new StaleSourceError(`File not found: ${path}`);
	return currentText(app, file);
}

/** `edits` null means "replace the whole text" (used by undo). */
async function writeText(app: App, path: string, text: string, edits: readonly TextEdit[] | null): Promise<void> {
	const view = openEditorView(app, path);
	if (view) {
		const editor = view.editor;
		const changes = edits
			? edits.map((e) => ({ from: { line: e.from.line - 1, ch: e.from.ch }, to: { line: e.to.line - 1, ch: e.to.ch }, text: e.text }))
			: [{ from: { line: 0, ch: 0 }, to: editor.offsetToPos(editor.getValue().length), text }];
		editor.transaction({ changes });
		await view.save();
		return;
	}
	const file = app.vault.getAbstractFileByPath(path);
	if (file instanceof TFile) await app.vault.process(file, () => text);
}
