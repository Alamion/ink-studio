// End-to-end: select links and nodes, the Link panel, Delete key, previews, blocked deletes, undo.
const { connect } = require("./common.cjs");
const OUT = process.argv[2];
(async () => {
  const { browser, page } = await connect();
  await page.evaluate(() => window.electronWindow.setSize(1500, 900)); // the default window is too small for two panes
  await page.waitForTimeout(1000);
  await page.evaluate(async () => {
    await app.plugins.disablePlugin("ink-graph");
    await app.plugins.enablePlugin("ink-graph");
    app.workspace.getLeavesOfType("ink-graph-view").forEach((l) => l.detach());
    const md = app.workspace.getLeavesOfType("markdown")[0] ?? app.workspace.getLeaf(false); // a fresh vault starts with an empty pane
    await md.openFile(app.vault.getAbstractFileByPath("stories/demo/main.ink"));
    const leaf = app.workspace.getLeaf("split", "vertical");
    await leaf.setViewState({ type: "ink-graph-view", state: { rootFile: "stories/demo/main.ink" }, active: true });
    app.workspace.setActiveLeaf(md, { focus: true }); // start with the editor focused, like a real user
  });
  await page.waitForTimeout(3000);

  const G = '.workspace-leaf-content[data-type="ink-graph-view"]';
  const MAIN = "stories/demo/main.ink";
  const text = (path) => page.evaluate(async (p) => {
    const leaf = app.workspace.getLeavesOfType("markdown").find((l) => l.view.file?.path === p);
    return leaf ? leaf.view.editor.getValue() : app.vault.adapter.read(p);
  }, path);
  const node = (id) => page.locator(`${G} .react-flow__node[data-id="${id}"]`);
  const label = (t) => page.locator(`${G} .ink-edge-label`, { hasText: t }).first();
  const panel = page.locator(`${G} .ink-panel`);
  const fit = async () => { await page.locator(`${G} .react-flow__controls-fitview`).click(); await page.waitForTimeout(400); };
  const menu = async (t) => { await page.locator(".menu .menu-item", { hasText: t }).first().click(); await page.waitForTimeout(300); };
  const check = (name, ok, extra = "") => console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  " + extra}`);
  const undo = async () => { await page.keyboard.press("Control+z"); await page.waitForTimeout(1200); };
  const original = await text(MAIN);
  if ((await page.locator(`${G} .ink-panel`).count()) === 0) await page.locator(`${G} .ink-panel-toggle`).click();
  await fit();

  // 1. Select a link by its label: panel shows the Link section with the source line
  await label("Пойти в таверну").click();
  await page.waitForTimeout(300);
  const panelText = await panel.innerText();
  check("link panel shows source → target", /LINK[\s\S]*start → tavern/i.test(panelText), panelText.slice(0, 300));
  check("link panel shows the written line", panelText.includes("+ [Пойти в таверну] -> tavern"));
  check("selected edge is highlighted", (await page.locator(`${G} .react-flow__edge-path.is-selected`).count()) === 1);
  await page.screenshot({ path: `${OUT}-link-panel.png` });

  // 2. Delete key on a one-line link: no dialog, removed, undo restores
  await page.keyboard.press("Delete");
  await page.waitForTimeout(1200);
  check("no dialog for a one-line link", (await page.locator(".modal").count()) === 0);
  check("choice line removed", !(await text(MAIN)).includes("Пойти в таверну"));
  await undo();
  check("undo restored it", (await text(MAIN)) === original);

  // 3. A divert inside a choice branch: panel shows choice line ⋮ divert; delete shows a diff first
  await fit();
  await page.locator(`${G} .ink-edge-label`).filter({ hasText: "Взломать", hasNotText: "Открыть" }).first().click();
  await page.waitForTimeout(300);
  const branchPanel = await panel.innerText();
  check("snippet shows the choice line and the divert", branchPanel.includes("* [Взломать]") && branchPanel.includes("⋮") && branchPanel.includes("-> death"), branchPanel.slice(0, 400));
  await page.keyboard.press("Delete");
  await page.waitForTimeout(500);
  const modal = page.locator(".modal");
  check("preview dialog opened", (await modal.count()) === 1);
  const diff = await modal.innerText();
  check("diff shows the removed conditional", diff.includes("- ") && diff.includes("is_dead()") && diff.includes("-> death"), diff);
  await page.screenshot({ path: `${OUT}-link-diff.png` });
  await modal.locator("button", { hasText: "Delete" }).click();
  await page.waitForTimeout(1200);
  const afterBranch = await text(MAIN);
  check("divert and its conditional removed, choice kept", !afterBranch.includes("-> death") && afterBranch.includes("* [Взломать]"));
  await undo();
  check("undo restored it", (await text(MAIN)) === original);

  // 4. Select a stitch, Delete: preview with the removed block and the redirected divert
  await fit();
  await node("find_torch.search_again").click();
  await page.waitForTimeout(300);
  check("node panel has Delete button", (await panel.locator("button", { hasText: "Delete" }).count()) === 1);
  check("node panel lists incoming links", (await panel.innerText()).includes("IN") || (await panel.innerText()).includes("In"));
  await page.keyboard.press("Delete");
  await page.waitForTimeout(600);
  const nodeDiff = await page.locator(".modal").innerText();
  check("preview shows the stitch and the redirect to END", nodeDiff.includes("= search_again") && nodeDiff.includes("-> END"), nodeDiff);
  await page.screenshot({ path: `${OUT}-node-diff.png` });
  await page.locator(".modal button", { hasText: "Delete" }).click();
  await page.waitForTimeout(1500);
  const afterNode = await text(MAIN);
  check("stitch removed from the file", !afterNode.includes("= search_again") && afterNode.includes("Ничего... -> END"));
  check("stitch gone from the canvas", (await node("find_torch.search_again").count()) === 0);
  await page.mouse.click((await page.locator(`${G} .react-flow__pane`).boundingBox()).x + 20, (await page.locator(`${G} .react-flow__pane`).boundingBox()).y + 20);
  await undo();
  check("undo restored the stitch", (await text(MAIN)) === original && (await node("find_torch.search_again").count()) === 1);

  // 5. Cancel does nothing
  await node("clearing").click();
  await page.keyboard.press("Delete");
  await page.waitForTimeout(500);
  await page.locator(".modal button", { hasText: "Cancel" }).click();
  await page.waitForTimeout(500);
  check("cancel leaves the text alone", (await text(MAIN)) === original);

  // 6. A node still used by a read count: blocked dialog lists the places
  await fit();
  await node("tavern").click({ button: "right" });
  await menu("Delete");
  await page.waitForTimeout(500);
  const blocked = await page.locator(".modal").innerText();
  check("blocked dialog lists the read count", blocked.includes("read count") && blocked.includes("main.ink"), blocked);
  await page.screenshot({ path: `${OUT}-blocked.png` });
  await page.locator(".modal button", { hasText: "OK" }).click();
  check("nothing changed", (await text(MAIN)) === original);

  // 7. Right click on an edge line offers the link menu
  await label("Пойти в таверну").click({ button: "right" });
  await page.waitForTimeout(300);
  const items = await page.locator(".menu .menu-item").allInnerTexts();
  check("edge menu has open + delete", items.some((t) => t.includes("Open")) && items.some((t) => t.includes("Delete")), items.join(" | "));
  await page.keyboard.press("Escape");

  const notices = await page.evaluate(() => [...document.querySelectorAll(".notice")].map((n) => n.textContent));
  console.log("notices:", notices);
  process.exit(0);
})().catch((e) => { console.error("fatal:", e.message.split("\n")[0]); process.exit(1); });
