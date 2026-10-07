import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	applyToSources,
	buildStoryGraph,
	planCreateKnot,
	planCreateStitch,
	planDeleteLinks,
	planDeleteNode,
	planLink,
	planRename,
	type EditPlan,
	type StoryGraph,
} from "../src";
import { verified } from "../src/edits";

const VAULT = join(__dirname, "../../../fixtures");
const DEMO = "stories/demo";
const ROOT = `${DEMO}/main.ink`;

function demo(): { sources: Map<string, string>; graph: StoryGraph } {
	const sources = new Map<string, string>();
	for (const f of readdirSync(join(VAULT, DEMO))) if (f.endsWith(".ink")) sources.set(`${DEMO}/${f}`, readFileSync(join(VAULT, DEMO, f), "utf8"));
	return { sources, graph: buildStoryGraph(ROOT, sources) };
}

/** Applies an ok plan and returns the new sources and graph. */
function apply(plan: EditPlan, sources: Map<string, string>, root = ROOT) {
	if (!plan.ok) throw new Error(plan.error);
	const after = applyToSources(sources, plan.edits);
	return { after, graph: buildStoryGraph(root, after) };
}

const errors = (g: StoryGraph) => g.diagnostics.filter((d) => d.severity === "error");

describe("create", () => {
	it("appends a knot to the root file", () => {
		const { sources, graph } = demo();
		const { after, graph: next } = apply(planCreateKnot(graph, sources, "cave"), sources);
		expect(next.nodes.find((n) => n.id === "cave")?.location?.file).toBe(ROOT);
		expect(after.get(ROOT)!.trimEnd().endsWith("=== cave ===\n// TODO: write cave\n-> END")).toBe(true);
		expect(errors(next)).toEqual([]);
	});

	it("rejects bad or taken names", () => {
		const { sources, graph } = demo();
		for (const [name, why] of [["forest", "already exists"], ["gold", "variable"], ["2nd", "letters"], ["END", "reserved"]]) {
			const plan = planCreateKnot(graph, sources, name!);
			expect(plan.ok).toBe(false);
			if (!plan.ok) expect(plan.error).toContain(why);
		}
	});

	it("adds a stitch after the knot's last stitch", () => {
		const { sources, graph } = demo();
		const { after, graph: next } = apply(planCreateStitch(graph, sources, "find_torch", "lamp"), sources);
		const lamp = next.nodes.find((n) => n.id === "find_torch.lamp")!;
		const gotIt = next.nodes.find((n) => n.id === "find_torch.got_it")!;
		const forest = next.nodes.find((n) => n.id === "forest")!;
		expect(lamp.location!.line).toBeGreaterThan(gotIt.location!.line);
		expect(lamp.location!.line).toBeLessThan(forest.location!.line);
		expect(after.get(ROOT)).toContain("\n= lamp\n");
	});
});

describe("link", () => {
	it("adds a choice at the end of the source's own content", () => {
		const { sources, graph } = demo();
		const { after, graph: next } = apply(planLink(graph, sources, "start", "death", "choice", "Сдаться [сразу]"), sources);
		expect(after.get(ROOT)).toContain("* [Сдаться \\[сразу\\]] -> death");
		const edge = next.edges.find((e) => e.source === "start" && e.target === "death")!;
		expect(edge).toMatchObject({ kind: "choice", label: "Сдаться [сразу]" });
	});

	it("puts a plain divert after choices behind a gather, so it is not swallowed by the last choice", () => {
		const { sources, graph } = demo();
		const { after, graph: next } = apply(planLink(graph, sources, "forest", "death", "divert"), sources);
		expect(after.get(ROOT)).toMatch(/\* -> clearing[^\n]*\n- -> death\n/); // right after the fallback choice
		expect(next.edges.find((e) => e.source === "forest" && e.target === "death")?.kind).toBe("divert");
	});

	it("uses the short name for a sibling stitch and edits the source's own file", () => {
		const { sources, graph } = demo();
		const sibling = planLink(graph, sources, "find_torch.search_again", "find_torch.got_it", "divert");
		expect(sibling.ok && sibling.edits[0]!.text).toContain("-> got_it");
		const crossFile = planLink(graph, sources, "tavern", "forest", "sticky", "В лес");
		expect(crossFile.ok && crossFile.edits[0]!.file).toBe(`${DEMO}/tavern.ink`);
	});

	it("refuses links that make no sense", () => {
		const { sources, graph } = demo();
		expect(planLink(graph, sources, "__root__", "forest", "divert").ok).toBe(false);
		expect(planLink(graph, sources, "forest", "forest", "choice", "").ok).toBe(false);
	});
});

