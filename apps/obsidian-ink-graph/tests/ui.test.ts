import { describe, expect, it } from "vitest";
import { CONFIG } from "../src/config";
import type { StoryEdge, StoryNode } from "@ink-studio/core";
import { routeEdge, type Box } from "../src/ui/edgeGeometry";
import { fitGroups, type FitNode } from "../src/ui/groupFit";
import { bundleEdges, storyOrder } from "../src/ui/layout";

const box = (x: number, y: number, width = 200, height = 50): Box => ({ x, y, width, height });

describe("edge routing", () => {
	it("draws a curve when the target is clearly to the right", () => {
		const route = routeEdge(box(0, 0), box(400, 100), 0);
		expect(route.detour).toBe(false);
		expect(route.path.startsWith("M 200,25 C")).toBe(true);
		expect([route.labelX, route.labelY]).toEqual([300, 75]);
	});

	it("detours around both nodes for a back edge instead of cutting through them", () => {
		const route = routeEdge(box(400, 0), box(0, 0), 0);
		expect(route.detour).toBe(true);
		expect(route.labelY).toBe(50 + CONFIG.edges.detourMargin); // corridor just below the row
	});

	it("keeps the corridor clear of nodes standing between the ends", () => {
		const blocker = box(250, 0, 100, 300);
		const route = routeEdge(box(400, 100), box(0, 100), 0, [blocker]);
		const corridor = route.labelY;
		expect(corridor < blocker.y || corridor > blocker.y + blocker.height).toBe(true);
	});

	it("goes around the shorter side and separates parallel detours by lane", () => {
		const up = routeEdge(box(400, 400), box(0, 0), 0);
		expect(up.labelY).toBeLessThan(0); // target is above: corridor over the top
		const lane0 = routeEdge(box(400, 0), box(0, 0), 0);
		const lane1 = routeEdge(box(400, 0), box(0, 0), 1);
		expect(lane1.labelY - lane0.labelY).toBe(CONFIG.edges.laneSpacing);
	});
});

describe("group fitting", () => {
	const { headerHeight, padding } = CONFIG.group;
	const group = (w: number, h: number): FitNode => ({ id: "g", position: { x: 100, y: 100 }, style: { width: w, height: h } });
	const child = (id: string, x: number, y: number): FitNode => ({ id, parentId: "g", position: { x, y }, style: { width: 200, height: 50 } });

	it("shrinks a stretched group back to its children", () => {
		// the group grew while a stitch was far away; the stitch is back now
		const nodes = fitGroups([group(900, 700), child("a", padding, headerHeight + padding), child("b", 250, headerHeight + padding)]);
		expect(nodes[0]!.style).toMatchObject({ width: 250 + 200 + padding, height: headerHeight + padding + 50 + padding });
		expect(nodes[0]!.position).toEqual({ x: 100, y: 100 });
	});

	it("removes empty space on the left/top by moving the group, not the stitches on screen", () => {
		const nodes = fitGroups([group(900, 700), child("a", 300, 200), child("b", 500, 260)]);
		const [g, a] = nodes;
		expect(a!.position).toEqual({ x: padding, y: headerHeight + padding });
		// absolute position of the stitch is unchanged
		expect(g!.position.x + a!.position.x).toBe(100 + 300);
		expect(g!.position.y + a!.position.y).toBe(100 + 200);
	});

	it("leaves already fitted groups untouched (same objects)", () => {
		const input = fitGroups([group(900, 700), child("a", padding, headerHeight + padding)]);
		const again = fitGroups(input);
		again.forEach((n, i) => expect(n).toBe(input[i]));
	});
});

describe("edge bundling and reading order", () => {
	const node = (id: string, parentId: string | null = null, isEntry = false): StoryNode => ({
		id, name: id, kind: parentId ? "stitch" : id === "__root__" ? "root" : "knot", parentId, location: null, isEntry, terminates: false, internalDiverts: 0,
	});
	const edge = (source: string, target: string, label: string | null = null): StoryEdge => ({
		id: `${source}->${target}#${label}`, source, target, kind: label ? "choice" : "divert", label, targetLabel: null, conditional: false, location: null, sites: [], choiceLocation: null,
	});

	it("bundles parallel diverts into one edge and gives detours into one target separate lanes", () => {
		const order = new Map([["a", 0], ["b", 1], ["c", 2]]);
		const bundles = bundleEdges([edge("a", "c", "x"), edge("a", "c", "y"), edge("a", "c", "z"), edge("b", "c")], order);
		expect(bundles).toHaveLength(2);
		expect(bundles.find((b) => b.source === "a")!.edges.map((e) => e.label)).toEqual(["x", "y", "z"]);
		expect(bundles.map((b) => b.lane).sort()).toEqual([0, 1]);
	});

	it("orders nodes as a reader meets them, entering knots through their first stitch", () => {
		const nodes = [node("late"), node("k"), node("k.s2", "k"), node("k.s1", "k", true), node("__root__"), node("first")];
		const order = storyOrder(nodes, [edge("__root__", "first"), edge("first", "k"), edge("k.s1", "k.s2"), edge("k.s2", "late")]);
		const sorted = [...order.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id);
		expect(sorted).toEqual(["__root__", "first", "k", "k.s1", "k.s2", "late"]);
	});
});
