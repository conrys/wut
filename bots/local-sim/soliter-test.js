// Косинка: чесна роздача з перевіркою солвером, добір по 1/по 3, глухий кут.
// node soliter-test.js   (simulator running)
const fs = require("node:fs");
const path = require("node:path");
const { launch, phone, BASE } = require("./harness");
const { solve } = require("../../js/soliter-solver.js");
const OUT = path.join(__dirname, "out", "soliter");
fs.mkdirSync(OUT, { recursive: true });
const results = [];
function check(name, ok, extra) { results.push(ok); console.log(`${ok ? "✅" : "❌"} ${name}${extra ? " — " + extra : ""}`); }

// позиція без жодного ходу: усі верхні карти чорні й не тузи, колода порожня
function deadEndState() {
  const tops = [["S", 5], ["C", 5], ["S", 7], ["C", 7], ["S", 9], ["C", 9], ["S", 11]];
  const rest = [];
  for (const s of ["S", "H", "D", "C"]) for (let r = 1; r <= 13; r++) if (!tops.some(([ts, tr]) => ts === s && tr === r)) rest.push({ suit: s, rank: r, id: `${s}_${r}`, faceUp: false });
  const tableau = tops.map(() => []);
  rest.forEach((c, i) => tableau[i % 7].push(c));
  tops.forEach(([s, r], i) => tableau[i].push({ suit: s, rank: r, id: `${s}_${r}`, faceUp: true }));
  return { tableau, foundations: { S: [], H: [], D: [], C: [] }, stock: [], waste: [] };
}

(async () => {
  // солвер: глухий кут доводиться
  check("solver proves the dead end", solve(deadEndState(), { drawCount: 1, complete: true }).result === "lose");

  const b = await launch();
  const p = await phone(b, "Влад");
  await p.goto(`${BASE}/soliter.html`, { waitUntil: "load" });
  const t0 = Date.now();
  await p.waitForFunction(() => window.SoliterDebug && window.SoliterDebug.state && !document.querySelector(".page.dealing"), null, { timeout: 15000 });
  const dealMs = Date.now() - t0;
  const st = await p.evaluate(() => window.SoliterDebug.state);
  const faceUp = st.tableau.map((c) => c.filter((x) => x.faceUp).length);
  check("classic deal: 28 in tableau, 24 in stock, one face-up per column",
    st.tableau.flat().length === 28 && st.stock.length === 24 && faceUp.every((n) => n === 1), `ready in ${dealMs} ms`);
  check("deal is winnable (solver)", solve(st, { drawCount: 1, maxNodes: 200000 }).result === "win");
  // не зворотна генерація: верхні карти колонок не обов'язково дрібні
  await p.screenshot({ path: path.join(OUT, "deal.png") });

  await p.click("#stockSlot");
  let w = await p.evaluate(() => window.SoliterDebug.state.waste.length);
  check("draw 1 → one card to waste", w === 1);

  // підказка з плану: підсвічує карту, і виконання підказок веде до перемоги
  await p.click("#hintBtn");
  await p.waitForSelector(".hint-src", { timeout: 5000 }).catch(() => {});
  check("hint highlights a card or the stock", (await p.$$(".hint-src")).length > 0);
  await p.screenshot({ path: path.join(OUT, "hint.png") });
  // відхилились від плану (зайвий тап по колоді) — підказка все одно є
  await p.click("#stockSlot"); await p.click("#stockSlot");
  await p.click("#hintBtn");
  await p.waitForSelector(".hint-src", { timeout: 15000 }).catch(() => {});
  check("hint after leaving the plan (re-solve)", (await p.$$(".hint-src")).length > 0);

  // повернення карти з бази: A♠ 2♠ у базі, 3♥ зверху колонки → тягнемо 2♠ на 3♥
  await p.evaluate(() => {
    const st = window.SoliterDebug.state;
    const take = (suit, rank) => { for (const col of st.tableau) { const i = col.findIndex((c) => c.suit === suit && c.rank === rank); if (i >= 0) return col.splice(i, 1)[0]; }
      for (const pile of [st.stock, st.waste]) { const i = pile.findIndex((c) => c.suit === suit && c.rank === rank); if (i >= 0) return pile.splice(i, 1)[0]; } return null; };
    const a = take("S", 1), two = take("S", 2), three = take("H", 3);
    st.foundations.S = [{ ...a, faceUp: true }, { ...two, faceUp: true }];
    st.tableau[0].forEach((c) => (c.faceUp = false));
    st.tableau[0].push({ ...three, faceUp: true });
    st.tableau.forEach((col) => { if (col.length) col[col.length - 1].faceUp = true; });
    window.SoliterDebug.load(st);
  });
  const fromBox = await (await p.$('.foundation-slot[data-suit="S"] .card')).boundingBox();
  const toCol = await p.$$("#tableau .col");
  const toBox = await (await toCol[0].$(".card:last-child")).boundingBox();
  await p.mouse.move(fromBox.x + 20, fromBox.y + 20); await p.mouse.down();
  await p.mouse.move(toBox.x + 20, toBox.y + 30, { steps: 10 }); await p.mouse.up();
  await p.waitForTimeout(400);
  const back = await p.evaluate(() => { const st = window.SoliterDebug.state; const col = st.tableau[0]; return { f: st.foundations.S.length, top: col[col.length - 1] }; });
  check("card returned from foundation to tableau", back.f === 1 && back.top.suit === "S" && back.top.rank === 2, JSON.stringify(back));

  // складно = по 3
  await p.click('#levelToggle button[data-level="hard"]');
  await p.waitForFunction(() => !document.querySelector(".page.dealing") && window.SoliterDebug.state.waste.length === 0, null, { timeout: 15000 });
  const st3 = await p.evaluate(() => window.SoliterDebug.state);
  check("hard deal winnable with draw 3", solve(st3, { drawCount: 3, maxNodes: 200000 }).result === "win");
  await p.click("#stockSlot");
  w = await p.evaluate(() => window.SoliterDebug.state.waste.length);
  check("draw 3 → three cards to waste", w === 3);
  check("level remembered", await p.evaluate(() => localStorage.getItem("soliter_level")) === "hard");
  await p.screenshot({ path: path.join(OUT, "draw3.png") });

  // глухий кут
  await p.evaluate((s) => window.SoliterDebug.load(s), deadEndState());
  await p.waitForSelector(".msg.deadend", { timeout: 8000 }).catch(() => {});
  check("dead end message shown", await p.isVisible(".msg.deadend"), await p.textContent("#msg"));
  await p.screenshot({ path: path.join(OUT, "deadend.png") });
  // нова гра прибирає повідомлення
  await p.click("#newGameBtn");
  await p.waitForFunction(() => !document.querySelector(".page.dealing"), null, { timeout: 15000 });
  await p.waitForTimeout(1500);
  check("new game clears dead end", !(await p.isVisible(".msg.deadend")));

  // 10 роздач поспіль — час
  const times = [];
  for (let i = 0; i < 10; i++) {
    const t = Date.now();
    await p.click("#newGameBtn");
    await p.waitForFunction(() => !document.querySelector(".page.dealing"), null, { timeout: 20000 });
    times.push(Date.now() - t);
  }
  times.sort((a, b) => a - b);
  check("dealing is quick", times[times.length - 1] < 6000, `median ${times[5]} ms, max ${times[9]} ms`);
  check("no JS errors", !p.errors.length, p.errors.slice(0, 3).join(" | "));
  await b.close();
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  process.exit(0);
})();
