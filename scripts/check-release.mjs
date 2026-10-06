// Obsidian community-plugin requirements for the ink-graph release. Run: pnpm check:release [tag]
//
// The store reads manifest.json and versions.json from the repository root, while the plugin is built in
// apps/obsidian-ink-graph. This check keeps the two manifests identical and validates the store rules.
// With a tag argument (the release workflow passes it) the tag must equal the manifest version exactly.

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => JSON.parse(readFileSync(join(ROOT, path), "utf8"));
const rootManifest = read("manifest.json");
const appManifest = read("apps/obsidian-ink-graph/manifest.json");
const versions = read("versions.json");
const errors = [];

if (JSON.stringify(rootManifest) !== JSON.stringify(appManifest)) {
	errors.push("manifest.json at the root differs from apps/obsidian-ink-graph/manifest.json (copy the app one to the root)");
}
const m = appManifest;
for (const key of ["id", "name", "version", "minAppVersion", "description", "author", "isDesktopOnly"]) {
	if (m[key] === undefined || m[key] === "") errors.push(`manifest: "${key}" is missing`);
}
if (!/^\d+\.\d+\.\d+$/.test(m.version)) errors.push(`manifest: version "${m.version}" must be x.y.z`);
if (!/^[a-z0-9-]+$/.test(m.id) || m.id.includes("obsidian")) errors.push(`manifest: id "${m.id}" must be lowercase and must not contain "obsidian"`);
if (/obsidian|plugin/i.test(m.name)) errors.push(`manifest: name "${m.name}" should not contain "Obsidian" or "plugin"`);
if (m.description.length > 250) errors.push("manifest: description is longer than 250 characters");
if (!/[.?!)]$/.test(m.description)) errors.push("manifest: description should end with a period");
if (/^this (is a )?plugin/i.test(m.description)) errors.push('manifest: description should not start with "This plugin"');
if (versions[m.version] !== m.minAppVersion) errors.push(`versions.json: "${m.version}" must map to minAppVersion ${m.minAppVersion}`);

const tag = process.argv[2];
if (tag && tag !== m.version) errors.push(`tag "${tag}" must equal manifest version "${m.version}" (no "v" prefix)`);

if (errors.length > 0) {
	console.error(`Release check failed (${errors.length}):\n` + errors.map((e) => `  - ${e}`).join("\n"));
	process.exit(1);
}
console.log(`Release OK: ${m.id} ${m.version} (minAppVersion ${m.minAppVersion})`);
