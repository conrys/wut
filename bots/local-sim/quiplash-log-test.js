// Сміхлист: етап відповідей не закінчується, поки живий гравець ще друкує, навіть якщо в нього
// збитий годинник (heartbeat «старий» за часом сервера); журнал гри пишеться в glog/ і читається logs.html.
// node quiplash-log-test.js   (симулятор має бути запущений)
const { launch, phone, BASE } = require("./harness");
const results = [];
function check(name, ok, extra) { results.push(ok); console.log(`${ok ? "✅" : "❌"} ${name}${extra ? " — " + extra : ""}`); }
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { const r = await fn(); if (r) return r; await new Promise((x) => setTimeout(x, 300)); } return null; };
const db = (p) => fetch(`${BASE}/db/${p}.json`).then((r) => r.json());
(async () => {
  await fetch(BASE + "/__mock/reset");
  const b = await launch();
  const room = "QL" + Math.floor(Math.random() * 900 + 100);
  const names = ["Влад", "Оля", "Петро"];
  const pages = [];
  for (const n of names) {
    const p = await phone(b, n);
    // у Петра годинник телефона відстає на 12 с, а поправка сервера не приходить → його lastSeen «старий»
    if (n === "Петро") await p.addInitScript(() => { const real = Date.now; Date.now = () => real() - 12000; });
    await p.goto(`${BASE}/quiplash.html?room=${room}`, { waitUntil: "load" });
    await p.waitForTimeout(pages.length ? 1000 : 2500);
    pages.push(p);
  }
  await until(async () => { const r = await db(`quiplash_rooms/${room}`); return r && r.players && Object.keys(r.players).length === 3; });
  await pages[0].evaluate(() => QuiplashGame.startGame());
  const st = await until(async () => { const r = await db(`quiplash_rooms/${room}`); return r && r.phase === "answering" && r; }, 30000);
  check("гра дійшла до відповідей", !!st, st ? `раунд ${st.round}` : "");
  if (!st) { await b.close(); return; }
  const mine = (n) => Object.entries(st.matchups || {}).filter(([, m]) => m.playerAId === n || m.playerBId === n).map(([id]) => id);
  for (const i of [0, 1]) for (const id of mine(names[i])) await pages[i].evaluate(([id]) => QuiplashGame.submitAnswer(id, "відповідь " + Math.random().toString(36).slice(2, 6)), [id]);
  await pages[0].waitForTimeout(5000);
  let r = await db(`quiplash_rooms/${room}`);
  check("2 з 3 відповіли — етап НЕ закінчився (Петро ще друкує)", r.phase === "answering", r.phase);
  for (const id of mine(names[2])) await pages[2].evaluate(([id]) => QuiplashGame.submitAnswer(id, "і я теж"), [id]);
  r = await until(async () => { const x = await db(`quiplash_rooms/${room}`); return x && x.phase !== "answering" && x; }, 8000);
  check("Петро відповів — етап закінчився одразу", r && r.phase === "answer_countdown", r && r.phase);

  // журнал
  await pages[0].waitForTimeout(4000);
  const idx = await db("glogi/quiplash");
  const logId = idx && Object.keys(idx).find((k) => k.startsWith(room));
  check("журнал з'явився в glogi", !!logId, logId);
  const evs = Object.values((await db(`glog/quiplash/${logId}`)) || {});
  const kinds = (k) => evs.filter((e) => e.k === k);
  check("join від усіх трьох", new Set(kinds("join").map((e) => e.u)).size === 3);
  const end = kinds("q-answers-end")[0], d = end && JSON.parse(end.d);
  check("кінець відповідей: причина «усі відповіли», присутність усіх", d && d.why === "all-answered" && Object.keys(d.pres).length === 3, end && end.d.slice(0, 160));
  check("відповіді й фази записані", kinds("answer").length >= 3 && kinds("phase").length >= 6, `answer ${kinds("answer").length}, phase ${kinds("phase").length}`);

  // перегляд (dev-акаунт)
  const v = await phone(b, "conrys");
  await v.goto(`${BASE}/logs.html`, { waitUntil: "load" });
  await v.waitForSelector(".log-row", { timeout: 10000 }).catch(() => {});
  check("logs.html: журнал у списку", await v.evaluate((room) => [...document.querySelectorAll(".log-row b")].some((x) => x.textContent.includes(room)), room));
  await v.click(".log-row"); await v.waitForSelector(".ev", { timeout: 8000 }).catch(() => {});
  const tl = await v.evaluate(() => document.getElementById("tl").innerText);
  check("logs.html: часова лінія з причиною", /КІНЕЦЬ ВІДПОВІДЕЙ/.test(tl) && /усі відповіли/.test(tl), tl.split("\n").slice(0, 3).join(" | "));
  await v.screenshot({ path: __dirname + "/out/logs-view.png", fullPage: false });
  check("logs.html: бачить збитий годинник Петра", /годинник телефона відстає на 1\d с/.test(tl));
  const s = await phone(b, "гість");
  await s.goto(`${BASE}/logs.html`, { waitUntil: "load" }); await s.waitForTimeout(1500);
  check("logs.html: не dev — закрито", await s.evaluate(() => !document.getElementById("denied").classList.contains("hidden")));
  const errs = pages.concat([v]).flatMap((p) => p.errors);
  check("без JS-помилок", !errs.length, errs.slice(0, 2).join(" | "));
  await b.close();
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
})();
