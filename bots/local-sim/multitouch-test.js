// Мультитач: поки один палець тримає джойстик, другий натискає кнопки (Хованки, Перевтілення, Орда).
// Справжні дотики через CDP (Input.dispatchTouchEvent) — два пальці одночасно.
// node multitouch-test.js   (симулятор має бути запущений)
const { launch, phone, BASE } = require("./harness");
const results = [];
function check(name, ok, extra) { results.push(ok); console.log(`${ok ? "✅" : "❌"} ${name}${extra ? " — " + extra : ""}`); }
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { const r = await fn(); if (r) return r; await new Promise((x) => setTimeout(x, 250)); } return null; };
async function touches(p) {
  const cdp = await p.context().newCDPSession(p);
  const send = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts });
  return { send };
}
async function center(p, sel) { return p.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, sel); }
(async () => {
  const b = await launch();
  // ---- Хованки: джойстик + кнопка вміння другим пальцем
  let p = await phone(b, null);
  await p.goto(BASE + "/ads/khovanky/play.html"); await p.evaluate(() => { localStorage.setItem("hns_level", "1"); localStorage.setItem("hns_dark", "0"); });
  await p.reload(); await p.waitForTimeout(1500); await p.click("#ovBtn");
  await until(() => p.evaluate(() => HNSGame.phase === "play"), 70000); await p.waitForTimeout(300);
  await p.evaluate(() => { const g = HNSGame; g.seeker.state = "count"; g.giveAbility(g.player, "dash"); });
  let T = await touches(p);
  const j0 = { x: 120, y: 520, id: 1 };
  await T.send("touchStart", [j0]); await T.send("touchMove", [{ ...j0, x: 170 }]); await p.waitForTimeout(250);
  const ab = await center(p, "#abil");
  await T.send("touchStart", [{ ...j0, x: 170 }, { x: ab.x, y: ab.y, id: 2 }]); await p.waitForTimeout(80);
  await T.send("touchEnd", [{ ...j0, x: 170 }]); await p.waitForTimeout(250);
  const k = await p.evaluate(() => ({ cd: HNSGame.player.abCd, vx: HNSGame.player.vx }));
  check("Хованки: тримаєш джойстик і тиснеш вміння — спрацювало", k.cd > 4, JSON.stringify(k));
  await T.send("touchMove", [{ ...j0, x: 200 }]); await p.waitForTimeout(250);
  const v2 = await p.evaluate(() => HNSGame.player.vx);
  check("Хованки: джойстик після другого пальця далі працює", v2 > 1, `vx ${v2.toFixed(2)}`);
  const cr = await center(p, "#crouch");
  await T.send("touchStart", [{ ...j0, x: 200 }, { x: cr.x, y: cr.y, id: 3 }]); await p.waitForTimeout(80); await T.send("touchEnd", [{ ...j0, x: 200 }]); await p.waitForTimeout(150);
  check("Хованки: «Присісти» другим пальцем", await p.evaluate(() => document.getElementById("crouch").getAttribute("aria-pressed") === "true"));
  await T.send("touchEnd", []); await p.context().close();

  // ---- Перевтілення: джойстик + «Змінити» / «Обманка»
  p = await phone(b, null);
  await p.goto(BASE + "/ads/perevtilennia/play.html"); await p.evaluate(() => localStorage.setItem("ph_level", "1"));
  await p.reload(); await p.waitForTimeout(1500); await p.click("#ovBtn");
  await until(() => p.evaluate(() => HNS.phase === "play"), 70000); await p.waitForTimeout(400);
  T = await touches(p);
  await T.send("touchStart", [j0]); await T.send("touchMove", [{ ...j0, x: 170 }]); await p.waitForTimeout(250);
  const d0 = await p.evaluate(() => HNS.chars.find((c) => c.isPlayer).dis);
  const cb = await center(p, "#changeBtn");
  await T.send("touchStart", [{ ...j0, x: 170 }, { x: cb.x, y: cb.y, id: 2 }]); await p.waitForTimeout(80); await T.send("touchEnd", [{ ...j0, x: 170 }]); await p.waitForTimeout(200);
  const d1 = await p.evaluate(() => HNS.chars.find((c) => c.isPlayer).dis);
  check("Перевтілення: «Змінити» поки біжиш", d1 !== d0, `${d0} → ${d1}`);
  const db = await center(p, "#decoyBtn");
  await T.send("touchStart", [{ ...j0, x: 170 }, { x: db.x, y: db.y, id: 3 }]); await p.waitForTimeout(80); await T.send("touchEnd", [{ ...j0, x: 170 }]); await p.waitForTimeout(200);
  check("Перевтілення: «Обманка» поки біжиш", await p.evaluate(() => HNS.decoys.filter((d) => d.own).length === 1));
  await T.send("touchEnd", []); await p.context().close();

  // ---- Орда: джойстик + пауза другим пальцем
  p = await phone(b, null);
  await p.goto(BASE + "/horde.html"); await p.waitForTimeout(1500);
  await p.evaluate(() => document.getElementById("btnPlay").click()); await p.waitForTimeout(1200);
  T = await touches(p);
  await T.send("touchStart", [{ x: 190, y: 600, id: 1 }]); await T.send("touchMove", [{ x: 230, y: 600, id: 1 }]); await p.waitForTimeout(200);
  const pb = await center(p, "#pauseBtn");
  await T.send("touchStart", [{ x: 230, y: 600, id: 1 }, { x: pb.x, y: pb.y, id: 2 }]); await p.waitForTimeout(60);
  await T.send("touchEnd", [{ x: 230, y: 600, id: 1 }]); await p.waitForTimeout(300);
  check("Орда: пауза другим пальцем, поки тримаєш джойстик", await p.evaluate(() => !document.getElementById("scrPause").hidden));
  await T.send("touchEnd", []);
  const errs = p.errors.filter((e) => !/vibrate/.test(e));
  check("без JS-помилок", !errs.length, errs.slice(0, 2).join(" | "));
  await b.close();
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
})();