describe("rename", () => {
	it("renames a knot everywhere ink refers to it, across files, keeping prose and comments", () => {
		const { sources, graph } = demo();
		const { after, graph: next } = apply(planRename(graph, sources, "tavern", "inn"), sources);
		expect(next.nodes.some((n) => n.id === "inn") && !next.nodes.some((n) => n.id === "tavern")).toBe(true);
		expect(after.get(`${DEMO}/tavern.ink`)).toContain("=== inn ===");
		expect(after.get(`${DEMO}/tavern.ink`)).toContain("{ inn > 1:"); // read count
		expect(after.get(`${DEMO}/tavern.ink`)).toContain("-> inn.bar_loop");
		expect(after.get(ROOT)).toContain("-> inn\n"); // from main.ink
		expect(after.get(ROOT)).toContain("в таверне был {inn} раз"); // read count in text
		expect(next.edges.length).toBe(graph.edges.length);
		expect(errors(next)).toEqual([]);
	});

	it("renames a stitch, including relative diverts", () => {
		const { sources, graph } = demo();
		const { after, graph: next } = apply(planRename(graph, sources, "find_torch.search", "look"), sources);
		expect(after.get(ROOT)).toContain("= look\n");
		expect(after.get(ROOT)).toContain("[Искать дальше] -> look");
		expect(next.edges.some((e) => e.source === "find_torch.search_again" && e.target === "find_torch.look")).toBe(true);
	});

	it("touches only real references, not equal words elsewhere", () => {
		const src = "-> hub\n=== hub ===\nWelcome to the hub. // the hub\n{hub > 1: Back.}\nVAR_hub\n* [Stay] -> hub\n* [Go] -> side.hub\n=== side ===\n= hub\n-> END\n";
		const sources = new Map([["main.ink", src]]);
		const graph = buildStoryGraph("main.ink", sources);
		const plan = planRename(graph, sources, "hub", "center");
		const text = applyToSources(sources, plan.ok ? plan.edits : []).get("main.ink")!;
		expect(text).toBe(
			"-> center\n=== center ===\nWelcome to the hub. // the hub\n{center > 1: Back.}\nVAR_hub\n* [Stay] -> center\n* [Go] -> side.hub\n=== side ===\n= hub\n-> END\n",
		);
	});
});

describe("delete node", () => {
	it("deletes a stitch and redirects diverts into it to END", () => {
		const { sources, graph } = demo();
		const plan = planDeleteNode(graph, sources, "find_torch.search_again");
		const { after, graph: next } = apply(plan, sources);
		expect(next.nodes.some((n) => n.id === "find_torch.search_again")).toBe(false);
		expect(after.get(ROOT)).not.toContain("= search_again");
		expect(after.get(ROOT)).toContain("Ничего... -> END");
		expect(after.get(ROOT)).toContain("= got_it"); // the next stitch stays
		expect(plan.ok && plan.redirected.map((r) => r.location.line)).toHaveLength(1);
		expect(errors(next)).toEqual([]);
	});

	it("deletes a knot with its stitches; choices into it become dead ends", () => {
		const { sources, graph } = demo();
		const { after, graph: next } = apply(planDeleteNode(graph, sources, "find_torch"), sources);
		expect(next.nodes.some((n) => n.id === "find_torch" || n.parentId === "find_torch")).toBe(false);
		expect(after.get(ROOT)).toMatch(/\[Поискать факел\][^\n]*\n\s*-> END/);
		expect(after.get(ROOT)).toContain("=== forest ===");
		expect(errors(next)).toEqual([]);
	});

	it("redirects plain diverts and fallback choices", () => {
		const { sources, graph } = demo();
		const { after, graph: next } = apply(planDeleteNode(graph, sources, "clearing"), sources);
		expect(after.get(ROOT)).toContain("* -> END");
		expect(after.get(ROOT)).not.toContain("clearing");
		expect(errors(next)).toEqual([]);
	});

	it("refuses while tunnels, read counts or divert values point at the node", () => {
		const { sources, graph } = demo();
		const start = planDeleteNode(graph, sources, "start");
		expect(start.ok).toBe(false);
		if (!start.ok) expect(start.blocking?.map((r) => r.kind)).toContain("divert value"); // VAR last_place = -> start
		const tavern = planDeleteNode(graph, sources, "tavern");
		expect(tavern.ok).toBe(false);
		if (!tavern.ok) expect(tavern.blocking?.map((r) => r.kind)).toContain("read count"); // {tavern} in main.ink
	});
});

