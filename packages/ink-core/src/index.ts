// Public entry point of the core: ink sources in, StoryGraph (and edit plans) out. No Obsidian, no DOM.

export * from "./model";
export { findStoryRoot, parseIncludes, resolveIncludePath } from "./includes";
export { buildStoryGraph } from "./storyGraph";
export {
	applyTextEdits,
	applyToSources,
	checkName,
	describeEdits,
	planCreateKnot,
	planCreateStitch,
	planLink,
	targetPath,
	type EditPlan,
	type LineChange,
	type LinkKind,
	type TextEdit,
	type TextPosition,
} from "./edits";
export { planRename } from "./rename";
export { planDeleteLinks, planDeleteNode, type DeletePlan, type Reference, type ReferenceKind } from "./deletion";
