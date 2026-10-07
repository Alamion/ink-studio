// Takes the README screenshots from the English demo story in the isolated Obsidian (see setup-debug.sh).
// Usage: node screenshots.e2e.cjs <repo root>   (writes <repo root>/docs/img/*.png)
const { connect } = require("./common.cjs");
const fs = require("node:fs");
const path = require("node:path");
const ROOT = process.argv[2];
const OUT = path.join(ROOT, "docs/img");
const VAULT = path.join(process.env.HOME, ".var/app/md.obsidian.Obsidian/cache/ink-debug/vault");

(async () => {
  for (const dir of ["demo-en", "loop-demo-en"]) fs.cpSync(path.join(ROOT, "fixtures/stories", dir), path.join(VAULT, "stories", dir), { recursive: true });
  fs.mkdirSync(OUT, { recursive: true });
  const { browser, page } = await connect();
  const wait = (ms) => page.waitForTimeout(ms);
  const VIEW = '.workspace-leaf-content[data-type="ink-graph-view"] .view-content';
  const shot = async (name) => { await page.bringToFront(); await page.locator(VIEW).screenshot({ path: `${OUT}/${name}.png` }); };
  const fit = async () => { await page.bringToFront(); await wait(300); await page.evaluate(() => document.querySelector('.react-flow__controls-fitview').click()); await wait(700); };
  const theme = async (t) => {
    await page.evaluate((t) => { app.vault.setConfig("theme", t === "dark" ? "obsidian" : "moonstone"); app.workspace.trigger("css-change"); }, t);
    await wait(1500);
  };
  const open = async (root) => {
    await page.evaluate(async (root) => {
      app.workspace.getLeavesOfType("ink-graph-view").forEach((l) => l.detach());
      await new Promise((r) => setTimeout(r, 600)); // Obsidian puts an empty pane back after the last one closes
      const leaf = app.workspace.getLeaf(false); // the one pane of the window
      await leaf.setViewState({ type: "ink-graph-view", state: { rootFile: root }, active: true });
    }, root);
    await page.bringToFront();
    await wait(3500);
    await fit();
  };

  // The window is sized through Electron: the screenshots do not depend on the monitor.
  await page.evaluate(() => window.electronWindow.setSize(1600, 820));
  await wait(1200);
  await page.evaluate(async () => {
    await app.plugins.setEnable(true); // a fresh isolated profile starts in restricted mode
    await app.plugins.disablePlugin("ink-graph");
    await app.plugins.enablePlugin("ink-graph");
    const p = app.plugins.plugins["ink-graph"];
    Object.assign(p.settings, { newKnotTarget: "root", labelMaxLength: 30, labelMaxLines: 3, sidePanel: "open", confirmDeletes: "multi-line" });
    await p.saveSettings();
    app.workspace.leftSplit.collapse();
    app.workspace.rightSplit.collapse();
    // Screenshots show the graph, not the window around it.
    const css = document.createElement("style");
    css.textContent = ".notice-container, .status-bar { display: none !important; }";
    document.head.append(css);
  });
  await page.bringToFront();

  await open("stories/demo-en/main.ink");
  for (const t of ["light", "dark"]) {
    await theme(t);
    await fit();
    await page.locator(`${VIEW} .react-flow__pane`).click({ position: { x: 5, y: 5 } });
    await shot(`overview-${t}`);
  }

  await theme("light");
  await fit();
  await page.locator(`${VIEW} .react-flow__node[data-id="tavern"]`).click();
  await wait(600);
  await shot("node-panel");

  await page.locator(`${VIEW} .ink-edge-label`, { hasText: "Break the lock", hasNotText: "Open it" }).first().click();
  await wait(600);
  await shot("link-panel");
  await page.keyboard.press("Delete");
  await wait(800);
  await page.locator(".modal").screenshot({ path: `${OUT}/delete-preview.png` });
  await page.locator(".modal button", { hasText: "Cancel" }).click();

  await page.evaluate(() => { app.setting.open(); app.setting.openTabById("ink-graph"); });
  await wait(1500);
  const sp = browser.contexts().flatMap((c) => c.pages()).find((p) => p !== page);
  await sp.locator(".vertical-tab-content").screenshot({ path: `${OUT}/settings.png` });
  await page.evaluate(() => app.setting.close());
  await page.bringToFront();
  await wait(2500);

  await open("stories/loop-demo-en/main.ink");
  await shot("loops");
  console.log("done:", fs.readdirSync(OUT).join(", "));
  process.exit(0);
})().catch((e) => { console.error("fatal:", e.message.split("\n").slice(0, 3).join(" | ")); process.exit(1); });
