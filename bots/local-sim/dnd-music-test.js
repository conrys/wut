// DnD: музика сцен і картинки. node dnd-music-test.js   (симулятор: node server.js)
const { launch, phone, BASE } = require("./harness");
const fs = require("fs");
const results = [];
function check(name, ok, extra) { results.push(ok); console.log(`${ok ? "✅" : "❌"} ${name}${extra ? " — " + extra : ""}`); }
const until = async (fn, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { const r = await fn().catch(() => null); if (r) return r; await new Promise((x) => setTimeout(x, 200)); } return null; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const b = await launch();
  const dm = await phone(b, "dm_music", { lite: true });
  const warns = []; dm.on("console", (m) => { if (/music/.test(m.text())) warns.push(m.text()); });
  await dm.goto(BASE + "/ads/dnd/play.html");
  await until(() => dm.evaluate(() => !document.getElementById("btnDm").disabled));
  await dm.fill("#dmName", "Влад"); await dm.click("#btnDm");
  await until(() => dm.evaluate(() => !document.getElementById("lobBots").hidden));
  check("у лобі музики немає", (await dm.evaluate(() => DNDMusic.current)) == null);
  await dm.click('[data-bot="fighter"]'); await dm.click('[data-bot="wizard"]');
  await until(() => dm.evaluate(() => !document.getElementById("lobStart").disabled));
  await dm.click("#lobStart");
  await until(() => dm.evaluate(() => !document.getElementById("app").hidden));
  const cur = () => dm.evaluate(() => DNDMusic.current);
  check("перша сцена — своя тема", !!(await until(async () => (await cur()) === "road")), await cur());
  check("на банері сцени — ілюстрація й назва треку", await dm.evaluate(() => !!document.querySelector(".scene-ban svg.scene-art") && /Дорога/.test(document.querySelector(".scene-mus").textContent)));
  await dm.evaluate(() => DNDGame.send({ t: "scene", sc: 1 }));
  check("Данстар → таверна (плавний перехід)", !!(await until(async () => (await cur()) === "tavern")));
  await dm.evaluate(() => DNDGame.send({ t: "fight", f: "wolves" })).catch(() => {});
  if (!(await dm.evaluate(() => !!DNDGame.G.cb))) { await dm.click('[data-tab="fight"]'); await dm.click('[data-fight]'); }
  const t0 = Date.now();
  check("ініціатива → одразу бойова тема", !!(await until(async () => (await cur()) === "battle", 3000)), (Date.now() - t0) + " мс");
  await dm.evaluate(() => DNDGame.send({ t: "fightend" }));
  check("після бою — назад до музики сцени", !!(await until(async () => (await cur()) === "tavern")));
  await dm.click('[data-tab="scene"]').catch(() => {});
  await dm.evaluate(() => document.querySelector('[data-mus="temple"]').click());
  check("майстер обирає трек вручну", !!(await until(async () => (await cur()) === "temple")));
  await dm.evaluate(() => document.querySelector('[data-mus="none"]').click());
  check("«Тиша» вимикає музику", !!(await until(async () => (await cur()) == null)));
  await dm.evaluate(() => DNDGame.send({ t: "scene", sc: 2 }));
  check("нова сцена знімає ручний вибір", !!(await until(async () => (await cur()) === "road")));
  // кнопка звуку: музика → лише ефекти → тиша
  await dm.click("#mute");
  check("🔈 — музику вимкнено, ефекти лишились", await dm.evaluate(() => document.getElementById("mute").textContent === "🔈" && localStorage.getItem("dnd_snd") === '"sfx"'));
  await dm.click("#mute"); await dm.click("#mute");
  // своя картинка сцени
  await dm.evaluate(async () => {
    const cv = document.createElement("canvas"); cv.width = 64; cv.height = 32; const c = cv.getContext("2d"); c.fillStyle = "#c33"; c.fillRect(0, 0, 64, 32);
    const id = "sc" + DNDHeroes.rid(); await DNDHeroes.put(id, cv.toDataURL("image/png")); DNDGame.send({ t: "art", id });
  });
  check("своя картинка замінює ілюстрацію", !!(await until(() => dm.evaluate(() => (document.querySelector(".scene-ban img.scene-art") || {}).src && document.querySelector(".scene-ban img.scene-art").src.startsWith("data:")))));
  await dm.evaluate(() => document.querySelector("[data-artdel]").click());
  check("«Стандартна» повертає ілюстрацію", !!(await until(() => dm.evaluate(() => /img\/scene_/.test((document.querySelector(".scene-ban img.scene-art") || {}).src || "") && !!document.querySelector(".scene-ban svg")))));
  // усі теми грають без помилок
  for (const id of Object.keys(await dm.evaluate(() => DNDMusic.THEMES))) { await dm.evaluate((i) => DNDMusic.play(i, "cut"), id); await wait(900); }
  check("усі 8 тем грають без помилок", warns.length === 0 && (await dm.evaluate(() => DNDMusic.current)) === "battle", warns.join(" | "));
  // знімок усіх ілюстрацій
  fs.mkdirSync(__dirname + "/shots", { recursive: true });
  const sh = await phone(b, "dm_shot", {}); await sh.goto(BASE + "/ads/dnd/play.html"); await until(() => sh.evaluate(() => !!window.DNDArt));
  await sh.evaluate(() => { const d = document.createElement("div"); d.id = "artGrid"; d.style.cssText = "position:fixed;inset:0;z-index:999;background:#000;overflow:auto;display:grid;grid-template-columns:1fr 1fr;gap:4px;padding:4px"; d.innerHTML = DNDArt.kinds.map((k) => '<div style="position:relative;height:120px;border-radius:12px;overflow:hidden">' + DNDArt.svg(k, 3) + '<b style="position:absolute;left:8px;bottom:6px;color:#fff">' + k + "</b></div>").join(""); document.body.appendChild(d); });
  await wait(400); await sh.screenshot({ path: __dirname + "/shots/dnd-art.png", fullPage: false });
  check("жодної JS-помилки", dm.errors.length === 0, dm.errors.slice(0, 4).join(" || "));
  const okN = results.filter(Boolean).length;
  console.log(`\n${okN}/${results.length} перевірок`);
  await b.close(); process.exit(okN === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
