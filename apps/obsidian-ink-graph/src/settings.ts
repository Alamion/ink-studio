// User-facing settings. Pure data and validation: the settings tab lives in settingsTab.ts.

export type NewKnotTarget = "root" | "ask";
export type SidePanelMode = "auto" | "open" | "closed";
export type DeleteConfirmation = "multi-line" | "always";

export interface InkGraphSettings {
	/** Where "New knot" writes: the story's root file, or a file chosen each time. */
	newKnotTarget: NewKnotTarget;
	/** Longest choice text shown on an edge before it is cut with an ellipsis. */
	labelMaxLength: number;
	/** Choice lines shown in one edge label before it collapses into "+N". */
	labelMaxLines: number;
	/** Whether the side panel is open when a graph opens. */
	sidePanel: SidePanelMode;
	/** "multi-line": deleting one line happens at once (with undo); "always": a preview is always shown. */
	confirmDeletes: DeleteConfirmation;
}

export const LABEL_LENGTH_RANGE = { min: 15, max: 80, step: 5 } as const;
export const LABEL_LINES_RANGE = { min: 1, max: 8, step: 1 } as const;

export const DEFAULT_SETTINGS: InkGraphSettings = {
	newKnotTarget: "root",
	labelMaxLength: 30,
	labelMaxLines: 3,
	sidePanel: "auto",
	confirmDeletes: "multi-line",
};

/** Turns whatever data.json holds (missing, old, hand-edited) into valid settings. */
export function sanitizeSettings(raw: unknown): InkGraphSettings {
	const data = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
	const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
		allowed.includes(value as T) ? (value as T) : fallback;
	const clamp = (value: unknown, range: { min: number; max: number }, fallback: number): number =>
		typeof value === "number" && Number.isFinite(value) ? Math.min(range.max, Math.max(range.min, Math.round(value))) : fallback;
	return {
		newKnotTarget: pick(data.newKnotTarget, ["root", "ask"], DEFAULT_SETTINGS.newKnotTarget),
		labelMaxLength: clamp(data.labelMaxLength, LABEL_LENGTH_RANGE, DEFAULT_SETTINGS.labelMaxLength),
		labelMaxLines: clamp(data.labelMaxLines, LABEL_LINES_RANGE, DEFAULT_SETTINGS.labelMaxLines),
		sidePanel: pick(data.sidePanel, ["auto", "open", "closed"], DEFAULT_SETTINGS.sidePanel),
		confirmDeletes: pick(data.confirmDeletes, ["multi-line", "always"], DEFAULT_SETTINGS.confirmDeletes),
	};
}
