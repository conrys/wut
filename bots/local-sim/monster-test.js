// Монстр: соло-раунд (запобіжники → вихід), монстр (слух, світло, витягує з шафи), падіння й підйом,
// щиток, засліплення, мультитач, мережа двома «телефонами» (бот-монстр і гравець-монстр).
// node monster-test.js   (симулятор має бути запущений: node server.js)
const { launch, phone, BASE } = require("./harness");
const results = [];
function check(name, ok, extra) { results.push(!!ok); console.log(`${ok ? "✅" : "❌"} ${name}${extra ? " — " + extra : ""}`); }
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { const r = await fn(); if (r) return r; await new Promise((x) => setTimeout(x, 250)); } return null; };
const URL_ = BASE + "/ads/monster/play.html";
async function touches(p) { const cdp = await p.context().newCDPSession(p); return (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts }); }
async function center(p, sel) { return p.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, sel); }
async function solo(b, lvl) {
  const p = await phone(b, null);
  await p.goto(URL_); await p.evaluate((l) => localStorage.setItem("mon_level", String(l)), lvl);
  await p.reload(); await p.waitForTimeout(1500); await p.click("#ovBtn"); await p.waitForTimeout(300);
  return p;
}
// заморозити монстра («спить»), щоб перевірки не заважали одна одній
const park = (p) => p.evaluate(() => { const m = MONGame.mon; m.state = "sleep"; m.path = null; m.vx = m.vz = 0; });

