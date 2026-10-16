// Мафія: легкий прогін для перевірки вигляду. 2 «телефони» (ведучий + гість)
// грають свідомо + боти з run-tests.js; скріншот обох екранів на кожній зміні фази.
// node mafia-preview.js [ботів=4] [хвилин=9]
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { launch, phone, BASE } = require("./harness");

const BOTS = Number(process.argv[2] || 4);
const MINUTES = Number(process.argv[3] || 9);
const ROOM = "MF" + Math.floor(Math.random() * 900 + 100);
const OUT = path.join(__dirname, "out", "mafia-preview");
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

// Один «людський» хід усередині сторінки — за фазою, без випадкових кліків.
function humanTurn(arg) {
  const room = window.MafiaGame && window.MafiaGame.room;
  if (!room) return "no-room";
  const me = (room.players || {})[arg.me];
  const click = (el) => { if (el) { el.click(); return true; } return false; };
  const phase = room.phase;
  if (phase === "lobby") {
    if (arg.isHost && arg.doctors && (room.settings || {}).doctorCount !== arg.doctors) window.MafiaGame.setSettings({ doctorCount: arg.doctors });
    if (me && !me.ready) click(document.getElementById("toggleReadyBtn"));
    const btn = document.getElementById("startGameBtn");
    const all = Object.values(room.players || {});
    if (arg.isHost && btn && !btn.disabled && all.length >= 4 && all.every((p) => p.ready)) { btn.click(); return "start"; }
    return "lobby";
  }
  if (!me || me.alive === false) return "spectate";
  const moves = room.moves || {};
  const grid = () => Array.from(document.querySelectorAll(".target-grid .tok:not(.locked)"));
  if (["mafia_move", "doctor_move", "sheriff_move"].includes(phase) && !moves[arg.me]) {
    const g = grid(); if (g.length) { click(g[(arg.seed) % g.length]); return "night-pick"; }
  }
  if (phase === "mafia_move" && me.role === "mafia" && !arg.chatted) {
    const inp = document.getElementById("chatInput");
    if (inp) { inp.value = "Сьогодні беремо тихоню 🔪"; document.getElementById("chatSendBtn").click(); return "chat"; }
  }
  if (phase === "day_discussion") {
    const inp = document.getElementById("chatInput");
    if (inp && !arg.chatted) { inp.value = arg.isHost ? "Хто вночі не спав? 🤨" : "Я мирна, чесно!"; document.getElementById("chatSendBtn").click(); return "chat"; }
    if (!(room.dayReady || {})[arg.me]) { click(document.getElementById("dayReadyBtn")); return "ready"; }
  }
  if (phase === "voting" && !(room.votes || {})[arg.me]) {
    const g = grid(); if (g.length) { click(g[(arg.seed + 1) % g.length]); return "vote"; }
  }
  return "wait";
}

(async () => {
  await fetch(BASE + "/__mock/reset");
  const browser = await launch();
  const pages = [];
  const widths = (process.env.WIDTHS || "390,390").split(",").map(Number); // ширина екрана ведучого, гостя
  for (const [wi, name] of ["Влад", "Олена К"].entries()) {
    const p = await phone(browser, name, { viewport: { width: widths[wi] || 390, height: 844 } });
    await p.context().route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.continue()); // справжні шрифти
    await p.goto(`${BASE}/mafia.html?room=${ROOM}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    pages.push(p);
    await p.waitForTimeout(2500);
  }
  let botLog = "";
  const bots = spawn("node", [path.resolve(__dirname, "..", "run-tests.js"), "mafia", ROOM, String(BOTS)], { env: Object.assign({}, process.env, { FIREBASE_DATABASE_URL: BASE + "/db" }) });
  bots.stdout.on("data", (d) => (botLog += d)); bots.stderr.on("data", (d) => (botLog += d));

  const end = Date.now() + MINUTES * 60000;
  let last = "", shot = 0, tick = 0;
  const chatted = {};
  const timeline = [];
  const KILL_HOST_AT = Number(process.env.KILL_HOST_AT || 0); // сек від старту — закрити вкладку ведучого
  const t0 = Date.now();
  let hostKilled = false;
  while (Date.now() < end) {
    tick++;
    if (KILL_HOST_AT && !hostKilled && (Date.now() - t0) / 1000 > KILL_HOST_AT) {
      hostKilled = true;
      const hp = pages.shift();
      await hp.context().close();
      console.log(`[${tick}] HOST PAGE CLOSED (${hp.username})`);
    }
    const room = await fetch(`${BASE}/db/mafia_rooms/${ROOM}.json`).then((r) => r.json()).catch(() => null);
    if (room) {
      const key = `${room.phase}|${room.nightNumber || 0}`;
      for (const [i, p] of pages.entries()) {
        const ck = p.username + "|" + key;
        const r = await p.evaluate(humanTurn, { me: p.username, isHost: room.hostUsername === p.username, seed: tick + i, chatted: !!chatted[ck], doctors: Number(process.env.DOCTORS || 0) }).catch((e) => "err " + e.message.slice(0, 80));
        if (r === "chat") chatted[ck] = true;
      }
      if (key !== last) {
        last = key;
        const roles = Object.fromEntries(Object.entries(room.players || {}).map(([n, pl]) => [n, `${pl.role || "-"}${pl.alive === false ? "†" : ""}`]));
        timeline.push({ t: tick, phase: room.phase, n: room.nightNumber, roles });
        console.log(`[${tick}] ${room.phase} n=${room.nightNumber || 0}`, JSON.stringify(roles));
        await new Promise((r) => setTimeout(r, room.phase === "role_reveal" ? 3200 : 1300));
        shot++;
        const tag = String(shot).padStart(2, "0") + "-" + room.phase;
        if (shot <= 40) for (const p of pages) await p.screenshot({ path: path.join(OUT, `${tag}-${p.username === "Влад" ? "host" : "guest"}.png`), timeout: 15000 }).catch(() => {});
        if (room.phase === "game_over") {
          await new Promise((r) => setTimeout(r, 3800));
          for (const p of pages) await p.screenshot({ path: path.join(OUT, `${tag}-${p.username === "Влад" ? "host" : "guest"}-final.png`), fullPage: true, timeout: 15000 }).catch(() => {});
          break;
        }
      }
    }
    await new Promise((r) => setTimeout(r, 900));
  }
  bots.kill("SIGINT");
  await new Promise((r) => setTimeout(r, 1500));
  fs.writeFileSync(path.join(OUT, "bots.log"), botLog);
  const errors = pages.flatMap((p) => p.errors.map((e) => p.username + ": " + e));
  fs.writeFileSync(path.join(OUT, "result.json"), JSON.stringify({ room: ROOM, timeline, errors }, null, 2));
  console.log("errors:", errors.length ? errors.slice(0, 20) : "none");
  await browser.close();
})();
