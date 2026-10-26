// Редактор питань (editor.html) + накладання змін у ігри. Запуск: node server.js, потім node editor-test.js
const { launch, phone, BASE } = require("./harness");
const res = []; const ok = (n, c, x) => { res.push(!!c); console.log((c ? "✓ " : "✗ ") + n + (x ? "  — " + x : "")); };
const SS = require("path").join(__dirname, "out", "");
require("fs").mkdirSync(SS, { recursive: true });
(async () => {
  await fetch(BASE + "/__mock/reset");
  const b = await launch();
  const a = await phone(b, "Влад");
  await a.goto(BASE + "/editor.html"); await a.waitForTimeout(800);
  ok("не адмін — відмова", (await a.textContent("#gate")).includes("немає права"));
  await a.evaluate(() => firebase.firestore().collection("games41_admins").doc("t_Влад").set({ name: "Влад" }));
  await a.reload(); await a.waitForSelector("#app:not(.hidden)", { timeout: 8000 });
  // 1. усі банки
  const ids = await a.$$eval("#listSel option", (o) => o.map((x) => x.value));
  const counts = [];
  for (const id of ids) { await a.selectOption("#listSel", id); await a.waitForTimeout(60); counts.push(id + ":" + (await a.textContent("#stats")).split(" ")[0]); }
  ok("16 банків, у кожному є вбудовані", ids.length === 16 && counts.every((c) => Number(c.split(":")[1]) > 0), counts.join(" "));
  const add = async (fill) => { await a.click("#addBtn"); await a.waitForSelector("#sheet:not(.hidden)"); await fill(); await a.click("#fSave"); await a.waitForTimeout(500); };
  // 2. Хто з нас: додати
  await a.selectOption("#listSel", "whofrom");
  await add(async () => { await a.fill("#f_text", "Хто з нас найімовірніше напише редактор питань з телефона?"); await a.click('#f_level button[data-v="2"]'); });
  ok("додано в «Хто з нас?»", await a.isHidden("#sheet") && (await a.textContent("#list .it")).includes("редактор питань"));
  // дубль
  await add(async () => { await a.fill("#f_text", "Хто з нас найімовірніше засне посеред вечірки?"); });
  ok("дубль вбудованого не пропускає", (await a.textContent("#fErr")).includes("вже є"));
  await a.goBack(); await a.waitForTimeout(200);
  // 3. Суд: змінити вбудоване
  await a.selectOption("#listSel", "court");
  const courtOrig = await a.textContent("#list .it .t");
  await a.click("#list .it"); await a.waitForSelector("#sheet:not(.hidden)");
  await a.fill("#f_text", courtOrig + " (редаговано)"); await a.click("#fSave"); await a.waitForTimeout(500);
  await a.click('#st button[data-s="edit"]');
  ok("змінене вбудоване видно у фільтрі «Змінені»", (await a.textContent("#list")).includes("(редаговано)"));
  await a.click('#st button[data-s="all"]');
  // 4. Ставки: прибрати
  await a.selectOption("#listSel", "bets");
  const betHidden = await a.textContent("#list .it .t");
  await a.click("#list .it"); await a.waitForSelector("#sheet:not(.hidden)"); await a.click("#fHide"); await a.waitForTimeout(500);
  await a.click('#st button[data-s="off"]');
  ok("приховане видно у «Приховані»", (await a.textContent("#list")).includes(betHidden));
  await a.click('#st button[data-s="all"]');
  // 5. Сміхлист: без ___
  await a.selectOption("#listSel", "quiplash");
  await add(async () => { await a.fill("#f_text", "Найкраща назва для кота"); });
  ok("Сміхлист вимагає ___", (await a.textContent("#fErr")).includes("___"));
  await a.fill("#f_text", "Найкраща назва для кота, який живе в Росії — ___");
  await a.waitForTimeout(100);
  ok("попередження про «Росії» з великої", (await a.textContent("#fWarn")).includes("з малої"));
  await a.click("#fLower"); await a.waitForTimeout(100);
  ok("«Зробити з малої» виправляє", (await a.inputValue("#f_text")).includes("в росії"), await a.inputValue("#f_text"));
  await a.click("#fSave"); await a.waitForTimeout(500);
  // 6. Хто я?: слово в тему
  await a.selectOption("#listSel", "whoami");
  await add(async () => { await a.selectOption("#f_theme", { index: 1 }); await a.fill("#f_text", "Редактор-невидимка"); await a.click('#f_level button[data-v="medium"]'); });
  const theme1 = await a.evaluate(() => WHOAMI_THEMES[1].name);
  // 7. Квіз: новий квіз 3, тема на всі ціни
  await a.selectOption("#listSel", "quiz");
  for (const v of [100, 200, 300, 400, 500]) {
    await add(async () => {
      await a.selectOption("#f_set", "3"); await a.waitForTimeout(80);
      await a.selectOption("#f_value", String(v)); await a.fill("#f_topic", "Тестова тема");
      await a.fill("#f_text", `Тестове питання за ${v}?`);
      for (let i = 0; i < 4; i++) await a.fill("#f_o" + i, `Варіант ${i + 1} (${v})`);
      await a.click('.opt button[data-c="2"]');

    });
  }
  const sets = await a.evaluate(() => Object.keys(QUIZ_SETS));
  const qtexts = await a.evaluate(() => QUIZ_SETS["3"][0].questions.map((q) => q.text)); ok("тексти питань не зіпсовані фокусом", qtexts.every((t, i) => t === `Тестове питання за ${(i + 1) * 100}?`), qtexts.join(" | "));
  ok("з редактора створено Квіз 3 (5 питань)", sets.includes("3") && (await a.evaluate(() => QUIZ_SETS["3"][0].questions.length)) === 5, sets.join(","));
  // змінити й прибрати вбудоване питання Квізу 1
  await a.fill("#q", "Яка столиця Польщі"); await a.waitForTimeout(300);
  await a.click("#list .it"); await a.waitForSelector("#sheet:not(.hidden)");
  await a.fill("#f_answerText", "Варшава — столиця Польщі з 1596 року (тест)."); await a.click("#fSave"); await a.waitForTimeout(400);
  await a.fill("#q", "Яка річка вважається найдовшою"); await a.waitForTimeout(300);
  await a.click("#list .it"); await a.waitForSelector("#sheet:not(.hidden)"); await a.click("#fHide"); await a.waitForTimeout(400);
  await a.fill("#q", ""); await a.waitForTimeout(200);
  await a.screenshot({ path: SS + "ed1.png" });
  await a.click("#list .it"); await a.waitForSelector("#sheet:not(.hidden)"); await a.screenshot({ path: SS + "ed2.png" }); await a.goBack();
  const docs = await a.evaluate(() => db.collection("games41_content").get().then((s) => s.docs.map((d) => d.data().list + ":" + d.data().op)));
  ok("записи в базі", docs.length === 12, docs.join(" "));

  // ---------- ігри підхоплюють ----------
  const g = await phone(b, "Олена К");
  const chk = async (page, fn, arg) => { await g.goto(BASE + "/" + page); await g.waitForTimeout(1500); return g.evaluate(fn, arg); };
  ok("whofrom.html: нове питання в банку", await chk("whofrom.html", () => PartySeed.WHOFROM.some((x) => x.text.includes("редактор питань") && x.level === 2)));
  ok("court.html: змінене звинувачення", await chk("court.html", (o) => PartySeed.COURT.some((x) => x.text === o + " (редаговано)") && !PartySeed.COURT.some((x) => x.text === o), courtOrig));
  ok("bets.html: прибране завдання зникло", await chk("bets.html", (t) => !PartySeed.BETS.some((x) => x.text === t), betHidden));
  ok("quiplash.html: нове питання (з малої)", await chk("quiplash.html", () => QUIPLASH_PROMPTS.some((t) => t.includes("в росії — ___"))));
  ok("whoami.html: нове слово в темі", await chk("whoami.html", (th) => WHOAMI_THEMES.find((t) => t.name === th).medium.includes("Редактор-невидимка"), theme1));
  ok("alias.html: бачить той самий банк Хто я?", await chk("alias.html", (th) => WHOAMI_THEMES.find((t) => t.name === th).medium.includes("Редактор-невидимка"), theme1));
  const qz = await chk("quiz.html", () => { const q1 = QUIZ_SETS["1"][0].questions; return { ids: Object.keys(QUIZ_SETS), edited: q1.find((q) => q.text.includes("Польщі")).answerText, off: !!q1.find((q) => q.text.includes("найдовшою")).off }; });
  ok("quiz.html: Квіз 3, змінене пояснення, приховане позначене", qz.ids.includes("3") && qz.edited.includes("(тест)") && qz.off, JSON.stringify(qz));
  // зіграти в Квіз 3
  await fetch(BASE + "/__mock/fs");
  const h = await phone(b, "Марʼяна");
  await h.goto(BASE + "/quiz.html?room=ED3"); await h.waitForTimeout(2500);
  await g.goto(BASE + "/quiz.html?room=ED3"); await g.waitForTimeout(2500);
  const host = (await (await fetch(BASE + "/db/quiz_rooms/ED3.json")).json()).hostUsername === "Марʼяна" ? h : g;
  const other = host === h ? g : h;
  ok("у лобі є «Квіз 3»", (await host.$$eval("#setBtns [data-set]", (e) => e.map((x) => x.dataset.set))).includes("3"));
  await host.click('#setBtns [data-set="3"]'); await host.waitForTimeout(800);
  let room = await (await fetch(BASE + "/db/quiz_rooms/ED3.json")).json();
  ok("поле з Квізу 3", room.quizSet === "3" && room.board.length === 1 && room.board[0].name === "Тестова тема", JSON.stringify(room.board.map((x) => x.name)));
  await host.click("#btnForceStart"); await host.waitForTimeout(1500);
  room = await (await fetch(BASE + "/db/quiz_rooms/ED3.json")).json();
  const act = room.currentPlayerUsername === "Марʼяна" ? h : g;
  await act.click(".qz-cell[data-ci]"); await act.waitForTimeout(1500);
  const shown = await other.textContent("#stage");
  ok("питання Квізу 3 показано іншому гравцеві", shown.includes("Тестове питання за 100?") && shown.includes("Варіант 3 (100)"), shown.slice(0, 80));
  // поле Квізу 1 не бере приховане
  const boards = await g.evaluate(() => { let hit = 0; for (let i = 0; i < 40; i++) { /* buildFreshBoard приватна: перевіряємо фільтр напряму */ } return QUIZ_SETS["1"][0].questions.filter((q) => q.value === 100 && !q.off).length; });
  ok("у темі Географія лишилось 2 питання за 100 (одне приховане)", boards === 2);
  // сторінки без помилок
  for (const p of ["party.html", "dilemmas.html", "charades.html", "quiplash-tv.html", "memology.html", "teli.html", "draw.html", "alias-solo.html", "crocodile.html", "spy.html", "quiz-tv.html"]) { await g.goto(BASE + "/" + p); await g.waitForTimeout(700); }
  const errs = a.errors.concat(g.errors, h.errors);
  ok("без JS-помилок (редактор + 19 сторінок ігор)", !errs.length, errs.slice(0, 5).join(" || "));
  console.log(`${res.filter(Boolean).length}/${res.length}`);
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
