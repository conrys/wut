// Лобі між раундами в усіх іграх з кімнатами: пізній гість чекає в лобі, хост завершує раунд, усі повертаються.
// node lobby-test.js [гра]   (симулятор має бути запущений: node server.js)
const { launch, phone, BASE } = require("./harness");
const GAMES = [["khovanky", "HNS"], ["perevtilennia", "HNS"], ["monster", "MONGame"], ["hill", "HILLGame"], ["redlight", "RLGame"]];
const only = process.argv[2];
let fails = 0;
const check = (n, ok, x) => { if (!ok) fails++; console.log(`${ok ? "✅" : "❌"} ${n}${x ? " — " + x : ""}`); };
const until = async (fn, ms = 30000) => { const end = Date.now() + ms; while (Date.now() < end) { const r = await fn(); if (r) return r; await new Promise((s) => setTimeout(s, 250)); } return false; };
const vis = (p, id) => p.evaluate((i) => { const e = document.getElementById(i); return !!e && !e.hidden && e.getClientRects().length > 0; }, id);
(async () => {
  const b = await launch();
  for (const [g, api] of GAMES) {
    if (only && only !== g) continue;
    console.log("\n=== " + g);
    const vp = { viewport: { width: 240, height: 420 }, lite: true };
    const [A, B, C] = [await phone(b, null, vp), await phone(b, null, vp), await phone(b, null, vp)];
    const errs = []; for (const p of [A, B, C]) p.on("pageerror", (e) => errs.push(e.message));
    const ph = (p) => p.evaluate((a) => window[a].phase, api);
    const inRound = (p) => ph(p).then((x) => x === "intro" || x === "play");
    const url = BASE + "/ads/" + g + "/play.html";
    for (const [p, n] of [[A, "Влад"], [B, "Олена"], [C, "Петро"]]) { for (let i = 0; i < 4; i++) { await p.goto(url); if (await until(() => p.evaluate(() => !document.getElementById("mpOpen").disabled), 12000)) break; } await p.click("#mpOpen"); await p.fill("#nick", n); }
    await A.click("#mpCreate"); await A.waitForTimeout(1200);
    const code = (await A.textContent("#roomCode")).trim();
    check("створив кімнату — лобі, а не гра", (await ph(A)) === "lobby" && await vis(A, "mpB"));
    await A.click("#mpStart");
    check("старт хоста", await until(() => inRound(A)));
    await until(async () => (await ph(A)) === "play", 20000);
    await B.fill("#codeIn", code); await B.click("#mpJoinBtn");
    const w = await until(() => B.evaluate(() => { const s = document.querySelector(".rl-status"); return s && !s.hidden && s.textContent; }));
    await B.waitForTimeout(1500);
    check("пізній гість у лобі, не глядач", (await ph(B)) === "lobby" && await vis(B, "mpB"), w);
    await C.fill("#codeIn", code); await C.click("#mpJoinBtn");
    await until(() => C.evaluate(() => { const s = document.querySelector(".rl-watch"); return s && !s.hidden; }));
    await C.click(".rl-watch");
    check("«Дивитись гру» показує раунд", await until(async () => (await ph(C)) !== "lobby", 8000));
    check("хост бачить плашку", await until(() => A.evaluate(() => { const e = document.querySelector(".rl-bar"); return e && !e.hidden && /Олена/.test(e.textContent) && /Петро/.test(e.textContent); }), 8000));
    await A.screenshot({ path: `/tmp/claude-0/-home-claude/2752151d-4b6d-5c18-b76b-ede83fc197a0/scratchpad/lobby-${g}-bar.png` }); await B.screenshot({ path: `/tmp/claude-0/-home-claude/2752151d-4b6d-5c18-b76b-ede83fc197a0/scratchpad/lobby-${g}-wait.png` });
    const armed = await A.evaluate(() => new Promise((r) => { const e = document.querySelector(".rl-bar button"); e.click(); requestAnimationFrame(() => requestAnimationFrame(() => { const t = e.textContent; e.click(); r(t); })); }));
    check("перший дотик лише питає", /Точно/.test(armed), armed);
    check("усі в лобі після завершення", await until(async () => (await ph(A)) === "lobby" && (await ph(B)) === "lobby" && (await ph(C)) === "lobby", 25000), [await ph(A), await ph(B), await ph(C)].join());
    check("у хоста кнопка наступного раунду", (await A.textContent("#mpStart")) === "Наступний раунд" && await vis(A, "mpStart"));
    await A.screenshot({ path: `/tmp/claude-0/-home-claude/2752151d-4b6d-5c18-b76b-ede83fc197a0/scratchpad/lobby-${g}-back.png` });
    await A.click("#mpStart");
    check("новий раунд у всіх трьох", await until(async () => (await inRound(A)) && (await inRound(B)) && (await inRound(C)), 15000));
    const pl = await A.evaluate((a) => window[a].MP.g.pl.length, api);
    check("усі троє — гравці", pl === 3, "pl=" + pl);
    // кінець раунду природним шляхом: хост доводить до end/over, далі таймер
    await until(async () => (await ph(A)) === "play", 20000);
    await A.evaluate(([a, gm]) => { const m = window[a].MP, gg = m.g; gg.ph = gm === "redlight" ? "over" : "end"; gg.k++; gg.res = gg.res || "hide"; gg.rem = 1500; m.hostEnd = performance.now() + 1500; }, [api, g]);
    check("після кінця раунду — знову лобі, без автостарту", await until(async () => (await ph(A)) === "lobby" && (await ph(B)) === "lobby", 15000));
    await B.waitForTimeout(800);
    check("гість бачить «Чекаємо хоста»", (await vis(B, "waitHost")) && !(await vis(B, "hostCtl")));
    await B.click("#mpQuit").catch(() => {}); await A.waitForTimeout(600);
    await A.click("#mpQuit").catch(() => {});
    check("вихід у меню", await until(async () => (await ph(A)) === "menu", 5000));
    check("без JS-помилок", !errs.length, errs.slice(0, 3).join(" | "));
    for (const p of [A, B, C]) await p.context().close();
  }
  await b.close(); console.log(fails ? `\n❌ невдач: ${fails}` : "\n✅ усе пройшло"); process.exit(fails ? 1 : 0);
})();