describe("delete link", () => {
	const edgeId = (graph: StoryGraph, source: string, target: string) => graph.edges.find((e) => e.source === source && e.target === target)!.id;

	it("removes a choice whose only exit is the link", () => {
		const { sources, graph } = demo();
		const plan = planDeleteLinks(graph, sources, [edgeId(graph, "start", "tavern")]);
		const { after, graph: next } = apply(plan, sources);
		expect(after.get(ROOT)).not.toContain("Пойти в таверну");
		expect(after.get(ROOT)).toContain("[Посмотреть инвентарь]");
		expect(plan.ok && plan.changes).toEqual([{ file: ROOT, line: expect.any(Number), before: ["+ [Пойти в таверну] -> tavern"], after: [] }]);
		expect(errors(next)).toEqual([]);
	});

	it("removes the choice with its branch when the branch only diverts", () => {
		const { sources, graph } = demo();
		const { after } = apply(planDeleteLinks(graph, sources, [edgeId(graph, "start", "forest")]), sources);
		expect(after.get(ROOT)).not.toContain("Зайти в тёмный лес");
		expect(after.get(ROOT)).not.toMatch(/^\s*-> forest$/m);
	});

	it("keeps the choice when the divert is one of several things in its branch", () => {
		const { sources, graph } = demo();
		const { after, graph: next } = apply(planDeleteLinks(graph, sources, [edgeId(graph, "clearing", "death")]), sources);
		expect(after.get(ROOT)).toContain("* [Взломать]");
		expect(after.get(ROOT)).not.toContain("-> death");
		expect(after.get(ROOT)).not.toContain("is_dead()"); // the conditional only held the divert
		expect(next.edges.some((e) => e.source === "clearing" && e.target === "ending" && e.label === "Взломать")).toBe(true);
		expect(errors(next)).toEqual([]);
	});

	it("removes a divert from a line with text, and a gathered divert with its gather", () => {
		const src = "-> a\n=== a ===\nHello -> b\n=== b ===\n* [x] -> END\n- -> a\n=== c ===\n-> END\n";
		const sources = new Map([["m.ink", src]]);
		const graph = buildStoryGraph("m.ink", sources);
		const text = (plan: EditPlan) => applyToSources(sources, plan.ok ? plan.edits : []).get("m.ink");
		expect(text(planDeleteLinks(graph, sources, [edgeId(graph, "a", "b")]))).toContain("=== a ===\nHello\n=== b");
		expect(text(planDeleteLinks(graph, sources, [edgeId(graph, "b", "a")]))).toContain("* [x] -> END\n=== c");
	});

	it("refuses links it cannot remove safely", () => {
		const { sources, graph } = demo();
		const call = graph.edges.find((e) => e.kind === "call")!;
		expect(planDeleteLinks(graph, sources, [call.id]).ok).toBe(false);
	});
});

