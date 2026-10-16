// Home page: tile order, search by name, search combined with the filter.
// node index-test.js   (simulator must be running)
const fs = require("node:fs");
const path = require("node:path");
const { launch, phone, BASE } = require("./harness");
const OUT = path.join(__dirname, "out", "index");
fs.mkdirSync(OUT, { recursive: true });
const results = [];
function check(name, ok, extra) { results.push(ok); console.log(`${ok ? "✅" : "❌"} ${name}${extra ? " — " + extra : ""}`); }
const EXPECTED = ["Тетріс", "2048", "Wordle", "Змійка", "Судоку", "Сапер", "Стрибунець", "Косинка", "Покер", "Дурень", "Шахи", "Шашки", "Шпигун",
  "Хто я?", "Мемологія", "Крокодил", "Зіпсовані шаради", "Зіпсований телефон", "Малювалка", "Квіз", "Сміхлист", "Мафія", "Дилеми",
  "Хто з нас?", "Суд Лінча", "Ставки", "Fake News"];

(async () => {
  const b = await launch();
  const p = await phone(b, "Влад");
  await p.goto(`${BASE}/index.html`, { waitUntil: "load" });
  await p.waitForTimeout(1500);
  const visible = () => p.$$eval(".tile:not(.hidden) .name", (els) => els.map((e) => e.textContent.trim()));
  const all = await visible();
  check("order matches the list", JSON.stringify(all) === JSON.stringify(EXPECTED), all.join(" · "));
  await p.screenshot({ path: path.join(OUT, "top.png") });

  const search = async (q) => { await p.fill("#gameSearch", q); await p.waitForTimeout(200); return visible(); };
  let r = await search("шах");
  check("«шах» → Шахи", JSON.stringify(r) === JSON.stringify(["Шахи"]), r.join(","));
  r = await search("ЗІПСОВАН");
  check("case-insensitive «ЗІПСОВАН» → 2 games", r.length === 2, r.join(","));
  r = await search("tetris");
  check("by file name «tetris» → Тетріс", JSON.stringify(r) === JSON.stringify(["Тетріс"]), r.join(","));
  r = await search("хто");
  check("«хто» → Хто я? + Хто з нас?", r.includes("Хто я?") && r.includes("Хто з нас?") && r.length === 2, r.join(","));
  r = await search("zzz");
  check("nothing found message", r.length === 0 && await p.isVisible("#searchEmpty"));
  await p.fill("#gameSearch", "");
  await p.click('.filter-btn[data-filter="solo"]');
  r = await search("ш");
  check("search respects the Соло filter («ш» → only solo games)", r.length > 0 && !r.includes("Шпигун") && r.includes("Шахи"), r.join(","));
  await p.fill("#gameSearch", ""); await p.click('.filter-btn[data-filter="all"]'); await p.waitForTimeout(200);
  check("clearing restores all", (await visible()).length === EXPECTED.length);
  await p.mouse.wheel(0, 900); await p.waitForTimeout(500);
  await p.screenshot({ path: path.join(OUT, "scrolled.png") });
  check("no JS errors", !p.errors.length, p.errors.slice(0, 3).join(" | "));
  await b.close();
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
})();
