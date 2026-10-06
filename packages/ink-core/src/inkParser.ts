// Runs the ink compiler over in-memory sources and normalises its diagnostics.

import { Compiler, CompilerOptions, ErrorType, type ParsedObject, type ParsedStory } from "./ink";
import type { Diagnostic, SourceLocation } from "./model";
import { resolveIncludePath } from "./includes";

export interface ParseResult {
	/** Available even when compilation failed: ink's parser recovers from most syntax errors. */
	story: ParsedStory | null;
	diagnostics: Diagnostic[];
	compiled: boolean;
	/** Files actually loaded through INCLUDE, root first. */
	files: string[];
}

// Compiler messages look like: "ERROR: 'stories/main.ink' line 12: Expected ..."
const MESSAGE_PATTERN = /^(?:ERROR|WARNING|TODO|RUNTIME ERROR|RUNTIME WARNING):\s*(?:'([^']+)'\s+)?(?:line\s+(\d+):\s*)?([\s\S]*)$/;

/** Parses and compiles an ink story from in-memory sources (vault path → text). */
export function parseInk(rootFile: string, sources: ReadonlyMap<string, string>): ParseResult {
	const rootSource = sources.get(rootFile);
	if (rootSource === undefined) {
		return {
			story: null,
			diagnostics: [{ severity: "error", message: `File not found: ${rootFile}`, location: null }],
			compiled: false,
			files: [],
		};
	}

	const diagnostics: Diagnostic[] = [];
	const files: string[] = [rootFile];
	const fileHandler = {
		// ink resolves every INCLUDE relative to the root file's folder.
		ResolveInkFilename: (filename: string): string => resolveIncludePath(rootFile, filename),
		LoadInkFileContents: (path: string): string => {
			const text = sources.get(path);
			if (text === undefined) throw new Error(`Included file not found: ${path}`);
			if (!files.includes(path)) files.push(path);
			return text;
		},
	};
	const onError = (message: string, type: ErrorType): void => {
		diagnostics.push(toDiagnostic(message, type, rootFile));
	};

	const compiler = new Compiler(rootSource, new CompilerOptions(rootFile, [], false, onError, fileHandler));
	let compiled = true;
	try {
		compiler.Compile();
	} catch (error) {
		compiled = false;
		// "Compilation failed." is only a summary: the real errors already went through onError.
		if (diagnostics.length === 0) {
			diagnostics.push({ severity: "error", message: errorText(error), location: null });
		}
	}
	if (diagnostics.some((d) => d.severity === "error")) compiled = false;

	let story: ParsedStory | null = null;
	try {
		story = compiler.parsedStory;
	} catch {
		story = null; // the getter throws when parsing did not even start
	}
	return { story, diagnostics, compiled, files };
}

/**
 * ink records included files under the name written in INCLUDE; map it back to a vault path.
 * The root keeps the vault path it was compiled with.
 */
export function normalizeSourceFile(rootFile: string, file: string): string {
	return file === rootFile ? file : resolveIncludePath(rootFile, file);
}

export function locationOf(obj: ParsedObject | null): SourceLocation | null {
	const meta = obj?.debugMetadata;
	if (!meta || !meta.fileName) return null;
	return { file: meta.fileName, line: meta.startLineNumber };
}

function toDiagnostic(message: string, type: ErrorType, rootFile: string): Diagnostic {
	const severity = type === ErrorType.Error ? "error" : "warning";
	const match = MESSAGE_PATTERN.exec(message.trim());
	if (!match) return { severity, message, location: null };
	const [, file, line, text] = match;
	return {
		severity,
		message: text ?? message,
		location: line ? { file: normalizeSourceFile(rootFile, file ?? rootFile), line: Number(line) } : null,
	};
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
