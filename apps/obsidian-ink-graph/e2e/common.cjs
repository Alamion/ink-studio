// Shared by the scenarios: connect to the isolated Obsidian and get past its first-run dialogs.
const { chromium } = require("/usr/local/lib/node_modules/@playwright/cli/node_modules/playwright-core");

async function connect() {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9333");
  const page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().startsWith("app://obsidian.md/index.html"));
  // right after launch the page may still be loading
  await page.waitForFunction(() => window.electronWindow && window.app?.workspace?.layoutReady, null, { timeout: 60000 });
  // A fresh profile starts in restricted mode, and a vault opened for the first time asks "Do you trust the author of
  // this vault?" (when, depends on the Obsidian version). That dialog blocks every click until answered. The isolated
  // vault is a copy of a trusted one, so a watcher in the page answers yes whenever it shows up.
  await page.evaluate(async () => {
    app.plugins.setEnable(true);
    if (!window.__trustWatch) {
      window.__trustWatch = setInterval(() => {
        const dialog = document.querySelector(".modal-container.mod-confirmation");
        if (dialog && /trust|довер/i.test(dialog.textContent ?? "")) dialog.querySelector("button:not(.mod-cancel)")?.click();
      }, 300);
    }
    await new Promise((r) => setTimeout(r, 2500));
  });
  // Turning community plugins on also opens the settings window, a little later; modals then open in whichever
  // window is active, so wait for that window and close it before the scenario starts.
  // Plugins load only after the trust question is answered; the settings window shows up around then.
  await page.waitForFunction(() => app.plugins.plugins["ink-graph"], null, { timeout: 60000 });
  const extraWindows = () => browser.contexts().flatMap((c) => c.pages()).filter((p) => p !== page).length;
  for (let i = 0; i < 15 && extraWindows() === 0; i++) await page.waitForTimeout(300);
  if (extraWindows() > 0) {
    await page.evaluate(() => app.setting.close());
    for (let i = 0; i < 25 && extraWindows() > 0; i++) await page.waitForTimeout(200);
  }
  await page.bringToFront();
  await page.waitForTimeout(1000);
  return { browser, page };
}

module.exports = { connect };
