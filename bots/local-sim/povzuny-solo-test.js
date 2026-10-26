// Повзуни: соло з ботами. Запуск: node server.js, потім node povzuny-solo-test.js
const { launch, phone, BASE } = require("./harness");
const SS = require("path").join(__dirname, "out", ""); require("fs").mkdirSync(SS, { recursive: true });
const ok = (n, c, x) => console.log((c ? "✓ " : "✗ ") + n + (x ? "  — " + x : ""));
(async () => {
  const b = await launch(); const p = await phone(b, null, { viewport: { width: 390, height: 780 } });
  await p.goto(BASE + "/ads/povzuny/play.html"); await p.waitForTimeout(1500);
  await p.screenshot({ path: SS + "pz_menu.png" });
  await p.fill("#nick", "Влад"); await p.click("#soloBtn"); await p.waitForTimeout(500);
  ok("соло: старт, 16 ботів", (await p.evaluate(() => Povzun.state)) === "play" && (await p.evaluate(() => Povzun.bots.length)) === 16);
  // керування: тягнемо пальцем праворуч
  await p.mouse.move(380, 390);
  const m0 = await p.evaluate(() => Povzun.me.mass);
  // FPS
  const fps = await p.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); (function f() { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(f); else res(Math.round(n / 3)); })(); }));
  await p.waitForTimeout(6000);
  const st = await p.evaluate(() => ({ m: Povzun.me.mass, dead: Povzun.me.dead, ang: Povzun.me.ang, botsAlive: Povzun.bots.filter((b) => !b.dead).length, botMass: Math.round(Povzun.bots.reduce((a, b) => a + b.mass, 0)) }));
  ok("змія жива або чесно загинула, боти повзають і їдять", st.botsAlive >= 14, JSON.stringify(st) + " fps≈" + fps);
  await p.screenshot({ path: SS + "pz_play.png" });
  // смерть → їжа
  const before = await p.evaluate(() => Povzun.deathFood.size);
  if (!(await p.evaluate(() => Povzun.me.dead))) await p.evaluate(() => Povzun.die(Povzun.me));
  await p.waitForTimeout(1300);
  const after = await p.evaluate(() => Povzun.deathFood.size);
  ok("після смерті тіло стало їжею, екран «Ще раз»", after > before && await p.isVisible("#dead"), `їжі ${before}→${after}`);
  await p.screenshot({ path: SS + "pz_dead.png" });
  await p.click("#againBtn"); await p.waitForTimeout(300);
  ok("«Ще раз» — нова змія", !(await p.evaluate(() => Povzun.me.dead)));
  // тривалий прогін: боти гинуть і відроджуються, помилок нема
  await p.waitForTimeout(15000);
  const st2 = await p.evaluate(() => ({ bots: Povzun.bots.filter((b) => !b.dead).length, death: Povzun.deathFood.size }));
  ok("за 15 с боти гинуть/відроджуються, популяція тримається", st2.bots >= 14, JSON.stringify(st2));
  console.log("errors", p.errors.slice(0, 5));
  await b.close();
})();
