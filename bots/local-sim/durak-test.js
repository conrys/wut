// Дурак з вбудованими ботами («+ Бот»): людина + 3 боти грають партію до кінця,
// за людину ходить та сама botAction. Перевіряє, що гра не зависає і закінчується.
// node durak-test.js   (simulator running)
const fs = require("node:fs");
const path = require("node:path");
const { launch, phone, BASE } = require("./harness");
const OUT = path.join(__dirname, "out", "durak");
fs.mkdirSync(OUT, { recursive: true });
const results = [];
function check(name, ok, extra) { results.push(ok); console.log(`${ok ? "✅" : "❌"} ${name}${extra ? " — " + extra : ""}`); }
const ROOM = "D" + Math.floor(Math.random() * 900 + 100);
const room = () => fetch(`${BASE}/db/durak_rooms/${ROOM}.json`).then((r) => r.json());
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { const r = await fn(); if (r) return r; await new Promise((x) => setTimeout(x, 300)); } return null; };

async function playGame(p, label) {
  // за людину: та сама логіка, що й у ботів; стоп — якщо 30 с стан не змінюється
  let last = "", lastChange = Date.now(), moves = 0;
  while (Date.now() - lastChange < 30000) {
    const r = await room();
    if (r.phase === "ended") return { ended: true, moves, room: r };
    const sig = JSON.stringify(r.state);
    if (sig !== last) { last = sig; lastChange = Date.now(); }
    const did = await p.evaluate(() => {
      const G = window.DurakGame, D = window.DurakRules;
      const snap = window.__durakRoom;
      if (!snap || !snap.state) return false;
      const s = G.normalizeState(snap.state);
      const a = D.botAction(s, "Влад");
      if (!a) return false;
      if (a.type === "throw") return G.throwCard(a.card);
      if (a.type === "defend") return G.defendCard(a.slotIndex, a.card);
      if (a.type === "take") return G.takeCards();
      if (a.type === "pass") return G.passAttack();
      return false;
    });
    if (did) moves++;
    await p.waitForTimeout(400);
  }
  const r = await room();
  await p.screenshot({ path: path.join(OUT, `stuck-${label}.png`) });
  return { ended: false, moves, room: r };
}

(async () => {
  const b = await launch();
  const p = await phone(b, "Влад");
  await p.goto(`${BASE}/durak.html`, { waitUntil: "load" });
  await p.waitForSelector("#roomCodeInput:visible");
  await p.fill("#roomCodeInput", ROOM);
  await p.click("#joinRoomBtn");
  await p.waitForSelector("#view-lobby:not(.hidden)", { timeout: 15000 });
  // підглядаємо в кімнату, яку бачить сторінка
  await p.evaluate(() => {
    const G = window.DurakGame;
    const prev = G.roomRef;
    prev.on("value", (s) => { window.__durakRoom = s.val(); });
  });
  for (let i = 0; i < 3; i++) { await p.click("#addBotBtn"); await p.waitForTimeout(400); }
  let r = await room();
  check("3 bots added", Object.values(r.players || {}).filter((x) => x.isBot).length === 3);
  await p.waitForSelector("#startGameBtn:visible", { timeout: 10000 });
  await p.click("#startGameBtn");
  r = await until(async () => { const x = await room(); return x && x.phase === "playing" && x; });
  check("game started", !!r);
  await p.waitForTimeout(800);
  await p.screenshot({ path: path.join(OUT, "game.png") });

  const g1 = await playGame(p, "1");
  check("game 1 reaches the end (no stall)", g1.ended, `my moves: ${g1.moves}, result: ${JSON.stringify(g1.room.state && g1.room.state.result)}`);
  await p.waitForTimeout(800);
  check("result overlay shown", await p.isVisible("#resultOverlay"));
  await p.screenshot({ path: path.join(OUT, "result.png") });

  // ще партію
  await p.click("#rematchBtn");
  r = await until(async () => { const x = await room(); return x && x.phase === "playing" && x; });
  check("rematch starts", !!r);
  const g2 = await playGame(p, "2");
  check("game 2 reaches the end", g2.ended, `my moves: ${g2.moves}`);
  check("no JS errors", !p.errors.length, p.errors.slice(0, 3).join(" | "));
  await b.close();
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  process.exit(0);
})();
