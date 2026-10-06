// Global variables: where they are declared, and which nodes read or write them —
// directly, through `ref` parameters, or transitively through called functions.

import {
	ConstantDeclaration,
	FlowBase,
	FunctionCall,
	IncDecExpression,
	VariableAssignment,
	VariableReference,
	type ParsedObject,
	type ParsedStory,
} from "./ink";
import { locationOf } from "./inkParser";
import { enclosingFlow, flowNodeId, walk } from "./inkTree";
import type { AccessMode, GlobalVariable, StoryEdge, VariableAccess } from "./model";

export interface VariableAnalysis {
	variables: GlobalVariable[];
	accesses: VariableAccess[];
}

/** `callEdges` come from the flow graph so call resolution is done in one place. */
export function analyzeVariables(story: ParsedStory, callEdges: readonly StoryEdge[]): VariableAnalysis {
	const objects = [...walk(story)];
	const globals = collectGlobals(objects);
	const scopes = new LocalScopes(objects);
	const direct = collectDirectAccesses(objects, globals, scopes);
	return {
		variables: [...globals.values()],
		accesses: dedupe([...direct, ...propagateThroughCalls(direct, callEdges)]),
	};
}

function collectGlobals(objects: readonly ParsedObject[]): Map<string, GlobalVariable> {
	const globals = new Map<string, GlobalVariable>();
	for (const obj of objects) {
		if (obj instanceof VariableAssignment && obj.isGlobalDeclaration) {
			const kind = obj.listDefinition ? "list" : "var";
			globals.set(obj.variableName, { name: obj.variableName, kind, declaredAt: locationOf(obj) });
		} else if (obj instanceof ConstantDeclaration && obj.constantName) {
			globals.set(obj.constantName, { name: obj.constantName, kind: "const", declaredAt: locationOf(obj) });
		}
	}
	return globals;
}

/** Temps and parameters shadow globals within their flow. */
class LocalScopes {
	private readonly locals = new Map<FlowBase, Set<string>>();

	constructor(objects: readonly ParsedObject[]) {
		for (const obj of objects) {
			if (obj instanceof FlowBase) {
				for (const arg of obj.args ?? []) if (arg.identifier?.name) this.scopeOf(obj).add(arg.identifier.name);
			} else if (obj instanceof VariableAssignment && obj.isNewTemporaryDeclaration) {
				this.scopeOf(enclosingFlow(obj)).add(obj.variableName);
			}
		}
	}

	isLocal(name: string, flow: FlowBase): boolean {
		return this.locals.get(flow)?.has(name) ?? false;
	}

	private scopeOf(flow: FlowBase): Set<string> {
		let scope = this.locals.get(flow);
		if (!scope) this.locals.set(flow, (scope = new Set()));
		return scope;
	}
}

function collectDirectAccesses(
	objects: readonly ParsedObject[],
	globals: ReadonlyMap<string, GlobalVariable>,
	scopes: LocalScopes,
): VariableAccess[] {
	const accesses: VariableAccess[] = [];
	const record = (obj: ParsedObject, name: string | undefined, mode: AccessMode, via: string | null = null): void => {
		if (!name || !globals.has(name)) return;
		const flow = enclosingFlow(obj);
		if (scopes.isLocal(name, flow)) return;
		accesses.push({ variable: name, nodeId: flowNodeId(flow), mode, via, location: locationOf(obj) });
	};

	for (const obj of objects) {
		if (obj instanceof VariableAssignment) {
			if (!obj.isGlobalDeclaration && !obj.isNewTemporaryDeclaration) record(obj, obj.variableName, "write");
		} else if (obj instanceof IncDecExpression) {
			// covers `x++`, `x--`, `x += e`, `x -= e`
			record(obj, obj.varIdentifier?.name ?? undefined, "write");
		} else if (obj instanceof VariableReference) {
			// Single-component names only: `List.item` is a list item, not a variable read.
			if (obj.path.length === 1) record(obj, obj.name, "read");
		} else if (obj instanceof FunctionCall) {
			for (const { argument, callee } of refArguments(obj)) record(obj, argument.name, "write", callee);
		}
	}
	return accesses;
}

/** Call arguments passed into `ref` parameters: `f(x)` with `function f(ref p)` writes `x`. */
function refArguments(call: FunctionCall): { argument: VariableReference; callee: string }[] {
	const divert = call.proxyDivert;
	const callee = divert.target?.ResolveFromContext(divert);
	if (!(callee instanceof FlowBase) || !callee.args) return [];
	const result: { argument: VariableReference; callee: string }[] = [];
	callee.args.forEach((param, index) => {
		const argument = call.args[index];
		if (param.isByReference && argument instanceof VariableReference) {
			result.push({ argument, callee: flowNodeId(callee) });
		}
	});
	return result;
}

/** A caller inherits the global accesses of every function it reaches through call edges. */
function propagateThroughCalls(direct: readonly VariableAccess[], callEdges: readonly StoryEdge[]): VariableAccess[] {
	const callees = new Map<string, string[]>();
	for (const edge of callEdges) {
		if (edge.kind !== "call") continue;
		callees.set(edge.source, [...(callees.get(edge.source) ?? []), edge.target]);
	}
	const byNode = new Map<string, VariableAccess[]>();
	for (const access of direct) byNode.set(access.nodeId, [...(byNode.get(access.nodeId) ?? []), access]);

	const inherited: VariableAccess[] = [];
	for (const [caller, firstCallees] of callees) {
		const visited = new Set<string>([caller]);
		const queue = [...firstCallees];
		while (queue.length > 0) {
			const fn = queue.shift()!;
			if (visited.has(fn)) continue;
			visited.add(fn);
			for (const access of byNode.get(fn) ?? []) {
				// Call-site location: that is where the caller "touches" the variable.
				inherited.push({ ...access, nodeId: caller, via: access.via ?? fn, location: callSite(callEdges, caller, firstCallees, fn) });
			}
			queue.push(...(callees.get(fn) ?? []));
		}
	}
	return inherited;
}

function callSite(edges: readonly StoryEdge[], caller: string, firstCallees: readonly string[], fn: string): VariableAccess["location"] {
	const direct = edges.find((e) => e.kind === "call" && e.source === caller && e.target === fn);
	const first = direct ?? edges.find((e) => e.kind === "call" && e.source === caller && firstCallees.includes(e.target));
	return first?.location ?? null;
}

function dedupe(accesses: readonly VariableAccess[]): VariableAccess[] {
	const seen = new Map<string, VariableAccess>();
	for (const access of accesses) {
		const key = `${access.variable}|${access.nodeId}|${access.mode}|${access.via ?? ""}`;
		if (!seen.has(key)) seen.set(key, access);
	}
	return [...seen.values()];
}
