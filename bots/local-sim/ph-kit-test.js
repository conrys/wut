// Перевтілення: «Змінити» з перезарядкою, обманки (−5 с шукачу), промах (−3 с), велика карта,
// мультиплеєр: обманки й штрафи в усіх, спостереження після того, як тебе облили.
// node ph-kit-test.js   (симулятор має бути запущений)
const { launch, phone, BASE } = require("./harness");
const results = [];
function check(name, ok, extra) { results.push(ok); console.log(`${ok ? "✅" : "❌"} ${name}${extra ? " — " + extra : ""}`); }
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { const r = await fn(); if (r) return r; await new Promise((x) => setTimeout(x, 250)); } return null; };
const URL_ = BASE + "/ads/perevtilennia/play.html";
async function solo(b, lvl) {
  const p = await phone(b, null);
  await p.goto(URL_); await p.evaluate((l) => localStorage.setItem("ph_level", String(l)), lvl);
  await p.reload(); await p.waitForTimeout(1500); await p.click("#ovBtn"); await p.waitForTimeout(500);
  await p.evaluate(() => { HNS.timer = HNS.timer; }); // no-op
  return p;
}
(async () => {
  await fetch(BASE + "/__mock/reset");
  const b = await launch();
  // ---- соло, ти предмет (рівень 1): змінити, обманка, бот-шукач бризкає в обманку
  let p = await solo(b, 1);
  await until(() => p.evaluate(() => HNS.phase === "play"), 70000); await p.waitForTimeout(300);
  const ui = await p.evaluate(() => ({ ch: !document.getElementById("changeBtn").hidden, dc: !document.getElementById("decoyBtn").hidden }));
  check("соло-предмет: кнопки «Змінити» й «Обманка» на місці", ui.ch && ui.dc);
  const d0 = await p.evaluate(() => HNS.chars.find((c) => c.isPlayer).dis);
  await p.click("#changeBtn"); await p.waitForTimeout(200);
  const r1 = await p.evaluate(() => { const pl = HNS.chars.find((c) => c.isPlayer); return { dis: pl.dis, cd: pl.changeT, label: document.getElementById("changeBtn").innerText }; });
  check("«Змінити»: інший предмет і перезарядка 20 с", r1.dis !== d0 && r1.cd > 19, `${d0}→${r1.dis}, ${r1.label.replace(/\n/g, " ")}`);
  await p.click("#changeBtn"); await p.waitForTimeout(150);
  check("під час перезарядки не міняє", await p.evaluate((d) => HNS.chars.find((c) => c.isPlayer).dis === d, r1.dis));
  await p.click("#decoyBtn"); await p.waitForTimeout(200);
  const dc = await p.evaluate(() => ({ n: HNS.decoys.length, left: HNS.chars.find((c) => c.isPlayer).decoysLeft, dis: HNS.decoys[0] && HNS.decoys[0].dis }));
  check("обманка поставлена, лишилось 1", dc.n === 1 && dc.left === 1, JSON.stringify(dc));
  const pen = await p.evaluate(() => { const s = HNS.seeker, d = HNS.decoys[0]; s.gunT = 0; const t0 = HNS.timer; HNS._shoot(s, d); return { dt: +(t0 - HNS.timer).toFixed(1), popped: d.popped }; });
  check("бот-шукач бризнув в обманку → вона лопнула, у шукача −5 с", pen.popped && pen.dt >= 4.9, JSON.stringify(pen));
  const miss = await p.evaluate(() => { const s = HNS.seeker; s.gunT = 0; s.look = s.yaw; const t0 = HNS.timer; HNS._shoot(s, null); return +(t0 - HNS.timer).toFixed(1); });
  check("промах бота-шукача: −3 с", miss >= 2.9, String(miss));
  await p.screenshot({ path: __dirname + "/out/ph-kit-hide.png" });
  await p.context().close();

  // ---- соло, ти шукач (рівень 2): обманки ботів, промах −3 с
  p = await solo(b, 2);
  await until(() => p.evaluate(() => HNS.phase === "play"), 70000);
  const bd = await p.evaluate(() => HNS.decoys.length);
  check("боти-предмети ставлять обманки", bd >= 1, `обманок ${bd}`);
  const sm = await p.evaluate(() => { const pl = HNS.chars.find((c) => c.isPlayer); pl.gunT = 0; const t0 = HNS.timer; HNS._shoot(pl, null); return +(t0 - HNS.timer).toFixed(1); });
  check("твій промах: −3 с", sm >= 2.9, String(sm));
  await p.context().close();

  // ---- велика карта
  p = await solo(b, 13);
  const mp = await p.evaluate(() => ({ map: HNS.map, name: HNSWorld.MAPS[HNS.map].name, w: HNSWorld.MW, h: HNSWorld.MH }));
  check("велика карта «Торговий центр»", mp.name === "Торговий центр" && mp.w === 34, JSON.stringify(mp));
  await p.waitForTimeout(1500); await p.screenshot({ path: __dirname + "/out/ph-mall.png" });
  await p.context().close();

  // ---- мультиплеєр: двоє + 1 бот
  const A = await phone(b, null), B = await phone(b, null);
  for (const [pg, n] of [[A, "Влад"], [B, "Оля"]]) { await pg.goto(URL_); await pg.waitForTimeout(1500); await pg.click("#mpOpen"); await pg.fill("#nick", n); }
  await A.click("#mpCreate"); await A.waitForTimeout(1500);
  const code = (await A.textContent("#roomCode")).trim();
  await B.fill("#codeIn", code); await B.click("#mpJoinBtn"); await B.waitForTimeout(2500);
  await A.evaluate(() => { document.getElementById("botSel") && (document.getElementById("botSel").value = "1"); });
  await A.click("#mpStart");
  await until(async () => (await A.evaluate(() => HNS.phase)) === "play" && (await B.evaluate(() => HNS.phase)) === "play", 30000);
  const roles = await Promise.all([A, B].map((pg) => pg.evaluate(() => HNS.mode)));
  const [S, H] = roles[0] === "seek" ? [A, B] : [B, A];
  check("мультиплеєр: раунд почався, ролі розподілені", roles.includes("seek") && roles.includes("hide"), roles.join(","));
  await H.evaluate(() => HNS.placeDecoy());
  const seen = (await until(() => S.evaluate(() => HNS.decoys.filter((d) => !/^b\d+:/.test(d.key)).length), 8000)) || 0;
  check("обманку хованця бачить шукач", seen === 1, `у шукача обманок ${seen}`);
  const t0 = await H.evaluate(() => HNS.timer);
  await S.evaluate(() => { const me = HNS.chars.find((c) => c.isPlayer), d = HNS.decoys.find((x) => !/^b\d+:/.test(x.key)); me.gunT = 0; HNS._shoot(me, d); });
  await H.waitForTimeout(2500);
  const after = await H.evaluate(() => ({ t: HNS.timer, popped: HNS.decoys.filter((d) => !/^b\d+:/.test(d.key)).every((d) => d.popped) }));
  check("шукач лопнув обманку → у хованця вона зникла, раунд коротший на ~5 с", after.popped && t0 - after.t >= 6.5, `${t0.toFixed(1)} → ${after.t.toFixed(1)} (2.5 с минуло)`);
  // шукач обливає хованця → у того спостереження
  await S.evaluate(() => { const me = HNS.chars.find((c) => c.isPlayer), h = HNS.chars.find((c) => c.role === "hider" && !c.isPlayer && c.nick); me.gunT = 0; HNS._shoot(me, h); });
  await until(() => H.evaluate(() => HNS.chars.find((c) => c.isPlayer).caught), 8000); await H.waitForTimeout(400);
  const sp = await H.evaluate(() => ({ caught: HNS.chars.find((c) => c.isPlayer).caught, bar: !document.getElementById("spec").hidden, name: document.getElementById("specName").textContent, t: HNS.spec.target() && HNS.spec.target().role }));
  check("облитий хованець бачить панель спостереження (спершу — шукач)", sp.caught && sp.bar && sp.t === "seeker", JSON.stringify(sp));
  await H.click("#specNext"); await H.waitForTimeout(300);
  const sp2 = await H.evaluate(() => document.getElementById("specName").textContent);
  check("◀ ▶ перемикає, за ким дивитись", sp2 !== sp.name, `${sp.name} → ${sp2}`);
  await H.screenshot({ path: __dirname + "/out/ph-spectate.png" });
  const errs = [A, B].flatMap((x) => x.errors).filter((e) => !/vibrate/.test(e));
  check("без JS-помилок", !errs.length, errs.slice(0, 3).join(" | "));
  await b.close();
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
})();
