// Квіз: набори 2/3/4 у лобі, перемикання ведучим, гра з Квізу 3, стара кімната з прибраним Квізом 1.
// node quiz-sets-test.js   (симулятор має працювати: node server.js)
const { launch, phone, BASE } = require("./harness");
const until = async (p, fn, arg, ms = 70000) => p.waitForFunction(fn, arg, { timeout: ms, polling: 300 });

(async () => {
  await fetch(BASE + "/__mock/reset");
  const b = await launch();
  const room = "QS" + Math.floor(Math.random() * 900 + 100);
  const A = await phone(b, "Влад", { lite: true }), B = await phone(b, "Олена К", { lite: true });
  let fails = 0;
  const check = (ok, msg) => { if (!ok) fails++; console.log(`${ok ? "✅" : "❌"} ${msg}`); };

  await A.goto(`${BASE}/quiz.html?room=${room}`, { waitUntil: "load" });
  await until(A, () => document.querySelectorAll("#setBtns [data-set]").length > 0);
  await B.goto(`${BASE}/quiz.html?room=${room}`, { waitUntil: "load" });
  await until(A, () => document.querySelectorAll("#playersList .pp-pl").length >= 2);

  const sets = await A.$$eval("#setBtns [data-set]", (bs) => bs.map((x) => x.dataset.set));
  check(JSON.stringify(sets) === '["2","3","4"]', "у лобі набори " + sets.join(", "));

  for (const id of ["4", "3"]) {
    await A.click(`#setBtns [data-set="${id}"]`);
    await until(B, (id) => (document.querySelector("#setBtns .selected") || {}).dataset?.set === id, id);
    const room1 = await (await fetch(`${BASE}/db/quiz_rooms/${room}.json`)).json();
    const names = room1.board.map((r) => r.name);
    const bank = await A.evaluate((id) => window.QUIZ_SETS[id].map((t) => t.name), id);
    check(room1.quizSet === id && names.every((n) => bank.includes(n)), `Квіз ${id}: поле з 6 тем свого набору (${names.slice(0, 3).join(", ")}…)`);
  }
  const note = await B.textContent("#setNote");
  check(/Open Trivia DB/.test(note), "підпис джерела в лобі: " + note.trim());

  await A.click("#btnForceStart");
  const pages = [A, B];
  const active = await (async () => {
    await until(A, () => document.querySelector(".qz-board"));
    for (const p of pages) if (await p.$(".qz-cell[data-ci]:not([disabled])")) return p;
  })();
  check(!!active, "гра почалась, хтось обирає питання");
  await active.click(".qz-cell[data-ci]:not([disabled])");
  await until(active, () => document.querySelectorAll(".qz-opt:not([disabled])").length === 4);
  const qText = await active.textContent(".qz-q");
  const inSet3 = await active.evaluate((t) => window.QUIZ_SETS["3"].some((x) => x.questions.some((q) => q.text === t.trim())), qText);
  check(inSet3, "питання з Квізу 3: " + qText.trim());
  await active.click(".qz-opt:not([disabled])");
  await until(active, () => document.querySelector(".qz-res"));
  check(true, "відповідь перевірено: " + (await active.textContent(".qz-res b")).trim());

  // стара кімната з набором «1»: не падає, а показує заглушку
  const stub = await A.evaluate(() => quizQuestionAt([{ set: "1", ti: 7, name: "X", questions: [{ qi: 2 }] }], 0, 0).text);
  check(/прибрано/.test(stub), "стара кімната з Квізом 1 не падає");

  for (const p of pages) check(p.errors.length === 0, `${p.username}: без JS-помилок ${p.errors.slice(0, 3).join(" | ")}`);
  await b.close();
  console.log(fails ? `${fails} failed` : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
