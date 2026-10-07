import { PluginSettingTab, Setting, type App } from "obsidian";
import { LABEL_LENGTH_RANGE, LABEL_LINES_RANGE, type DeleteConfirmation, type NewKnotTarget, type SidePanelMode } from "./settings";
import type InkGraphPlugin from "./main";

export class InkGraphSettingTab extends PluginSettingTab {
	constructor(app: App, private readonly plugin: InkGraphPlugin) {
		super(app, plugin);
	}

	override display(): void {
		const { containerEl } = this;
		containerEl.empty();
		const settings = this.plugin.settings;
		const save = (): void => void this.plugin.saveSettings();

		new Setting(containerEl)
			.setName("New knots go to")
			.setDesc("The story's root file, or a file you pick each time (only asked when the story has several files).")
			.addDropdown((d) =>
				d
					.addOptions({ root: "Root file", ask: "Ask each time" } satisfies Record<NewKnotTarget, string>)
					.setValue(settings.newKnotTarget)
					.onChange((value) => {
						settings.newKnotTarget = value as NewKnotTarget;
						save();
					}),
			);

		new Setting(containerEl)
			.setName("Side panel")
			.setDesc("Whether the panel with variables and details is open when a graph opens. Automatic collapses it in narrow panes.")
			.addDropdown((d) =>
				d
					.addOptions({ auto: "Automatic", open: "Always open", closed: "Always closed" } satisfies Record<SidePanelMode, string>)
					.setValue(settings.sidePanel)
					.onChange((value) => {
						settings.sidePanel = value as SidePanelMode;
						save();
					}),
			);

		new Setting(containerEl)
			.setName("Delete confirmation")
			.setDesc("Deleting a single line happens at once and can be undone. Choose always to see a preview first, as for bigger deletions.")
			.addDropdown((d) =>
				d
					.addOptions({ "multi-line": "Preview bigger deletions", always: "Always preview" } satisfies Record<DeleteConfirmation, string>)
					.setValue(settings.confirmDeletes)
					.onChange((value) => {
						settings.confirmDeletes = value as DeleteConfirmation;
						save();
					}),
			);

		new Setting(containerEl)
			.setName("Choice text length on links")
			.setDesc("Longer choice texts are cut with an ellipsis. The full text is in the link's tooltip and the side panel.")
			.addSlider((s) =>
				s
					.setLimits(LABEL_LENGTH_RANGE.min, LABEL_LENGTH_RANGE.max, LABEL_LENGTH_RANGE.step)
					.setValue(settings.labelMaxLength)
					.onChange((value) => {
						settings.labelMaxLength = value;
						save();
					}),
			);

		new Setting(containerEl)
			.setName("Choices shown per link")
			.setDesc("When several choices lead to the same place they share one line. The rest collapse into a “+N more” row.")
			.addSlider((s) =>
				s
					.setLimits(LABEL_LINES_RANGE.min, LABEL_LINES_RANGE.max, LABEL_LINES_RANGE.step)
					.setValue(settings.labelMaxLines)
					.onChange((value) => {
						settings.labelMaxLines = value;
						save();
					}),
			);
	}
}
