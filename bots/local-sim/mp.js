// Multiplayer stress: N phones join one room, host starts, everyone auto-plays.
// node mp.js <page> <gameKey> <players> <seconds> <outDir>
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const BOTS = Number(process.env.BOTS || 0), BOTGAME = process.env.BOTGAME;
const path = require("node:path");
const { launch, phone, BASE } = require("./harness");
const [, , PAGE, KEY, N = "20", SECS = "120", OUT = path.join(__dirname, "out", String(process.argv[2] || "run").replace(".html", ""))] = process.argv;
const KILL_HOST_AT = Number(process.env.KILL_HOST_AT || 0);
const ROOM = "TEST" + Math.floor(Math.random() * 90 + 10);
fs.mkdirSync(OUT, { recursive: true });

const NAMES = ["vlad", "olena", "andrii", "marta", "taras", "iryna", "bohdan", "sofiia", "dmytro", "kateryna",
  "maksym", "yuliia", "oleh", "nataliia", "serhii", "anastasiia", "roman", "viktoriia", "petro", "khrystyna", "ivan", "daria"];

// Runs inside the page: one "turn" of a naive human.
function autoTurn(arg) {
  const { isHost, me, tick } = arg;
  const SKIP = /завершити|закінчити|скинути вечір|назад|вийти|вихід|закрити|вигнати|викинути|кік|скинути|нова кімната|створити|налаштуван|правила|допомог|профіль|увійти|реєстрац|видалити|прибрати|покинути|вийди|у меню|в меню|головна|лобі|завершити гру|зупинити|пауза|відмін|очистити|стерти|undo|скасувати|share|поділит|копіюв|звук|🔇|🔊|ℹ|❓|✕|×|⟳|↻|оновити|перезапуст|змінити ім/i;
  const START = /почати|старт|розпочати|грати|start/i;
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    const st = getComputedStyle(el);
    if (st.visibility === "hidden" || st.display === "none" || Number(st.opacity) === 0) return false;
    if (el.closest("#top-bar, .game-header, header, .auth-overlay:not(.open), .menu-overlay, .profile-overlay, .help-overlay, .settings-overlay, .notes-panel")) return false;
    if (r.bottom < 0 || r.top > innerHeight * 3) return false;
    return true;
  };
  const acted = [];
  // close any open modal overlay that isn't the game's own
  document.querySelectorAll(".auth-overlay.open, .menu-overlay.open, .profile-overlay.open").forEach((o) => o.classList.remove("open"));
  // fill inputs
  document.querySelectorAll("input[type=text], input:not([type]), textarea").forEach((el) => {
    if (!visible(el) || el.disabled || el.readOnly) return;
    if (/код|code/i.test(el.placeholder + el.id + el.name)) return;
    if (el.value && el.value.length > 1) return;
    const max = el.maxLength > 0 ? el.maxLength : 40;
    const emoji = /emoji|шифр|емодз/i.test(el.placeholder + el.id + el.className);
    const v = emoji ? "🐶🍕🚀" : ("тест " + me + " " + tick).slice(0, Math.max(1, max));
    const setter = Object.getOwnPropertyDescriptor(el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value").set;
    setter.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    acted.push("fill#" + (el.id || el.name || el.tagName));
  });
  // draw on canvases
  document.querySelectorAll("canvas").forEach((c) => {
    if (!visible(c) || c.width < 50) return;
    const r = c.getBoundingClientRect();
    const pts = Array.from({ length: 6 }, (_, i) => [r.left + r.width * (0.2 + 0.1 * i), r.top + r.height * (0.3 + 0.05 * ((i * 7 + tick) % 6))]);
    const ev = (type, [x, y]) => {
      const init = { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, pointerType: "touch", isPrimary: true, buttons: 1 };
      c.dispatchEvent(new PointerEvent(type, init));
      c.dispatchEvent(new MouseEvent(type.replace("pointer", "mouse"), init));
    };
    ev("pointerdown", pts[0]); pts.slice(1).forEach((p) => ev("pointermove", p)); ev("pointerup", pts[pts.length - 1]);
    acted.push("draw");
  });
  // candidate clickables
  const els = Array.from(document.querySelectorAll("button, [role=button], .btn, .choice, .option, .vote-btn, .player-chip, .card, .cell, .room-item, a.btn, .clickable, [data-vote], [data-pick], [data-choice], [data-name], [data-player], [data-target], [data-id], [data-idx], [data-index], [onclick]"))
    .filter((el) => visible(el) && !el.disabled && el.getAttribute("aria-disabled") !== "true" && !el.classList.contains("disabled"))
    .filter((el) => { const t = (el.innerText || el.value || el.title || "").trim(); return !SKIP.test(t) && !SKIP.test(el.id || ""); })
    .filter((el) => !(el.tagName === "A" && el.getAttribute("href") && !el.getAttribute("href").startsWith("#")))
    .filter((el, _, all) => !all.some((o) => o !== el && el.contains(o)))
    .filter((el) => (el.innerText || "").trim().length <= 60)
    .filter((el) => /[\p{L}\p{N}]/u.test(el.innerText || el.value || "") || el.tagName === "CANVAS" || el.querySelector("img") || Math.random() < 0.02);
  const starts = els.filter((el) => START.test((el.innerText || "").trim()));
  let target = null;
  if (starts.length) target = isHost ? starts[0] : null;
  const others = els.filter((el) => !starts.includes(el));
  if (!target && others.length) {
    // prefer "submit/ready/next/vote" kinds
    const pref = others.filter((el) => /готов|надіслати|відправити|підтвердити|далі|ок\b|голос|обрат|вибрат|так|ні|згод|прийнят|ставк|зробити|відповісти|підказ|наступн|пропустит|перевір|відкрит/i.test(el.innerText || ""));
    const pool = pref.length && Math.random() < 0.7 ? pref : others;
    target = pool[Math.floor(Math.random() * pool.length)];
  }
  if (target) {
    target.scrollIntoView({ block: "center" });
    target.click();
    acted.push("click:" + ((target.innerText || target.id || target.className || "").trim().replace(/\s+/g, " ").slice(0, 30)));
  }
  return acted;
}

