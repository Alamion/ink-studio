// INCLUDE handling without running the compiler: path resolution and story-root discovery.

const INCLUDE_PATTERN = /^[ \t]*INCLUDE[ \t]+(.+?)[ \t]*$/gm;

/** Resolves an INCLUDE argument against the root file's folder, returning a normalised vault path. */
export function resolveIncludePath(rootFile: string, includePath: string): string {
	const base = rootFile.includes("/") ? rootFile.slice(0, rootFile.lastIndexOf("/")) : "";
	const parts = base ? base.split("/") : [];
	for (const part of includePath.trim().replace(/\\/g, "/").split("/")) {
		if (part === "" || part === ".") continue;
		if (part === "..") parts.pop();
		else parts.push(part);
	}
	return parts.join("/");
}

/** Returns raw INCLUDE arguments, ignoring ones inside comments. */
export function parseIncludes(source: string): string[] {
	const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
	return [...withoutComments.matchAll(INCLUDE_PATTERN)].map((m) => m[1]!);
}

/**
 * Walks up the INCLUDE chain from `file` to the file nobody includes — the story root.
 * Nested includes are resolved relative to the including file's folder (exact for the usual
 * single-level layout; ink itself resolves every INCLUDE relative to the root).
 */
export function findStoryRoot(file: string, sources: ReadonlyMap<string, string>): string {
	const includedBy = new Map<string, string>();
	for (const [path, text] of sources) {
		for (const include of parseIncludes(text)) {
			const target = resolveIncludePath(path, include);
			if (target !== path && !includedBy.has(target)) includedBy.set(target, path);
		}
	}
	const seen = new Set<string>([file]);
	let current = file;
	for (let parent = includedBy.get(current); parent && !seen.has(parent); parent = includedBy.get(current)) {
		seen.add(parent);
		current = parent;
	}
	return current;
}
