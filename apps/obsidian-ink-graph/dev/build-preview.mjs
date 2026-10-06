// Bundles dev/preview.tsx with a story from the vault baked in.
// Usage: node dev/build-preview.mjs [rootFile relative to vault] [light|dark]
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, relative } from "node:path";
import esbuild from "esbuild";

const vault = join(import.meta.dirname, "../../../fixtures");
const root = process.argv[2] ?? "stories/demo/main.ink";
const theme = process.argv[3] ?? "light";
const outDir = join(import.meta.dirname, "out");

/** All .ink files of the vault (skipping dot-folders), keyed by vault path. */
function collect(dir, sources = {}) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.name.startsWith(".")) continue;
		const path = join(dir, entry.name);
		if (entry.isDirectory()) collect(path, sources);
		else if (entry.name.endsWith(".ink")) sources[relative(vault, path)] = readFileSync(path, "utf8");
	}
	return sources;
}

mkdirSync(outDir, { recursive: true });
await esbuild.build({
	entryPoints: [join(import.meta.dirname, "preview.tsx")],
	bundle: true,
	outfile: join(outDir, "preview.js"),
	format: "iife",
	platform: "browser",
	jsx: "automatic",
	define: {
		__PREVIEW__: JSON.stringify({ root, sources: collect(vault), theme }),
		"process.env.NODE_ENV": '"development"',
	},
	logLevel: "warning",
});
writeFileSync(
	join(outDir, "preview.html"),
	`<!doctype html><meta charset="utf-8"><title>Ink graph preview</title><link rel="stylesheet" href="preview.css"><div id="app"></div><script src="preview.js"></script>\n`,
);
console.log(`Preview: ${join(outDir, "preview.html")} (${root}, ${theme})`);

