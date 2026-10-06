// Story graph model: a pure, serialisable projection of ink sources.
// Nothing here depends on inkjs or Obsidian, so UI and tests only see these types.

export interface SourceLocation {
	/** Vault-relative path of the .ink file. */
	file: string;
	/** 1-based line number. */
	line: number;
}

/** `root` is the content before the first knot; `missing` is a placeholder for an unresolved divert target. */
export type NodeKind = "root" | "knot" | "stitch" | "function" | "missing";

export interface StoryNode {
	/** Ink path: `knot`, `knot.stitch`, or a reserved id for root/missing nodes. */
	id: string;
	name: string;
	kind: NodeKind;
	/** Knot id for stitches, otherwise null. */
	parentId: string | null;
	location: SourceLocation | null;
	/** First stitch of a knot: where a knot without own content falls through. */
	isEntry: boolean;
	/** Contains `-> END` or `-> DONE`. */
	terminates: boolean;
	/** Diverts that stay inside this node (loops to labels, gathers). */
	internalDiverts: number;
}

/**
 * divert  `-> x`              choice   `* [text] -> x`
 * tunnel  `-> x ->`           thread   `<- x`
 * call    `f()` (functions)   dynamic  `-> variable` (possible targets)
 */
export type EdgeKind = "divert" | "choice" | "tunnel" | "thread" | "call" | "dynamic";

export interface StoryEdge {
	id: string;
	source: string;
	target: string;
	kind: EdgeKind;
	/** Choice text for choice edges, variable name for dynamic edges. */
	label: string | null;
	/** Named gather/choice label inside the target node, if the divert points at one. */
	targetLabel: string | null;
	/** Divert sits under a choice condition or an if/else branch. */
	conditional: boolean;
	/** First divert that makes this edge (the same link can be written in several places). */
	location: SourceLocation | null;
	/** Every divert that makes this edge, in source order. */
	sites: SourceLocation[];
	/** Line of the choice that owns the divert (choice edges; may differ from the divert's line). */
	choiceLocation: SourceLocation | null;
}

export type VariableKind = "var" | "const" | "list";

export interface GlobalVariable {
	name: string;
	kind: VariableKind;
	declaredAt: SourceLocation | null;
}

export type AccessMode = "read" | "write";

export interface VariableAccess {
	variable: string;
	nodeId: string;
	mode: AccessMode;
	/** Function node id when the access happens inside a called function (transitively), otherwise null. */
	via: string | null;
	location: SourceLocation | null;
}

export type Severity = "error" | "warning";

export interface Diagnostic {
	severity: Severity;
	message: string;
	location: SourceLocation | null;
}

/**
 * A cycle the story can run around without the player choosing anything: once entered,
 * ink keeps producing content forever and the player (or any runtime) hangs.
 */
export interface LoopWarning {
	/** Nodes of the cycle, in cycle order where possible. */
	nodeIds: string[];
	/** Graph edges on the cycle (loops inside a single node have none). */
	edgeIds: string[];
	/** Every transition on some cycle is unconditional: the story hangs as soon as it gets there. */
	certain: boolean;
	location: SourceLocation | null;
}

export interface StoryGraph {
	rootFile: string;
	/** All files that took part in the parse (root + INCLUDEs). */
	files: string[];
	nodes: StoryNode[];
	edges: StoryEdge[];
	variables: GlobalVariable[];
	accesses: VariableAccess[];
	diagnostics: Diagnostic[];
	loops: LoopWarning[];
	/** False when ink reported errors: the graph is best-effort. */
	compiled: boolean;
}

export const ROOT_NODE_ID = "__root__";
export const MISSING_NODE_PREFIX = "__missing__:";
