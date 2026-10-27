// Редактор карт: відкриття, перевірка вбудованих карт, стіна в дверях → недосяжно, скасування, меблі, 3D-тест аватаром,
// публікація нової карти й виправленої вбудованої → їх бачать Хованки / Агенти, повернення вбудованої.
// node mapedit-test.js   (симулятор: node server.js)
const { launch, phone, BASE } = require("./harness");
const results = [];
function check(name, ok, extra) { results.push(!!ok); console.log(`${ok ? "✅" : "❌"} ${name}${extra ? " — " + extra : ""}`); }
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { const r = await fn(); if (r) return r; await new Promise((x) => setTimeout(x, 250)); } return null; };
(async () => {
  await fetch(BASE + "/__mock/reset");
  const b = await launch();
  const p = await phone(b, "conrys");
  await p.goto(BASE + "/ads/mapedit/index.html"); await p.waitForTimeout(2000);
  const o = await p.evaluate(() => ({ id: MapEdit.D.id, w: MapEdit.D.world, n: MapEdit.D.furn.length, st: document.getElementById("stat").textContent }));
  check("редактор відкрив «Будинок»", o.id === "house" && o.w === "hns" && o.n > 20, JSON.stringify(o));
  // звіт по всіх вбудованих картах
  const rep = await p.evaluate(() => { const out = []; for (const w of ["hns", "ph"]) for (const m of (w === "hns" ? window.HW_HNS : window.HW_PH).MAPS) { if (m.id === "__edit") continue; MapEdit.openMap(w, m.id); MapEdit.runCheck(true); out.push(w + "/" + m.id + ": " + (MapEdit.check.issues.map((i) => (i.e ? "⛔" : "⚠") + i.t).join("; ") || "✓")); } return out; });
  console.log("   " + rep.join("\n   "));
  check("перевірено всі вбудовані карти обох світів", rep.length >= 16, rep.length);
  // стіна в дверях кухні Будинку → кухня недосяжна
  await p.evaluate(() => { MapEdit.openMap("hns", "house"); localStorage.clear(); MapEdit.openMap("hns", "house"); });
  const before = await p.evaluate(() => MapEdit.check.issues.filter((i) => i.e).length);
  // двері кухні з коридором малюємо пальцем, з вітальнею — кодом (у кухні двоє дверей)
  const vp = await p.evaluate(() => { const v = MapEdit.view; const sx = (x) => v.ox + x * v.s, sy = (z) => v.oy + z * v.s; return { a: [sx(3.5), sy(7.5)], b: [sx(4.5), sy(7.5)], s: v.s }; });
  await p.click('.tool[data-t="wall"]');
  await p.mouse.move(vp.a[0], vp.a[1]); await p.mouse.down(); await p.mouse.move(vp.b[0], vp.b[1], { steps: 5 }); await p.mouse.up();
  await p.evaluate(() => { const D = MapEdit.D; D.rows[3][7] = "#"; D.rows[4][7] = "#"; MapEdit.changed(); });
  await p.waitForTimeout(800);
  const after = await p.evaluate(() => ({ e: MapEdit.check.issues.filter((i) => i.e).map((i) => i.t), row: MapEdit.D.rows[7].join("") }));
  check("замурував двері кухні пальцем — «Кухня: недосяжно»", before === 0 && after.e.some((t) => /Кухня/.test(t)) && /недосяжно/.test(after.e.join()), JSON.stringify(after));
  await p.click("#undo"); await p.waitForTimeout(800);
  await p.waitForTimeout(100);
  check("↶ — двері знову відкриті, проблем нема", await p.evaluate(() => MapEdit.D.rows[7].join("") === "###kk#####lll#####bb##" && MapEdit.D.rows[3][7] === "k" && !MapEdit.check.issues.some((i) => i.e)));
  // меблі: вибрати шафу й поставити в дверях вітальні → «меблі в дверях»
  await p.click('.tool[data-t="furn"]'); await p.waitForTimeout(200);
  await p.evaluate(() => { MapEdit.ftype = "sofa"; });
  const dp = await p.evaluate(() => { const v = MapEdit.view; return [v.ox + 11.5 * v.s, v.oy + 7.5 * v.s]; });
  await p.mouse.click(dp[0], dp[1]); await p.waitForTimeout(900);
  const fw = await p.evaluate(() => ({ last: MapEdit.D.furn[MapEdit.D.furn.length - 1].t, props: !document.getElementById("props").hidden, iss: MapEdit.check.issues.map((i) => i.t).join("; ") }));
  check("поставив диван дотиком — зʼявилась панель властивостей", fw.last === "sofa" && fw.props, JSON.stringify(fw));
  check("диван поперек дверей — «Двері перекриті»", /Двері перекриті/.test(fw.iss), fw.iss);
  await p.click('#props button[aria-label="Повернути"]'); await p.waitForTimeout(200);
  check("⟳ повертає меблі", await p.evaluate(() => MapEdit.D.furn[MapEdit.D.furn.length - 1].r === 1));
  await p.click('#props button[aria-label="Видалити"]'); await p.waitForTimeout(800);
  check("🗑 видаляє — проблем знову нема", await p.evaluate(() => !MapEdit.check.issues.some((i) => i.e)));
  // 3D-тест
  await p.click("#playBtn"); await p.waitForTimeout(1500);
  const t0 = await p.evaluate(() => { const t = MapEdit.R3; return { on: t.on, x: t.p.x, z: t.p.z }; });
  check("▶ Тест — 3D, аватар на старті", t0.on && Math.abs(t0.x - 11) < 0.5, JSON.stringify(t0));
  // дотик — аватар зʼявляється там
  await p.mouse.click(195, 300); await p.waitForTimeout(400);
  const t1 = await p.evaluate(() => [MapEdit.R3.p.x, MapEdit.R3.p.z]);
  check("дотик — аватар перенісся", Math.hypot(t1[0] - t0.x, t1[1] - t0.z) > 0.8, JSON.stringify(t1));
  // іде вгору в стіну — стіна тримає
  await p.mouse.move(200, 600); await p.mouse.down(); await p.mouse.move(200, 520, { steps: 4 });
  await p.waitForTimeout(6000); await p.mouse.up();
  const t2 = await p.evaluate(() => ({ z: MapEdit.R3.p.z, x: MapEdit.R3.p.x }));
  check("джойстиком іде й не проходить крізь стіну", t2.z > 0.28 && t2.z < t1[1], JSON.stringify(t2));
  await p.click("#tExit"); await p.waitForTimeout(300);
  // нова карта → публікація
  await p.evaluate(() => MapEdit.newMap("hns")); await p.waitForTimeout(500);
  await p.evaluate(() => { const D = MapEdit.D; D.name = "Тест-карта"; for (let z = 1; z < 17; z++) D.rows[z][12] = z === 8 || z === 9 ? "a" : "#"; MapEdit.changed(); });
  await p.waitForTimeout(700);
  check("нова карта: стіна з проходом — усе досяжно", await p.evaluate(() => !MapEdit.check.issues.some((i) => i.e)));
  await p.click("#saveBtn"); await p.waitForTimeout(300);
  await p.evaluate(() => { for (const c of document.querySelectorAll("[data-g]")) c.checked = ["khovanky", "agents"].includes(c.dataset.g); });
  await p.click("#pOk");
  const saved = await until(() => p.evaluate(() => Object.keys(MapEdit.remote).length === 1 && /Збережено/.test(document.getElementById("toast").textContent)), 15000);
  const nid = await p.evaluate(() => MapEdit.D.id);
  check("збережено в базу", !!saved);
  // виправлена вбудована: школа без однієї шафи
  await p.evaluate(() => { MapEdit.openMap("hns", "school"); const D = MapEdit.D; D.furn.splice(0, 1); D.name = "Школа (нова)"; MapEdit.changed(); });
  await p.waitForTimeout(600); await p.click("#saveBtn"); await p.waitForTimeout(300); await p.click("#pOk");
  await until(() => p.evaluate(() => !!MapEdit.remote.hns_school), 15000);
  const k = await phone(b, "conrys");
  await k.goto(BASE + "/ads/khovanky/play.html"); await k.waitForTimeout(3000);
  const kh = await k.evaluate((nid) => { const M = HNSWorld.MAPS; const n = M.find((m) => m.id === nid), s = M.find((m) => m.id === "school"); return { n: !!n && n.name, nw: n && n.rows[0].length, school: s.name, opt: [...document.querySelectorAll("#mapSel option")].map((o) => o.textContent).filter((t) => /✎/.test(t)).join() }; }, nid);
  check("Хованки: нова карта є і в списку карт", kh.n === "Тест-карта" && /Тест-карта/.test(kh.opt), JSON.stringify(kh));
  check("Хованки: виправлена «Школа» замінила вбудовану", kh.school === "Школа (нова)");
  const ag = await phone(b, "conrys");
  await ag.goto(BASE + "/ads/agents/play.html"); await ag.waitForTimeout(3000);
  check("Агенти теж бачать нову карту", await ag.evaluate((nid) => AGTGame.MAPIDS.some((i) => HNSWorld.MAPS[i].id === nid) && [...document.querySelectorAll("#mapSel option")].some((o) => /Тест-карта/.test(o.textContent)), nid));
  const ph = await phone(b, "conrys");
  await ph.goto(BASE + "/ads/perevtilennia/play.html"); await ph.waitForTimeout(3000);
  check("Перевтілення не чіпає (інший світ, гра не вибрана)", await ph.evaluate((nid) => !HNSWorld.MAPS.some((m) => m.id === nid) && HNSWorld.MAPS.find((m) => m.id === "school").name === "Школа", nid));
  // Хованки грають на новій карті
  await k.evaluate((nid) => { const i = HNSWorld.MAPS.findIndex((m) => m.id === nid); localStorage.setItem("hns_level", String(i * 2 + 1)); }, nid);
  // повернути вбудовану школу
  await p.evaluate(() => { document.getElementById("moreBtn").click(); });
  await p.click("#mRev");
  await until(() => p.evaluate(() => !MapEdit.remote.hns_school), 15000);
  await k.reload(); await k.waitForTimeout(3500);
  check("«Повернути вбудовану» — у Хованках знову стара «Школа»", await k.evaluate(() => HNSWorld.MAPS.find((m) => m.id === "school").name === "Школа"));
  await p.screenshot({ path: __dirname + "/out/mapedit.png" });
  const errs = [p, k, ag, ph].flatMap((x) => x.errors);
  check("без JS-помилок", !errs.length, errs.slice(0, 5).join(" | "));
  await b.close();
  const ok = results.filter(Boolean).length; console.log(`\n${ok}/${results.length}`); process.exit(ok === results.length ? 0 : 1);
})();
