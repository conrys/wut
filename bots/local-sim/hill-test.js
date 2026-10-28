// Цар гори: соло (зона, очки, переїзд, поштовх, щит, калюжа, ривок, перемога), мультитач, мережа двома телефонами.
// node hill-test.js   (симулятор має бути запущений: node server.js)
const { launch, phone, BASE } = require("./harness");
const URL_ = BASE + "/ads/hill/play.html";
const results = [];
function check(name, ok, extra) { results.push(ok); console.log(`${ok ? "✅" : "❌"} ${name}${extra ? " — " + extra : ""}`); }
const until = async (fn, ms = 30000) => { const end = Date.now() + ms; while (Date.now() < end) { const r = await fn(); if (r) return r; await new Promise((x) => setTimeout(x, 300)); } return null; };
async function center(p, sel) { return p.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, sel); }

(async () => {
  const b = await launch();
  // ================= СОЛО =================
  let p = await phone(b, null, { lite: true });
  await p.goto(URL_); await p.waitForTimeout(2500);
  check("меню: боти вже бʼються за зону на заставці", await p.evaluate(() => HILLGame.phase === "menu" && HILLGame.chars.length === 6 && HILLGame.zones.length >= 1));
  await p.selectOption("#soloBots", "5"); await p.click("#ovSolo");
  await until(() => p.evaluate(() => HILLGame.phase === "intro"), 20000);
  const info = await p.evaluate(() => ({ n: HILLGame.chars.length, z: HILLGame.zones.length, ab: HILLGame.player.ab, map: HILLGame.world.def.name }));
  check("соло: я + 5 ботів, зон на карті ≥ 3, є вміння", info.n === 6 && info.z >= 3 && !!info.ab, JSON.stringify(info));
  // зони по різних кімнатах і на вільній підлозі на всіх картах
  const zcheck = await p.evaluate(() => { const g = HILLGame, out = []; for (const mi of g.MAPIDS) { g.buildWorld(mi, 777); const zs = g.zones; out.push([g.world.def.id, zs.length, new Set(zs.map((z) => z.room)).size]); } return out; });
  check("на кожній карті ≥ 3 зони в ≥ 2 кімнатах", zcheck.every(([, n, r]) => n >= 3 && r >= 2), zcheck.map((z) => z.join(":")).join(" "));
  // новий раунд після перебудови карт (3 боти — як за замовчуванням)
  await p.evaluate(() => HILLGame.startSolo(3));
  await p.evaluate(() => HILLGame.sim(5.5));
  check("відлік 5 с → гра", await p.evaluate(() => HILLGame.phase === "play"));
  // боти самі йдуть у зону й набирають очки, зона переїжджає
  const z0 = await p.evaluate(() => HILLGame.G.zi);
  await p.evaluate(() => { const pl = HILLGame.player; pl.x = 1e3; pl.gone = true; HILLGame.sim(34); pl.gone = false; });
  const s1 = await p.evaluate(() => ({ tot: Object.values(HILLGame.G.sc).reduce((a, b) => a + b, 0), zi: HILLGame.G.zi, fx: HILLGame.G.fx.filter((e) => e[1] === "p").length }));
  check("боти за 34 с набрали очки в зоні", s1.tot > 2, s1.tot.toFixed(1));
  check("через 30 с зона переїхала в інше місце", s1.zi !== z0, `${z0} → ${s1.zi}`);
  check("боти штовхаються за зону", s1.fx > 0, `поштовхів у журналі: ${s1.fx}`);
  // поштовх: бот поруч переді мною
  await p.evaluate(() => { const g = HILLGame, me = g.player, z = g.zones[g.G.zi]; me.x = z.x; me.z = z.z; me.yaw = 0; me.cdP = 0; me.stun = 0;
    const others = g.chars.filter((c) => c !== me); others.forEach((c, i) => { c.x = 2 + i; c.z = 2; c.stun = 99; });
    const v = others[0]; v.x = z.x; v.z = z.z + 1; v.stun = 0; v.kx = v.kz = 0; g.G.shd = {}; window.__v = v.id; });
  await p.evaluate(() => HILLGame.doPush());
  await p.evaluate(() => HILLGame.sim(0.05));
  const kn = await p.evaluate(() => { const v = HILLGame.chr(window.__v); return { k: Math.hypot(v.kx, v.kz), st: v.stun, cd: HILLGame.player.cdP }; });
  check("✋ поштовх відкидає найближчого й оглушає", kn.k > 1.5 && kn.st > 0.3 && kn.cd > 2, JSON.stringify(kn));
  // очки капають, лише коли в зоні сам
  const sc0 = await p.evaluate(() => { const g = HILLGame; for (const c of g.chars) if (c !== g.player) { c.x = 2; c.z = 2; c.stun = 99; } const z = g.zones[g.G.zi]; g.player.x = z.x; g.player.z = z.z; g.G.zt = 25000; return g.G.sc.me || 0; });
  await p.evaluate(() => HILLGame.sim(3));
  const sc1 = await p.evaluate(() => HILLGame.G.sc.me || 0);
  check("сам у зоні — +1 очко за секунду", sc1 - sc0 > 2.5 && sc1 - sc0 < 3.5, (sc1 - sc0).toFixed(2));
  const sc2 = await p.evaluate(() => { const g = HILLGame, z = g.zones[g.G.zi], o = g.chars.find((c) => c !== g.player); o.x = z.x + 0.6; o.z = z.z; g.player.x = z.x; g.player.z = z.z; g.G.zt = 25000; const a = { me: g.G.sc.me, o: g.G.sc[o.id] || 0, id: o.id }; g.sim(2); return { me: g.G.sc.me - a.me, o: (g.G.sc[a.id] || 0) - a.o, own: g.G.own }; });
  check("двоє в зоні — ніхто не отримує, зона «⚔ Бійка»", sc2.me === 0 && sc2.o === 0 && sc2.own === "*", JSON.stringify(sc2));
  // щит: бот штовхає мене — відлітає сам
  const sres = await p.evaluate(() => { const g = HILLGame, me = g.player; me.ab = "shield"; me.cdA = 0; me.stun = 0; me.kx = me.kz = 0; g.doAbil(); const on = (g.G.shd.me | 0) > 0;
    const o = g.chars.find((c) => c !== me); o.x = me.x + 0.8; o.z = me.z; o.stun = 0; o.kx = o.kz = 0; o.gone = false;
    g.push(o.id, "me"); g.sim(0.1); return { on, meK: Math.hypot(me.kx, me.kz), meSt: me.stun, oSt: o.stun, b: g.G.fx.some((e) => e[1] === "b" && e[3] === "me") }; });
  check("🛡 щит: мене не виштовхнути, а хто штовхнув — відлетів сам", sres.on && sres.b && sres.meSt === 0 && sres.oSt > 0, JSON.stringify(sres));
  // калюжа сповільнює суперників, але не мене
  const pd = await p.evaluate(() => { const g = HILLGame, me = g.player; me.ab = "puddle"; me.cdA = 0; me.stun = 0; g.doAbil(); return g.G.pd.length; });
  check("🫧 калюжа зʼявилась під мною", pd === 1);
  // ривок
  const dz = await p.evaluate(() => { const g = HILLGame, me = g.player; me.ab = "dash"; me.cdA = 0; me.stun = 0; me.yaw = 0; const x0 = me.x, z0 = me.z; g.doAbil(); g.sim(0.3); return Math.hypot(me.x - x0, me.z - z0); });
  check("💨 ривок кидає вперед на ~2 м", dz > 1.2, dz.toFixed(2) + " м");
  // перемога на 60
  await p.evaluate(() => { const g = HILLGame; for (const c of g.chars) if (c !== g.player) { c.x = 2; c.z = 2; c.stun = 99; c.gone = true; } const z = g.zones[g.G.zi]; g.player.x = z.x; g.player.z = z.z; g.player.stun = 0; g.G.zt = 25000; g.G.sc.me = 59.5; g.sim(1); });
  const win = await until(() => p.evaluate(() => HILLGame.phase === "end" && HILLGame.G.res === "me" && !document.getElementById("ov").hidden && /цар гори/i.test(document.getElementById("ovTitle").textContent)), 6000);
  check("60 очок — «Ти — цар гори!» і таблиця", !!win);
  // дотик до підлоги — іде туди
  await p.evaluate(() => HILLGame.startSolo(3)); await p.evaluate(() => HILLGame.sim(5.5));
  const before = await p.evaluate(() => [HILLGame.player.x, HILLGame.player.z]);
  await p.evaluate(() => { const g = HILLGame; for (const [x, y] of [[195, 250], [100, 350], [290, 350], [195, 560], [60, 480], [330, 480]]) { g.tapAt(x, y); if (g.player.path && g.player.path.length) break; } });
  const walked = await until(() => p.evaluate((b0) => Math.hypot(HILLGame.player.x - b0[0], HILLGame.player.z - b0[1]) > 0.8, before), 8000);
  check("торкнувся підлоги — іде туди", !!walked);
  check("соло без JS-помилок", p.errors.length === 0, p.errors.slice(0, 3).join(" | "));
  await p.context().close();

  // ================= МУЛЬТИТАЧ =================
  p = await phone(b, null, { lite: true });
  await p.goto(URL_); await p.waitForTimeout(2000); await p.click("#ovSolo");
  await until(() => p.evaluate(() => HILLGame.phase === "play"), 40000);
  await p.evaluate(() => { const g = HILLGame; for (const c of g.chars) if (c !== g.player) { c.stun = 999; c.x = 2; c.z = 2; } g.player.ab = "dash"; g.player.cdA = 0;
    const z = g.zones.slice().sort((a, b) => b.x - a.x)[g.zones.length - 1]; g.player.x = z.x - 1; g.player.z = z.z; g.player.path = null; }); // відкрите місце: є куди бігти вправо
  const cdp = await p.context().newCDPSession(p), send = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts });
  const j0 = { x: 120, y: 420, id: 1 };
  await send("touchStart", [j0]); await send("touchMove", [{ ...j0, x: 170 }]); await p.waitForTimeout(300);
  const pu = await center(p, "#push");
  await send("touchStart", [{ ...j0, x: 170 }, { x: pu.x, y: pu.y, id: 2 }]); await p.waitForTimeout(80); await send("touchEnd", [{ x: pu.x, y: pu.y, id: 2 }]); await p.waitForTimeout(200);
  const m1 = await p.evaluate(() => ({ cd: HILLGame.player.cdP, vx: HILLGame.player.vx }));
  check("тримаєш джойстик і тиснеш ✋ другим пальцем — спрацювало, рух не перервався", m1.cd > 0 && m1.vx > 1, JSON.stringify(m1));
  await send("touchMove", [{ ...j0, x: 200 }]); await p.waitForTimeout(250);
  const v2 = await p.evaluate(() => HILLGame.player.vx);
  check("джойстик після другого пальця далі веде", v2 > 1, `vx ${v2.toFixed(2)}`);
  const ab = await center(p, "#abil");
  await send("touchStart", [{ ...j0, x: 200 }, { x: ab.x, y: ab.y, id: 3 }]); await p.waitForTimeout(80); await send("touchEnd", [{ x: ab.x, y: ab.y, id: 3 }]); await p.waitForTimeout(150);
  check("вміння другим пальцем під час руху", await p.evaluate(() => HILLGame.player.cdA > 3));
  await send("touchEnd", []);
  check("мультитач без JS-помилок", p.errors.length === 0, p.errors.slice(0, 3).join(" | "));
  await p.context().close();

  // ================= МЕРЕЖА =================
  const vp = { viewport: { width: 360, height: 700 }, lite: true }; const A = await phone(b, null, vp), B = await phone(b, null, vp);
  for (const [pg, n] of [[A, "Влад"], [B, "Олена К"]]) { await pg.goto(URL_); await pg.waitForTimeout(2000); await pg.click("#mpOpen"); await pg.fill("#nick", n); }
  await A.click("#mpCreate"); await A.waitForTimeout(1500);
  const code = (await A.textContent("#roomCode")).trim();
  await B.fill("#codeIn", code); await B.click("#mpJoinBtn"); await B.waitForTimeout(2500);
  check("лобі: хост бачить обох", (await A.evaluate(() => document.querySelectorAll("#plist li").length)) === 2);
  await A.selectOption("#botSel", "2"); await A.click("#mpStart");
  await until(async () => (await A.evaluate(() => HILLGame.phase)) === "intro" && (await B.evaluate(() => HILLGame.phase)) === "intro", 30000);
  const sa = await A.evaluate(() => JSON.stringify([HILLGame.zones.map((z) => [z.x, z.z]), HILLGame.chars.map((c) => c.id + ":" + c.colI).join()]));
  const sb = await B.evaluate(() => JSON.stringify([HILLGame.zones.map((z) => [z.x, z.z]), HILLGame.chars.map((c) => c.id + ":" + c.colI).join()]));
  check("в обох однакові зони й гравці (2 люди + 2 боти, різні кольори)", sa === sb && JSON.parse(sa)[1].split(",").length === 4 && new Set(JSON.parse(sa)[1].split(",").map((s) => s.split(":")[1])).size === 4);
  await until(async () => (await A.evaluate(() => HILLGame.phase)) === "play" && (await B.evaluate(() => HILLGame.phase)) === "play", 30000);
  // хост заморожує ботів; гість стає в зону сам — хост рахує йому очки
  await A.evaluate(() => { for (const c of HILLGame.chars) if (c.kind === "bot") { c.stun = 999; c.x = 2; c.z = 2; } const me = HILLGame.player; me.x = 3; me.z = 2.5; });
  const bId = await B.evaluate(() => { const g = HILLGame, z = g.zones[g.G.zi]; g.player.x = z.x; g.player.z = z.z; g.player.path = null; return g.player.id; });
  const got = await until(() => A.evaluate((id) => (HILLGame.G.sc[id] || 0) > 2, bId), 30000);
  check("гість сам у зоні — хост нараховує йому очки", !!got);
  const seen = await until(() => B.evaluate(() => parseInt(document.getElementById("meChip").textContent.replace(/[^0-9/]/g, "")) >= 2), 15000);
  check("гість бачить свої очки в HUD", !!seen, await B.textContent("#meChip"));
  // хост підходить і штовхає гостя — гостя відкидає на його телефоні
  await A.evaluate((id) => { const g = HILLGame, o = g.chr(id), me = g.player; me.x = o.x - 0.9; me.z = o.z; me.yaw = Math.PI / 2; me.cdP = 0; me.stun = 0; }, bId);
  await A.waitForTimeout(400);
  await A.evaluate(() => HILLGame.doPush());
  const kb = await until(() => B.evaluate(() => HILLGame.player.stun > 0 || Math.hypot(HILLGame.player.kx, HILLGame.player.kz) > 1), 15000);
  check("хост штовхнув гостя — на телефоні гостя його відкинуло", !!kb);
  // гість штовхає бота — хост застосовує
  const botId = await A.evaluate(() => HILLGame.chars.find((c) => c.kind === "bot").id);
  await B.evaluate((bid) => { const g = HILLGame, me = g.player, o = g.chr(bid); me.stun = 0; me.kx = me.kz = 0; me.x = o.x - 0.8; me.z = o.z; me.yaw = Math.PI / 2; me.cdP = 0; }, botId);
  await B.waitForTimeout(600);
  await B.evaluate(() => HILLGame.doPush());
  const kb2 = await until(() => A.evaluate((bid) => { const o = HILLGame.chr(bid); return HILLGame.G.fx.some((e) => e[1] === "p" && e[3] === bid) || Math.hypot(o.kx, o.kz) > 1; }, botId), 15000);
  check("гість штовхнув бота — хост відкинув бота", !!kb2);
  check("мережа без JS-помилок", A.errors.length === 0 && B.errors.length === 0, A.errors.concat(B.errors).slice(0, 3).join(" | "));
  await b.close();
  const bad = results.filter((r) => !r).length;
  console.log(bad ? `${bad} failed` : "all passed");
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
