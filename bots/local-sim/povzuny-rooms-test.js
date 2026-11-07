// Повзуни: турнірна таблиця кімнати + «Активні кімнати» в меню. Запуск: node server.js, потім node povzuny-rooms-test.js
const { launch, phone, BASE } = require("./harness");
let fail = 0; const ok = (n, c, x) => { if (!c) fail++; console.log((c ? "✓ " : "✗ ") + n + (x ? "  — " + x : "")); };
const until = async (p, fn, arg, t = 20000) => { try { await p.waitForFunction(fn, arg, { timeout: t }); return true; } catch (e) { return false; } };
(async () => {
  await fetch(BASE + "/__mock/reset");
  const b = await launch(); const errs = [];
  const mk = async (name) => { const p = await phone(b, name, { viewport: { width: 390, height: 780 } }); p.on("pageerror", (e) => errs.push(name + ": " + e.message));
    await p.goto(BASE + "/ads/povzuny/play.html"); await p.waitForTimeout(1200); await p.fill("#nick", name); return p; };
  const circle = (p) => p.evaluate(() => setInterval(() => { const m = Povzun.me; if (m && !m.dead) m.ta = m.ang + 0.7; }, 80));
  const A = await mk("Влад");
  await A.click("#createBtn"); await A.waitForFunction(() => Povzun.state === "play", null, { timeout: 15000 }); await circle(A);
  const code = await A.evaluate(() => Povzun.NET.code);
  const Bp = await mk("Олена");
  const seen = await until(Bp, (c) => !!document.querySelector(`#roomsList .room[data-c="${c}"]`), code);
  ok("у меню видно активну кімнату хоста", seen, seen ? await Bp.textContent("#roomsList") : "");
  await Bp.click(`#roomsList .room[data-c="${code}"]`);
  await Bp.waitForFunction(() => Povzun.state === "play", null, { timeout: 15000 }); await circle(Bp);
  ok("тап по кімнаті — зайшла в ту саму", (await Bp.evaluate(() => Povzun.NET.code)) === code);
  await A.waitForTimeout(2500);
  const rowsA = await A.$$eval("#board li:not(.hd) span", (els) => els.map((e) => e.textContent).join("|"));
  ok("таблиця в хоста — лише люди кімнати", /Влад/.test(rowsA) && /Олена/.test(rowsA) && rowsA.split("|").length === 2, rowsA);
  const n = await until(Bp, (c) => /👤 2\/10/.test(document.body.textContent) || true, code);
  // Олена зʼїдає (зараховуємо) і гине — у Влада бачимо 💀 і її 🗡
  await Bp.evaluate(() => { Povzun.me.kills = 2; Povzun.die(Povzun.me); });
  const dead = await until(A, () => [...document.querySelectorAll("#board li.off")].some((l) => /Олена/.test(l.textContent) && /💀/.test(l.textContent)));
  ok("загибель видно в таблиці (💀), гравець лишається в списку", dead);
  const kOk = await until(A, () => [...document.querySelectorAll("#board li")].some((l) => /Олена/.test(l.textContent) && l.querySelectorAll("i")[1]?.textContent === "2"));
  ok("зʼїдені змії рахуються за всі життя", kOk);
  await Bp.waitForTimeout(1200);
  ok("на екрані смерті — таблиця кімнати", await Bp.evaluate(() => !document.getElementById("deadBoard").hidden && document.querySelectorAll("#deadBoard li:not(.hd)").length === 2));
  await Bp.click("#againBtn"); await A.waitForTimeout(2500);
  const kept = await A.evaluate(() => [...document.querySelectorAll("#board li")].find((l) => /Олена/.test(l.textContent))?.querySelectorAll("i")[1]?.textContent);
  ok("після «Ще раз» 🗡 не обнуляється", kept === "2", kept);
  // хост виходить — кімната лишається в списку (новий хост переписує запис)
  const C = await mk("Петро");
  await A.click("#mute"); await A.evaluate(() => { document.getElementById("menuBtn").click(); });
  const still = await until(C, (c) => !!document.querySelector(`#roomsList .room[data-c="${c}"]`), code, 25000);
  ok("хост вийшов — кімнату далі видно (веде новий хост)", still, still ? await C.textContent("#roomsList") : "");
  await Bp.evaluate(() => document.getElementById("menuBtn").click());
  const gone = await until(C, (c) => !document.querySelector(`#roomsList .room[data-c="${c}"]`), code, 40000);
  ok("усі вийшли — кімната зникла зі списку", gone);
  ok("без JS-помилок", !errs.length, errs.join("; "));
  await b.close(); console.log(fail ? fail + " failed" : "all passed"); process.exit(fail ? 1 : 0);
})();
