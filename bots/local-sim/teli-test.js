// Зіпсований телефон: drawings live outside the room (teli_drawings/…), are WebP,
// get loaded for the next player and for the reveal. node teli-test.js (simulator running)
const fs = require("node:fs");
const path = require("node:path");
const { launch, phone, BASE } = require("./harness");
const OUT = path.join(__dirname, "out", "teli");
fs.mkdirSync(OUT, { recursive: true });
const results = [];
function check(name, ok, extra) { results.push(ok); console.log(`${ok ? "✅" : "❌"} ${name}${extra ? " — " + extra : ""}`); }
const ROOM = "TL" + Math.floor(Math.random() * 900 + 100);
const room = () => fetch(`${BASE}/db/teli_rooms/${ROOM}.json`).then((r) => r.json());
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { const r = await fn(); if (r) return r; await new Promise((x) => setTimeout(x, 300)); } return null; };

async function draw(p) {
  const c = await p.$("#drawCanvas"), r = await c.boundingBox();
  for (let s = 0; s < 4; s++) {
    await p.mouse.move(r.x + r.width * (0.2 + 0.15 * s), r.y + r.height * 0.3);
    await p.mouse.down();
    for (let k = 1; k <= 8; k++) await p.mouse.move(r.x + r.width * (0.2 + 0.15 * s + 0.02 * k), r.y + r.height * (0.3 + 0.05 * k));
    await p.mouse.up();
  }
}

(async () => {
  await fetch(BASE + "/__mock/reset");
  const b = await launch();
  const names = ["Влад", "Олена К", "Марʼяна"], pages = [];
  for (const n of names) { const p = await phone(b, n); await p.goto(`${BASE}/teli.html?room=${ROOM}`, { waitUntil: "load" }); await p.waitForTimeout(pages.length ? 800 : 2500); pages.push(p); }
  await pages[0].waitForTimeout(2000);
  await pages[0].click("#startBtn");
  let r = await until(async () => { const x = await room(); return x && x.phase === "active" && x; });
  check("game started, 3 rounds", r && r.totalRounds === 3);

  // round 0: text
  for (let k = 0; k < pages.length; k++) { await pages[k].waitForSelector("#textEntryInput:visible"); await pages[k].fill("#textEntryInput", ["кіт на даху", "пес у космосі", "бабуся на скейті"][k]); await pages[k].click("#submitTextBtn"); }
  r = await until(async () => { const x = await room(); return x && x.currentRound === 1 && x; });
  check("round 2 (drawing) started", !!r);
  // round 1: drawing
  for (const p of pages) { await p.waitForSelector("#drawCanvas:visible"); await draw(p); await p.click("#submitDrawBtn"); }
  r = await until(async () => { const x = await room(); return x && x.currentRound === 2 && x; });
  check("round 3 started", !!r);
  const entries = Object.values(r.books || {}).flatMap((bk) => Object.values(bk || {})).filter((e) => e && e.type === "drawing");
  check("book holds a ref, not the image", entries.length === 3 && entries.every((e) => e.ref && !e.content), JSON.stringify(entries[0]));
  check("assignments carry no image data", !JSON.stringify(r.assignments).includes("data:image"));
  const roomBytes = JSON.stringify(r).length;
  check("room stays small", roomBytes < 8000, roomBytes + " bytes");
  const store = await fetch(`${BASE}/db/teli_drawings/${ROOM}.json`).then((x) => x.json());
  const imgs = Object.values(store || {}).flatMap((g) => Object.values(g || {}));
  check("3 drawings stored separately", imgs.length === 3);
  check("drawings are WebP and small", imgs.every((s) => s.startsWith("data:image/webp") && s.length < 60000), imgs.map((s) => s.slice(11, 15) + " " + Math.round(s.length / 1024) + "KB").join(", "));

  // round 2: describe the drawing — the prompt image must load
  await pages[1].waitForSelector("#promptContent img", { timeout: 10000 });
  const promptSrc = await until(() => pages[1].$eval("#promptContent img", (im) => im.getAttribute("src") || ""), 8000);
  check("next player sees the drawing", !!promptSrc && promptSrc.startsWith("data:image/webp"));
  await pages[1].screenshot({ path: path.join(OUT, "describe.png") });
  for (let k = 0; k < pages.length; k++) { await pages[k].fill("#textEntryInput", "якийсь звір " + k); await pages[k].click("#submitTextBtn"); }
  r = await until(async () => { const x = await room(); return x && x.phase === "reveal" && x; });
  check("reveal phase", !!r);
  await pages[0].waitForTimeout(1500);
  const shown = await pages[0].$$eval("#revealContent img", (ims) => ims.map((im) => !!im.getAttribute("src")));
  check("reveal shows the drawing", shown.length === 1 && shown[0], JSON.stringify(shown));
  // no flicker: the img element survives heartbeat updates
  await pages[0].evaluate(() => { window.__img = document.querySelector("#revealContent img"); });
  await pages[0].waitForTimeout(5000);
  check("reveal not rebuilt on heartbeat (no flicker)", await pages[0].evaluate(() => window.__img === document.querySelector("#revealContent img")));
  await pages[0].screenshot({ path: path.join(OUT, "reveal.png"), fullPage: true });

  // new game clears old drawings
  await pages[0].click("#playAgainBtn").catch(() => {});
  const lobby = await until(async () => { const x = await room(); return x && x.phase === "lobby" && Object.keys(x.players || {}).length >= 2 && x; });
  check("«play again» returns to lobby", !!lobby);
  if (lobby) {
    check("same host and players after «play again»", lobby.hostUsername === names[0] && Object.keys(lobby.players).length === 3, lobby.hostUsername);
    const hostPage = pages[0];
    await hostPage.waitForSelector("#startBtn:visible:enabled", { timeout: 15000 });
    await hostPage.click("#startBtn");
    await until(async () => { const x = await room(); return x && x.phase === "active" && x; });
    const after = await fetch(`${BASE}/db/teli_drawings/${ROOM}.json`).then((x) => x.json());
    check("new game clears old drawings", !after);
  }
  const errs = pages.flatMap((p) => p.errors);
  check("no JS errors", !errs.length, errs.slice(0, 3).join(" | "));
  await b.close();
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
})();
