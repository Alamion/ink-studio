import { describe, expect, it } from "vitest";
import { classifyDrop } from "../src/ui/GraphApp";

/** A tiny stand-in for the DOM pieces classifyDrop touches. */
interface Fake {
	matches: string[];
	parent?: Fake;
	id?: string;
	classes?: string[];
	top?: number;
	self?: HTMLElement;
}
function el(fake: Fake): HTMLElement {
	const self = {
		contains: (other: unknown) => {
			for (let n = other as Fake | undefined; n; n = n.parent) if (n === (self as unknown)) return true;
			return false;
		},
		classList: { contains: (c: string) => (fake.classes ?? []).includes(c) },
		getAttribute: (name: string) => (name === "data-id" ? (fake.id ?? null) : null),
		getBoundingClientRect: () => ({ top: fake.top ?? 0 }),
		closest: (selector: string) => {
			for (let n: Fake | undefined = fake; n; n = n.parent) {
				if (n.matches.some((m) => selector.split(",").map((s) => s.trim()).includes(m))) return n.self;
			}
			return null;
		},
		parent: fake.parent?.self,
	} as unknown as HTMLElement & { parent?: unknown };
	fake.self = self;
	return self;
}
function tree() {
	const view: Fake = { matches: [] };
	const viewEl = el(view);
	const make = (fake: Fake): HTMLElement => {
		fake.parent = fake.parent ?? view;
		return el(fake);
	};
	return { viewEl, make, view };
}

const point = { x: 100, y: 100 };

describe("classifyDrop", () => {
	it("ignores everything outside the graph view", () => {
		const { viewEl } = tree();
		const outside = el({ matches: [".react-flow__pane"] });
		expect(classifyDrop(viewEl, outside, point, 1)).toEqual({ kind: "none" });
		expect(classifyDrop(viewEl, null, point, 1)).toEqual({ kind: "none" });
		expect(classifyDrop(null, outside, point, 1)).toEqual({ kind: "none" });
	});

	it("ignores the side panel, controls and labels", () => {
		const { make, viewEl } = tree();
		for (const cls of [".ink-panel", ".react-flow__controls", ".react-flow__minimap", ".ink-edge-label", ".ink-loop-banner", ".ink-panel-toggle"]) {
			expect(classifyDrop(viewEl, make({ matches: [cls] }), point, 1)).toEqual({ kind: "none" });
		}
	});

	it("empty canvas means a new knot", () => {
		const { make, viewEl } = tree();
		expect(classifyDrop(viewEl, make({ matches: [".react-flow__pane"] }), point, 1)).toEqual({ kind: "pane" });
		expect(classifyDrop(viewEl, make({ matches: [".react-flow__edge"] }), point, 1)).toEqual({ kind: "pane" });
	});

	it("a plain node means link to it", () => {
		const { make, viewEl } = tree();
		const node = make({ matches: [".react-flow__node"], id: "tavern", classes: ["react-flow__node-ink"] });
		expect(classifyDrop(viewEl, node, point, 1)).toEqual({ kind: "node", id: "tavern" });
	});

	it("a knot group: the header links, the body means a new stitch", () => {
		const { make, viewEl } = tree();
		const group = make({ matches: [".react-flow__node"], id: "find_torch", classes: ["react-flow__node-inkGroup"], top: 80 });
		expect(classifyDrop(viewEl, group, { x: 100, y: 100 }, 1)).toEqual({ kind: "node", id: "find_torch" }); // 20px below the top: header
		expect(classifyDrop(viewEl, group, { x: 100, y: 200 }, 1)).toEqual({ kind: "group", id: "find_torch" });
		// the header scales with the zoom
		expect(classifyDrop(viewEl, group, { x: 100, y: 130 }, 0.5)).toEqual({ kind: "group", id: "find_torch" });
	});

	it("something unknown inside the view does nothing", () => {
		const { make, viewEl } = tree();
		expect(classifyDrop(viewEl, make({ matches: [".something-else"] }), point, 1)).toEqual({ kind: "none" });
	});
});
