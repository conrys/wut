// No round-count setting: a set lasts as long as the deck for the chosen level.
// node rounds-test.js   (simulator must be running)
const { launch, phone, BASE } = require("./harness");
const GAMES = [["whofrom.html", "party_whofrom", "items"], ["court.html", "party_court", "items"], ["bets.html", "party_bets", "items"],
  ["party.html", "party", "items"], ["dilemmas.html", "dilemmas", "cards"]];
const results = [];
function check(name, ok, extra) { results.push(ok); console.log(`${ok ? "✅" : "❌"} ${name}${extra ? " — " + extra : ""}`); }
const until = async (fn, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { const r = await fn(); if (r) return r; await new Promise((x) => setTimeout(x, 300)); } return null; };
(async () => {
  await fetch(BASE + "/__mock/reset");
  const b = await launch();
  for (const [page, key, deckField] of GAMES) {
    const room = "RD" + Math.floor(Math.random() * 900 + 100);
    const pages = [];
    for (const n of ["Влад", "Олена К", "Марʼяна"]) { const p = await phone(b, n); await p.goto(`${BASE}/${page}?room=${room}`, { waitUntil: "load" }); await p.waitForTimeout(pages.length ? 800 : 2500); pages.push(p); }
    await pages[0].waitForTimeout(2500);
    check(`${page}: no rounds setting`, !(await pages[0].$("#roundsSeg")));
    await pages[0].click("#startBtn");
    const r = await until(async () => { const x = await fetch(`${BASE}/db/${key}_rooms/${room}.json`).then((q) => q.json()); return x && x.totalRounds && x; });
    const deck = r && (deckField === "cards" ? r.cards : r.deck && r.deck.items) || [];
    check(`${page}: rounds = whole deck`, r && r.totalRounds === deck.length && deck.length > 14, r ? `${r.totalRounds} rounds, deck ${deck.length}` : "not started");
    const errs = pages.flatMap((p) => p.errors);
    if (errs.length) check(`${page}: no JS errors`, false, errs.slice(0, 2).join(" | "));
    for (const p of pages) await p.context().close();
  }
  await b.close();
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
})();
