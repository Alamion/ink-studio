// Native Obsidian dialogs for canvas actions. Each resolves with the user's input, or null on cancel.

import { FuzzySuggestModal, Modal, Setting, type App } from "obsidian";
import type { LineChange, LinkKind, Reference, SourceLocation } from "@ink-studio/core";

/** Asks for a knot/stitch name; `validate` returns an error message or null (checked as you type). */
export function askName(app: App, title: string, initial: string, validate: (name: string) => string | null): Promise<string | null> {
	return new Promise((resolve) => new NameModal(app, title, initial, validate, resolve).open());
}

/** Picks one of `files` (vault paths); resolves null on cancel. The default is listed first. */
export function askFile(app: App, title: string, files: readonly string[]): Promise<string | null> {
	return new Promise((resolve) => new FilePicker(app, title, files, resolve).open());
}

class FilePicker extends FuzzySuggestModal<string> {
	private chosen = false;

	constructor(
		app: App,
		title: string,
		private readonly files: readonly string[],
		private readonly resolve: (file: string | null) => void,
	) {
		super(app);
		this.setPlaceholder(title);
	}

	getItems(): string[] {
		return [...this.files];
	}

	getItemText(file: string): string {
		return file;
	}

	onChooseItem(file: string): void {
		this.chosen = true;
		this.resolve(file);
	}

	override onClose(): void {
		super.onClose();
		// onChooseItem runs after onClose: wait a tick before treating the close as a cancel.
		activeWindow.setTimeout(() => !this.chosen && this.resolve(null), 0);
	}
}

class NameModal extends Modal {
	private value: string;
	private done = false;

	constructor(
		app: App,
		private readonly title: string,
		initial: string,
		private readonly validate: (name: string) => string | null,
		private readonly resolve: (name: string | null) => void,
	) {
		super(app);
		this.value = initial;
	}

	override onOpen(): void {
		this.setTitle(this.title);
		const error = this.contentEl.createDiv({ cls: "ink-modal-error" });
		let submit: () => void = () => {};
		const setting = new Setting(this.contentEl).setName("Name").addText((text) => {
			text.setValue(this.value).onChange((v) => {
				this.value = v.trim();
				error.setText(this.value ? (this.validate(this.value) ?? "") : "");
			});
			text.inputEl.addEventListener("keydown", (e) => e.key === "Enter" && (e.preventDefault(), submit()));
			activeWindow.setTimeout(() => text.inputEl.select(), 0);
		});
		setting.addButton((b) =>
			b
				.setButtonText("OK")
				.setCta()
				.onClick((submit = () => {
					const problem = this.validate(this.value);
					if (problem) return void error.setText(problem);
					this.finish(this.value);
				})),
		);
	}

	override onClose(): void {
		this.finish(null);
		this.contentEl.empty();
	}

	private finish(value: string | null): void {
		if (this.done) return;
		this.done = true;
		this.resolve(value);
		this.close();
	}
}

export interface LinkChoice {
	kind: LinkKind;
	text: string;
}

const LINK_KINDS: Record<LinkKind, string> = {
	choice: "Choice  * [text] -> target",
	sticky: "Sticky choice  + [text] -> target",
	divert: "Divert  -> target",
	tunnel: "Tunnel  -> target ->",
};

/** Asks how to connect `source` to `target`: which kind of link, and the choice text. */
export function askLink(app: App, source: string, target: string): Promise<LinkChoice | null> {
	return new Promise((resolve) => new LinkModal(app, source, target, resolve).open());
}

class LinkModal extends Modal {
	private choice: LinkChoice;
	private done = false;

	constructor(
		app: App,
		private readonly source: string,
		private readonly target: string,
		private readonly resolve: (choice: LinkChoice | null) => void,
	) {
		super(app);
		this.choice = { kind: "choice", text: target.split(".").pop()!.replace(/_/g, " ") };
	}

	override onOpen(): void {
		this.setTitle(`Link ${this.source} → ${this.target}`);
		const isChoice = (): boolean => this.choice.kind === "choice" || this.choice.kind === "sticky";
		new Setting(this.contentEl).setName("Kind").addDropdown((d) => {
			for (const [kind, label] of Object.entries(LINK_KINDS)) d.addOption(kind, label);
			d.setValue(this.choice.kind).onChange((v) => {
				this.choice.kind = v as LinkKind;
				textSetting.settingEl.toggle(isChoice());
			});
		});
		const textSetting = new Setting(this.contentEl).setName("Choice text").addText((t) => {
			t.setValue(this.choice.text).onChange((v) => (this.choice.text = v));
			t.inputEl.addEventListener("keydown", (e) => e.key === "Enter" && (e.preventDefault(), this.finish(this.choice)));
			activeWindow.setTimeout(() => t.inputEl.select(), 0);
		});
		new Setting(this.contentEl).addButton((b) => b.setButtonText("Link").setCta().onClick(() => this.finish(this.choice)));
	}

