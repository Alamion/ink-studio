// Finds cycles the story can run around without the player choosing anything.
// Such a cycle makes ink produce content forever: Ink Player (or any runtime) hangs on it.

import type { Transition } from "./flowGraph";
import type { Diagnostic, LoopWarning } from "./model";

export interface LoopAnalysis {
	loops: LoopWarning[];
	diagnostics: Diagnostic[];
}

/**
 * Every strongly connected component of the automatic-transition graph that contains a cycle
 * is a loop. It is `certain` when a cycle exists using unconditional transitions only.
 */
export function findChoicelessLoops(transitions: readonly Transition[]): LoopAnalysis {
	const loops: LoopWarning[] = [];
	for (const component of cyclicComponents(transitions)) {
		const inside = transitions.filter((t) => component.has(t.source) && component.has(t.target));
		const certain = cyclicComponents(inside.filter((t) => !t.conditional)).length > 0;
		const cycle = cyclePath(inside, certain);
		loops.push({
			nodeIds: cycle,
			edgeIds: [...new Set(inside.map((t) => t.edgeId).filter((id): id is string => id !== null))],
			certain,
			location: (inside.find((t) => !t.conditional) ?? inside[0])?.location ?? null,
		});
	}
	return { loops, diagnostics: loops.map(toDiagnostic) };
}

function toDiagnostic(loop: LoopWarning): Diagnostic {
	const path = [...loop.nodeIds, loop.nodeIds[0]].join(" → ");
	return loop.certain
		? { severity: "error", message: `Infinite loop without choices: ${path}`, location: loop.location }
		: {
				severity: "warning",
				message: `Possible infinite loop without choices (conditional): ${path}`,
				location: loop.location,
			};
}

/** Tarjan's SCC, keeping components that contain a cycle (size > 1 or a self-transition). */
function cyclicComponents(transitions: readonly Transition[]): Set<string>[] {
	const next = new Map<string, string[]>();
	for (const t of transitions) next.set(t.source, [...(next.get(t.source) ?? []), t.target]);
	const index = new Map<string, number>();
	const low = new Map<string, number>();
	const stack: string[] = [];
	const onStack = new Set<string>();
	const result: Set<string>[] = [];
	let counter = 0;

	// Iterative to stay safe on long divert chains.
	const visit = (root: string): void => {
		const work: { node: string; i: number }[] = [{ node: root, i: 0 }];
		index.set(root, counter);
		low.set(root, counter++);
		stack.push(root);
		onStack.add(root);
		while (work.length > 0) {
			const frame = work[work.length - 1]!;
			const targets = next.get(frame.node) ?? [];
			if (frame.i < targets.length) {
				const target = targets[frame.i++]!;
				if (!index.has(target)) {
					index.set(target, counter);
					low.set(target, counter++);
					stack.push(target);
					onStack.add(target);
					work.push({ node: target, i: 0 });
				} else if (onStack.has(target)) {
					low.set(frame.node, Math.min(low.get(frame.node)!, index.get(target)!));
				}
				continue;
			}
			work.pop();
			const parent = work[work.length - 1];
			if (parent) low.set(parent.node, Math.min(low.get(parent.node)!, low.get(frame.node)!));
			if (low.get(frame.node) !== index.get(frame.node)) continue;
			const component = new Set<string>();
			let member: string;
			do {
				member = stack.pop()!;
				onStack.delete(member);
				component.add(member);
			} while (member !== frame.node);
			const selfLoop = component.size === 1 && targets.includes(frame.node);
			if (component.size > 1 || selfLoop) result.push(component);
		}
	};
	for (const node of next.keys()) if (!index.has(node)) visit(node);
	return result;
}

/** One concrete cycle inside the component, for a readable message (prefers unconditional moves). */
function cyclePath(inside: readonly Transition[], unconditionalOnly: boolean): string[] {
	const usable = unconditionalOnly ? inside.filter((t) => !t.conditional) : inside;
	const next = (node: string): string[] => usable.filter((t) => t.source === node).map((t) => t.target);
	for (const start of new Set(usable.map((t) => t.source))) {
		// BFS back to `start`.
		const previous = new Map<string, string>();
		const queue = [...next(start).map((n) => { if (!previous.has(n)) previous.set(n, start); return n; })];
		while (queue.length > 0) {
			const node = queue.shift()!;
			if (node === start) {
				const path = [start];
				for (let at = previous.get(start)!; at !== start; at = previous.get(at)!) path.push(at);
				return [path[0]!, ...path.slice(1).reverse()];
			}
			for (const n of next(node)) {
				if (!previous.has(n)) {
					previous.set(n, node);
					queue.push(n);
				}
			}
		}
	}
	return [...new Set(inside.map((t) => t.source))];
}
