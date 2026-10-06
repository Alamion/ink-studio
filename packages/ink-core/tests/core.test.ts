import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	buildStoryGraph,
	findStoryRoot,
	MISSING_NODE_PREFIX,
	resolveIncludePath,
	ROOT_NODE_ID,
	type StoryEdge,
	type StoryGraph,
} from "../src";

// The demo story lives in the vault that hosts this plugin: <vault>/.obsidian/plugins/ink-graph
const VAULT = join(__dirname, "../../../fixtures");
const DEMO_DIR = "stories/demo";

function loadDemo(): Map<string, string> {
	const sources = new Map<string, string>();
	for (const file of readdirSync(join(VAULT, DEMO_DIR))) {
		if (file.endsWith(".ink")) sources.set(`${DEMO_DIR}/${file}`, readFileSync(join(VAULT, DEMO_DIR, file), "utf8"));
	}
	return sources;
}

function single(source: string): StoryGraph {
	return buildStoryGraph("main.ink", new Map([["main.ink", source]]));
}

function edge(graph: StoryGraph, source: string, target: string): StoryEdge | undefined {
	return graph.edges.find((e) => e.source === source && e.target === target);
}

function accessesOf(graph: StoryGraph, nodeId: string, mode: "read" | "write"): string[] {
	const names = graph.accesses.filter((a) => a.nodeId === nodeId && a.mode === mode).map((a) => a.variable);
	return [...new Set(names)].sort();
}

describe("demo story", () => {
	const graph = buildStoryGraph(`${DEMO_DIR}/main.ink`, loadDemo());

	it("compiles and loads every included file", () => {
		expect(graph.compiled).toBe(true);
		expect(graph.diagnostics).toEqual([]);
		expect(graph.files.sort()).toEqual(
			["functions.ink", "main.ink", "tavern.ink"].map((f) => `${DEMO_DIR}/${f}`),
		);
	});

	it("builds knots, stitches and functions with vault locations", () => {
		const byId = new Map(graph.nodes.map((n) => [n.id, n]));
		expect(byId.get("forest")).toMatchObject({ kind: "knot", location: { file: `${DEMO_DIR}/main.ink`, line: 75 } });
		expect(byId.get("take_damage")).toMatchObject({ kind: "function", location: { file: `${DEMO_DIR}/functions.ink` } });
		expect(byId.get("find_torch.search")).toMatchObject({ kind: "stitch", parentId: "find_torch", isEntry: true });
		expect(byId.get("find_torch.got_it")).toMatchObject({ isEntry: false });
		expect(byId.get("death")?.terminates).toBe(true);
		expect(byId.get(ROOT_NODE_ID)?.terminates).toBe(false); // implicit -> DONE is ignored
	});

	it("classifies edges", () => {
		expect(edge(graph, "start", "find_torch")).toMatchObject({ kind: "choice", label: "Поискать факел", conditional: true });
		expect(edge(graph, "start", "tavern")).toMatchObject({ kind: "choice", label: "Пойти в таверну", conditional: false });
		expect(edge(graph, "start", "inventory_screen")?.kind).toBe("tunnel");
		expect(edge(graph, "tavern", "tavern_regulars")?.kind).toBe("thread");
		expect(edge(graph, "tavern_regulars", "tavern")).toMatchObject({ kind: "choice", targetLabel: "bar_loop" });
		expect(edge(graph, "clearing", "death")).toMatchObject({ kind: "choice", conditional: true }); // divert in an if inside a choice
		expect(edge(graph, "clearing", "take_damage")?.kind).toBe("call");
		expect(edge(graph, "forest", "clearing")?.kind).toBe("divert"); // first one wins: `-> clearing` in the if
		expect(graph.edges.some((e) => e.target === "MAX" || e.target === "RANDOM")).toBe(false); // built-ins
		expect(graph.edges.some((e) => e.source === e.target)).toBe(false);
	});

	it("keeps loops inside a node as a counter", () => {
		expect(graph.nodes.find((n) => n.id === "forest")?.internalDiverts).toBeGreaterThan(0);
	});

	it("collects global declarations", () => {
		const kinds = Object.fromEntries(graph.variables.map((v) => [v.name, v.kind]));
		expect(kinds).toMatchObject({ MAX_HP: "const", hp: "var", Mood: "list", inventory: "var" });
		expect(graph.variables.find((v) => v.name === "gold")?.declaredAt).toEqual({ file: `${DEMO_DIR}/main.ink`, line: 12 });
	});

	it("tracks direct, compound, ref and transitive writes", () => {
		expect(accessesOf(graph, "find_torch.got_it", "write")).toEqual(["has_torch", "inventory"]); // incl. +=
		expect(accessesOf(graph, "tavern", "write")).toEqual(["gold", "inventory", "last_place"]); // gold-- and spend(ref)
		expect(graph.accesses).toContainEqual(expect.objectContaining({ nodeId: "tavern", variable: "gold", via: "spend" }));
		expect(accessesOf(graph, "clearing", "write")).toEqual(["Mood", "gold", "hp"]); // hp/Mood via take_damage
	});

	it("ignores temps, parameters, list items and visit counts", () => {
		const names = new Set(graph.accesses.map((a) => a.variable));
		for (const local of ["found", "roll", "current", "wallet", "items", "key", "scared", "tavern", "deeper"]) {
			expect(names.has(local)).toBe(false);
		}
	});
});

