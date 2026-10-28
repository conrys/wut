// Тихо-голосно: соло (лялька, вибування, поблажка, укриття, поштовх на «червоне», фініш, раунди), мультитач, мережа двома телефонами.
// node redlight-test.js   (симулятор має бути запущений: node server.js)
const { launch, phone, BASE } = require("./harness");
const URL_ = BASE + "/ads/redlight/play.html";
const results = [];
function check(name, ok, extra) { results.push(ok); console.log(`${ok ? "✅" : "❌"} ${name}${extra ? " — " + extra : ""}`); }
const until = async (fn, ms = 30000) => { const end = Date.now() + ms; while (Date.now() < end) { const r = await fn(); if (r) return r; await new Promise((x) => setTimeout(x, 300)); } return null; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function center(p, sel) { return p.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, sel); }
// «завмерти»: бот стоїть, поки його не штовхнуть
const SPOT = `(() => { const g = RLGame; for (const z of [22, 24, 20, 26, 18]) for (const x of [2.2, 11.8, 4, 10, 7]) if (g.seen(x, z) && g.seen(x, z - 1.5)) return [x, z]; return [2.2, 22]; })()`;
const FREEZE = `for (const c of RLGame.chars) if (c.kind === "bot") { c.go = false; c.want = false; c.goAt = 1e15; c.vx = c.vz = 0; c.dlN = RLGame.G.dlN; }`;

