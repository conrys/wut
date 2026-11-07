// Кошмар наяву: майстер сам із ботами (швидкий тест з одного телефона).
// node dnd-bots-test.js   (симулятор має бути запущений: node server.js)
const { launch, phone, BASE } = require("./harness");
const results = [];
function check(name, ok, extra) { results.push(ok); console.log(`${ok ? "✅" : "❌"} ${name}${extra ? " — " + extra : ""}`); }
const until = async (fn, ms = 30000) => { const end = Date.now() + ms; while (Date.now() < end) { const r = await fn().catch(() => null); if (r) return r; await new Promise((x) => setTimeout(x, 250)); } return null; };

(async () => {
  const b = await launch();
  const dm = await phone(b, "dm_solo", { lite: true });
  await dm.goto(BASE + "/ads/dnd/play.html");
  await until(() => dm.evaluate(() => !document.getElementById("btnDm").disabled));
  await dm.fill("#dmName", "Влад"); await dm.click("#btnDm");
  await until(() => dm.evaluate(() => !document.getElementById("lobBots").hidden));
  check("без гравців «Почати» вимкнено", await dm.evaluate(() => document.getElementById("lobStart").disabled));
  await dm.click('[data-bot="fighter"]'); await dm.click('[data-bot="rogue"]'); await dm.click('[data-bot="cleric"]');
  const n = await until(() => dm.evaluate(() => document.querySelectorAll("#lobPlayers [data-unbot]").length === 3 && document.querySelector('[data-bot="fighter"]').disabled));
  check("у лобі 3 боти, їхні герої зайняті", !!n);
  await dm.click('#lobPlayers [data-unbot]');
  check("бота можна прибрати", !!(await until(() => dm.evaluate(() => document.querySelectorAll("#lobPlayers [data-unbot]").length === 2))));
  await dm.click('[data-bot="wizard"]');
  await until(() => dm.evaluate(() => !document.getElementById("lobStart").disabled));
  await dm.click("#lobStart");
  await until(() => dm.evaluate(() => !document.getElementById("app").hidden));
  // перевірка — боти кидають самі
  await dm.click('[data-ask=""]'); await dm.click('[data-whoall="1"]'); await dm.click('[data-mode="group"]'); await dm.click('[data-cfgsend="1"]');
  const done = await until(() => dm.evaluate(() => DNDGame.G.ck && DNDGame.G.ck.done), 15000);
  check("боти самі кинули групову перевірку", !!done);
  await dm.click('[data-ckclose="1"]');
  // бій: боти ходять самі, монстрів теж віддаємо грі
  await dm.evaluate(() => { DNDGame.E.delay = 120; });
  await dm.click('[data-tab="fight"]');
  await dm.click('[data-fight="hall"]');
  await until(() => dm.evaluate(() => !!DNDGame.G.cb));
  await dm.evaluate(() => DNDGame.send({ t: "auto", on: true }));
  const fin = await until(() => dm.evaluate(() => DNDGame.G.cb && (DNDGame.G.cb.won || DNDGame.G.cb.lost) && (DNDGame.G.cb.won ? "перемога" : "поразка")), 150000);
  check("боти й монстри довоювали бій у залі самі", !!fin, fin || ("раунд " + (await dm.evaluate(() => DNDGame.G.cb && DNDGame.G.cb.round))));
  await dm.click('[data-a="fightend"]').catch(() => {});
  await dm.evaluate(() => DNDGame.send({ t: "fightend" }));
  await dm.click('[data-tab="party"]');
  await dm.click('[data-bot="ranger"]');
  check("посеред гри — бот додається з вкладки «Гравці»", !!(await until(() => dm.evaluate(() => Object.values(DNDGame.G.chars).some((c) => c.bot && c.cls === "ranger")))));
  check("жодної JS-помилки", dm.errors.length === 0, dm.errors.slice(0, 4).join(" || "));
  const okN = results.filter(Boolean).length;
  console.log(`\n${okN}/${results.length} перевірок`);
  await b.close(); process.exit(okN === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
