// Copies the built plugin into a vault: node install-to-vault.mjs <vault path>
// Run `pnpm --filter obsidian-ink-graph build` first.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const vault = process.argv[2];
if (!vault || !existsSync(join(vault, ".obsidian"))) {
	console.error("Usage: node install-to-vault.mjs <path to an Obsidian vault>");
	process.exit(1);
}
const target = join(vault, ".obsidian", "plugins", "ink-graph");
mkdirSync(target, { recursive: true });
for (const file of ["main.js", "manifest.json", "styles.css"]) {
	if (!existsSync(join(import.meta.dirname, file))) {
		console.error(`${file} is missing: build first`);
		process.exit(1);
	}
	copyFileSync(join(import.meta.dirname, file), join(target, file));
}
console.log(`Installed to ${target}. Reload the plugin or Obsidian.`);