(async () => {
  const b = await launch();
  let p = await phone(b, null, { lite: true });
  await p.goto(URL_); await p.waitForTimeout(2500);
  check("меню: на заставці боти грають самі", await p.evaluate(() => RLGame.phase === "menu" && RLGame.chars.length === 7 && RLGame.world.def.arena === 1));
  const maps = await p.evaluate(() => RLGame.MAPIDS.map((mi) => { RLGame.buildWorld(mi, 1); return [RLGame.world.def.id, RLGame.world.tallBoxes.length, RLGame.FIN, RLGame.START]; }));
  check("дві арени (Спортзал, Двір) з укриттями", maps.length === 2 && maps.every((m) => m[1] >= 6), JSON.stringify(maps));
  await p.click("#ovSolo");
  await until(() => p.evaluate(() => RLGame.phase === "intro"), 20000);
  const st = await p.evaluate(() => ({ n: RLGame.chars.length, behind: RLGame.chars.every((c) => c.z > RLGame.START) }));
  check("соло: я + 5 ботів, усі за стартовою лінією", st.n === 6 && st.behind, JSON.stringify(st));
  await p.evaluate(() => RLGame.sim(4.5));
  check("відлік → гра", await p.evaluate(() => RLGame.phase === "play"));

  // ---- цілий раунд ботів (я «відсутній»)
  const full = await p.evaluate(() => { const g = RLGame, me = g.player; me.gone = true; const n0 = g.G.dlN; for (let t = 0; t < 75 && g.G.ph === "play"; t += 0.5) g.sim(0.5); me.gone = false;
    return { fin: g.G.fin.length, out: g.G.out.length, turns: g.G.dlN - n0, pts: g.G.fin.map((id) => g.G.rs[id]), ph: g.G.ph }; });
  check("лялька весь раунд перемикається (зелене/червоне/обманки)", full.turns >= 6, `змін стану: ${full.turns}`);
  check("боти дійшли до фінішу або вибули", full.fin + full.out === 5 && full.fin >= 2, `🏁 ${full.fin} 💀 ${full.out}`);
  check("бали за місце: 5, 3, 2, далі 1", JSON.stringify(full.pts.slice(0, 4)) === JSON.stringify([5, 3, 2, 1].slice(0, Math.min(4, full.fin))), JSON.stringify(full.pts));
  check("раунд скінчився — показ результатів", full.ph === "end");

  // ---- новий раунд для перевірок гравця
  async function freshRound() { await p.evaluate(() => { RLGame.startSolo(5); RLGame.sim(4.5); }); await p.evaluate(FREEZE); }
  await freshRound();
  // рух на «червоне» після поблажки — вибув
  await p.evaluate((S) => { const g = RLGame, me = g.player, [x, z] = eval(S); me.x = x; me.z = z; g.setDl("r", 6000); g.sim(0.05); }, SPOT);
  await wait(450);
  await p.evaluate(() => { const g = RLGame; g.keys.w = true; g.sim(0.3); g.keys.w = false; });
  check("🔴 ворухнувся, коли лялька дивиться, — вибув", await p.evaluate(() => RLGame.player.out && RLGame.G.out.includes("me")));
  await freshRound();
  // стоїш — живий
  await p.evaluate((S) => { const g = RLGame, me = g.player, [x, z] = eval(S); me.x = x; me.z = z; me.vx = me.vz = 0; g.setDl("r", 6000); g.sim(0.05); }, SPOT);
  await wait(450);
  await p.evaluate(() => RLGame.sim(1.5));
  check("🔴 стоїш нерухомо — живий", await p.evaluate(() => !RLGame.player.out));
  // поблажка: зупинився в перші 0,25 с — не вибув
  await p.evaluate(() => { const g = RLGame; g.setDl("g", 5000); g.sim(0.05); g.keys.w = true; g.sim(0.4); g.setDl("t", 350); g.sim(0.05); g.keys.w = false; g.sim(0.45); });
  await wait(450); await p.evaluate(() => RLGame.sim(0.3));
  check("відпустив, щойно лялька почала обертатись, — поблажка, живий", await p.evaluate(() => !RLGame.player.out));
  // за укриттям — можна рухатись
  const hid = await p.evaluate(() => { const g = RLGame; const box = g.world.tallBoxes.slice().sort((a, b) => b[1] - a[1])[2]; const me = g.player;
    me.x = (box[0] + box[2]) / 2; me.z = box[3] + 0.45; me.vx = me.vz = 0; g.setDl("r", 6000); g.sim(0.05); return !g.seen(me.x, me.z); });
  await wait(450);
  await p.evaluate(() => { const g = RLGame; g.keys.a = true; g.sim(0.12); g.keys.a = false; g.sim(0.3); });   // крок уздовж ящика — лишаєшся в укритті
  check("🫣 за високим ящиком лялька не бачить — рух не карається", hid && (await p.evaluate(() => !RLGame.player.out)));
  const far = await p.evaluate(() => { const g = RLGame, box = g.world.tallBoxes.slice().sort((a, b) => b[1] - a[1])[2], x = (box[0] + box[2]) / 2; return { near: g.seen(x, box[3] + 0.6), far: g.seen(x, box[3] + 2.5) }; });
  check("відійшов від ящика на 2,5 м — лялька вже бачить (ховатись можна лише впритул)", !far.near && far.far, JSON.stringify(far));
  // поштовх на «червоне»: відкинутий бот вибуває
  await p.evaluate(() => { const g = RLGame, me = g.player, v = g.chars.find((c) => c.kind === "bot" && !c.out); window.__v = v.id; me.x = 4; me.z = 24; me.cdP = 0; me.stun = 0; me.vx = me.vz = 0;
    v.x = 4.9; v.z = 24; v.vx = v.vz = 0; v.kx = v.kz = 0; g.setDl("r", 8000); g.sim(0.05); });
  await p.evaluate(FREEZE); await wait(450);
  const push = await p.evaluate(() => { const g = RLGame, me = g.player, v = g.chr(window.__v); g.sim(0.1); const before = g.G.out.includes(v.id); me.yaw = Math.PI / 2; g.doPush(); g.sim(0.4); return { before, after: g.G.out.includes(v.id), seen: g.seen(v.x, v.z) }; });
  check("✋ штовхнув сусіда на «червоне» — він вибув", !push.before && push.after, JSON.stringify(push));
  // фініш
  await freshRound();
  const fin = await p.evaluate(() => { const g = RLGame, me = g.player; me.x = 7; me.z = g.FIN + 0.5; g.setDl("g", 5000); g.sim(0.05); g.keys.w = true; g.sim(0.6); g.keys.w = false;
    return { fin: g.G.fin.includes("me"), pts: g.G.rs.me, sc: g.G.sc.me }; });
  check("🏁 перетнув лінію першим — +5", fin.fin && fin.pts === 5, JSON.stringify(fin));
  // раунди: 1 → 2 → 3 → підсумок
  const rounds = await p.evaluate(() => { const g = RLGame, seen = []; for (let k = 0; k < 3; k++) { g.G.rem = 50; g.sim(0.2); seen.push(g.G.ph); if (g.G.ph === "end") { g.sim(6.5); seen.push("rd" + g.G.rd); g.sim(4.5); } } return seen; });
  check("три раунди й фінальний підсумок", JSON.stringify(rounds) === JSON.stringify(["end", "rd2", "end", "rd3", "over"]), rounds.join(" → "));
  const over = await until(() => p.evaluate(() => !document.getElementById("ov").hidden && document.getElementById("ovBtn").textContent === "Ще раз" && document.querySelectorAll("#scoreList li").length === 6), 6000);
  check("підсумок: таблиця й «Ще раз»", !!over);
  check("соло без JS-помилок", p.errors.length === 0, p.errors.slice(0, 3).join(" | "));
  await p.context().close();

  // ================= МУЛЬТИТАЧ =================
  p = await phone(b, null, { lite: true });
  await p.goto(URL_); await p.waitForTimeout(2000); await p.click("#ovSolo");
  await until(() => p.evaluate(() => RLGame.phase === "play"), 40000);
  await p.evaluate(() => { const g = RLGame; g.setDl("g", 60000); const me = g.player; me.x = 12.2; me.z = 30; });
  const cdp = await p.context().newCDPSession(p), send = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts });
  const j0 = { x: 150, y: 520, id: 1 };
  await send("touchStart", [j0]); await send("touchMove", [{ ...j0, y: 470 }]); await p.waitForTimeout(300);
  const pu = await center(p, "#push");
  await send("touchStart", [{ ...j0, y: 470 }, { x: pu.x, y: pu.y, id: 2 }]); await p.waitForTimeout(80); await send("touchEnd", [{ x: pu.x, y: pu.y, id: 2 }]); await p.waitForTimeout(250);
  const m1 = await p.evaluate(() => ({ cd: RLGame.player.cdP, vz: RLGame.player.vz }));
  check("біжиш джойстиком і тиснеш ✋ другим пальцем — спрацювало, біг не перервався", m1.cd > 0 && m1.vz < -1, JSON.stringify(m1));
  await send("touchEnd", [{ ...j0, y: 470 }]); await p.waitForTimeout(400);
  check("відпустив палець — завмер (швидкість < порогу)", await p.evaluate(() => Math.hypot(RLGame.player.vx, RLGame.player.vz) < 0.45));
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
  await until(async () => (await A.evaluate(() => RLGame.phase)) === "intro" && (await B.evaluate(() => RLGame.phase)) === "intro", 30000);
  const sa = await A.evaluate(() => RLGame.chars.map((c) => c.id + ":" + c.colI).join()), sb = await B.evaluate(() => RLGame.chars.map((c) => c.id + ":" + c.colI).join());
  check("в обох та сама арена й гравці (2 люди + 2 боти)", sa === sb && sa.split(",").length === 4, sa);
  await until(async () => (await A.evaluate(() => RLGame.phase)) === "play" && (await B.evaluate(() => RLGame.phase)) === "play", 30000);
  await A.evaluate(() => { RLGame.setDl("g", 60000); for (const c of RLGame.chars) if (c.kind === "bot") { c.go = false; c.want = false; c.goAt = 1e15; c.vx = c.vz = 0; c.dlN = RLGame.G.dlN; } });
  // гість добігає до фінішу на своєму телефоні — хост зараховує
  const bId = await B.evaluate(() => RLGame.player.id);
  await B.evaluate(() => { const g = RLGame, me = g.player; me.x = 7; me.z = g.FIN + 1.2; });
  await B.waitForTimeout(800);
  await B.evaluate(() => { RLGame.keys.w = true; }); await B.waitForTimeout(1200); await B.evaluate(() => { RLGame.keys.w = false; });
  const fin2 = await until(() => A.evaluate((id) => RLGame.G.fin.includes(id) && RLGame.G.rs[id] === 5, bId), 20000);
  check("гість перетнув фініш — у хоста +5 за перше місце", !!fin2);
  // хост: червоне; хост рухається — сам себе вибиває; лялька обертається в обох
  await A.evaluate((S) => { const me = RLGame.player, [x, z] = eval(S); me.x = x; me.z = z; RLGame.setDl("r", 8000); }, SPOT);
  const redB = await until(() => B.evaluate(() => RLGame.DL.s === "r"), 10000);
  check("гість бачить, що лялька обернулась (🔴)", !!redB);
  await A.waitForTimeout(600);
  await A.evaluate(() => { RLGame.keys.w = true; }); await A.waitForTimeout(500); await A.evaluate(() => { RLGame.keys.w = false; });
  const outA = await until(() => B.evaluate(() => RLGame.G.out.length === 1 && RLGame.chars.some((c) => c.out)), 15000);
  check("хост ворухнувся на «червоне» — вибув, гість це бачить 💀", !!outA);
  check("мережа без JS-помилок", A.errors.length === 0 && B.errors.length === 0, A.errors.concat(B.errors).slice(0, 3).join(" | "));
  await b.close();
  const bad = results.filter((r) => !r).length;
  console.log(bad ? `${bad} failed` : "all passed");
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
