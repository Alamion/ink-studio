// Edge routing from live node boxes. Pure geometry: no React, no DOM, unit-tested.
// Edges leave a node on its right side and enter the next one on its left side (the story reads
// left to right). Forward edges are smooth curves; edges that go back (or would cut through the
// nodes) take an orthogonal detour around both nodes along a "lane", so they never hide behind them.

import { CONFIG } from "../config";

export interface Box {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface EdgeRoute {
	path: string;
	labelX: number;
	labelY: number;
	/** True when the edge takes the detour (target is not clearly to the right). */
	detour: boolean;
}

/**
 * Routes an edge from `source`'s right side to `target`'s left side. `lane` separates parallel
 * detours; `obstacles` are the other node boxes a detour corridor must pass around.
 */
export function routeEdge(source: Box, target: Box, lane: number, obstacles: readonly Box[] = []): EdgeRoute {
	const { minForwardGap } = CONFIG.edges;
	const sx = source.x + source.width;
	const sy = source.y + source.height / 2;
	const tx = target.x;
	const ty = target.y + target.height / 2;
	return tx - sx >= minForwardGap ? forward(sx, sy, tx, ty) : detour(source, target, sx, sy, tx, ty, lane, obstacles);
}

function forward(sx: number, sy: number, tx: number, ty: number): EdgeRoute {
	const bend = Math.max(CONFIG.edges.minCurvature, (tx - sx) / 2);
	// Symmetric control points put the curve's midpoint exactly between the ends.
	return {
		path: `M ${sx},${sy} C ${sx + bend},${sy} ${tx - bend},${ty} ${tx},${ty}`,
		labelX: (sx + tx) / 2,
		labelY: (sy + ty) / 2,
		detour: false,
	};
}

function detour(
	source: Box,
	target: Box,
	sx: number,
	sy: number,
	tx: number,
	ty: number,
	lane: number,
	obstacles: readonly Box[],
): EdgeRoute {
	const { detourGap, detourMargin, laneSpacing } = CONFIG.edges;
	const offset = lane * laneSpacing;
	const outX = sx + detourGap + offset / 2;
	const inX = tx - detourGap - offset / 2;
	// The horizontal corridor passes every box it would otherwise cut through...
	const [left, right] = [Math.min(inX, outX), Math.max(inX, outX)];
	const inTheWay = [source, target, ...obstacles.filter((o) => o.x < right && o.x + o.width > left)];
	const belowY = Math.max(...inTheWay.map((b) => b.y + b.height)) + detourMargin + offset;
	const aboveY = Math.min(...inTheWay.map((b) => b.y)) - detourMargin - offset;
	// ...on whichever side makes the shorter trip; on a tie, the side the target lies on.
	const aboveCost = Math.abs(sy - aboveY) + Math.abs(ty - aboveY);
	const belowCost = Math.abs(sy - belowY) + Math.abs(ty - belowY);
	const goAbove = Math.abs(aboveCost - belowCost) < 1 ? ty < sy : aboveCost < belowCost;
	const corridorY = goAbove ? aboveY : belowY;
	const points: [number, number][] = [
		[sx, sy],
		[outX, sy],
		[outX, corridorY],
		[inX, corridorY],
		[inX, ty],
		[tx, ty],
	];
	return { path: roundedPolyline(points, CONFIG.edges.cornerRadius), labelX: outX + (inX - outX) * CONFIG.edges.detourLabelAt, labelY: corridorY, detour: true };
}

/** SVG path through the points with rounded corners (radius shrinks on short segments). */
export function roundedPolyline(points: readonly [number, number][], radius: number): string {
	if (points.length < 2) return "";
	const [first] = points;
	let d = `M ${first![0]},${first![1]}`;
	for (let i = 1; i < points.length - 1; i++) {
		const [px, py] = points[i - 1]!;
		const [cx, cy] = points[i]!;
		const [nx, ny] = points[i + 1]!;
		const r = Math.min(radius, Math.hypot(cx - px, cy - py) / 2, Math.hypot(nx - cx, ny - cy) / 2);
		const inPoint = towards(cx, cy, px, py, r);
		const outPoint = towards(cx, cy, nx, ny, r);
		d += ` L ${inPoint[0]},${inPoint[1]} Q ${cx},${cy} ${outPoint[0]},${outPoint[1]}`;
	}
	const last = points[points.length - 1]!;
	return `${d} L ${last[0]},${last[1]}`;
}

function towards(fromX: number, fromY: number, toX: number, toY: number, distance: number): [number, number] {
	const length = Math.hypot(toX - fromX, toY - fromY);
	if (length === 0) return [fromX, fromY];
	return [fromX + ((toX - fromX) / length) * distance, fromY + ((toY - fromY) / length) * distance];
}
