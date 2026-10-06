import { builtinModules } from "node:module";
import { renameSync, existsSync } from "node:fs";
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
	plugins: [renameCss],
});

if (production) {
	await context.rebuild();
	await context.dispose();
} else {
	await context.watch();
}