async function roomState() {
  let r = await fetch(`${BASE}/db/${KEY}_rooms/${ROOM}.json`).then((x) => x.json());
  if (!r) {
    const all = await fetch(`${BASE}/db/${KEY}_rooms.json`).then((x) => x.json()) || {};
    r = Object.values(all).sort((a, b) => Object.keys(b.players || {}).length - Object.keys(a.players || {}).length)[0] || null;
  }
  if (!r) return { exists: false };
  const players = Object.keys(r.players || {}).length;
  return { exists: true, sub: r.subPhase || r.gamePhase || r.state || r.step || (r.game && r.game.phase) || null, phase: r.phase, stage: r.stage && (r.stage.id || r.stage.type || r.stage.kind), round: r.round ?? r.currentRound ?? r.roundIndex, players, host: r.hostUsername, keys: Object.keys(r).join(",") };
}

(async () => {
  await fetch(BASE + "/__mock/reset");
  const n = Number(N);
  const browser = await launch();
  const pages = [];
  const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    const p = await phone(browser, NAMES[i]);
    const tg = Date.now(); await p.goto(`${BASE}/${PAGE}?room=${ROOM}`, { waitUntil: "domcontentloaded", timeout: 120000 }); console.log("join", i, Date.now() - tg, "ms");
    pages.push(p);
    await p.waitForTimeout(i === 0 ? 2500 : 300);
  }
  await pages[0].waitForTimeout(4000);
  const joinState = await roomState();
  console.log(`joined in ${((Date.now() - t0) / 1000).toFixed(0)}s:`, JSON.stringify(joinState));
  let botProc = null, botLog = "";
  if (BOTS) {
    botProc = spawn("node", [path.resolve(__dirname, "..", "run-tests.js"), BOTGAME, ROOM, String(BOTS)], { env: Object.assign({}, process.env, { FIREBASE_DATABASE_URL: BASE + "/db" }) });
    botProc.stdout.on("data", (d) => (botLog += d)); botProc.stderr.on("data", (d) => (botLog += d));
    await new Promise((r) => setTimeout(r, 2000 + BOTS * 200));
    console.log("bots:", botLog.split("\n").slice(-3).join(" / "));
  }
  await pages[0].screenshot({ path: path.join(OUT, "host-lobby.png"), fullPage: true, timeout: 20000 }).catch(() => {});
  await pages[n - 1].screenshot({ path: path.join(OUT, "guest-lobby.png"), fullPage: true, timeout: 20000 }).catch(() => {});

  const timeline = [];
  let lastSig = "";
  const end = Date.now() + Number(SECS) * 1000;
  let tick = 0, shot = 0;
  const actLog = {};
  while (Date.now() < end) {
    tick++;
    const st = await roomState();
    if (KILL_HOST_AT && !pages.killed && (Date.now() - t0) / 1000 > KILL_HOST_AT) {
      const hp = pages.find((p) => p.username === st.host);
      if (hp) { pages.killed = hp.username; await hp.context().close(); pages.splice(pages.indexOf(hp), 1); timeline.push({ t: Math.round((Date.now() - t0) / 1000), event: "host page closed: " + hp.username }); }
    }
    const hostName = st.host || NAMES[0];
    await Promise.all(pages.map(async (p) => {
      if (Math.random() < 0.35 && p.username !== hostName) return; // humans are not instant
      try {
        const acted = await p.evaluate(autoTurn, { isHost: p.username === hostName, me: p.username, tick });
        for (const a of acted) actLog[a.split(":")[0] + ":" + (a.split(":")[1] || "")] = (actLog[a.split(":")[0] + ":" + (a.split(":")[1] || "")] || 0) + 1;
      } catch (e) { p.errors.push("autoturn: " + e.message.slice(0, 120)); }
    }));
    const sig = `${st.phase}|${st.stage}|${st.round}|${st.sub || ''}`;
    if (sig !== lastSig) {
      timeline.push({ t: Math.round((Date.now() - t0) / 1000), ...st });
      lastSig = sig;
      if (shot < 8) {
        shot++;
        const hp = pages.find((p) => p.username === hostName) || pages[0];
        const gp = pages.find((p) => p !== hp);
        await hp.screenshot({ path: path.join(OUT, `s${shot}-host.png`), timeout: 15000 }).catch(() => {});
        await gp.screenshot({ path: path.join(OUT, `s${shot}-guest.png`), timeout: 15000 }).catch(() => {});
      }
    }
    await new Promise((r) => setTimeout(r, 1200));
  }
  if (botProc) { botProc.kill("SIGINT"); await new Promise((r) => setTimeout(r, 2500)); fs.writeFileSync(path.join(OUT, "bots.log"), botLog); }
  const stats = await fetch(BASE + "/__mock/stats").then((x) => x.json());
  const errs = {};
  pages.forEach((p) => p.errors.forEach((e) => { const k = e.replace(/\d{3,}/g, "#").slice(0, 220); errs[k] = (errs[k] || 0) + 1; }));
  const final = await roomState();
  const result = { page: PAGE, room: ROOM, players: n, joinState, final, timeline, errors: errs, stats, topActions: Object.entries(actLog).sort((a, b) => b[1] - a[1]).slice(0, 25) };
  fs.writeFileSync(path.join(OUT, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ final, timeline: timeline.map((x) => `${x.t}s ${x.phase}/${x.stage}/${x.round} p=${x.players}`), errors: errs, stats }, null, 1));
  await browser.close();
})();
