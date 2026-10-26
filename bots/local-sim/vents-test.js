// Хованки: люки-телепорти. Запуск: node server.js, потім node vents-test.js
const { launch, phone, BASE } = require("./harness");
const SS = require("path").join(__dirname, "out", ""); require("fs").mkdirSync(SS, { recursive: true });
const ok = (n, c, x) => console.log((c ? "✓ " : "✗ ") + n + (x ? "  — " + x : ""));
(async () => {
  const b = await launch(); const p = await phone(b, null, { viewport: { width: 390, height: 760 } });
  const maps = [];
  for (const lvl of [1, 3, 5, 7, 9, 13]) {
    await p.goto(BASE + "/ads/khovanky/play.html"); await p.evaluate((l) => { localStorage.setItem("hns_level", String(l)); localStorage.setItem("hns_dark", "1"); }, lvl);
    await p.reload(); await p.waitForTimeout(1500); await p.click("#ovBtn"); await p.waitForTimeout(500);
    const v = await p.evaluate(() => HNSGame.vents.map((v) => ({ x: +v.x.toFixed(1), z: +v.z.toFixed(1), pair: v.pair, to: v.to })));
    const pd = [0, 1].map((k) => { const a = v.filter((x) => x.pair === k); return Math.hypot(a[0].x - a[1].x, a[0].z - a[1].z).toFixed(1); });
    maps.push(`L${lvl}: ${v.length} люки, пари ${pd.join(" і ")} м`);
  }
  ok("на кожній карті 4 люки в 2 пари, далеко один від одного", maps.every((m) => m.includes(": 4 люки")), "\n   " + maps.join("\n   "));
  // рівень 1 — ховаємось; гравця на люк
  await p.evaluate(() => localStorage.setItem("hns_level", "1")); await p.reload(); await p.waitForTimeout(1500); await p.click("#ovBtn"); await p.waitForTimeout(800);
  ok("далеко від люка кнопки нема", await p.isHidden("#vent"));
  const v0 = await p.evaluate(() => { const v = HNSGame.vents[0]; const pl = HNSGame.player; pl.x = v.x + 0.2; pl.z = v.z; return { x: v.x, z: v.z, to: HNSGame.vents[v.to] }; });
  await p.waitForTimeout(400);
  ok("на люку зʼявилась кнопка «Телепорт»", await p.isVisible("#vent") && (await p.textContent("#vent span")) === "Телепорт");
  await p.screenshot({ path: SS + "vent1.png" });
  await p.evaluate(() => document.getElementById("vent").click()); await p.waitForTimeout(250);
  const pos = await p.evaluate(() => ({ x: HNSGame.player.x, z: HNSGame.player.z, cd: HNSGame.player.ventCD }));
  ok("стрибок у парний люк", Math.hypot(pos.x - v0.to.x, pos.z - v0.to.z) < 0.4, `${pos.x.toFixed(1)},${pos.z.toFixed(1)} → ${v0.to.x.toFixed(1)},${v0.to.z.toFixed(1)}`);
  await p.waitForTimeout(200);
  ok("перезарядка: «Телепорт · 12», кнопка неактивна", /Телепорт · 1[12]/.test(await p.textContent("#vent span")) && (await p.getAttribute("#vent", "class")).includes("off"), await p.textContent("#vent span"));
  await p.evaluate(() => document.getElementById("vent").click()); await p.waitForTimeout(150);
  const pos2 = await p.evaluate(() => ({ x: HNSGame.player.x, z: HNSGame.player.z }));
  ok("під час перезарядки не стрибає", Math.hypot(pos2.x - pos.x, pos2.z - pos.z) < 0.3);
  await p.waitForTimeout(5500);   // темрява після інтро
  await p.screenshot({ path: SS + "vent2.png" });
  // бот біля люка, шукач поруч — бот має втекти через люк
  let used = false, info = "";
  for (let tr = 0; tr < 6 && !used; tr++) {
    info = await p.evaluate(() => {
      const G = HNSGame, v = G.vents[2], bot = G.chars.find((c) => c.role === "hider" && !c.isPlayer && !c.caught), sk = G.chars.find((c) => c.role === "seeker");
      if (!bot || !sk) return "нема бота";
      bot.x = v.x + 1.0; bot.z = v.z; bot.ventCD = 0; bot.repathT = 0; bot.state = "hidden"; bot.path = null;
      sk.x = v.x + 3.0; sk.z = v.z; sk.state = "patrol"; sk.yaw = sk.look = -Math.PI / 2;
      window.__bot = bot; return "ok " + G.phase;
    });
    for (let i = 0; i < 12; i++) { await p.waitForTimeout(250); if (await p.evaluate(() => window.__bot.ventCD > 0)) { used = true; break; } }
  }
  ok("бот-хованець тікає через люк, коли шукач поруч", used, info);
  console.log("errors", p.errors.slice(0, 4));
  await b.close();
})();
