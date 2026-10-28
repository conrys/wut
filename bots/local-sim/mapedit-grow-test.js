// Редактор карт: малювання підлоги за межею — карта росте (вправо, вліво зі зсувом), ↶, далеко — не росте.
// node mapedit-grow-test.js   (симулятор: node server.js)
const { launch, phone, BASE } = require("./harness");
(async () => {
  await fetch(BASE + "/__mock/reset");
  const b = await launch(); const p = await phone(b, "conrys");
  await p.goto(BASE + "/ads/mapedit/index.html"); await p.waitForTimeout(2000);
  await p.evaluate(() => { localStorage.clear(); MapEdit.newMap("hns"); });
  await p.click('.tool[data-t="floor"]'); await p.waitForTimeout(200);
  const before = await p.evaluate(() => ({ w: MapEdit.D.rows[0].length, h: MapEdit.D.rows.length, sp: MapEdit.D.spawn.slice() }));
  const pt = await p.evaluate(() => { const v = MapEdit.view, sx = (x) => v.ox + x * v.s, sy = (z) => v.oy + z * v.s, w = MapEdit.D.rows[0].length; return { a: [sx(w - 3), sy(5.5)], b: [sx(w + 4.5), sy(5.5)], l: [sx(3), sy(9.5)], l2: [sx(-3.5), sy(9.5)], s: v.s }; });
  // вправо за межу
  await p.mouse.move(pt.a[0], pt.a[1]); await p.mouse.down(); await p.mouse.move(pt.b[0], pt.b[1], { steps: 8 }); await p.mouse.up();
  const r1 = await p.evaluate(() => ({ w: MapEdit.D.rows[0].length, h: MapEdit.D.rows.length, rowOk: MapEdit.D.rows.every((r) => r.length === MapEdit.D.rows[0].length), edge: MapEdit.D.rows.every((r) => r[r.length - 1] === "#"), row5: MapEdit.D.rows[5].join("") }));
  console.log(r1.w === before.w + 6 && r1.rowOk && r1.edge ? "✅" : "❌", "вправо: карта виросла", before.w, "→", r1.w, r1.row5);
  // вліво: координати зсуваються, старт зсувається разом
  await p.mouse.move(pt.l[0], pt.l[1]); await p.mouse.down(); await p.mouse.move(pt.l2[0], pt.l2[1], { steps: 8 }); await p.mouse.up();
  const r2 = await p.evaluate(() => ({ w: MapEdit.D.rows[0].length, sp: MapEdit.D.spawn.slice(), row9: MapEdit.D.rows[9].join(""), col0: MapEdit.D.rows.every((r) => r[0] === "#") }));
  console.log(r2.w === r1.w + 5 && r2.sp[0] === before.sp[0] + 5 && r2.col0 && /^#a{10,}/.test(r2.row9) ? "✅" : "❌", "вліво: виросла, старт зсунувся", JSON.stringify(r2));
  // скасування повертає розмір
  await p.click("#undo"); await p.waitForTimeout(300);
  const r3 = await p.evaluate(() => MapEdit.D.rows[0].length);
  console.log(r3 === r1.w ? "✅" : "❌", "↶ повертає попередній розмір", r3);
  // далеко за картою — не роздуваємо
  const r4 = await p.evaluate(() => { const v = MapEdit.view; return [v.ox + (MapEdit.D.rows[0].length + 30) * v.s, v.oy + 3 * v.s]; });
  await p.mouse.click(r4[0], r4[1]); await p.waitForTimeout(300);
  console.log((await p.evaluate(() => MapEdit.D.rows[0].length)) === r1.w ? "✅" : "❌", "дотик далеко за картою не роздуває її");
  await p.waitForTimeout(800);
  const st = await p.evaluate(() => MapEdit.check.issues.filter((i) => i.e).map((i) => i.t));
  console.log(st.length === 0 ? "✅" : "❌", "перевірка прохідності без помилок", JSON.stringify(st));
  console.log(p.errors.length ? "❌ " + p.errors.join(" | ") : "✅ без JS-помилок");
  await b.close();
})();
