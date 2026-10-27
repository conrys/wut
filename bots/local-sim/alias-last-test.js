// Еліас: «Час вийшов! Останнє слово» — слово бачить лише пояснювач; решта бачить його на підсумку ходу.
// node alias-last-test.js   (симулятор має бути запущений)
const { launch, phone, BASE } = require("./harness");
const results = [];
function check(name, ok, extra) { results.push(ok); console.log(`${ok ? "✅" : "❌"} ${name}${extra ? " — " + extra : ""}`); }
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { const r = await fn(); if (r) return r; await new Promise((x) => setTimeout(x, 300)); } return null; };
const db = (p) => fetch(`${BASE}/db/${p}.json`).then((r) => r.json());
(async () => {
  await fetch(BASE + "/__mock/reset");
  const b = await launch();
  const room = "AL" + Math.floor(Math.random() * 900 + 100);
  const names = ["Влад", "Оля", "Петро", "Іра"], pages = {};
  for (const n of names) { const p = await phone(b, n); await p.goto(`${BASE}/alias.html?room=${room}`, { waitUntil: "load" }); await p.waitForTimeout(Object.keys(pages).length ? 900 : 2500); pages[n] = p; }
  await until(async () => { const r = await db(`alias_rooms/${room}`); return r && r.players && Object.keys(r.players).length === 4; });
  await pages["Влад"].waitForTimeout(1500);
  await pages["Влад"].evaluate(() => AliasGame.startGame());
  let r = await until(async () => { const x = await db(`alias_rooms/${room}`); return x && x.phase === "ready" && x.explainer && x; });
  check("гра почалась", !!r, r && `пояснює ${r.explainer}`);
  const ex = r.explainer;
  await pages[ex].evaluate(() => AliasGame.beginTurn());
  r = await until(async () => { const x = await db(`alias_rooms/${room}`); return x && x.phase === "playing" && x; });
  await pages[ex].evaluate(() => { AliasGame.mark(true); });
  await pages[ex].waitForTimeout(600);
  // таймер — одразу в нуль
  await pages[ex].evaluate(() => AliasGame.roomRef.update({ endsAt: AliasGame.now() - 1 }));
  r = await until(async () => { const x = await db(`alias_rooms/${room}`); return x && x.phase === "last" && x; });
  check("час вийшов → «останнє слово»", !!r);
  const word = r.cur;
  await pages[ex].waitForTimeout(1200);
  const seen = {};
  for (const n of names) seen[n] = await pages[n].evaluate((w) => document.getElementById("stage").innerText.includes(w), word);
  check("пояснювач бачить останнє слово", seen[ex], word);
  const others = names.filter((n) => n !== ex);
  check("усі інші (і своя команда, і суперники) слова НЕ бачать", others.every((n) => !seen[n]), JSON.stringify(seen));
  await pages[others[0]].screenshot({ path: __dirname + "/out/alias-last-guesser.png" });
  await pages[ex].evaluate(() => AliasGame.setLast(-1));
  await until(async () => { const x = await db(`alias_rooms/${room}`); return x && x.phase === "review"; });
  await pages[ex].waitForTimeout(1200);
  const after = {};
  for (const n of names) after[n] = await pages[n].evaluate((w) => document.getElementById("stage").innerText.includes(w), word);
  check("після завершення ходу слово бачать усі (навіть «ніхто не вгадав»)", names.every((n) => after[n]), JSON.stringify(after));
  await pages[others[0]].screenshot({ path: __dirname + "/out/alias-review.png" });
  const errs = Object.values(pages).flatMap((p) => p.errors).filter((e) => !/navigator.vibrate/.test(e));
  check("без JS-помилок", !errs.length, errs.slice(0, 2).join(" | "));
  await b.close();
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
})();
