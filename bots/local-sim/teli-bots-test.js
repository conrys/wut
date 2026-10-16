// Зіпсований телефон з ботами: людина + 3 боти (run-tests.js teli) проходять гру до показу.
// node teli-bots-test.js   (simulator running)
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { launch, phone, BASE } = require("./harness");
const OUT = path.join(__dirname, "out", "teli-bots");
fs.mkdirSync(OUT, { recursive: true });
const results = [];
function check(name, ok, extra) { results.push(ok); console.log(`${ok ? "✅" : "❌"} ${name}${extra ? " — " + extra : ""}`); }
const ROOM = "TB" + Math.floor(Math.random() * 900 + 100);
const room = () => fetch(`${BASE}/db/teli_rooms/${ROOM}.json`).then((r) => r.json());
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { const r = await fn(); if (r) return r; await new Promise((x) => setTimeout(x, 300)); } return null; };

(async () => {
  const b = await launch();
  const p = await phone(b, "Влад");
  await p.goto(`${BASE}/teli.html?room=${ROOM}`, { waitUntil: "load" });
  await until(async () => { const x = await room(); return x && x.players && x.players["Влад"]; });
  const bots = spawn(process.execPath, [path.join(__dirname, "..", "run-tests.js"), "teli", ROOM, "3"], {
    env: { ...process.env, FIREBASE_DATABASE_URL: BASE + "/db" }, stdio: ["ignore", "pipe", "pipe"],
  });
  let log = ""; bots.stdout.on("data", (d) => { log += d; }); bots.stderr.on("data", (d) => { log += d; });
  const lobby = await until(async () => { const x = await room(); return x && Object.keys(x.players || {}).length === 4 && x; });
  check("3 bots joined", !!lobby);
  await p.waitForSelector("#startBtn:visible:enabled", { timeout: 15000 });
  await p.click("#startBtn");
  let r = await until(async () => { const x = await room(); return x && x.phase === "active" && x; });
  check("4 rounds", r && r.totalRounds === 4);

  for (let round = 0; round < 4; round++) {
    r = await until(async () => { const x = await room(); return x && x.currentRound === round && x.assignments && x; });
    const mine = r.assignments["Влад"];
    if (mine.type === "text") {
      await p.waitForSelector("#textEntryInput:visible");
      await p.fill("#textEntryInput", "фраза " + round);
      await p.click("#submitTextBtn");
    } else {
      await p.waitForSelector("#drawCanvas:visible");
      const c = await (await p.$("#drawCanvas")).boundingBox();
      await p.mouse.move(c.x + 30, c.y + 30); await p.mouse.down(); await p.mouse.move(c.x + 150, c.y + 120, { steps: 8 }); await p.mouse.up();
      await p.click("#submitDrawBtn");
    }
    if (round === 2) {
      // мені дістався малюнок бота — він має завантажитись
      const src = await until(() => p.$eval("#promptContent img", (im) => im.getAttribute("src") || "").catch(() => ""), 8000);
      check("I see a bot's drawing", !!src && src.startsWith("data:image/png"));
    }
  }
  r = await until(async () => { const x = await room(); return x && x.phase === "reveal" && x; });
  check("reached reveal", !!r);
  const all = Object.values(r.books || {}).flatMap((bk) => Object.values(bk || {}));
  check("16 entries in 4 books", all.length === 16);
  await p.waitForTimeout(1500);
  const shown = await p.$$eval("#revealContent img", (ims) => ims.map((im) => !!im.getAttribute("src")));
  check("reveal shows drawings", shown.length >= 1 && shown.every(Boolean), JSON.stringify(shown));
  await p.screenshot({ path: path.join(OUT, "reveal.png"), fullPage: true });
  // «Грати ще раз»: я лишаюсь ведучим, боти — у лобі
  await p.click("#playAgainBtn");
  const again = await until(async () => { const x = await room(); return x && x.phase === "lobby" && x; });
  await p.waitForTimeout(3000);
  const lob = await room();
  check("play again: I stay host, bots stay", again && lob.hostUsername === "Влад" && Object.keys(lob.players || {}).length === 4, lob && lob.hostUsername);
  check("play again: I see Start, badge on me", await p.isVisible("#startBtn") && (await p.textContent("#playerList, body")).includes("Влад"));
  const hostBadge = await p.$$eval(".player-chip", (els) => els.filter((e) => e.querySelector(".badge")).map((e) => e.textContent));
  check("ВЕДУЧИЙ badge on me", hostBadge.length === 1 && hostBadge[0].includes("Влад"), hostBadge.join(","));
  check("no JS errors", !p.errors.length, p.errors.slice(0, 3).join(" | "));
  bots.kill("SIGINT");
  await new Promise((x) => setTimeout(x, 1500));
  check("bot log has drawings", /drew a doodle/.test(log), log.split("\n").filter(Boolean).slice(-3).join(" / "));
  await b.close();
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  process.exit(0);
})();