(async () => {
  await fetch(BASE + "/__mock/reset");
  const b = await launch();

  // ================= СОЛО =================
  let p = await solo(b, 1);
  const i0 = await p.evaluate(() => ({ ph: MONGame.phase, m: MONGame.mon.state, nf: MONGame.G.nf, items: MONGame.items.length, ex: !!MONGame.exit, h: MONGame.hides.length }));
  check("старт: інтро, монстр спить, 3 запобіжники + батарейки, є вихід і схованки", i0.ph === "intro" && i0.m === "sleep" && i0.nf === 3 && i0.items >= 5 && i0.ex && i0.h >= 3, JSON.stringify(i0));
  await until(() => p.evaluate(() => MONGame.phase === "play"), 70000); await p.waitForTimeout(400);
  check("гра почалась — монстр прокинувся", await p.evaluate(() => MONGame.mon.state !== "sleep"));
  check("кнопки «Ліхтар» і «Присісти» видно", await p.evaluate(() => !document.getElementById("light").hidden && !document.getElementById("crouch").hidden));
  await park(p);
  // ліхтар
  const b0 = await p.evaluate(() => MONGame.player.battery); await p.evaluate(() => MONGame.sim(2));
    const b1 = await p.evaluate(() => MONGame.player.battery);
  check("увімкнений ліхтар садить батарейку", b1 < b0 - 1, `${b0.toFixed(1)} → ${b1.toFixed(1)}`);
  await p.tap("#light"); await p.waitForTimeout(200); const b1b = await p.evaluate(() => MONGame.player.battery); await p.evaluate(() => MONGame.sim(1.5));
  const b2 = await p.evaluate(() => ({ on: MONGame.player.lightOn, b: MONGame.player.battery }));
  check("кнопка вимикає ліхтар — заряд не тане", !b2.on && Math.abs(b2.b - b1b) < 0.01, JSON.stringify(b2));
  await p.tap("#light");
  // батарейка
  const bt = await p.evaluate(() => { const g = MONGame, it = g.items.find((i) => i.kind === "b"); g.player.battery = 30; g.player.x = it.x; g.player.z = it.z; return it.id; });
  await p.waitForTimeout(500);
  const bb = await p.evaluate((id) => ({ b: MONGame.player.battery, got: MONGame.G.got.includes(id) }), bt);
  check("підібрав 🔋 — заряд +45", bb.got && bb.b > 70, JSON.stringify(bb));
  // запобіжник: несеш один, у щиток — утриманням
  const f0 = await p.evaluate(() => { const g = MONGame, it = g.items.find((i) => i.kind === "f"); g.player.x = it.x; g.player.z = it.z; return it.id; });
  await p.evaluate(() => MONGame.sim(0.2));
  const c0 = await p.evaluate((id) => ({ hold: MONGame.G.hold.me, chip: document.getElementById("fuseChip").textContent }), f0);
  check("підібрав 🔌 — несу в руках", c0.hold === f0 && c0.chip.includes("🔌"), JSON.stringify(c0));
  const f1 = await p.evaluate(() => { const g = MONGame, it = g.items.find((i) => i.kind === "f" && i.id !== g.G.hold.me); g.player.x = it.x; g.player.z = it.z; return it.id; });
  await p.evaluate(() => MONGame.sim(0.2));
  check("другий запобіжник не взяти, поки руки зайняті", await p.evaluate((id) => MONGame.G.hold.me !== id && !MONGame.items.find((i) => i.id === id).gone, f1));
  await p.evaluate(() => { const g = MONGame, [x, z] = [g.box.x, g.box.z]; g.player.x = x; g.player.z = z; });
  await p.evaluate(() => MONGame.sim(0.1));
  check("біля щитка — «Вставити · тримай»", await p.evaluate(() => MONGame.actCtx() && MONGame.actCtx().k === "ins" && /Вставити/.test(document.getElementById("actTxt").textContent)));
  await p.evaluate(() => { const h = MONGame.hold; h.on = true; h.ctx = "ins"; MONGame.sim(1.2); });
  const midIns = await p.evaluate(() => MONGame.G.ins.length);
  await p.evaluate(() => { const h = MONGame.hold; h.on = true; h.ctx = "ins"; MONGame.sim(1.6); h.on = false; });
  const ins1 = await p.evaluate(() => ({ ins: MONGame.G.ins.length, hold: MONGame.G.hold.me || null, chip: document.getElementById("fuseChip").textContent }));
  check("утримав 2,5 с — запобіжник у щитку, лічильник 1/3", midIns === 0 && ins1.ins === 1 && !ins1.hold && ins1.chip.includes("1/3"), JSON.stringify(ins1));
  // слух: біг поруч зі спиною монстра
  await p.evaluate(() => { const g = MONGame, m = g.mon, pl = g.player; const [x, z] = [pl.x, pl.z];
    // монстр за 3 м, дивиться в інший бік; гравець «біжить» без ліхтаря
    m.state = "patrol"; m.path = null; m.x = x + 3; m.z = z; m.look = m.yaw = 0; m.hearCd = 0; pl.lightOn = false; });
  await p.keyboard.down("a"); await p.evaluate(() => MONGame.sim(0.4)); await p.keyboard.up("a");   // тікає від монстра — але гучно
  const hs = await p.evaluate(() => MONGame.mon.state);
  check("монстр чує біг за спиною", ["hear", "chase", "look"].includes(hs), hs);   // look — дійшов до місця шуму й роззирається
  // присів — тихо
  await p.evaluate(() => { const g = MONGame, m = g.mon, pl = g.player; m.state = "patrol"; m.path = null; m.hearCd = 0; m.x = pl.x + 2.5; m.z = pl.z; m.look = m.yaw = 0; pl.crouch = 1; });
  const silent = await p.evaluate(() => { const g = MONGame, m = g.mon, pl = g.player; return !g.monSees(m, pl); });
  check("присів і без ліхтаря — монстр, що дивиться вбік, не бачить", silent);
  await park(p);
  await p.evaluate(() => { MONGame.player.crouch = 0; MONGame.player.vx = MONGame.player.vz = 0; });
  // світло в обличчя (з 6 м: так далеко ліхтар видно лише, якщо світиш на монстра)
  await p.evaluate(() => { const pl = MONGame.player; pl.lightOn = true; pl.battery = 90; MONGame.mon.state = "patrol"; MONGame.mon.path = null; });
  const glare = await p.evaluate(() => { const g = MONGame, m = g.mon, pl = g.player;
    // знайти напрям, де між гравцем і монстром нема стін
    for (let a = 0; a < 6.28; a += 0.3) { const x = pl.x + Math.sin(a) * 6, z = pl.z + Math.cos(a) * 6; m.x = x; m.z = z; m.look = m.yaw = a; pl.yaw = a; if (g.sees({ x: x, z: z, look: a + Math.PI, sight: 9, state: "patrol" }, Object.assign({}, pl, { lightOn: false, crouch: 0, down: false, escaped: false, hidden: -1, out: false }))) return a; } return null; });
  await p.evaluate(() => MONGame.sim(0.8));
  const gs = await p.evaluate(() => ({ st: MONGame.mon.state, glare: MONGame.mon.glare }));
  check("світиш ліхтарем монстру в обличчя — він помічає й женеться", glare !== null && gs.st === "chase", JSON.stringify(gs));
  // засліпити: монстр за 4,5 м дивиться на мене (і біжить до мене), світю йому в очі ~0,9 с
  await park(p);
  const bl = await p.evaluate(() => { const g = MONGame, m = g.mon, pl = g.player;
    for (let a = 0; a < 6.28; a += 0.3) { const x = pl.x + Math.sin(a) * 4.5, z = pl.z + Math.cos(a) * 4.5; if (!g.sees({ x, z, look: a + Math.PI, sight: 9, state: "patrol" }, Object.assign({}, pl, { lightOn: false, crouch: 0, down: false, escaped: false, hidden: -1, out: false }))) continue;
      m.x = x; m.z = z; m.look = m.yaw = a + Math.PI; pl.yaw = a; pl.lightOn = true; pl.battery = 90; m.state = "patrol"; m.path = null; g.sim(1.3); return { st: m.state, bl: g.G.bl }; } return null; });
  check("світив в очі зблизька ~1 с — монстр засліплений", bl && bl.st === "blind" && bl.bl === 1, JSON.stringify(bl));
  const after = await p.evaluate(() => { MONGame.player.lightOn = false; MONGame.sim(2.75); const st = MONGame.mon.state; MONGame.mon.state = "sleep"; MONGame.mon.path = null; return st; });   // далі сам підбіг би й збив
  check("через 3 с монстр знову бачить", after !== "blind", after);
  await park(p);
  const imm = await p.evaluate(() => { const g = MONGame, m = g.mon, pl = g.player; pl.lightOn = true; m.look = m.yaw = Math.atan2(pl.x - m.x, pl.z - m.z); pl.yaw = Math.atan2(m.x - pl.x, m.z - pl.z); g.sim(1.5); return g.G.bl; });
  check("одразу вдруге не засліпити (імунітет 12 с)", imm === 1, String(imm));
  await p.evaluate(() => { MONGame.player.lightOn = false; });
  // беру ще запобіжник — упаде, коли мене зіб'ють
  const f2 = await p.evaluate(() => { const g = MONGame, it = g.items.find((i) => i.kind === "f" && !g.G.ins.includes(i.id)); g.player.x = it.x; g.player.z = it.z; g.sim(0.2); return g.G.hold.me; });
  // сховатись у шафі на очах у монстра → витягує → падіння
  const hideAt = await p.evaluate(() => { const g = MONGame, h = g.hides[0], pl = g.player; pl.x = h.ex; pl.z = h.ez; pl.vx = pl.vz = 0; return g.actCtx() && g.actCtx().k; });
  check("біля шафи/ліжка — кнопка «Сховатись»", hideAt === "hide", hideAt);
  await park(p);
  await p.waitForTimeout(200);
  await p.tap("#act"); await p.waitForTimeout(300);
  const hid = await p.evaluate(() => ({ h: MONGame.player.hidden, sees: MONGame.monSees(Object.assign({}, MONGame.mon, { look: 0, sight: 9 }), MONGame.player), btn: document.getElementById("actTxt").textContent }));
  check("сховався: монстр не бачить, кнопка «Вилізти»", hid.h >= 0 && !hid.sees && /Вилізти/.test(hid.btn), JSON.stringify(hid));
  await p.tap("#act"); await p.waitForTimeout(300);
  check("вилізти зі схованки", await p.evaluate(() => MONGame.player.hidden === -1));
  // тепер ховаюсь, коли монстр женеться й бачить
  await p.evaluate(() => { const g = MONGame, h = g.hides[0], pl = g.player, m = g.mon; pl.x = h.ex; pl.z = h.ez; m.x = h.ex + 0.8; m.z = h.ez + 0.8; const ok = g.astar(m.x, m.z, h.ex, h.ez); m.state = "chase"; m.target = pl; m.lostT = 0; m.lastSeen = [pl.x, pl.z]; m.path = null; pl.hidePrev = null; });
  await p.evaluate(() => { const c = MONGame.actCtx(); if (c && c.k === "hide") document.getElementById("act").dispatchEvent(new PointerEvent("pointerdown", { pointerId: 9, bubbles: true })); });
  const pulled = await until(() => p.evaluate(() => MONGame.player.down), 8000);
  check("сховався на очах у монстра — витягнув і збив", !!pulled);
  const dropped = await p.evaluate((id) => { const g = MONGame, it = g.items.find((i) => i.id === id); g.sim(0.1); return { drop: g.G.drop[id], hold: g.G.hold.me || null, vis: !it.gone, near: Math.hypot(it.x - g.player.x, it.z - g.player.z) }; }, f2);
  check("збили з запобіжником — він упав на підлогу поруч", !!f2 && !!dropped.drop && !dropped.hold && dropped.vis && dropped.near < 0.5, JSON.stringify(dropped));
  check("збитий: кнопка «Підвестись · тримай»", await p.evaluate(() => /Підвестись/.test(document.getElementById("actTxt").textContent)));
  // підвестись самому: утримання 5 с, коли монстр далеко
  await p.evaluate(() => { const m = MONGame.mon, pl = MONGame.player; m.state = "sleep"; m.path = null; m.vx = m.vz = 0; m.x = pl.x + 9; m.z = pl.z; });
  let tp = await touches(p); const ac = await center(p, "#act");
  await tp("touchStart", [{ x: ac.x, y: ac.y, id: 5 }]); await p.waitForTimeout(200);
  await p.evaluate(() => MONGame.sim(3)); const mid = await p.evaluate(() => MONGame.hold.p);
  const up = await until(() => p.evaluate(() => { MONGame.sim(0.5); return !MONGame.player.down; }), 15000);
  await tp("touchEnd", []);
  check("утримав «Підвестись» ~5 с — на ногах, самопідйом використано", mid > 0.3 && !!up && (await p.evaluate(() => MONGame.player.selfUsed)), `прогрес на 3 с: ${mid.toFixed(2)}`);
  // решту запобіжників (і той, що впав) — у щиток; перший раз перевіряю, що монстр чує щиток
  await park(p);
  let heardBox = null;
  for (const id of await p.evaluate(() => MONGame.items.filter((i) => i.kind === "f" && !MONGame.G.ins.includes(i.id)).map((i) => i.id))) {
    await p.evaluate((id) => { const g = MONGame, it = g.items.find((i) => i.id === id); g.player.x = it.x; g.player.z = it.z; g.sim(0.2); g.player.x = g.box.x; g.player.z = g.box.z; g.sim(0.1); }, id);
    if (heardBox === null) heardBox = await p.evaluate(() => { const g = MONGame, m = g.mon, x = g.box.x, z = g.box.z;
      let w = null; for (let a = 0; a < 6.28 && !w; a += 0.4) { const q = g.snap(x + Math.sin(a) * 5, z + Math.cos(a) * 5), d = Math.hypot(q[0] - x, q[1] - z); if (d > 4 && d < 6.5) w = q; }
      m.x = w[0]; m.z = w[1]; m.state = "patrol"; m.path = null; m.hearCd = 0;
      const h = g.hold; h.on = true; h.ctx = "ins"; g.sim(0.2); const st = m.state; m.state = "sleep"; m.path = null; return st + " " + Math.hypot(w[0] - x, w[1] - z).toFixed(1); });
    await p.evaluate(() => { const h = MONGame.hold; h.on = true; h.ctx = "ins"; MONGame.sim(2.8); h.on = false; });
  }
  check("вставляєш у щиток — монстр чує здалеку", /^hear/.test(heardBox), heardBox);
  const op = await p.evaluate(() => ({ op: MONGame.G.op, chip: document.getElementById("fuseChip").textContent }));
  check("усі запобіжники → вихід відчинено", op.op === 1 && /Вихід/.test(op.chip), JSON.stringify(op));
  await p.screenshot({ path: __dirname + "/out/monster-exit-open.png" });
  await p.evaluate(() => { const g = MONGame; g.player.x = g.exit.ix; g.player.z = g.exit.iz; });
  const end = await until(() => p.evaluate(() => MONGame.phase === "end" && MONGame.G.res), 6000);
  await p.waitForTimeout(1800);
  const card = await p.evaluate(() => ({ t: document.getElementById("ovTitle").textContent, lvl: MONGame.level, btn: document.getElementById("ovBtn").textContent }));
  check("дійшов до дверей — втік, перемога, рівень 2", end === "win" && card.lvl === 2 && /Далі/.test(card.btn), JSON.stringify(card));
  // поразка: збили вдруге без самопідйому
  await p.click("#ovBtn"); await until(() => p.evaluate(() => MONGame.phase === "play"), 70000);
  await p.evaluate(() => { const g = MONGame; g.G.sr.push("me"); g.knock(g.player); });
  const lost = await until(() => p.evaluate(() => MONGame.phase === "end" && MONGame.G.res), 6000);
  check("збили, а самопідйому вже нема — поразка", lost === "lose", lost);
  // лежиш 45 с — вибув
  await p.click("#ovBtn"); await until(() => p.evaluate(() => MONGame.phase === "play"), 70000);
  await p.evaluate(() => { const g = MONGame; g.knock(g.player); g.mon.state = "sleep"; });
  await p.waitForTimeout(300);
  await p.evaluate(() => MONGame.sim(46));
  check("лежиш 45 с без допомоги — гра закінчується", await p.evaluate(() => MONGame.phase === "end" && MONGame.G.res === "lose"));
  const soloErr = p.errors.filter((e) => !/vibrate/.test(e));
  await p.context().close();

  // ================= МУЛЬТИТАЧ =================
  p = await solo(b, 1);
  await until(() => p.evaluate(() => MONGame.phase === "play"), 70000); await p.waitForTimeout(300);
  await p.evaluate(() => { MONGame.mon.state = "sleep"; });
  const T = await touches(p), j0 = { x: 110, y: 560, id: 1 };
  await T("touchStart", [j0]); await T("touchMove", [{ ...j0, x: 160 }]); await p.waitForTimeout(250);
  const lb = await center(p, "#light"), l0 = await p.evaluate(() => MONGame.player.lightOn);
  await T("touchStart", [{ ...j0, x: 160 }, { x: lb.x, y: lb.y, id: 2 }]); await p.waitForTimeout(80); await T("touchMove", [{ ...j0, x: 160 }]); await p.waitForTimeout(200);   // відпустити лише кнопку
  const l1 = await p.evaluate(() => ({ on: MONGame.player.lightOn, vx: MONGame.player.vx }));
  check("тримаєш джойстик і тиснеш «Ліхтар» — спрацювало", l1.on !== l0, JSON.stringify(l1));
  await T("touchMove", [{ ...j0, x: 40 }]); await p.waitForTimeout(250);   // назад, звідки прийшов (праворуч уже може бути стіна)
  check("джойстик після другого пальця далі веде", (await p.evaluate(() => MONGame.player.vx)) < -1);
  const cb = await center(p, "#crouch");
  await T("touchStart", [{ ...j0, x: 40 }, { x: cb.x, y: cb.y, id: 3 }]); await p.waitForTimeout(80); await T("touchMove", [{ ...j0, x: 40 }]); await p.waitForTimeout(150);
  check("«Присісти» другим пальцем", await p.evaluate(() => document.getElementById("crouch").getAttribute("aria-pressed") === "true"));
  await T("touchEnd", []);
  const mtErr = p.errors.filter((e) => !/vibrate/.test(e));
  await p.context().close();

  // ================= МЕРЕЖА =================
  const A = await phone(b, null), B = await phone(b, null);
  for (const [pg, n] of [[A, "Влад"], [B, "Марʼяна"]]) { await pg.goto(URL_); await pg.waitForTimeout(1500); await pg.click("#mpOpen"); await pg.fill("#nick", n); }
  await A.click("#mpCreate"); await A.waitForTimeout(1500);
  const code = (await A.textContent("#roomCode")).trim();
  await B.fill("#codeIn", code); await B.click("#mpJoinBtn"); await B.waitForTimeout(2500);
  check("лобі: хост бачить обох", (await A.evaluate(() => document.querySelectorAll("#plist li").length)) === 2);
  await A.click("#mpStart");
  await until(async () => (await A.evaluate(() => MONGame.phase)) === "play" && (await B.evaluate(() => MONGame.phase)) === "play", 40000);
  const sa = await A.evaluate(() => JSON.stringify([MONGame.items.map((i) => [i.id, i.x, i.z]), MONGame.exit.ix, MONGame.exit.iz, MONGame.chars.length]));
  const sb = await B.evaluate(() => JSON.stringify([MONGame.items.map((i) => [i.id, i.x, i.z]), MONGame.exit.ix, MONGame.exit.iz, MONGame.chars.length]));
  check("у обох однакові речі, вихід і 2 гравці", sa === sb && JSON.parse(sa)[3] === 2);
  await A.evaluate(() => { MONGame.mon.state = "sleep"; });
  // B іде — A бачить
  const bp = await B.evaluate(() => { const pl = MONGame.player, [x, z] = [pl.x + 1.5, pl.z]; pl.x = x; return [pl.x, pl.z]; });
  const seenB = await until(() => A.evaluate((bp) => { const c = MONGame.chars.find((c) => !c.isPlayer); return Math.hypot(c.x - bp[0], c.z - bp[1]) < 0.3; }, bp), 6000);
  check("хост бачить, де гравець 2", !!seenB);
  // монстр у хоста рухається — у гравця 2 теж
  await A.evaluate(() => { const m = MONGame.mon; m.x += 2; });
  const mm = await until(async () => { const a = await A.evaluate(() => [MONGame.mon.x, MONGame.mon.z]); const bm = await B.evaluate(() => [MONGame.mon.x, MONGame.mon.z]); return Math.hypot(a[0] - bm[0], a[1] - bm[1]) < 0.3; }, 6000);
  check("монстр однаковий на обох телефонах", !!mm);
  // B підбирає запобіжник → у хоста зараховано
  const fid = await B.evaluate(() => { const it = MONGame.items.find((i) => i.kind === "f"); MONGame.player.x = it.x; MONGame.player.z = it.z; return it.id; });
  const gotA = await until(() => A.evaluate((id) => { const c = MONGame.chars.find((c) => !c.isPlayer); return MONGame.G.hold[c.id] === id && c.mdl.carry.visible; }, fid), 6000);
  check("гравець 2 підібрав 🔌 — хост бачить його в руках", !!gotA);
  // монстр збиває B (хост вирішує) → у B впав
  await B.evaluate(() => { const pl = MONGame.player, h = MONGame.hides[0]; pl.x = h.ex; pl.z = h.ez; });
  await A.waitForTimeout(500);
  await A.evaluate(() => { const g = MONGame, c = g.chars.find((c) => !c.isPlayer); g.knock(c); g.mon.state = "sleep"; g.mon.path = null; });
  const bDown = await until(() => B.evaluate(() => MONGame.player.down), 6000);
  check("хост: монстр збив гравця 2 — у нього «Тебе збили»", !!bDown);
  const dropB = await until(() => B.evaluate((id) => { const it = MONGame.items.find((i) => i.id === id); return !it.gone && !MONGame.G.hold[MONGame.player.id]; }, fid), 6000);
  check("його запобіжник упав — у нього на екрані знову лежить", !!dropB);
  // A підходить і тримає «Підняти»
  await A.evaluate(() => { const g = MONGame, c = g.chars.find((c) => !c.isPlayer); g.player.x = c.x + 0.5; g.player.z = c.z; });
  await A.waitForTimeout(400);
  const ctxA = await A.evaluate(() => MONGame.actCtx() && MONGame.actCtx().k);
  check("біля збитого друга — «Підняти»", ctxA === "rev", ctxA);
  const TA = await touches(A), aa = await center(A, "#act");
  await TA("touchStart", [{ x: aa.x, y: aa.y, id: 4 }]);
  const bUp = await until(async () => { await A.evaluate(() => MONGame.sim(0.4)); return B.evaluate(() => !MONGame.player.down); }, 20000);
  await TA("touchEnd", []);
  check("утримав «Підняти» — друг на ногах (у його телефоні)", !!bUp && !(await B.evaluate(() => MONGame.player.selfUsed)));
  await A.screenshot({ path: __dirname + "/out/monster-mp-host.png" }); await B.screenshot({ path: __dirname + "/out/monster-mp-guest.png" });
  const botErr = [A, B].flatMap((x) => x.errors);
  await A.context().close(); await B.context().close();

  // ================= ГРАВЕЦЬ-МОНСТР =================
  const C = await phone(b, null), D = await phone(b, null);
  for (const [pg, n] of [[C, "Оля"], [D, "Тарас"]]) { await pg.goto(URL_); await pg.waitForTimeout(1500); await pg.click("#mpOpen"); await pg.fill("#nick", n); }
  await C.click("#mpCreate"); await C.waitForTimeout(1500);
  const code2 = (await C.textContent("#roomCode")).trim();
  await D.fill("#codeIn", code2); await D.click("#mpJoinBtn"); await D.waitForTimeout(2500);
  await C.selectOption("#monSel", "player"); await C.click("#mpStart");
  await until(async () => (await C.evaluate(() => MONGame.phase)) === "play" && (await D.evaluate(() => MONGame.phase)) === "play", 40000);
  const cmon = await C.evaluate(() => MONGame.G.mm === MONGame.MP.me);
  const [M, S] = cmon ? [C, D] : [D, C];
  const mv = await M.evaluate(() => ({ dash: !document.getElementById("dash").hidden, light: !document.getElementById("light").hidden, chars: MONGame.chars.length, pl: !!MONGame.player }));
  const sv = await S.evaluate(() => ({ chars: MONGame.chars.length, me: !!MONGame.player, light: !document.getElementById("light").hidden }));
  check("гравець-монстр: у нього «Ривок», без ліхтаря; у вцілілого — звичайна гра", mv.dash && !mv.light && !mv.pl && mv.chars === 1 && sv.me && sv.light, JSON.stringify([mv, sv]));
  await M.tap("#dash"); await M.waitForTimeout(150);
  check("«Ривок» спрацював", await M.evaluate(() => MONGame.dashT > 0));
  // монстр іде — вцілілий бачить, де він
  const mp0 = await M.evaluate(() => { const m = MONGame.mon, h = MONGame.hides[0]; m.x = h.ex + 1.2; m.z = h.ez; return [m.x, m.z]; });
  check("вцілілий бачить, куди йде гравець-монстр", !!(await until(async () => { const q = await M.evaluate(() => [MONGame.mon.x, MONGame.mon.z]); return Math.hypot(q[0] - mp0[0], q[1] - mp0[1]) < 2 && S.evaluate((q) => Math.hypot(MONGame.mon.x - q[0], MONGame.mon.z - q[1]) < 0.3, q); }, 8000)));
  // засліпити гравця-монстра: стоять лицем одне до одного за ~2,5 м
  const pair = await S.evaluate(() => { const g = MONGame, pl = g.player; for (let a = 0; a < 6.28; a += 0.3) { const x = pl.x + Math.sin(a) * 2.5, z = pl.z + Math.cos(a) * 2.5;
      if (g.sees({ x, z, look: a + Math.PI, sight: 9, state: "patrol" }, Object.assign({}, pl, { lightOn: false, crouch: 0, down: false, escaped: false, hidden: -1, out: false }))) { pl.yaw = a; pl.lightOn = true; pl.battery = 90; return [x, z, a + Math.PI]; } } return null; });
  await M.evaluate((q) => { const m = MONGame.mon; m.x = q[0]; m.z = q[1]; m.yaw = m.look = q[2]; m.vx = m.vz = 0; }, pair);
  const blinded = await until(() => M.evaluate(() => MONGame.blindT > 0 && Number(getComputedStyle(document.getElementById("blind")).opacity) > 0.3), 25000);
  check("вцілілий засліпив гравця-монстра — у нього білий екран", !!blinded);
  await S.evaluate(() => { MONGame.player.lightOn = false; });
  // ховаюсь у шафу — монстр відчиняє — збиває
  await S.evaluate(() => { const g = MONGame, h = g.hides[0]; g.player.x = h.ex; g.player.z = h.ez; });
  await S.waitForTimeout(300);
  await S.evaluate(() => { const c = MONGame.actCtx(); if (c && c.k === "hide") document.getElementById("act").dispatchEvent(new PointerEvent("pointerdown", { pointerId: 9, bubbles: true })); });
  await until(() => M.evaluate(() => MONGame.chars[0].hidden === 0), 8000);
  await until(() => M.evaluate(() => MONGame.blindT <= 0), 20000);
  await M.evaluate(() => { const g = MONGame, h = g.hides[0]; g.mon.x = h.ex; g.mon.z = h.ez; });
  await M.waitForTimeout(400);
  const chkCtx = await M.evaluate(() => MONGame.actCtx() && MONGame.actCtx().k);
  check("гравець-монстр біля шафи — «Відчинити»", chkCtx === "chk", chkCtx);
  await M.tap("#act");
  check("відчинив шафу, де сховався вцілілий, — той збитий", !!(await until(() => S.evaluate(() => MONGame.player.down && MONGame.player.hidden === -1), 10000)));
  // підвівся сам — монстр торкається — знову збитий
  await M.evaluate(() => { const g = MONGame, m = g.mon; m.x += 6; });
  await until(() => S.evaluate(() => Math.hypot(MONGame.mon.x - MONGame.player.x, MONGame.mon.z - MONGame.player.z) > 5), 8000);
  await until(() => S.evaluate(() => { const h = MONGame.hold; h.on = true; h.ctx = "self"; MONGame.sim(0.6); return !MONGame.player.down; }), 25000);
  await S.waitForTimeout(3000);   // кулдаун удару в хоста
  const sp = await S.evaluate(() => [MONGame.player.x, MONGame.player.z]);
  await M.evaluate((q) => { const m = MONGame.mon; m.x = q[0] + 0.3; m.z = q[1]; }, sp);
  check("гравець-монстр торкнувся — вцілілий збитий", !!(await until(() => S.evaluate(() => MONGame.player.down), 10000)));
  await M.screenshot({ path: __dirname + "/out/monster-pmon.png" });
  const errs = soloErr.concat(mtErr, botErr, [C, D].flatMap((x) => x.errors)).filter((e) => !/vibrate/.test(e));
  check("без JS-помилок", !errs.length, errs.slice(0, 3).join(" | "));
  await b.close();
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
})();
