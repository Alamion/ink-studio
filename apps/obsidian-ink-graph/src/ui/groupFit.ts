// Keeps knot groups snug around their stitches. React Flow's `expandParent` only ever grows a
// parent; after a drag we re-fit the group both ways: shrink it, and move it so that no empty
// space stays on the left/top (children shift by the same amount, so nothing jumps on screen).

import { CONFIG } from "../config";

export interface FitNode {
	id: string;
	type?: string;
	parentId?: string;
	position: { x: number; y: number };
	width?: number;
	height?: number;
	measured?: { width?: number; height?: number };
	style?: { width?: number | string; height?: number | string };
}

/** Returns nodes with every group fitted to its children; unchanged nodes keep their identity. */
export function fitGroups<T extends FitNode>(nodes: readonly T[]): T[] {
	const { headerHeight, padding } = CONFIG.group;
	const replaced = new Map<string, T>();
	for (const group of nodes) {
		const children = nodes.filter((n) => n.parentId === group.id);
		if (children.length === 0) continue;
		const minX = Math.min(...children.map((c) => c.position.x));
		const minY = Math.min(...children.map((c) => c.position.y));
		const dx = minX - padding;
		const dy = minY - (headerHeight + padding);
		const maxX = Math.max(...children.map((c) => c.position.x + sizeOf(c).width)) - dx;
		const maxY = Math.max(...children.map((c) => c.position.y + sizeOf(c).height)) - dy;
		const width = maxX + padding;
		const height = maxY + padding;
		const current = sizeOf(group);
		if (dx === 0 && dy === 0 && current.width === width && current.height === height) continue;
		replaced.set(group.id, {
			...group,
			position: { x: group.position.x + dx, y: group.position.y + dy },
			style: { ...group.style, width, height },
			width,
			height,
		});
		if (dx !== 0 || dy !== 0) {
			for (const child of children) {
				replaced.set(child.id, { ...child, position: { x: child.position.x - dx, y: child.position.y - dy } });
			}
		}
	}
	return nodes.map((n) => replaced.get(n.id) ?? n);
}

export function sizeOf(node: FitNode): { width: number; height: number } {
	return {
		width: node.measured?.width ?? node.width ?? Number(node.style?.width ?? 0),
		height: node.measured?.height ?? node.height ?? Number(node.style?.height ?? 0),
	};
}
