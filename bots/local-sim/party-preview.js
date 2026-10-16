// Вечірки (Хто з нас? / Суд Лінча / Ставки): легкий прогін для перевірки вигляду.
// 3 «телефони» (ведучий + 2 гості) + боти з run-tests.js; скріншоти всіх трьох на кожному етапі.
// node party-preview.js <whofrom|court|bets> [ботів=3] [раундів=2]
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { launch, phone, BASE } = require("./harness");

const GAME = process.argv[2] || "whofrom";
const BOTS = Number(process.argv[3] || 3);
const ROUNDS = Number(process.argv[4] || 2);
const KEY = "party_" + GAME;
const ROOM = "PV" + Math.floor(Math.random() * 900 + 100);
const OUT = path.join(__dirname, "out", "party-" + GAME);
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NAMES = ["Влад", "Олена К", "Марʼяна"];

(async () => {
  await fetch(BASE + "/__mock/reset");
  const browser = await launch();
  const pages = [];
  for (const name of NAMES) {
    const p = await phone(browser, name);
    await p.context().route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.continue()); // справжні шрифти
    await p.goto(`${BASE}/${GAME}.html?room=${ROOM}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    pages.push(p);
    await sleep(pages.length === 1 ? 3000 : 1500);
  }
  let botLog = "";
  const bots = spawn("node", [path.resolve(__dirname, "..", "run-tests.js"), GAME, ROOM, String(BOTS)], { env: Object.assign({}, process.env, { FIREBASE_DATABASE_URL: BASE + "/db" }) });
  bots.stdout.on("data", (d) => (botLog += d)); bots.stderr.on("data", (d) => (botLog += d));
  await sleep(6000);
  const shotAll = async (tag, full) => { for (const [i, p] of pages.entries()) await p.screenshot({ path: path.join(OUT, `${tag}-${["host", "guest1", "guest2"][i]}.png`), fullPage: !!full, timeout: 15000 }).catch(() => {}); };
  await shotAll("00-lobby");
  // короткі таймери, щоб прогін не тягнувся
  await pages[0].evaluate(() => window.PartyGame.updateSettings({ courtSpeakSeconds: 20, voteSeconds: 20, betSeconds: 20, decideSeconds: 20 }));
  await sleep(800);
  await pages[0].click("#startBtn");

  let lastStage = null, shot = 0;
  const end = Date.now() + 6 * 60000;
  while (Date.now() < end) {
    const room = await fetch(`${BASE}/db/${KEY}_rooms/${ROOM}.json`).then((r) => r.json()).catch(() => null);
    if (room && room.phase === "summary") { await sleep(2500); await shotAll(String(++shot).padStart(2, "0") + "-summary", true); break; }
    if (room && room.stage) {
      const st = room.stage;
      if (st.id !== lastStage) {
        lastStage = st.id;
        console.log(`round ${room.roundNo + 1}: ${st.kind} ${(st.data && st.data.step) || ""}`);
        await sleep(st.kind === "reveal" ? 2600 : 1500);
        const tag = `${String(++shot).padStart(2, "0")}-r${room.roundNo + 1}-${st.kind}${st.data && st.data.step ? "-" + st.data.step : ""}`;
        await shotAll(tag, st.kind === "reveal");
        if (st.kind === "reveal" && room.roundNo + 1 >= ROUNDS) {
          await pages[0].evaluate(() => window.PartyGame.endSet());
        } else if (st.kind === "reveal" || st.kind === "show") {
          await pages[0].click("#hostNextBtn").catch(() => {});
        }
      }
      // гравці відповідають: кожен тисне свою кнопку data-answer
      for (const [i, p] of pages.entries()) {
        await p.evaluate((seed) => {
          const btns = Array.from(document.querySelectorAll("#stage [data-answer]"));
          if (btns.length && !document.querySelector("#stage [data-answer].selected")) btns[seed % btns.length].click();
        }, i + (room.roundNo || 0)).catch(() => {});
      }
    }
    await sleep(700);
  }
  bots.kill("SIGINT");
  await sleep(1000);
  fs.writeFileSync(path.join(OUT, "bots.log"), botLog);
  const errors = pages.flatMap((p) => p.errors.map((e) => p.username + ": " + e));
  console.log("errors:", errors.length ? errors.slice(0, 20) : "none");
  await browser.close();
})();
