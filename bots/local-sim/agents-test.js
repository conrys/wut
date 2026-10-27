// Агенти: соло-шпигун (сісти, злам, бот-мисливець), соло-мисливець (промах по перехожому, спіймав шпигуна),
// мультитач (джойстик + «Злам»), мережа двома «телефонами» (боти й злами однакові, постріл гравця-мисливця).
// node agents-test.js   (симулятор має бути запущений: node server.js)
const { launch, phone, BASE } = require("./harness");
const results = [];
function check(name, ok, extra) { results.push(!!ok); console.log(`${ok ? "✅" : "❌"} ${name}${extra ? " — " + extra : ""}`); }
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { const r = await fn(); if (r) return r; await new Promise((x) => setTimeout(x, 250)); } return null; };
const URL_ = BASE + "/ads/agents/play.html";
async function touches(p) { const cdp = await p.context().newCDPSession(p); return (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts }); }
async function center(p, sel) { return p.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, sel); }
const toPlay = (p) => p.evaluate(() => { const g = AGTGame.G; if (g.ph === "intro") { g.ph = "play"; g.rem = g.tl * 1000; } });

(async () => {
  await fetch(BASE + "/__mock/reset");
  const b = await launch();
  // ================= СОЛО: ШПИГУН =================
  let p = await phone(b, null);
  await p.goto(URL_); await p.waitForTimeout(2500);
  const m0 = await p.evaluate(() => ({ n: AGTGame.chars.length, calls: AGTGame.renderer.info.render.calls }));
  check("меню: вокзал живе, натовп малюється кількома викликами", m0.n >= 30 && m0.calls < 30, JSON.stringify(m0));
  await p.click("#ovSpy"); await p.waitForTimeout(500);
  const i0 = await p.evaluate(() => { const g = AGTGame; return { ph: g.phase, role: g.player.role, n: g.chars.length, hu: g.G.hu, t: g.terms.length, goal: g.G.goal }; });
  check("старт шпигуном: інтро, 34 перехожі + бот-мисливець, термінали", i0.ph === "intro" && i0.role === "spy" && i0.n === 36 && i0.hu[0] === "bh" && i0.t >= 8 && i0.goal === 4, JSON.stringify(i0));
  await until(() => p.evaluate(() => AGTGame.phase === "play"), 70000);
  check("гра почалась, кнопки «Біг» і «Телефон» є", await p.evaluate(() => !document.getElementById("run").hidden && !document.getElementById("phone").hidden));
  // мисливця відсуваємо, щоб не заважав
  const park = () => p.evaluate(() => { const h = AGTGame.chr("bh"); h.x = AGTGame.spawn[0]; h.z = AGTGame.spawn[1]; AGTGame.G.am.bh = 0; });
  await park();
  // сісти
  const st = await p.evaluate(() => { const g = AGTGame, s = g.seats.find((s) => !s.res && !g.terms.some((t) => Math.hypot(t.sx - s.ax, t.sz - s.az) < 2.5) && !g.chars.some((c) => Math.hypot(c.x - s.x, c.z - s.z) < 0.5 || Math.hypot(c.x - s.ax, c.z - s.az) < 0.6)); g.player.x = s.ax; g.player.z = s.az; g.player.path = null; return s.i; });
  await p.evaluate(() => AGTGame.sim(0.1));
  const sc = await p.evaluate(() => AGTGame.actCtx() && AGTGame.actCtx().k);
  check("біля лавки — «Сісти»", sc === "sit", sc);
  await p.tap("#act"); await p.waitForTimeout(300);
  const sat = await p.evaluate(() => ({ st: AGTGame.player.st, s: !!AGTGame.player.seat, k: AGTGame.actCtx() && AGTGame.actCtx().k }));
  check("сів (стан «сидить»), кнопка стала «Встати»", sat.st === 1 && sat.s && sat.k === "up", JSON.stringify(sat));
  await p.tap("#act"); await p.waitForTimeout(200);
  check("встав", await p.evaluate(() => !AGTGame.player.seat && AGTGame.player.st !== 1));
  // злам: утримання 3,2 с
  const ti = await p.evaluate(() => { const g = AGTGame, t = g.terms[0]; for (const c of g.chars) if (c !== g.player && Math.hypot(c.x - t.sx, c.z - t.sz) < 1) { c.x += 3; } g.player.x = t.sx; g.player.z = t.sz; g.player.vx = g.player.vz = 0; return t.i; });
  await p.evaluate(() => AGTGame.sim(0.1));
  check("біля терміналу — «Злам · тримай»", await p.evaluate(() => AGTGame.actCtx() && AGTGame.actCtx().k === "hack" && /Злам/.test(document.getElementById("actTxt").textContent)));
  await p.evaluate((ti) => { const h = AGTGame.hold; h.on = true; h.ti = ti; AGTGame.sim(1.5); }, ti);
  const mid = await p.evaluate((ti) => ({ d: AGTGame.G.done.length, st: AGTGame.player.st, bl: AGTGame.terms[ti].blink }), ti);
  await p.evaluate((ti) => { const h = AGTGame.hold; h.on = true; h.ti = ti; AGTGame.sim(2.0); }, ti);
  const h1 = await p.evaluate(() => ({ d: AGTGame.G.done.slice(), chip: document.getElementById("progChip").textContent }));
  check("під час зламу термінал блимає червоним", mid.bl);
  check("під час зламу — та сама анімація, що в перехожих («працює»)", mid.st === 2 && mid.d === 0, JSON.stringify(mid));
  check("утримав 3,2 с — термінал зламано, 1/4", h1.d.length === 1 && h1.d[0] === ti && h1.chip.includes("1/4"), JSON.stringify(h1));
  // рух скасовує злам
  const t2 = await p.evaluate(() => { const g = AGTGame, t = g.terms[1]; g.player.x = t.sx; g.player.z = t.sz; return t.i; });
  await p.evaluate((ti) => { const h = AGTGame.hold; h.on = true; h.ti = ti; AGTGame.sim(1); AGTGame.player.x += 1.5; AGTGame.sim(2.5); }, t2);
  check("відійшов — злам не зараховано", await p.evaluate((ti) => !AGTGame.G.done.includes(ti), t2));
  await p.evaluate(() => { AGTGame.hold.on = false; });
  // боти поводяться по-різному
  await p.evaluate(() => AGTGame.sim(8));
  const plans = await p.evaluate(() => { const o = {}; for (const c of AGTGame.chars) if (c.kind === "bot") o[c.st] = (o[c.st] || 0) + 1; return o; });
  check("перехожі ходять, сидять, працюють, телефонують", Object.keys(plans).length >= 3, JSON.stringify(plans));
  // бот-мисливець: шпигун біжить поруч — підозра й постріл
  const caught = await p.evaluate(() => { const g = AGTGame, h = g.chr("bh"), pl = g.player; g.G.am.bh = 3;
    const t = g.terms[2]; h.x = t.sx; h.z = t.sz; h.path = null; for (const [dx, dz] of [[2.5, 0], [-2.5, 0], [0, 2.5], [0, -2.5], [1.8, 1.8], [-1.8, -1.8], [1.8, -1.8], [-1.8, 1.8]]) { const [x, z] = g.snap(t.sx + dx, t.sz + dz); pl.x = x; pl.z = z; if (g.los(h.x, h.z, x, z) && Math.hypot(x - h.x, z - h.z) > 1.2) break; } for (const c of g.chars) if (c !== pl && c !== h && Math.hypot(c.x - h.x, c.z - h.z) < 6) { c.x = g.spawn[0]; c.z = g.spawn[1]; }
    g.run = true;
    for (let k = 0; k < 250 && !g.G.out.includes("me") && g.G.ph === "play"; k++) { const ph = Math.floor(k / 4) % 4; g.keys.a = ph === 0; g.keys.w = ph === 1; g.keys.d = ph === 2; g.keys.s = ph === 3; g.sim(0.1); }
    g.keys.a = g.keys.w = g.keys.d = g.keys.s = false; g.run = false;
    return { out: g.G.out.includes("me"), am: g.G.am.bh, ph: g.G.ph, res: g.G.res }; });
  check("бот-мисливець помічає шпигуна, що метушиться, і стріляє", caught.out && caught.am === 2, JSON.stringify(caught));
  await until(() => p.evaluate(() => !document.getElementById("ov").hidden), 8000);
  check("шпигуна спіймано — кінець раунду, мисливець переміг", await p.evaluate(() => AGTGame.phase === "end" && AGTGame.G.res === "hunt" && !document.getElementById("ov").hidden && /Мисливець/.test(document.getElementById("ovTitle").textContent)));
  const e1 = p.errors.slice();
  await p.screenshot({ path: __dirname + "/out/agents-solo-spy.png" });

  // ================= СОЛО: МИСЛИВЕЦЬ =================
  await p.click("#ovHunt"); await p.waitForTimeout(500);
  const j0 = await p.evaluate(() => ({ r: AGTGame.player.role, bs: AGTGame.G.bs.length, am: AGTGame.G.am.me, run: !document.getElementById("run").hidden }));
  check("мисливцем: 3 боти-шпигуни, 6 набоїв", j0.r === "hunter" && j0.bs === 3 && j0.am === 6, JSON.stringify(j0));
  const fz = await p.evaluate(() => { const x = AGTGame.player.x; AGTGame.sim(1); return Math.abs(AGTGame.player.x - x) < 0.01; });
  check("мисливець стоїть, поки шпигуни розходяться (інтро)", fz);
  await toPlay(p); await p.evaluate(() => AGTGame.sim(0.1));
  check("кнопка «Постріл» є", await p.evaluate(() => !document.getElementById("shoot").hidden));
  // постріл по перехожому
  const miss = await p.evaluate(() => { const g = AGTGame, pl = g.player, c = g.chars.find((c) => c.role === "bot" && c.st !== 1); c.plan = "idle"; c.t = 9; c.x = pl.x + 2; c.z = pl.z; c.path = null;
    if (!g.los(pl.x, pl.z, c.x, c.z)) { c.x = pl.x; c.z = pl.z + 1.5; } g.select(c.id); g.shoot(); g.sim(0.1); return { id: c.id, st: c.st, am: g.G.am.me, stun: g.myStun }; });
  check("влучив у перехожого — він «спить», мінус набій, оглушення", miss.st === 5 && miss.am === 5 && miss.stun > 2, JSON.stringify(miss));
  const blocked = await p.evaluate(() => { const g = AGTGame, pl = g.player, c = g.chars.find((c) => c.role === "spy"); c.x = pl.x + 1.5; c.z = pl.z; g.select(c.id); g.shoot(); g.sim(0.1); return g.G.out.length; });
  check("оглушений не стріляє", blocked === 0);
  await p.evaluate(() => AGTGame.sim(3.2));
  const hit = await p.evaluate(() => { const g = AGTGame, pl = g.player, c = g.chars.find((c) => c.role === "spy" && !c.out); c.plan = "idle"; c.t = 9; c.path = null; c.x = pl.x + 1.5; c.z = pl.z;
    if (!g.los(pl.x, pl.z, c.x, c.z)) { c.x = pl.x; c.z = pl.z + 1.5; } g.select(c.id); g.shoot(); g.sim(0.2); return { out: g.G.out.slice(), am: g.G.am.me, chip: document.getElementById("spyChip").textContent }; });
  check("влучив у шпигуна — спійманий, 🕵 2/3", hit.out.length === 1 && hit.am === 4 && hit.chip.includes("2/3"), JSON.stringify(hit));
  // боти-шпигуни самі зламують
  await p.evaluate(() => { for (const c of AGTGame.chars) if (c.role === "spy" && !c.out) { c.plan = null; } AGTGame.sim(110); });
  const bd = await p.evaluate(() => ({ done: AGTGame.G.done.length, ph: AGTGame.G.ph }));
  check("боти-шпигуни зламують термінали самі", bd.done >= 1, JSON.stringify(bd));
  // мультитач: джойстик одним пальцем + утримання іншим (тут — «Постріл» як кнопка на дотик)
  const e2 = p.errors.slice(e1.length);
  await p.context().close();

  // ================= МУЛЬТИТАЧ: шпигун іде й тримає «Злам» =================
  p = await phone(b, null); await p.goto(URL_); await p.waitForTimeout(2500); await p.click("#ovSpy"); await p.waitForTimeout(300); await toPlay(p);
  await p.evaluate(() => { const g = AGTGame, h = g.chr("bh"); g.G.am.bh = 0; h.x = g.spawn[0]; h.z = g.spawn[1]; const t = g.terms[0]; for (const c of g.chars) if (c !== g.player && Math.hypot(c.x - t.sx, c.z - t.sz) < 1.2) c.x += 3; g.player.x = t.sx; g.player.z = t.sz; });
  await p.waitForTimeout(400);
  const T1 = await touches(p), a = await center(p, "#act");
  await T1("touchStart", [{ x: 120, y: 500, id: 1 }]); await T1("touchMove", [{ x: 122, y: 501, id: 1 }]);
  await T1("touchStart", [{ x: 122, y: 501, id: 1 }, { x: a.x, y: a.y, id: 2 }]);
  const held = await until(() => p.evaluate(() => AGTGame.hold.on && AGTGame.hold.p > 0.1), 8000);
  await T1("touchEnd", [{ x: 122, y: 501, id: 1 }]);
  check("палець на полі + другий на «Злам» — злам іде", !!held);
  const hd = await until(() => p.evaluate(() => AGTGame.G.done.length === 1), 15000);
  await T1("touchEnd", []);
  check("утримав пальцем — термінал зламано", !!hd);
  // дотик до підлоги — персонаж іде сам
  const before = await p.evaluate(() => [AGTGame.player.x, AGTGame.player.z]);
  await p.evaluate(() => { const g = AGTGame; for (const [x, y] of [[195, 200], [100, 300], [290, 300], [195, 520], [60, 450], [330, 450]]) { g.tapAt(x, y); if (g.player.path && g.player.path.length) break; } }); // короткий дотик (у headless між down/up >1 с, тому напряму)
  const walked = await until(() => p.evaluate((b0) => Math.hypot(AGTGame.player.x - b0[0], AGTGame.player.z - b0[1]) > 0.8, before), 8000);
  check("торкнувся підлоги — іде туди пішки", !!walked);
  const e3 = p.errors.slice();
  await p.context().close();

  // ================= МЕРЕЖА =================
  const vp = { viewport: { width: 320, height: 600 } }; const A = await phone(b, null, vp), B = await phone(b, null, vp);
  for (const [pg, n] of [[A, "Оля"], [B, "Тарас"]]) { await pg.goto(URL_); await pg.waitForTimeout(2000); await pg.click("#mpOpen"); await pg.fill("#nick", n); }
  await A.click("#mpCreate"); await A.waitForTimeout(1500);
  const code = (await A.textContent("#roomCode")).trim();
  await B.fill("#codeIn", code); await B.click("#mpJoinBtn"); await B.waitForTimeout(2500);
  check("лобі: хост бачить обох", (await A.evaluate(() => document.querySelectorAll("#plist li").length)) === 2);
  await A.selectOption("#huntSel", "player"); await A.selectOption("#crowdSel", "48"); await A.click("#mpStart");
  await until(async () => (await A.evaluate(() => AGTGame.phase)) === "intro" && (await B.evaluate(() => AGTGame.phase)) === "intro", 30000);
  const sa = await A.evaluate(() => JSON.stringify([AGTGame.terms.map((t) => [t.x, t.z]), AGTGame.chars.length, AGTGame.chars.map((c) => c.id + c.role).join()]));
  const sb = await B.evaluate(() => JSON.stringify([AGTGame.terms.map((t) => [t.x, t.z]), AGTGame.chars.length, AGTGame.chars.map((c) => c.id + c.role).join()]));
  check("в обох однакові термінали, 48 перехожих + 2 гравці, ролі", sa === sb && JSON.parse(sa)[1] === 50, JSON.parse(sa)[1]);
  const roles = await Promise.all([A, B].map((x) => x.evaluate(() => AGTGame.player.role)));
  check("один мисливець, один шпигун", roles.sort().join() === "hunter,spy", roles.join());
  const H = roles[0] === "hunter" ? A : B; const S = H === A ? B : A;
  const realRoles = await A.evaluate(() => AGTGame.player.role);
  const Hp = realRoles === "hunter" ? A : B, Sp = Hp === A ? B : A;
  await until(async () => (await A.evaluate(() => AGTGame.phase)) === "play" && (await B.evaluate(() => AGTGame.phase)) === "play", 30000);
  // боти однакові в обох (з невеликою затримкою)
  // хост «заморожує» натовп — у гостя він має стати точно там само
  await A.evaluate(() => { for (const c of AGTGame.chars) if (c.kind === "bot") { c.plan = "idle"; c.t = 999; c.st = 0; c.vx = c.vz = 0; c.path = null; } });
  const sync = await until(async () => { const pa = await A.evaluate(() => AGTGame.chars.filter((c) => c.kind === "bot").map((c) => [c.x, c.z])); const pb = await B.evaluate(() => AGTGame.chars.filter((c) => c.kind === "bot").map((c) => [c.x, c.z]));
    let worst = 0; for (let i = 0; i < pa.length; i++) worst = Math.max(worst, Math.hypot(pa[i][0] - pb[i][0], pa[i][1] - pb[i][1])); return worst < 0.15 ? worst.toFixed(3) : null; }, 40000);
  check("48 перехожих рухаються однаково на обох телефонах", !!sync, sync);
  // шпигун зламує — у хоста зараховано
  const tId = await Sp.evaluate(() => { const g = AGTGame, t = g.terms[0]; g.player.x = t.sx; g.player.z = t.sz; g.player.path = null; return t.i; });
  await Sp.waitForTimeout(600);
  await Sp.waitForTimeout(3000);
  await Sp.evaluate((ti) => { const h = AGTGame.hold; h.on = true; h.ti = ti; AGTGame.sim(3.5); }, tId);
  const hk = await until(() => A.evaluate((ti) => AGTGame.G.done.includes(ti), tId), 40000);
  await Sp.evaluate(() => { AGTGame.hold.on = false; });
  check("шпигун утримав «Злам» на своєму телефоні — у хоста 💾 1", !!hk);
  check("в обох лічильник 💾 1/" , !!(await until(async () => /1\//.test(await Hp.textContent("#progChip")) && /1\//.test(await Sp.textContent("#progChip")), 30000)));
  // мисливець стріляє в шпигуна
  const spyId = await Sp.evaluate(() => AGTGame.player.id);
  await Sp.evaluate(() => { const g = AGTGame; g.player.x = g.spawn[0] + 2; g.player.z = g.spawn[1]; g.player.path = null; });
  await Hp.evaluate(() => { const g = AGTGame; g.player.x = g.spawn[0]; g.player.z = g.spawn[1]; });
  await Hp.waitForTimeout(6000);
  await Hp.evaluate((id) => { const g = AGTGame; for (const c of g.chars) if (c.kind === "bot" && Math.hypot(c.x - g.spawn[0] - 1, c.z - g.spawn[1]) < 2) c.x += 4; g.select(id); g.shoot(); }, spyId);
  const outB = await until(() => Sp.evaluate(() => AGTGame.player.out), 40000);
  check("мисливець влучив — у шпигуна «спіймали»", !!outB);
  const endBoth = await until(async () => (await A.evaluate(() => AGTGame.phase)) === "end" && (await B.evaluate(() => AGTGame.phase)) === "end", 40000);
  check("останнього шпигуна спіймано — кінець в обох", !!endBoth);
  await A.waitForTimeout(2000);
  check("рахунок у кінці (у мисливця бали)", await Hp.evaluate(() => document.querySelectorAll("#scoreList li").length === 2 && !document.getElementById("scoreList").hidden));
  const hu1 = await A.evaluate(() => AGTGame.G.hu[0]);
  const next = await until(async () => (await A.evaluate(() => AGTGame.G && AGTGame.G.r === 2 && AGTGame.phase !== "end")) && (await B.evaluate(() => AGTGame.G && AGTGame.G.r === 2 && AGTGame.phase !== "end")), 90000);
  const r2 = await Promise.all([A, B].map((x) => x.evaluate(() => AGTGame.player.role)));
  const hu2 = await A.evaluate(() => AGTGame.G.hu[0]);
  check("наступний раунд — мисливцем інший гравець", !!next && hu2 !== hu1 && r2.sort().join() === "hunter,spy", r2.join());
  const wire = await A.evaluate(() => { const g = AGTGame; return g.encBots().length; });
  check("стиснені перехожі: 6 символів на бота", wire === 48 * 6, wire);
  await A.screenshot({ path: __dirname + "/out/agents-mp-a.png" }); await B.screenshot({ path: __dirname + "/out/agents-mp-b.png" });
  const e4 = [A, B].flatMap((x) => x.errors);
  check("без JS-помилок", !e1.length && !e2.length && !e3.length && !e4.length, [...e1, ...e2, ...e3, ...e4].slice(0, 6).join(" | "));
  await b.close();
  const ok = results.filter(Boolean).length; console.log(`\n${ok}/${results.length}`); process.exit(ok === results.length ? 0 : 1);
})();
