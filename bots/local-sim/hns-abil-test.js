// Хованки: вміння (по одному випадковому на раунд) + 10 с на сховатись.
// node hns-abil-test.js   (симулятор має бути запущений)
const { launch, phone, BASE } = require("./harness");
const results = [];
function check(name, ok, extra) { results.push(ok); console.log(`${ok ? "✅" : "❌"} ${name}${extra ? " — " + extra : ""}`); }
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { const r = await fn(); if (r) return r; await new Promise((x) => setTimeout(x, 250)); } return null; };
const URL_ = BASE + "/ads/khovanky/play.html";
async function solo(b, lvl) {
  const p = await phone(b, null);
  await p.goto(URL_); await p.evaluate((l) => { localStorage.setItem("hns_level", String(l)); localStorage.setItem("hns_dark", "0"); }, lvl);
  await p.reload(); await p.waitForTimeout(1500); await p.click("#ovBtn"); await p.waitForTimeout(300);
  return p;
}
(async () => {
  await fetch(BASE + "/__mock/reset");
  const b = await launch();
  // ---- ховаєшся (рівень 1)
  let p = await solo(b, 1);
  const intro = await p.evaluate(() => ({ ph: HNSGame.phase, t: document.getElementById("timer").textContent }));
  check("на сховатись 10 с", intro.ph === "intro" && /0:(10|09)/.test(intro.t), JSON.stringify(intro));
  const ab0 = await p.evaluate(() => { const pl = HNSGame.player; return { ab: pl.ab, role: HNSGame.ABIL[pl.ab] && HNSGame.ABIL[pl.ab].role, seek: HNSGame.seeker.ab }; });
  check("усі отримали випадкове вміння своєї ролі", ab0.role === "hider" && !!ab0.seek, JSON.stringify(ab0));
  await until(() => p.evaluate(() => HNSGame.phase === "play"), 70000); await p.waitForTimeout(300);
  check("кнопка вміння з'явилась", await p.evaluate(() => !document.getElementById("abil").hidden && /·/.test(document.getElementById("abil").innerText)));
  await p.evaluate(() => { const s = HNSGame.seeker; s.state = "count"; s.path = null; HNSGame.player.caught = false; });   // шукач стоїть, поки перевіряємо вміння
  const H = async (k, fn) => p.evaluate(([k, src]) => { const g = HNSGame, pl = g.player; g.giveAbility(pl, k); pl.abCd = 0; const before = { u: pl.abUses }; const ok = g.useAbility(pl); return Object.assign({ ok, used: before.u - pl.abUses }, new Function("g", "pl", src)(g, pl)); }, [k, fn]);
  let r = await H("dash", "return {dash: pl.dashT>0}"); check("ривок", r.ok && r.dash, JSON.stringify(r));
  r = await H("invis", "const s=g.seeker; s.x=pl.x+2; s.z=pl.z; s.look=Math.atan2(pl.x-s.x,pl.z-s.z); return {invis: pl.invisT>0, seen: g.sees(s,pl)}");
  check("невидимість: шукач за 2 м не бачить", r.ok && r.invis && !r.seen, JSON.stringify(r));
  await p.evaluate(() => { HNSGame.player.invisT = 0; });
  r = await H("smoke", "const s=g.seeker; s.x=pl.x+2.6; s.z=pl.z; s.look=Math.atan2(pl.x-s.x,pl.z-s.z); return {n:g.smokes.length, seen:g.sees(s,pl)}");
  check("димова завіса: хмара є, крізь неї не видно", r.ok && r.n === 1 && !r.seen, JSON.stringify(r));
  r = await H("double", "return {n:g.doubles.length}"); await p.waitForTimeout(1200);
  const dm = await p.evaluate(() => { const d = HNSGame.doubles[0]; return d ? Math.hypot(d.x - HNSGame.player.x, d.z - HNSGame.player.z) : -1; });
  check("двійник зʼявився й тікає", r.ok && r.n === 1 && dm > 0.8, `відбіг на ${dm.toFixed(1)} м`);
  await p.evaluate(() => { const s = HNSGame.seeker; s.state = "patrol"; s.x = HNSGame.player.x + 8; });
  r = await H("lure", "const s=g.seeker; return {st:s.state, lure:!!pl.lure}");
  check("шум-приманка: бот-шукач іде глянути", r.ok && r.lure && r.st === "search", JSON.stringify(r));
  await p.screenshot({ path: __dirname + "/out/hns-abil-hide.png" });
  await p.context().close();

  // ---- шукаєш (рівень 2)
  p = await solo(b, 2);
  await until(() => p.evaluate(() => HNSGame.phase === "play"), 70000); await p.waitForTimeout(300);
  r = await H("radar", "return {r:pl.radarT>0}"); check("радар", r.ok && r.r);
  r = await H("spot", "return {range:pl.range}"); await p.waitForTimeout(200);
  const sp = await p.evaluate(() => ({ range: HNSGame.player.range, base: HNSGame.player.baseRange }));
  check("прожектор: ліхтар далі", r.ok && sp.range > sp.base * 1.4, JSON.stringify(sp));
  r = await H("sprint", "return {s:pl.sprintT>0}"); check("спринт", r.ok && r.s);
  r = await H("trap", "return {n:g.traps.length}");
  const tr = await p.evaluate(() => { const t = HNSGame.traps[0], h = HNSGame.chars.find((c) => c.role === "hider" && !c.caught); h.x = t.x; h.z = t.z; return h.id || HNSGame.chars.indexOf(h); });
  await p.waitForTimeout(400);
  const st = await p.evaluate((i) => { const h = HNSGame.chars[i]; return { stuck: h.stuckT > 0, traps: HNSGame.traps.length }; }, tr);
  check("пастка: бот наступив → застряг, пастка зникла", r.ok && r.n === 1 && st.stuck && st.traps === 0, JSON.stringify(st));
  r = await H("sonar", "return {a:g.chars.filter(c=>c.role==='hider'&&c.achoo>0).length}"); check("сонар: хованці видали себе", r.ok && r.a >= 1, JSON.stringify(r));
  await p.screenshot({ path: __dirname + "/out/hns-abil-seek.png" });
  await p.context().close();

  // ---- мультиплеєр: дим і двійник хованця видно шукачу; пастка шукача ловить хованця
  const A = await phone(b, null), B = await phone(b, null);
  for (const [pg, n] of [[A, "Влад"], [B, "Оля"]]) { await pg.goto(URL_); await pg.waitForTimeout(1500); await pg.click("#mpOpen"); await pg.fill("#nick", n); }
  await A.click("#mpCreate"); await A.waitForTimeout(1500);
  const code = (await A.textContent("#roomCode")).trim();
  await B.fill("#codeIn", code); await B.click("#mpJoinBtn"); await B.waitForTimeout(2500);
  await A.click("#mpStart");
  await until(async () => (await A.evaluate(() => HNSGame.phase)) === "intro", 15000);
  const it = await A.evaluate(() => document.getElementById("timer").textContent);
  check("мультиплеєр: 10 с на сховатись", /0:(10|09|08)/.test(it), it);
  await until(async () => (await A.evaluate(() => HNSGame.phase)) === "play" && (await B.evaluate(() => HNSGame.phase)) === "play", 40000);
  const roleA = await A.evaluate(() => HNSGame.player.role);
  const [S, Hd] = roleA === "seeker" ? [A, B] : [B, A];
  await S.evaluate(() => { const g = HNSGame, pl = g.player; g.giveAbility(pl, "trap"); g.useAbility(pl); pl.x += 3; });
  const ht = await until(() => Hd.evaluate(() => HNSGame.traps.length === 1 && [HNSGame.traps[0].x, HNSGame.traps[0].z]), 8000);
  check("хованець бачить (ледь) пастку шукача", !!ht);
  if (ht) await Hd.evaluate(([x, z]) => { const pl = HNSGame.player; pl.x = x; pl.z = z; }, ht);
  const stuck = await until(() => Hd.evaluate(() => HNSGame.player.stuckT > 0), 5000);
  const sGone = await until(() => S.evaluate(() => HNSGame.traps.length === 0), 8000);
  check("хованець вскочив у пастку → застряг, у шукача пастка зникла", !!stuck && !!sGone);
  await Hd.evaluate(() => { const g = HNSGame, pl = g.player; g.giveAbility(pl, "smoke"); g.useAbility(pl); g.giveAbility(pl, "double"); g.useAbility(pl); });
  const seen = await until(() => S.evaluate(() => HNSGame.smokes.length >= 1 && HNSGame.doubles.length >= 1 && { s: HNSGame.smokes.length, d: HNSGame.doubles.length }), 8000);
  check("шукач бачить дим і двійника хованця", !!seen, JSON.stringify(seen));
  await S.evaluate(() => { const g = HNSGame, d = g.doubles[0], me = g.player; d.path = null; me.x = d.x; me.z = d.z; });
  const gone = await until(() => Hd.evaluate(() => HNSGame.doubles.length === 0), 8000);
  check("шукач спіймав двійника → у хованця він зник", !!gone);
  const errs = [A, B].flatMap((x) => x.errors).filter((e) => !/vibrate/.test(e));
  check("без JS-помилок", !errs.length, errs.slice(0, 3).join(" | "));
  await b.close();
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
})();
