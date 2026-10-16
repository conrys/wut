// Солвер Косинки без браузера: кожна прийнята роздача доходить до перемоги,
// якщо просто виконувати підказки (хід за ходом, як у грі).
// node soliter-solver-test.js [кількість роздач]
const { solve } = require("../../js/soliter-solver.js");
const SUITS = ["S", "H", "D", "C"];
const RED = new Set(["H", "D"]);
const results = [];
function check(name, ok, extra) { results.push(ok); console.log(`${ok ? "✅" : "❌"} ${name}${extra ? " — " + extra : ""}`); }

function randomDeal() {
  const d = [];
  SUITS.forEach((s) => { for (let r = 1; r <= 13; r++) d.push({ suit: s, rank: r, faceUp: false }); });
  for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; }
  const tableau = [[], [], [], [], [], [], []]; let n = 0;
  for (let c = 0; c < 7; c++) for (let r = 0; r <= c; r++) tableau[c].push({ ...d[n++], faceUp: r === c });
  return { tableau, foundations: { S: [], H: [], D: [], C: [] }, stock: d.slice(n), waste: [] };
}

// ті самі правила, що й у soliter.html
function legalOnTableau(col, card) {
  if (!col.length) return card.rank === 13;
  const top = col[col.length - 1];
  return top.faceUp && top.rank === card.rank + 1 && RED.has(top.suit) !== RED.has(card.suit);
}
function applyHint(st, h, draw) {
  const reveal = (col) => { if (col.length && !col[col.length - 1].faceUp) col[col.length - 1].faceUp = true; };
  if (h.from.type === "stock") {
    if (!st.stock.length) { st.stock = st.waste.reverse().map((c) => ({ ...c, faceUp: false })); st.waste = []; return true; }
    for (let i = 0; i < draw && st.stock.length; i++) { const c = st.stock.pop(); c.faceUp = true; st.waste.push(c); }
    return true;
  }
  let cards;
  if (h.from.type === "waste") cards = [st.waste[st.waste.length - 1]];
  else if (h.from.type === "foundation") cards = [st.foundations[h.from.suit][st.foundations[h.from.suit].length - 1]];
  else cards = st.tableau[h.from.col].slice(h.from.idx);
  const c = cards[0];
  if (!c || c.suit !== h.card.suit || c.rank !== h.card.rank) return false;
  if (h.to.type === "foundation") {
    if (cards.length !== 1 || st.foundations[c.suit].length !== c.rank - 1) return false;
    st.foundations[c.suit].push(c);
  } else {
    if (!legalOnTableau(st.tableau[h.to.col], c)) return false;
    st.tableau[h.to.col].push(...cards.map((x) => ({ ...x, faceUp: true })));
  }
  if (h.from.type === "waste") st.waste.pop();
  else if (h.from.type === "foundation") st.foundations[h.from.suit].pop();
  else { st.tableau[h.from.col].splice(h.from.idx); reveal(st.tableau[h.from.col]); }
  return true;
}

const { signature } = require("../../js/soliter-solver.js");
const N = Number(process.argv[2]) || 60;
for (const draw of [1, 3]) {
  let repeated = 0, looped = 0, accepted = 0, wonByPlan = 0, sigMismatch = 0, illegal = 0, noPlan = 0, recheckFail = 0, maxSteps = 0;
  const nodes = [];
  for (let i = 0; i < N; i++) {
    const st = randomDeal();
    const r = solve(st, { drawCount: draw, maxNodes: 30000, plan: true });
    if (r.result !== "win") continue;
    accepted++; nodes.push(r.nodes);
    if (!r.plan) { noPlan++; continue; }
    let ok = true;
    if (new Set(r.plan.map((x) => x.sig)).size !== r.plan.length) repeated++;
    // так само, як гра: крок шукаємо за відбитком поточної позиції
    let guard = 0;
    while (ok && SUITS.some((s) => st.foundations[s].length < 13)) {
      if (++guard > r.plan.length + 1) { looped++; ok = false; break; }
      const sigNow = signature(st);
      const step = r.plan.find((x) => x.sig === sigNow);
      if (!step) { sigMismatch++; ok = false; break; }
      // посеред плану позиція має лишатися виграшною і для нового пошуку
      if (guard % 25 === 12 && solve(st, { drawCount: draw, maxNodes: 300000 }).result === "lose") recheckFail++;
      if (!applyHint(st, step.hint, draw)) { illegal++; ok = false; console.log("illegal", JSON.stringify(step.hint)); }
    }
    if (ok && SUITS.every((s) => st.foundations[s].length === 13)) wonByPlan++;
    maxSteps = Math.max(maxSteps, r.plan.length);
  }
  nodes.sort((a, b) => a - b);
  const q = (f) => nodes[Math.floor(nodes.length * f)];
  check(`draw ${draw}: every accepted deal is won by following the hint plan`, wonByPlan === accepted && accepted > 0,
    `${wonByPlan}/${accepted} won; no plan ${noPlan}, sig mismatch ${sigMismatch}, illegal ${illegal}, max ${maxSteps} steps; nodes q25/50/75: ${q(0.25)}/${q(0.5)}/${q(0.75)}`);
  check(`draw ${draw}: no repeated positions in a plan, no hint loops`, repeated === 0 && looped === 0, `repeated ${repeated}, looped ${looped}`);
  check(`draw ${draw}: positions along the plan stay winnable`, recheckFail === 0, `${recheckFail} false «lose»`);
}
console.log(`
${results.filter(Boolean).length}/${results.length} passed`);
