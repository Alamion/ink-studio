// End-to-end: drag a link from a node and let go on empty canvas / inside a knot's group / outside the view.
// Needs the isolated Obsidian (e2e/launch-isolated.sh). Usage: node drop-create.e2e.cjs
const { connect } = require("./common.cjs");
(async () => {
  const { browser, page } = await connect();
  const check = (name, ok, extra = "") => console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  " + extra}`);
  const wait = (ms) => page.waitForTimeout(ms);
  const VIEW = '.workspace-leaf-content[data-type="ink-graph-view"] .view-content';
  const MAIN = "stories/demo-en/main.ink";
  const read = (p) => page.evaluate((p) => app.vault.adapter.read(p), p);

  const fs = require("node:fs"), path = require("node:path");
  const vault = path.join(process.env.HOME, ".var/app/md.obsidian.Obsidian/cache/ink-debug/vault/stories");
  fs.cpSync(path.join(__dirname, "../../../fixtures/stories/demo-en"), path.join(vault, "demo-en"), { recursive: true });

  await page.evaluate(() => window.electronWindow.setSize(1500, 900));
  await wait(1000);
  await page.evaluate(async () => {
    await app.plugins.setEnable(true);
    await app.plugins.disablePlugin("ink-graph");
    await app.plugins.enablePlugin("ink-graph");
    const p = app.plugins.plugins["ink-graph"];
    Object.assign(p.settings, { newKnotTarget: "root", sidePanel: "open", confirmDeletes: "multi-line" });
    await p.saveSettings();
    app.workspace.leftSplit.collapse();
    app.workspace.rightSplit.collapse();
    app.workspace.getLeavesOfType("ink-graph-view").forEach((l) => l.detach());
    await new Promise((r) => setTimeout(r, 600)); // an empty pane replaces the last one that closed
    const leaf = app.workspace.getLeaf(false);
    await leaf.setViewState({ type: "ink-graph-view", state: { rootFile: "stories/demo-en/main.ink" }, active: true });
  });
  await page.keyboard.press("Escape");
  await page.bringToFront();
  await wait(3500);
  await page.evaluate(() => document.querySelector(".react-flow__controls-fitview").click());
  await wait(800);
  const original = await read(MAIN);
  await wait(1500);

  const handle = (id) => page.locator(`${VIEW} .react-flow__node[data-id="${id}"] .react-flow__handle.source`).first();
  const center = async (loc) => { const b = await loc.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
  const dragTo = async (fromId, x, y) => {
    const from = await center(handle(fromId));
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move((from.x + x) / 2, (from.y + y) / 2, { steps: 6 });
    await page.mouse.move(x, y, { steps: 6 });
    await page.mouse.up();
    await wait(900);
  };
  const pane = await page.locator(`${VIEW} .react-flow__pane`).boundingBox();
  const emptySpot = { x: pane.x + 60, y: pane.y + pane.height - 60 }; // bottom-left corner of the canvas: nothing there
  const modalCount = () => page.locator(".modal").count();

  // 1. Empty canvas: a dialog for a new knot opens; Escape closes it and nothing changes
  await dragTo("start", emptySpot.x, emptySpot.y);
  check("dialog opens on empty canvas", (await modalCount()) === 1);
  const title = await page.locator(".modal .modal-title").innerText().catch(() => "");
  check("it is the new knot dialog", title.trim() === "New knot", title);
  await page.keyboard.press("Escape");
  await wait(400);
  check("Escape closes it", (await modalCount()) === 0);
  check("nothing was written", (await read(MAIN)) === original);

  // 2. Clicking outside the dialog closes it too; Cancel too
  await dragTo("start", emptySpot.x, emptySpot.y);
  await page.mouse.click(5, 5);
  await wait(400);
  check("click outside closes it", (await modalCount()) === 0);
  await dragTo("start", emptySpot.x, emptySpot.y);
  await page.locator(".modal button", { hasText: "Cancel" }).click();
  await wait(400);
  check("Cancel closes it", (await modalCount()) === 0 && (await read(MAIN)) === original);

  // 3. Letting go outside the graph view (over the side panel / outside the window) does nothing
  const panel = await page.locator(`${VIEW} .ink-panel`).boundingBox();
  await dragTo("start", panel.x + 40, panel.y + 300);
  check("no dialog over the side panel", (await modalCount()) === 0);
  await dragTo("start", 1495, 895);
  check("no dialog at the window edge outside the canvas", (await modalCount()) === 0);
  await dragTo("start", 700, 15); // the tab header above the view
  check("no dialog over the tab header", (await modalCount()) === 0);
  await dragTo("start", -50, 300).catch(() => {});
  check("no dialog outside the window", (await modalCount()) === 0);
  check("still nothing written", (await read(MAIN)) === original);

  // 4. Create: a name, a choice text that follows it, one undo takes back both
  await dragTo("start", emptySpot.x, emptySpot.y);
  await page.locator(".modal input[type=text]").first().fill("cellar");
  const choiceText = await page.locator(".modal input[type=text]").nth(1).inputValue();
  check("choice text follows the name", choiceText === "cellar", choiceText);
  await page.locator(".modal button", { hasText: "Create" }).click();
  await wait(1800);
  const created = await read(MAIN);
  check("knot written", created.includes("=== cellar ==="));
  check("link written in the source knot", /\+? ?\* \[cellar\] -> cellar|\* \[cellar\] -> cellar/.test(created), created.slice(-400));
  check("the new knot is on the canvas at the drop spot", (await page.locator(`${VIEW} .react-flow__node[data-id="cellar"]`).count()) === 1);
  await page.locator(`${VIEW} .react-flow__pane`).click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Control+z");
  await wait(1500);
  check("one undo takes back the knot and the link", (await read(MAIN)) === original, (await read(MAIN)).slice(-300));

  // 5. Validation: a taken name is refused in the dialog
  await dragTo("start", emptySpot.x, emptySpot.y);
  await page.locator(".modal input[type=text]").first().fill("forest");
  const err = await page.locator(".modal .ink-modal-error").innerText();
  check("a taken name shows an error", /already/i.test(err), err);
  await page.locator(".modal button", { hasText: "Create" }).click();
  await wait(400);
  check("the dialog stays open", (await modalCount()) === 1);
  await page.keyboard.press("Escape");
  await wait(400);

  // 6. Inside a knot's group (away from stitches and header): a new stitch
  // A point inside the knot's group that is not over a stitch and not in the header: found by probing the page.
  const inGroup = await page.evaluate(() => {
    const g = document.querySelector('.react-flow__node-inkGroup[data-id="find_torch"]').getBoundingClientRect();
    for (let y = g.bottom - 6; y > g.top + 60; y -= 6) {
      for (let x = g.left + 6; x < g.right - 6; x += 6) {
        const hit = document.elementFromPoint(x, y)?.closest(".react-flow__node");
        if (hit?.getAttribute("data-id") === "find_torch") return { x, y };
      }
    }
    return null;
  });
  check("found room inside the group", inGroup !== null);
  await dragTo("start", inGroup.x, inGroup.y);
  const stitchTitle = await page.locator(".modal .modal-title").innerText().catch(() => "none");
  check("dropping in a knot's group offers a new stitch", stitchTitle.trim() === "New stitch in find_torch", stitchTitle);
  await page.locator(".modal input[type=text]").first().fill("rest");
  await page.locator(".modal button", { hasText: "Create" }).click();
  await wait(1800);
  const withStitch = await read(MAIN);
  check("stitch written inside the knot", /= rest\n/.test(withStitch) && withStitch.indexOf("= rest") < withStitch.indexOf("=== forest ==="));
  check("link goes to the stitch", withStitch.includes("-> find_torch.rest"));
  await page.locator(`${VIEW} .react-flow__pane`).click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Control+z");
  await wait(1500);
  check("undo restores the story", (await read(MAIN)) === original);

  // 7. On a node (not empty): the old behaviour, the link dialog
  const target = await center(page.locator(`${VIEW} .react-flow__node[data-id="forest"]`));
  await dragTo("start", target.x, target.y);
  const linkTitle = await page.locator(".modal .modal-title").innerText().catch(() => "none");
  check("dropping on a node still opens the plain link dialog", /^Link start → forest/.test(linkTitle.trim()), linkTitle);
  await page.keyboard.press("Escape");
  await wait(300);

  // 8. From the start block of a story that already starts with a divert: refused, and nothing is left behind
  await dragTo("__root__", emptySpot.x, emptySpot.y);
  await page.locator(".modal input[type=text]").first().fill("attic");
  await page.locator(".modal button", { hasText: "Create" }).click();
  await wait(2500);
  const notices = await page.evaluate(() => [...document.querySelectorAll(".notice")].map((n) => n.textContent));
  check("the start block explains why it cannot take another divert", notices.some((t) => /already starts with/.test(t)), notices.join(" | "));
  check("the half-made knot was taken back", (await read(MAIN)) === original && !(await read(MAIN)).includes("attic"));

  check("the story is back to its original text", (await read(MAIN)) === original);

  // 9. An empty .ink file: the start block is all there is; a new knot gets linked from it
  await page.evaluate(async () => {
    const existing = app.vault.getAbstractFileByPath("stories/empty.ink");
    if (existing) await app.vault.modify(existing, "");
    else await app.vault.create("stories/empty.ink", "");
    app.workspace.getLeavesOfType("ink-graph-view").forEach((l) => l.detach());
    await new Promise((r) => setTimeout(r, 600));
    const leaf = app.workspace.getLeaf(false);
    await leaf.setViewState({ type: "ink-graph-view", state: { rootFile: "stories/empty.ink" }, active: true });
  });
  await page.bringToFront();
  await wait(3000);
  check("only the start block is shown", (await page.locator(`${VIEW} .react-flow__node`).count()) === 1);
  const pane2 = await page.locator(`${VIEW} .react-flow__pane`).boundingBox();
  await dragTo("__root__", pane2.x + 300, pane2.y + 200);
  check("dropping from the start block opens the dialog", (await modalCount()) === 1);
  await page.locator(".modal input[type=text]").first().fill("cellar");
  await page.locator(".modal select.dropdown:not(.is-measuring)").selectOption("divert");
  await page.locator(".modal button", { hasText: "Create" }).click();
  await wait(2000);
  const emptyNow = await read("stories/empty.ink");
  check("knot created and linked from the start", emptyNow.startsWith("-> cellar\n") && emptyNow.includes("=== cellar ==="), JSON.stringify(emptyNow));
  check("the graph shows both blocks and the link", (await page.locator(`${VIEW} .react-flow__node`).count()) === 2 && (await page.locator(`${VIEW} .react-flow__edge`).count()) === 1);
  await page.locator(`${VIEW} .react-flow__pane`).click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Control+z");
  await wait(1500);
  check("undo brings back the empty file", (await read("stories/empty.ink")) === "", JSON.stringify(await read("stories/empty.ink")));
  process.exit(0);
})().catch((e) => { console.error("fatal:", e.message.split("\n").slice(0, 3).join(" | ")); process.exit(1); });
