// Load every page solo on a phone viewport, collect JS errors, screenshot.
const fs = require("node:fs");
const path = require("node:path");
const { launch, phone, BASE } = require("./harness");
const SITE = process.argv[2] || path.join(__dirname, "..", "..");
const OUT = process.argv[3] || path.join(__dirname, "out", "smoke");
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const pages = fs.readdirSync(SITE).filter((f) => f.endsWith(".html")).sort();
  const browser = await launch();
  const report = {};
  for (const f of pages) {
    const p = await phone(browser, "tester");
    try {
      await p.goto(`${BASE}/${f}`, { waitUntil: "load", timeout: 20000 });
      await p.waitForTimeout(2500);
      const info = await p.evaluate(() => ({
        title: document.title,
        hscroll: document.documentElement.scrollWidth > window.innerWidth + 1,
        scrollW: document.documentElement.scrollWidth,
        bodyText: document.body.innerText.slice(0, 400),
      }));
      await p.screenshot({ path: path.join(OUT, f.replace(".html", ".png")) });
      report[f] = { errors: p.errors, ...info };
    } catch (e) {
      report[f] = { errors: p.errors.concat("load: " + e.message) };
    }
    await p.context().close();
  }
  await browser.close();
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
  for (const [f, r] of Object.entries(report)) {
    const flags = [r.errors.length ? `${r.errors.length} err` : "", r.hscroll ? `hscroll ${r.scrollW}` : ""].filter(Boolean).join(", ");
    console.log(`${f.padEnd(20)} ${flags || "ok"}`);
    r.errors.slice(0, 4).forEach((e) => console.log("    " + e));
  }
})();
