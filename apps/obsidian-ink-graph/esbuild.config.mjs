import { builtinModules } from "node:module";
import { readFileSync, renameSync, existsSync } from "node:fs";
import esbuild from "esbuild";

const production = process.argv[2] === "production";

/** esbuild names the CSS bundle after the entry (main.css); Obsidian loads styles.css. */
const renameCss = {
	name: "rename-css",
	setup(build) {
		build.onEnd(() => {
			if (existsSync("main.css")) renameSync("main.css", "styles.css");
		});
	},
};

/**
 * react-dom can inject <script> elements (its "resource hoisting" for <script async src> rendered by an app).
 * Ink Graph never renders scripts, and a plugin must not be able to load code at runtime, so those branches are
 * replaced with an error instead of shipping a way to create script elements.
 */
const noScriptResources = {
	name: "no-script-resources",
	setup(build) {
		build.onLoad({ filter: /react-dom[\\/]cjs[\\/]react-dom-client\.(production|development)\.js$/ }, (args) => ({
			contents: readFileSync(args.path, "utf8").replace(
				/\.createElement\((["'])script\1\)/g,
				'.createElement("template") /* script resources are not supported */',
			),
			loader: "js",
		}));
	},
};

const context = await esbuild.context({
	entryPoints: ["src/main.ts"],
	bundle: true,
	outfile: "main.js",
	format: "cjs",
	platform: "browser",
	target: "es2022",
	jsx: "automatic",
	external: ["obsidian", "electron", "@codemirror/*", "@lezer/*", ...builtinModules, ...builtinModules.map((m) => `node:${m}`)],
	define: { "process.env.NODE_ENV": JSON.stringify(production ? "production" : "development") },
	sourcemap: production ? false : "inline",
	minify: production,
	treeShaking: true,
	logLevel: "info",
	plugins: [renameCss, noScriptResources],
});

if (production) {
	await context.rebuild();
	await context.dispose();
} else {
	await context.watch();
}
