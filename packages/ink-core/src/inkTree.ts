// Traversal helpers over inkjs's parsed hierarchy.

import { Choice, FlowBase, Gather, Knot, ParsedStory, Stitch, Weave, type ParsedObject } from "./ink";
import { ROOT_NODE_ID } from "./model";

/** Depth-first pre-order walk over `content`, in source order. */
export function* walk(root: ParsedObject): Generator<ParsedObject> {
	const stack: ParsedObject[] = [root];
	while (stack.length > 0) {
		const obj = stack.pop()!;
		yield obj;
		const children = obj.content ?? [];
		for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]!);
	}
}

/** Nearest knot, stitch or story that owns `obj` (the flow itself for a flow). */
export function enclosingFlow(obj: ParsedObject): FlowBase {
	for (let current: ParsedObject | null = obj; current; current = current.parent) {
		if (current instanceof FlowBase) return current;
	}
	throw new Error("Parsed object is not attached to a story");
}

/** Nearest ancestor of the given class, not crossing the owning flow. */
export function ancestorWithinFlow<T extends ParsedObject>(
	obj: ParsedObject,
	cls: abstract new (...args: never[]) => T,
): T | null {
	for (let current = obj.parent; current && !(current instanceof FlowBase); current = current.parent) {
		if (current instanceof cls) return current;
	}
	return null;
}

/**
 * The choice whose branch contains `obj`. In the parsed tree a choice's body lines are not its
 * children but the siblings that follow it inside the Weave, up to the next choice or gather
 * (ink only nests them when generating runtime containers). A gather ends the inner weave's
 * choices, so the search continues in the enclosing weave (e.g. `--` inside a `*` branch).
 */
export function owningChoice(obj: ParsedObject): Choice | null {
	let child = obj;
	for (let parent = obj.parent; parent && !(parent instanceof FlowBase); parent = parent.parent) {
		if (parent instanceof Choice) return parent;
		if (parent instanceof Weave) {
			const siblings = parent.content;
			for (let i = siblings.indexOf(child) - 1; i >= 0; i--) {
				const sibling = siblings[i];
				if (sibling instanceof Choice) return sibling;
				if (sibling instanceof Gather) break;
			}
		}
		child = parent;
	}
	return null;
}

/**
 * True when the player must have made a choice in this flow before `obj` runs: it sits in a
 * choice branch, or after choices (a gather collects them). Unlike `owningChoice`, gathers do
 * not stop the search — content after a gather still runs only once a choice was taken.
 */
export function precededByChoice(obj: ParsedObject): boolean {
	let child = obj;
	for (let parent = obj.parent; parent && !(parent instanceof FlowBase); parent = parent.parent) {
		if (parent instanceof Choice) return true;
		if (parent instanceof Weave) {
			const siblings = parent.content;
			for (let i = siblings.indexOf(child) - 1; i >= 0; i--) {
				const sibling = siblings[i]!;
				if (sibling instanceof Choice) return true;
				if (sibling instanceof Weave && [...walk(sibling)].some((o) => o instanceof Choice)) return true;
			}
		}
		child = parent;
	}
	return false;
}

/** Graph node id of a flow: `knot`, `knot.stitch`, or the root id for the story (and included stories). */
export function flowNodeId(flow: FlowBase): string {
	if (flow instanceof ParsedStory) return ROOT_NODE_ID;
	const name = flow.identifier?.name ?? "?";
	if (flow instanceof Stitch) {
		const knot = flow.parent ? enclosingFlow(flow.parent) : null;
		if (knot instanceof Knot) return `${knot.identifier?.name ?? "?"}.${name}`;
	}
	return name;
}

export function isFlow(obj: ParsedObject): obj is Knot | Stitch {
	return obj instanceof Knot || obj instanceof Stitch;
}
