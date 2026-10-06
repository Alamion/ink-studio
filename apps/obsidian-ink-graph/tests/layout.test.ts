import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildStoryGraph } from "@ink-studio/core";
import { layoutGraph } from "../src/ui/layout";

const VAULT = join(__dirname, "../../../fixtures");
const DEMO_DIR = "stories/demo";

function demoGraph() {
	const sources = new Map<string, string>();
	for (const file of readdirSync(join(VAULT, DEMO_DIR))) {
		sources.set(`${DEMO_DIR}/${file}`, readFileSync(join(VAULT, DEMO_DIR, file), "utf8"));
	}
	return buildStoryGraph(`${DEMO_DIR}/main.ink`, sources);
}

describe("layout", () => {
	const graph = demoGraph();

	it("lays out every visible node with parents before children", async () => {
		const { nodes, edges } = await layoutGraph(graph, { showFunctions: false }, {});
		const index = new Map(nodes.map((n, i) => [n.id, i]));
		expect(nodes.some((n) => n.data.node.kind === "function")).toBe(false);
		expect(edges.every((e) => index.has(e.source) && index.has(e.target))).toBe(true);
		for (const node of nodes) {
			expect(Number.isFinite(node.position.x) && Number.isFinite(node.position.y)).toBe(true);
			if (node.parentId) expect(index.get(node.parentId)!).toBeLessThan(index.get(node.id)!);
		}
		expect(nodes.find((n) => n.id === "find_torch")?.type).toBe("inkGroup");
		expect(nodes.find((n) => n.id === "find_torch.search")?.parentId).toBe("find_torch");
	});

	it("does not overlap top-level nodes", async () => {
		const { nodes } = await layoutGraph(graph, { showFunctions: true }, {});
		const boxes = nodes
			.filter((n) => !n.parentId)
			.map((n) => ({ id: n.id, x: n.position.x, y: n.position.y, w: Number(n.style!.width), h: Number(n.style!.height) }));
		for (const a of boxes)
			for (const b of boxes)
				if (a.id < b.id) {
					const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
					expect(overlap, `${a.id} overlaps ${b.id}`).toBe(false);
				}
	});

	it("prefers saved positions and grows groups to fit them", async () => {
		const saved = { forest: { x: 5000, y: 7 }, "find_torch.got_it": { x: 900, y: 600 } };
		const { nodes } = await layoutGraph(graph, { showFunctions: false }, saved);
		expect(nodes.find((n) => n.id === "forest")?.position).toEqual({ x: 5000, y: 7 });
		const group = nodes.find((n) => n.id === "find_torch")!;
		expect(Number(group.style!.width)).toBeGreaterThan(900);
		expect(Number(group.style!.height)).toBeGreaterThan(600);
	});
});
