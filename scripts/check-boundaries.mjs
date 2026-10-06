// Enforces the dependency rules from docs/ARCHITECTURE.md. Run: pnpm check:boundaries
//
// Every workspace package must be declared in LAYERS. A package may only import
//   - relative files inside its own directory,
//   - the workspace packages and external modules listed for its layer,
// and (for pure layers) no Node builtins. Anything else fails the check.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** @type {Record<string, {allow: string[], builtins?: boolean, note: string}>} */
const LAYERS = {
	"@ink-studio/core": { allow: ["inkjs"], note: "pure TypeScript: ink in, graph and edit plans out" },
	// Add new packages here, deliberately. Planned:
	// "@ink-studio/engine":  { allow: ["@ink-studio/core", "inkjs"], note: "runtime on top of inkjs; no DOM" },
	// "@ink-studio/widgets": { allow: ["@ink-studio/core", "@ink-studio/engine", "react", "react-dom"], note: "host-independent UI" },
};

const SOURCE = /\.(ts|tsx|mts|js|mjs)$/;
const IMPORT = /\b(?:import|export)\b[^'"`;]*?from\s*["']([^"']+)["']|\bimport\s*["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)|\brequire\(\s*["']([^"']+)["']\s*\)/g;

const builtins = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);
const errors = [];

function files(dir) {
	const out = [];
	for (const name of readdirSync(dir)) {
		if (name === "node_modules" || name === "dist") continue;
		const path = join(dir, name);
		if (statSync(path).isDirectory()) out.push(...files(path));
		else if (SOURCE.test(name)) out.push(path);
	}
	return out;
}

const bare = (spec) => (spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]);

for (const group of ["packages", "apps"]) {
	const base = join(ROOT, group);
	let dirs = [];
	try { dirs = readdirSync(base).filter((d) => statSync(join(base, d)).isDirectory()); } catch { continue; }
	for (const d of dirs) {
		const dir = join(base, d);
		let manifest;
		try { manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")); } catch { continue; }
		const where = `${group}/${d}`;

		if (group === "apps") continue; // apps may depend on anything; nothing may depend on apps (checked below)

		const layer = LAYERS[manifest.name];
		if (!layer) {
			errors.push(`${where}: package "${manifest.name}" has no layer in scripts/check-boundaries.mjs`);
			continue;
		}
		const allowed = new Set(layer.allow);
		for (const dep of Object.keys(manifest.dependencies ?? {})) {
			if (!allowed.has(dep)) errors.push(`${where}/package.json: dependency "${dep}" is not allowed in this layer (${layer.note})`);
		}
		for (const file of files(join(dir, "src"))) {
			const text = readFileSync(file, "utf8");
			for (const m of text.matchAll(IMPORT)) {
				const spec = m[1] ?? m[2] ?? m[3] ?? m[4];
				const rel = relative(ROOT, file).split(sep).join("/");
				if (spec.startsWith(".")) {
					const target = resolve(dirname(file), spec);
					if (target !== dir && !target.startsWith(dir + sep)) errors.push(`${rel}: relative import "${spec}" leaves the package`);
				} else if (builtins.has(spec)) {
					if (!layer.builtins) errors.push(`${rel}: Node builtin "${spec}" is not allowed in this layer`);
				} else if (!allowed.has(bare(spec))) {
					errors.push(`${rel}: import "${spec}" is not allowed in this layer (${layer.note})`);
				}
			}
		}
	}
}

if (errors.length > 0) {
	console.error(`Boundary violations (${errors.length}):\n` + errors.map((e) => `  - ${e}`).join("\n"));
	process.exit(1);
}
console.log("Boundaries OK:", Object.keys(LAYERS).join(", "));