	override onClose(): void {
		this.finish(null);
		this.contentEl.empty();
	}

	private finish(value: LinkChoice | null): void {
		if (this.done) return;
		this.done = true;
		this.resolve(value);
		this.close();
	}
}

/** Most lines shown per change in a preview; the rest is summarised. */
const PREVIEW_LINES = 12;

/** Shows what a deletion will do to the text (a small diff) and asks to go ahead. */
export function confirmChanges(app: App, title: string, intro: string, changes: readonly LineChange[], notes: readonly Reference[] = []): Promise<boolean> {
	return new Promise((resolve) => new ConfirmModal(app, title, intro, changes, notes, resolve).open());
}

class ConfirmModal extends Modal {
	private done = false;

	constructor(
		app: App,
		private readonly title: string,
		private readonly intro: string,
		private readonly changes: readonly LineChange[],
		private readonly notes: readonly Reference[],
		private readonly resolve: (ok: boolean) => void,
	) {
		super(app);
	}

	override onOpen(): void {
		this.setTitle(this.title);
		this.contentEl.addClass("ink-modal");
		this.contentEl.createEl("p", { text: this.intro });
		if (this.notes.length > 0) {
			this.contentEl.createEl("p", { text: `${this.notes.length} link(s) into it will end the story instead (→ END):`, cls: "ink-muted" });
		}
		for (const change of this.changes) renderChange(this.contentEl, change);
		new Setting(this.contentEl)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.finish(false)))
			.addButton((b) => {
				b.setButtonText("Delete").setWarning().onClick(() => this.finish(true));
				activeWindow.setTimeout(() => b.buttonEl.focus(), 0);
			});
	}

	override onClose(): void {
		this.finish(false);
		this.contentEl.empty();
	}

	private finish(ok: boolean): void {
		if (this.done) return;
		this.done = true;
		this.resolve(ok);
		this.close();
	}
}

function renderChange(parent: HTMLElement, change: LineChange): void {
	const block = parent.createDiv({ cls: "ink-diff" });
	block.createDiv({ cls: "ink-diff-file", text: `${change.file.split("/").pop()}:${change.line}` });
	const pre = block.createEl("pre");
	const add = (lines: readonly string[], sign: string, cls: string): void => {
		for (const line of lines.slice(0, PREVIEW_LINES)) pre.createDiv({ cls, text: `${sign} ${line}` });
		if (lines.length > PREVIEW_LINES) pre.createDiv({ cls: "ink-diff-more", text: `  … ${lines.length - PREVIEW_LINES} more line(s)` });
	};
	add(change.before, "-", "ink-diff-del");
	add(change.after, "+", "ink-diff-add");
}

/** Explains why something cannot be deleted and lists the places to fix (click to open). */
export function showBlocked(app: App, title: string, message: string, references: readonly Reference[], onOpen: (location: SourceLocation) => void): void {
	new BlockedModal(app, title, message, references, onOpen).open();
}

class BlockedModal extends Modal {
	constructor(
		app: App,
		private readonly title: string,
		private readonly message: string,
		private readonly references: readonly Reference[],
		private readonly openLocation: (location: SourceLocation) => void,
	) {
		super(app);
	}

	override onOpen(): void {
		this.setTitle(this.title);
		this.contentEl.addClass("ink-modal");
		this.contentEl.createEl("p", { text: this.message });
		this.contentEl.createEl("p", { cls: "ink-muted", text: "Remove or change these references first, then delete again:" });
		const list = this.contentEl.createEl("ul", { cls: "ink-ref-list" });
		for (const ref of this.references) {
			const item = list.createEl("li");
			item.createSpan({ cls: "ink-ref-kind", text: ref.kind });
			const link = item.createEl("a", { cls: "ink-link", text: `${ref.location.file.split("/").pop()}:${ref.location.line}` });
			link.addEventListener("click", () => {
				this.close();
				this.openLocation(ref.location);
			});
			item.createEl("code", { text: ref.text });
		}
		new Setting(this.contentEl).addButton((b) => b.setButtonText("OK").setCta().onClick(() => this.close()));
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}