describe("edge cases", () => {
	it("resolves divert-to-variable into possible targets", () => {
		const graph = single(`
VAR next = -> a
-> hub
=== hub ===
-> next
=== a ===
~ next = -> b
-> hub
=== b ===
-> END
`);
		expect(edge(graph, "hub", "a")).toMatchObject({ kind: "dynamic", label: "next" });
		expect(edge(graph, "hub", "b")).toMatchObject({ kind: "dynamic", label: "next" });
	});

	it("still produces a graph with a syntax error and a broken divert", () => {
		const graph = single(`
-> start
=== start ===
* [Go] -> nowhere
* [Home] -> home
=== home ===
{ broken
-> END
`);
		expect(graph.compiled).toBe(false);
		expect(graph.diagnostics.length).toBeGreaterThan(0);
		expect(graph.nodes.map((n) => n.id)).toEqual(expect.arrayContaining(["start", "home", MISSING_NODE_PREFIX + "nowhere"]));
		expect(edge(graph, "start", "home")?.kind).toBe("choice");
	});

	it("does not treat a local temp that shadows a global as a global write", () => {
		const graph = single(`
VAR x = 0
-> k
=== k ===
~ temp x = 5
~ x = 6
-> END
`);
		expect(accessesOf(graph, "k", "write")).toEqual([]);
	});

	it("reports a missing root file instead of throwing", () => {
		const graph = buildStoryGraph("nope.ink", new Map());
		expect(graph.nodes).toEqual([]);
		expect(graph.diagnostics[0]?.severity).toBe("error");
	});
});

describe("includes", () => {
	it("resolves include paths relative to the root folder", () => {
		expect(resolveIncludePath("stories/demo/main.ink", "tavern.ink")).toBe("stories/demo/tavern.ink");
		expect(resolveIncludePath("stories/demo/main.ink", "../shared/lib.ink")).toBe("stories/shared/lib.ink");
		expect(resolveIncludePath("main.ink", "./a/b.ink")).toBe("a/b.ink");
	});

	it("finds the story root from an included file", () => {
		const sources = loadDemo();
		expect(findStoryRoot(`${DEMO_DIR}/tavern.ink`, sources)).toBe(`${DEMO_DIR}/main.ink`);
		expect(findStoryRoot(`${DEMO_DIR}/main.ink`, sources)).toBe(`${DEMO_DIR}/main.ink`);
	});

	it("ignores INCLUDE lines inside comments and survives include cycles", () => {
		const sources = new Map([
			["a.ink", "INCLUDE b.ink"],
			["b.ink", "// INCLUDE c.ink\nINCLUDE a.ink"],
			["c.ink", ""],
		]);
		expect(findStoryRoot("c.ink", sources)).toBe("c.ink");
		expect(["a.ink", "b.ink"]).toContain(findStoryRoot("b.ink", sources));
	});
});

describe("choiceless loops", () => {
	const loopsOf = (source: string) => single(source).loops.map((l) => ({ nodes: l.nodeIds, certain: l.certain }));

	it("reports an unconditional divert cycle as a certain loop, with its edges", () => {
		const graph = single("-> a\n=== a ===\nHi\n-> b\n=== b ===\nThere\n-> a\n");
		expect(graph.loops).toHaveLength(1);
		expect(graph.loops[0]).toMatchObject({ nodeIds: ["a", "b"], certain: true });
		expect(graph.loops[0]!.edgeIds.sort()).toEqual(["divert:a->b##", "divert:b->a##"]);
		expect(graph.diagnostics).toContainEqual(
			expect.objectContaining({ severity: "error", message: "Infinite loop without choices: a → b → a" }),
		);
	});

	it("catches loops inside one node (back to a label) and tunnel recursion", () => {
		expect(loopsOf("-> a\n=== a ===\n- (top) Hi\n-> top\n")).toEqual([{ nodes: ["a"], certain: true }]);
		expect(loopsOf("-> a\n=== a ===\n-> b ->\n-> END\n=== b ===\n-> a ->\n->->\n")).toEqual([{ nodes: ["a", "b"], certain: true }]);
	});

	it("follows a knot without content into its first stitch", () => {
		expect(loopsOf("-> k\n=== k ===\n= s\nHi\n-> k\n")).toEqual([{ nodes: ["k", "k.s"], certain: true }]);
	});

	it("marks loops guarded by conditions or sequences as possible, not certain", () => {
		expect(loopsOf("VAR n = 0\n-> a\n=== a ===\n~ n++\n{ n < 5: -> a }\n-> END\n")).toEqual([{ nodes: ["a"], certain: false }]);
		expect(loopsOf("-> a\n=== a ===\nHi {-> a|-> END}\n")).toEqual([{ nodes: ["a"], certain: false }]);
	});

	it("does not report cycles that pass through a choice", () => {
		expect(loopsOf("-> a\n=== a ===\n* [x] -> b\n=== b ===\n-> a\n")).toEqual([]);
		// the divert after a gather only runs once one of the choices was taken
		expect(loopsOf("-> a\n=== a ===\n* [x]\n* [y]\n- -> b\n=== b ===\n-> a\n")).toEqual([]);
		expect(loopsOf("-> a\n=== a ===\n+ [again] -> a\n+ [stop] -> END\n")).toEqual([]);
	});

	it("finds nothing in the demo story", () => {
		expect(buildStoryGraph(`${DEMO_DIR}/main.ink`, loadDemo()).loops).toEqual([]);
	});
});
