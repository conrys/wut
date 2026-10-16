// Charades: one-line emoji search, single spoken guesser marked by the encoder,
// host reload mid-game. node charades-test.js   (simulator must be running)
const { launch, phone, BASE } = require("./harness");
const results = [];
function check(name, ok, extra) { results.push(ok); console.log(`${ok ? "✅" : "❌"} ${name}${extra ? " — " + extra : ""}`); }
const ROOM = "CH" + Math.floor(Math.random() * 900 + 100);
const room = () => fetch(`${BASE}/db/charades_rooms/${ROOM}.json`).then((r) => r.json());
const until = async (fn, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { const r = await fn(); if (r) return r; await new Promise((x) => setTimeout(x, 300)); } return null; };
const found = (p) => p.$$eval("#chSearchResults [data-emoji]", (bs) => bs.map((b) => b.dataset.emoji));

(async () => {
  await fetch(BASE + "/__mock/reset");
  const b = await launch();
  const names = ["Влад", "Олена К", "Марʼяна"], pages = {};
  for (const n of names) { pages[n] = await phone(b, n); await pages[n].goto(`${BASE}/charades.html?room=${ROOM}`, { waitUntil: "load" }); await pages[n].waitForTimeout(n === names[0] ? 2500 : 800); }
  await pages[names[0]].waitForTimeout(2500);
  await pages[names[0]].click("#startBtn");
  let r = await until(async () => { const x = await room(); return x && x.stage && x.stage.kind === "encode" && x; });
  check("set started", !!r);
  check("no laps: rounds = all words of the level (99 on level 2)", r.totalRounds === 99 && r.deck.items.length === 99, String(r.totalRounds));
  check("laps setting is gone", !(await pages[names[0]].$("#lapsSeg")));
  let enc = r.stage.data.encoder, others = r.order.filter((n) => n !== enc);
  const E = pages[enc];
  await E.waitForSelector("#chEmoji", { timeout: 10000 });
  check("single input line (no separate search box)", !(await E.$("#chSearch")));

  const type = async (text) => { await E.type("#chEmoji", text); await E.waitForTimeout(500); };
  await type("ппппп");
  check("no results message", /Нічого не знайшлось/.test(await E.textContent("#chSearchResults")));
  await E.click("#chEmojiClear");
  await type("білка");
  const sq = await found(E);
  check("typing «білка» suggests 🐿️", sq.some((e) => e.startsWith("🐿")), sq.slice(0, 8).join(""));
  await E.click("#chSearchResults [data-emoji]");
  check("tap replaces the word with emoji", (await E.inputValue("#chEmoji")) === "🐿️", await E.inputValue("#chEmoji"));
  check("suggestions hide after replace", await E.isHidden("#chSearchResults"));
  await type("посмішки");
  const sm = await found(E);
  check("inflected «посмішки» → smileys", sm.includes("😀") && sm.length >= 10, sm.length + "");
  await E.click("#chSend");
  await E.waitForTimeout(300);
  check("letters left in field are refused", /Заміни слова/.test(await E.textContent("#chFeedback")), await E.textContent("#chFeedback"));
  await E.click("#chSearchResults [data-emoji]");
  await type("червоне серце");
  const hearts = await found(E);
  check("two words narrow («червоне серце» → ❤️)", hearts[0] === "❤️", hearts.join(""));
  await E.click("#chSearchResults [data-emoji]");
  const cipher = await E.inputValue("#chEmoji");
  check("cipher built from three words", Array.from(cipher).filter((c) => /\p{Extended_Pictographic}/u.test(c)).length === 3 && !/\p{L}/u.test(cipher), cipher);
  await E.click("#chSend");

  r = await until(async () => { const x = await room(); return x && x.stage && x.stage.kind === "guess" && x; });
  check("guess stage started", !!r);
  const G1 = pages[others[0]];
  await G1.waitForTimeout(800);
  check("guesser sees «say it aloud», no text box", (await G1.isVisible(".ch-say")) && !(await G1.$("#chGuess")));
  await E.waitForSelector(".ch-pick", { timeout: 5000 });
  const tap = async (n) => { await E.click(`.ch-pick[data-pick="${n}"]`); await E.waitForTimeout(500); };
  const marked = () => E.$$eval(".ch-pick.on", (bs) => bs.map((x) => x.dataset.pick));
  await tap(others[0]); await tap(others[1]);
  check("several guessers can be marked", (await marked()).length === 2, (await marked()).join(","));
  await tap(others[1]);
  check("tap again un-marks", JSON.stringify(await marked()) === JSON.stringify([others[0]]));
  await tap(others[1]);
  check("everyone sees who guessed", (await G1.textContent("#waitInfo")).includes(others[0]) && (await G1.textContent("#waitInfo")).includes(others[1]), await G1.textContent("#waitInfo"));
  await E.click("#chDone");
  r = await until(async () => { const x = await room(); return x && x.stage && x.stage.kind === "reveal" && x; });
  const pts = (r && r.stage.points) || {};
  check("points: each guesser +3, encoder +1", pts[others[0]] === 3 && pts[others[1]] === 3 && pts[enc] === 1, JSON.stringify(pts));

  // Host reloads the page between rounds: the game must keep running.
  const hostName = r.hostUsername;
  await pages[hostName].reload({ waitUntil: "load" });
  await pages[hostName].waitForTimeout(6000);
  await pages[hostName].click("#hostNextBtn");
  r = await until(async () => { const x = await room(); return x && x.stage && x.stage.kind === "encode" && x.roundNo === 1 && x; });
  check("host reloaded and moved on", !!r);
  enc = r.stage.data.encoder;
  const E2 = pages[enc];
  await E2.waitForSelector("#chEmoji", { timeout: 10000 });
  await E2.fill("#chEmoji", "🐶🍕");
  await E2.click("#chSend");
  r = await until(async () => { const x = await room(); return x && x.stage && x.stage.kind === "guess" && x; }, 10000);
  check("after host reload the stage still advances by itself", !!r);
  await E2.waitForSelector("#chDone", { timeout: 5000 });
  check("button says «Ніхто не вгадав» with no pick", /Ніхто не вгадав/.test(await E2.textContent("#chDone")));
  await E2.click("#chDone");
  r = await until(async () => { const x = await room(); return x && x.stage && x.stage.kind === "reveal" && x; });
  check("nobody guessed → encoder drinks", r && r.stage.penalties && r.stage.penalties[enc] === 1, JSON.stringify(r && r.stage.penalties));

  const errs = Object.values(pages).flatMap((p) => p.errors);
  check("no JS errors", !errs.length, errs.slice(0, 3).join(" | "));
  await b.close();
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
})();
