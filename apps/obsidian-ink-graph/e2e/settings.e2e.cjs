// End-to-end: settings tab (persisted, applied live), delete confirmation, file picker for new knots.
// Usage: node settings.e2e.cjs
// Needs the isolated Obsidian from setup-debug.sh running with --remote-debugging-port=9333.
const { chromium } = require("/usr/local/lib/node_modules/@playwright/cli/node_modules/playwright-core");
(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9333");
  const page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().startsWith("app://obsidian.md/index.html"));
  const check = (name, ok, extra = "") => console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  " + extra}`);
  const G = '.workspace-leaf-content[data-type="ink-graph-view"]';
  const wait = (ms) => page.waitForTimeout(ms);

  await page.evaluate(() => window.electronWindow.setSize(1500, 900));
  await wait(1000);
  await page.evaluate(async () => {
    await app.plugins.setEnable(true); // a fresh isolated profile starts in restricted mode
    await app.plugins.disablePlugin("ink-graph");
    await app.plugins.enablePlugin("ink-graph");
    app.workspace.getLeavesOfType("ink-graph-view").forEach((l) => l.detach());
    const md = app.workspace.getLeavesOfType("markdown")[0] ?? app.workspace.getLeaf("tab");
    await md.openFile(app.vault.getAbstractFileByPath("stories/demo/main.ink"));
    const leaf = app.workspace.getLeaf("split", "vertical");
    await leaf.setViewState({ type: "ink-graph-view", state: { rootFile: "stories/demo/main.ink" }, active: true });
    app.workspace.setActiveLeaf(md, { focus: true });
  });
  await wait(3500);
  const fit = async () => { await page.locator(`${G} .react-flow__controls-fitview`).click(); await wait(500); };

  // Start from defaults whatever an earlier run left behind
  await page.evaluate(async () => { const p = app.plugins.plugins["ink-graph"]; Object.assign(p.settings, { newKnotTarget: "root", labelMaxLength: 30, labelMaxLines: 3, sidePanel: "auto", confirmDeletes: "multi-line" }); await p.saveSettings(); });
  await page.bringToFront();

  // Settings are loaded and default
  const defaults = await page.evaluate(() => app.plugins.plugins["ink-graph"].settings);
  check("default settings loaded", defaults.newKnotTarget === "root" && defaults.labelMaxLines === 3 && defaults.confirmDeletes === "multi-line", JSON.stringify(defaults));

  // The settings dialog opens in its own window here (a popout), so it is a second CDP page.
  await page.evaluate(() => { app.setting.open(); app.setting.openTabById("ink-graph"); });
  await wait(1200);
  const sp = browser.contexts().flatMap((c) => c.pages()).find((p) => p !== page);
  check("settings window opened", !!sp);
  const names = await sp.locator(".vertical-tab-content .setting-item-name").allInnerTexts();
  check("settings tab lists 5 options", names.length === 5, names.join(" | "));

  // Change "Delete confirmation" through the UI: persisted to data.json
  await sp.locator(".setting-item", { hasText: "Delete confirmation" }).locator("select.dropdown:not(.is-measuring)").selectOption("always");
  await wait(600);
  const saved = await page.evaluate(() => app.vault.adapter.read(".obsidian/plugins/ink-graph/data.json"));
  check("setting persisted to data.json", JSON.parse(saved).confirmDeletes === "always", saved);

  // "Choices shown per link" applies live to the open graph
  await sp.locator(".setting-item", { hasText: "Choices shown per link" }).locator("input[type=range]").fill("1");
  await wait(900);
  await page.evaluate(() => app.setting.close());
  await page.bringToFront(); // after the settings window closes the main one is throttled until it is raised
  await wait(2500);
  await fit();
  const maxLines = await page.evaluate(() => Math.max(0, ...[...document.querySelectorAll(".ink-edge-label")].map((l) => l.querySelectorAll(".ink-edge-label-line").length)));
  check("label lines follow the setting (max 1 line)", maxLines <= 1, String(maxLines));
  await page.evaluate(async () => { const p = app.plugins.plugins["ink-graph"]; p.settings.labelMaxLines = 3; await p.saveSettings(); });
  await wait(800);

  // Always-preview: even a one-line delete shows the dialog
  await page.locator(`${G} .ink-edge-label`, { hasText: "Пойти в таверну" }).first().click();
  await page.keyboard.press("Delete");
  await wait(600);
  check("one-line delete asks first when set to always", (await page.locator(".modal button", { hasText: "Delete" }).count()) === 1);
  await page.locator(".modal button", { hasText: "Cancel" }).click();
  await page.evaluate(async () => { const p = app.plugins.plugins["ink-graph"]; p.settings.confirmDeletes = "multi-line"; await p.saveSettings(); });

  // New knot asks for a file when set to "ask"
  await page.evaluate(async () => { const p = app.plugins.plugins["ink-graph"]; p.settings.newKnotTarget = "ask"; await p.saveSettings(); });
  const pane = await page.locator(`${G} .react-flow__pane`).boundingBox();
  await page.mouse.click(pane.x + 40, pane.y + 40, { button: "right" });
  await page.locator(".menu .menu-item", { hasText: "New knot here" }).click();
  await wait(400);
  await page.locator(".modal input[type=text]").fill("cellar");
  await page.locator(".modal button", { hasText: "OK" }).click();
  await wait(600);
  const choices = await page.locator(".suggestion-item").allInnerTexts();
  check("file picker lists the story files, root first", choices.length === 3 && choices[0].endsWith("main.ink"), choices.join(" | "));
  await page.locator(".suggestion-item", { hasText: "tavern.ink" }).click();
  await wait(1500);
  const tavern = await page.evaluate(() => app.vault.adapter.read("stories/demo/tavern.ink"));
  const main = await page.evaluate(() => app.vault.adapter.read("stories/demo/main.ink"));
  check("knot written to the chosen file only", tavern.includes("=== cellar ===") && !main.includes("=== cellar ==="));
  await page.keyboard.press("Control+z");
  await wait(1200);
  await page.evaluate(async () => { const p = app.plugins.plugins["ink-graph"]; p.settings.newKnotTarget = "root"; await p.saveSettings(); });

  const original = await page.evaluate(() => app.vault.adapter.read("stories/demo/main.ink"));
  check("demo story left unchanged", !original.includes("cellar"));
  process.exit(0);
})().catch((e) => { console.error("fatal:", e.message.split("\n").slice(0, 3).join(" | ")); process.exit(1); });
