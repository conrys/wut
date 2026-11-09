// DnD: сейви кампанії — авто на початку сцени й перед боєм, завантаження після поразки, хмара.
// node dnd-saves-test.js   (симулятор: node server.js)
const { launch, phone, BASE } = require("./harness");
const results = [];
function check(name, ok, extra) { results.push(ok); console.log(`${ok ? "✅" : "❌"} ${name}${extra ? " — " + extra : ""}`); }
const until = async (fn, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { const r = await fn().catch(() => null); if (r) return r; await new Promise((x) => setTimeout(x, 200)); } return null; };

(async () => {
  const b = await launch();
  const dm = await phone(b, "dm_saves", { lite: true });
  dm.on("dialog", (d) => d.accept().catch(() => {}));
  await dm.goto(BASE + "/ads/dnd/play.html");
  await until(() => dm.evaluate(() => !document.getElementById("btnDm").disabled));
  check("«Ніч, яку не забути» не пропонується соло", await dm.evaluate(() => !document.querySelector('[data-advsolo="sanguine"]') && document.getElementById("advCard").hidden));
  await dm.fill("#dmName", "Влад"); await dm.click("#btnDm");
  await until(() => dm.evaluate(() => !document.getElementById("lobBots").hidden));
  check("у лобі майстра «Ніч, яку не забути» є", await dm.evaluate(() => !!document.querySelector('#lobAdv [data-adv="sanguine"]')));
  await dm.click('[data-bot="fighter"]'); await dm.click('[data-bot="wizard"]');
  await until(() => dm.evaluate(() => !document.getElementById("lobStart").disabled));
  await dm.click("#lobStart");
  await until(() => dm.evaluate(() => !document.getElementById("app").hidden));
  const cps = () => dm.evaluate(() => JSON.parse(localStorage.getItem("dnd_cp_" + DNDGame.ME.code) || "[]").map((x) => x.l));
  check("сейв на початку пригоди", !!(await until(async () => (await cps()).some((l) => /Сцена 1/.test(l)))), (await cps()).join(" | "));
  await dm.evaluate(() => DNDGame.send({ t: "scene", sc: 2 }));
  check("сейв на новій сцені", !!(await until(async () => (await cps())[0] && /Сцена 3/.test((await cps())[0]))));
  const hpBefore = await dm.evaluate(() => Object.values(DNDGame.G.chars).map((c) => c.hp).join(","));
  await dm.evaluate(() => DNDGame.send({ t: "fight", f: "hall" }));
  check("сейв перед боєм", !!(await until(async () => /^⚔️ Перед боєм/.test((await cps())[0] || ""))), (await cps())[0]);
  await dm.evaluate(() => { for (const k in DNDGame.G.chars) DNDGame.send({ t: "hp", k, d: -999 }); });
  check("усі впали → поразка", !!(await until(() => dm.evaluate(() => DNDGame.G.cb && DNDGame.G.cb.lost))));
  await dm.click('[data-tab="fight"]').catch(() => {});
  check("на панелі поразки — «Завантажити сейв перед боєм»", !!(await until(() => dm.evaluate(() => { const b = document.querySelector("#act [data-cpload]"); return b && /Перед боєм/.test(b.textContent); }))));
  await dm.evaluate(() => document.querySelector("#act [data-cpload]").click());
  const ok = await until(() => dm.evaluate(() => !DNDGame.G.cb && DNDGame.G.log.some((e) => /Завантажено сейв/.test(e.t)) && DNDGame.G.sc === 2));
  check("сейв завантажено: бою ще немає, та сама сцена", !!ok);
  check("хіти героїв — як до бою", (await dm.evaluate(() => Object.values(DNDGame.G.chars).map((c) => c.hp).join(","))) === hpBefore);
  await dm.evaluate(() => DNDGame.send({ t: "fight", f: "hall" }));
  check("бій можна почати знову", !!(await until(() => dm.evaluate(() => DNDGame.G.cb && !DNDGame.G.cb.lost))));
  await dm.evaluate(() => DNDGame.send({ t: "fightend" }));
  await dm.click('[data-tab="party"]');
  await dm.evaluate(() => document.querySelector("[data-cpsave]").click());
  check("ручний сейв з вкладки «Гравці»", !!(await until(async () => /^💾/.test((await cps())[0] || ""))));
  const cloud = await until(() => dm.evaluate(async () => { const v = (await firebase.database().ref("dnd_cp/" + DNDGame.ME.code).get()).val(); return v && Object.keys(v).length >= 4 ? Object.keys(v).length : 0; }));
  check("сейви є і в хмарі", !!cloud, cloud + " шт.");
  check("жодної JS-помилки", dm.errors.length === 0, dm.errors.slice(0, 4).join(" || "));
  const okN = results.filter(Boolean).length;
  console.log(`\n${okN}/${results.length} перевірок`);
  await b.close(); process.exit(okN === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