describe("delete everything, one at a time", () => {
	for (const story of ["demo", "loop-demo"]) {
		it(`${story}: every plan is clean or a clear refusal`, () => {
			const dir = `stories/${story}`;
			const sources = new Map<string, string>();
			for (const f of readdirSync(join(VAULT, dir))) if (f.endsWith(".ink")) sources.set(`${dir}/${f}`, readFileSync(join(VAULT, dir, f), "utf8"));
			const graph = buildStoryGraph(`${dir}/main.ink`, sources);
			const plans = [
				...graph.nodes.filter((n) => n.kind === "knot" || n.kind === "stitch").map((n) => planDeleteNode(graph, sources, n.id)),
				...graph.edges.map((e) => planDeleteLinks(graph, sources, [e.id])),
			];
			for (const plan of plans) {
				if (!plan.ok) expect(plan.error).toMatch(/\w/);
				else expect(errors(buildStoryGraph(`${dir}/main.ink`, applyToSources(sources, plan.edits))).length).toBeLessThanOrEqual(errors(graph).length);
			}
			expect(plans.filter((p) => p.ok).length).toBeGreaterThan(plans.length / 2);
		}, 60_000);
	}
});

describe("safety net", () => {
	it("rejects a plan that would break compilation", () => {
		const { sources, graph } = demo();
		const header = graph.nodes.find((n) => n.id === "clearing")!.location!;
		const breakHeader = [{ file: ROOT, from: { line: header.line, ch: 0 }, to: { line: header.line, ch: 3 }, text: "" }];
		const plan = verified(graph, sources, breakHeader, () => true);
		expect(plan.ok).toBe(false);
		if (!plan.ok) expect(plan.error).toContain("would not compile");
	});
});

describe("drop a link on empty canvas: create the node, then link to it", () => {
	/** What the plugin does in two steps: plan the creation, apply it, plan the link on the result. */
	function createThenLink(sourceId: string, create: (g: StoryGraph, s: Map<string, string>) => EditPlan, newId: string, kind: "choice" | "divert" | "tunnel") {
		const { sources, graph } = demo();
		const first = apply(create(graph, sources), sources);
		const second = apply(planLink(first.graph, first.after, sourceId, newId, kind, "Onwards"), first.after);
		return { ...second, source: sources };
	}

	it("a new knot linked from a knot", () => {
		const { graph, after } = createThenLink("start", (g, s) => planCreateKnot(g, s, "cave"), "cave", "choice");
		expect(errors(graph)).toEqual([]);
		expect(graph.edges.some((e) => e.source === "start" && e.target === "cave" && e.kind === "choice")).toBe(true);
		expect(after.get(ROOT)).toContain("=== cave ===");
	});

	it("a new knot linked from the last knot of its file (both edits touch the end of the file)", () => {
		const { graph } = createThenLink("ending", (g, s) => planCreateKnot(g, s, "epilogue"), "epilogue", "divert");
		expect(errors(graph)).toEqual([]);
		expect(graph.edges.some((e) => e.source === "ending" && e.target === "epilogue")).toBe(true);
	});

	it("a new stitch in a knot, linked from one of that knot's stitches", () => {
		const { graph } = createThenLink("find_torch.search", (g, s) => planCreateStitch(g, s, "find_torch", "rest"), "find_torch.rest", "choice");
		expect(errors(graph)).toEqual([]);
		expect(graph.edges.some((e) => e.source === "find_torch.search" && e.target === "find_torch.rest")).toBe(true);
	});

	it("a new stitch in another knot, linked from a knot", () => {
		const { graph } = createThenLink("start", (g, s) => planCreateStitch(g, s, "forest", "edge"), "forest.edge", "tunnel");
		expect(errors(graph)).toEqual([]);
		expect(graph.edges.some((e) => e.source === "start" && e.target === "forest.edge" && e.kind === "tunnel")).toBe(true);
	});

	it("a stitch dropped inside its own knot, linked from the knot itself", () => {
		const { graph } = createThenLink("find_torch", (g, s) => planCreateStitch(g, s, "find_torch", "hideout"), "find_torch.hideout", "divert");
		expect(errors(graph)).toEqual([]);
		expect(graph.edges.some((e) => e.source === "find_torch" && e.target === "find_torch.hideout")).toBe(true);
	});
});
