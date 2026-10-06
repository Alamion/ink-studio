// Node positions live in a sidecar JSON next to the story root, so they travel with the story in git.
// Keys are ink paths (`knot`, `knot.stitch`); stitch positions are relative to their knot.

import type { DataAdapter } from "obsidian";
import { CONFIG } from "../config";

export interface Point {
	x: number;
	y: number;
}

export interface SavedLayout {
	version: number;
	positions: Record<string, Point>;
}

export function emptyLayout(): SavedLayout {
	return { version: CONFIG.layoutFormatVersion, positions: {} };
}

export function layoutPathFor(rootFile: string): string {
	return rootFile.replace(/\.ink$/i, "") + CONFIG.layoutFileSuffix;
}

/**
 * Uses the DataAdapter on purpose: Obsidian does not index files with unknown extensions (`.graph.json`)
 * unless "Detect all file extensions" is on, so the Vault API cannot see or safely create the sidecar.
 */
export class LayoutStore {
	constructor(private readonly adapter: DataAdapter) {}

	/** Returns an empty layout when the file is missing or malformed: layout is a convenience, never a blocker. */
	async load(rootFile: string): Promise<SavedLayout> {
		const path = layoutPathFor(rootFile);
		try {
			if (!(await this.adapter.exists(path))) return emptyLayout();
			const parsed: unknown = JSON.parse(await this.adapter.read(path));
			return isSavedLayout(parsed) ? parsed : emptyLayout();
		} catch {
			return emptyLayout(); // unreadable sidecar: the layout is recomputed and overwritten on the next drag
		}
	}

	async save(rootFile: string, layout: SavedLayout): Promise<void> {
		// Sorted keys keep diffs of the sidecar stable in git.
		const positions = Object.fromEntries(
			Object.entries(layout.positions)
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([id, p]) => [id, { x: Math.round(p.x), y: Math.round(p.y) }]),
		);
		const text = JSON.stringify({ version: CONFIG.layoutFormatVersion, positions }, null, "\t");
		await this.adapter.write(layoutPathFor(rootFile), text + "\n");
	}
}

function isSavedLayout(value: unknown): value is SavedLayout {
	if (typeof value !== "object" || value === null) return false;
	const { version, positions } = value as Partial<SavedLayout>;
	if (version !== CONFIG.layoutFormatVersion || typeof positions !== "object" || positions === null) return false;
	return Object.values(positions).every(
		(p: unknown) => typeof p === "object" && p !== null && Number.isFinite((p as Point).x) && Number.isFinite((p as Point).y),
	);
}
