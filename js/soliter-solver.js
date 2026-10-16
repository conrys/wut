// ==========================================================================
// Солвер Косинки (Klondike) — DFS з пам'яттю позицій і лімітом вузлів.
// Знає всі карти (і закриті теж), тобто відповідає на питання «чи можна
// цей розклад виграти взагалі».
//
//   solve(state, { drawCount, maxNodes, complete }) →
//     { result: "win" | "lose" | "unknown", nodes }
//
// state — той самий формат, що й у soliter.html:
//   { tableau: [[{suit,rank,faceUp}]], foundations: {S:[..],H:[..],..},
//     stock: [..] (останній = наступний у доборі), waste: [..] (останній = верхній) }
//
// complete:false (роздача) — урізаний набір ходів, швидко; "win" чесний,
//   бо всі ходи легальні, а "lose" може бути хибним — тому роздачі без "win"
//   просто відкидаємо.
// complete:true (глухий кут) — усі корисні ходи, включно з поверненням карти
//   з бази і частковими перенесеннями; "lose" = доведено, що виграти не можна.
//
// Працює як звичайний скрипт (window.SoliterSolver), як Web Worker
// (postMessage({id, state, opts}) → {id, result, nodes}) і як модуль Node.
// ==========================================================================
(function (root) {
  const SUITS = ["S", "H", "D", "C"];
  const RED = [false, true, true, false];

  // карта = suit*16 + rank (rank 1..13)
  const suitOf = (c) => c >> 4;
  const rankOf = (c) => c & 15;
  const isRed = (c) => RED[c >> 4];
  const enc = (card) => SUITS.indexOf(card.suit) * 16 + card.rank;

  function fromState(state) {
    const cols = state.tableau.map((col) => col.map(enc));
    const down = state.tableau.map((col) => col.filter((c) => !c.faceUp).length);
    const found = SUITS.map((s) => ((state.foundations && state.foundations[s]) || []).length);
    // талон у порядку добору: спершу відбій (знизу вгору), потім колода (згори вниз)
    const talon = (state.waste || []).map(enc).concat((state.stock || []).slice().reverse().map(enc));
    return { cols, down, found, talon, p: (state.waste || []).length };
  }

  // Відбиток позиції саме в тому вигляді, як її бачить гравець (колонки на
  // своїх місцях, покажчик колоди враховано) — щоб звірити з кроком плану.
  function sig(s) {
    return s.cols.map((c, i) => s.down[i] + ":" + c.join(",")).join("|") + "/" + s.found.join(",") + "/" + s.talon.join(",") + "@" + s.p;
  }
  function signature(state) { return sig(fromState(state)); }

  function solve(state, opts) {
    opts = opts || {};
    const k = opts.drawCount === 3 ? 3 : 1;
    const maxNodes = opts.maxNodes || 200000;
    const complete = !!opts.complete;
    const seen = new Set();
    let nodes = 0;
    let aborted = false;

    const canStack = (lower, upper) => rankOf(upper) === rankOf(lower) + 1 && isRed(upper) !== isRed(lower);
    const toFound = (s, c) => s.found[suitOf(c)] === rankOf(c) - 1;
    // «безпечна» карта в базу: її вже ніхто не потребує як опору
    function safeToFound(s, c) {
      const r = rankOf(c);
      if (r <= 2) return true;
      const red = isRed(c);
      for (let i = 0; i < 4; i++) if (RED[i] !== red && s.found[i] < r - 1) return false;
      return true;
    }

    function key(s) {
      const cols = s.cols.map((c, i) => s.down[i] + ":" + c.join(",")).sort().join("|");
      return cols + "/" + s.found.join(",") + "/" + s.talon.join(",") + (k === 1 ? "" : "@" + s.p);
    }

    function clone(s) {
      return { cols: s.cols.map((c) => c.slice()), down: s.down.slice(), found: s.found.slice(), talon: s.talon.slice(), p: s.p };
    }

    function reveal(s, i) { s.down[i] = Math.max(0, Math.min(s.down[i], s.cols[i].length - 1)); }

    // Які карти талону досяжні (index, і де після цього опиниться покажчик)
    function talonReachable(s) {
      const n = s.talon.length, out = [];
      if (!n) return out;
      if (k === 1) { for (let i = 0; i < n; i++) out.push(i); return out; }
      const seenIdx = new Set();
      if (s.p > 0) { out.push(s.p - 1); seenIdx.add(s.p - 1); }
      let p = s.p, wrapped = false;
      for (let guard = 0; guard < 2 * n + 4; guard++) {
        if (p >= n) { if (wrapped) break; wrapped = true; p = 0; }
        p = Math.min(p + k, n);
        const idx = p - 1;
        if (!seenIdx.has(idx)) { seenIdx.add(idx); out.push(idx); }
        else if (wrapped) break;
      }
      return out;
    }
    function takeTalon(s, idx) { s.talon.splice(idx, 1); s.p = idx; }

    // Одна «безпечна» карта в базу (першою — з колонок зліва направо, потім
    // верх відбою). autoplay — це просто повтор autoStep, тож план, зібраний
    // по кроках, дає точно ті самі позиції, що й пошук.
    function autoStep(s) {
      for (let i = 0; i < 7; i++) {
        const col = s.cols[i];
        if (!col.length) continue;
        const c = col[col.length - 1];
        if (toFound(s, c) && safeToFound(s, c)) return { t: "tf", i };
      }
      // Верх відбою — лише при доборі по 1. По 3 зняття карти зсуває трійки в
      // колоді, і «безпечний» хід може відрізати потрібну карту.
      if (k === 1 && s.p > 0) {
        const c = s.talon[s.p - 1];
        if (toFound(s, c) && safeToFound(s, c)) return { t: "lf", idx: s.p - 1 };
      }
      return null;
    }
    function autoplay(s) { let m; while ((m = autoStep(s))) applyRaw(s, m); }

    let shortcut = true;
    function won(s) {
      if (s.found.every((f) => f === 13)) return true;
      // усе відкрито і талон порожній — далі виграш гарантований
      return shortcut && !s.talon.length && s.down.every((d) => d === 0);
    }

    function moves(s) {
      const out = [];
      // 1) у базу з таблиці
      for (let i = 0; i < 7; i++) {
        const col = s.cols[i];
        if (col.length && toFound(s, col[col.length - 1])) out.push({ pr: 100 + s.down[i], t: "tf", i });
      }
      // 2) переноси в таблиці
      for (let i = 0; i < 7; i++) {
        const col = s.cols[i];
        for (let j = s.down[i]; j < col.length; j++) {
          const c = col[j];
          const whole = j === s.down[i];
          const exposesFound = j > 0 && j > s.down[i] && toFound(s, col[j - 1]);
          if (!complete) {
            if (!whole && !exposesFound) continue;
            if (whole && s.down[i] === 0 && j === 0 && rankOf(c) === 13) continue; // король і так на дні
          } else if (whole && j === 0 && rankOf(c) === 13) continue; // нічого не змінює
          let emptyTried = false;
          for (let t = 0; t < 7; t++) {
            if (t === i) continue;
            const dst = s.cols[t];
            if (!dst.length) {
              if (rankOf(c) !== 13 || emptyTried || j === 0) continue;
              emptyTried = true; // усі порожні колонки рівноцінні
              out.push({ pr: whole ? 60 + s.down[i] : 30, t: "tt", i, j, d: t });
            } else if (canStack(c, dst[dst.length - 1])) {
              out.push({ pr: whole ? (s.down[i] ? 70 + s.down[i] : 20) : 40, t: "tt", i, j, d: t });
            }
          }
        }
      }
      // 3) з талону
      for (const idx of talonReachable(s)) {
        const c = s.talon[idx];
        if (toFound(s, c)) out.push({ pr: 90, t: "lf", idx });
        let emptyTried = false;
        for (let t = 0; t < 7; t++) {
          const dst = s.cols[t];
          if (!dst.length) {
            if (rankOf(c) !== 13 || emptyTried) continue;
            emptyTried = true;
            out.push({ pr: 50, t: "lt", idx, d: t });
          } else if (canStack(c, dst[dst.length - 1])) out.push({ pr: 50, t: "lt", idx, d: t });
        }
      }
      // 4) з бази назад у таблицю (лише в повному режимі)
      if (complete) {
        for (let f = 0; f < 4; f++) {
          if (!s.found[f]) continue;
          const c = f * 16 + s.found[f];
          for (let t = 0; t < 7; t++) {
            const dst = s.cols[t];
            if (dst.length ? canStack(c, dst[dst.length - 1]) : rankOf(c) === 13) { out.push({ pr: 5, t: "ft", f, d: t }); if (!dst.length) break; }
          }
        }
      }
      return out.sort((a, b) => b.pr - a.pr);
    }

    function applyRaw(n, m) {
      if (m.t === "tf") { const c = n.cols[m.i].pop(); n.found[suitOf(c)]++; reveal(n, m.i); }
      else if (m.t === "tt") { const run = n.cols[m.i].splice(m.j); n.cols[m.d].push(...run); reveal(n, m.i); }
      else if (m.t === "lf") { const c = n.talon[m.idx]; takeTalon(n, m.idx); n.found[suitOf(c)]++; }
      else if (m.t === "lt") { const c = n.talon[m.idx]; takeTalon(n, m.idx); n.cols[m.d].push(c); }
      else if (m.t === "ft") { const c = m.f * 16 + n.found[m.f]; n.found[m.f]--; n.cols[m.d].push(c); }
    }
    function apply(s, m) {
      const n = clone(s);
      applyRaw(n, m);
      autoplay(n);
      return n;
    }

    let path = [], endState = null;
    function dfs(s) {
      if (won(s)) { endState = s; return true; }
      const kk = key(s);
      if (seen.has(kk)) return false;
      seen.add(kk);
      if (++nodes > maxNodes) { aborted = true; return false; }
      for (const m of moves(s)) {
        path.push(m);
        if (dfs(apply(s, m))) return true;
        path.pop();
        if (aborted) return false;
      }
      return false;
    }

    // Хід у термінах інтерфейсу: звідки (tableau/waste/stock/foundation) і куди.
    function describe(s, m) {
      const card = (c) => ({ suit: SUITS[suitOf(c)], rank: rankOf(c) });
      if (m.t === "tf") { const c = s.cols[m.i][s.cols[m.i].length - 1]; return { card: card(c), from: { type: "tableau", col: m.i, idx: s.cols[m.i].length - 1 }, to: { type: "foundation", suit: SUITS[suitOf(c)] } }; }
      if (m.t === "tt") return { card: card(s.cols[m.i][m.j]), from: { type: "tableau", col: m.i, idx: m.j }, to: { type: "tableau", col: m.d } };
      if (m.t === "ft") return { card: card(m.f * 16 + s.found[m.f]), from: { type: "foundation", suit: SUITS[m.f] }, to: { type: "tableau", col: m.d } };
      const c = s.talon[m.idx];
      return { card: card(c), from: { type: "waste" }, to: m.t === "lf" ? { type: "foundation", suit: SUITS[suitOf(c)] } : { type: "tableau", col: m.d } };
    }

    // Повний план від позиції гравця до перемоги: кожен крок = { sig, hint },
    // включно з автоматичними ходами в базу і тапами по колоді (карта з
    // глибини талону — це кілька «тапни колоду», доки вона не стане зверху).
    function buildPlan(orig, moveList) {
      const s = clone(orig), out = [];
      const emit = (m) => {
        if ((m.t === "lf" || m.t === "lt") && m.idx !== s.p - 1) {
          const n = s.talon.length;
          for (let guard = 0; s.p - 1 !== m.idx; guard++) {
            if (guard > 3 * n + 3) return false;
            out.push({ sig: sig(s), hint: { card: { suit: SUITS[suitOf(s.talon[m.idx])], rank: rankOf(s.talon[m.idx]) }, from: { type: "stock" }, to: null } });
            s.p = s.p >= n ? 0 : Math.min(s.p + k, n);
          }
        }
        out.push({ sig: sig(s), hint: describe(s, m) });
        applyRaw(s, m);
        return true;
      };
      const flush = () => { let a; while ((a = autoStep(s))) if (!emit(a)) return false; return true; };
      if (!flush()) return null;
      for (const m of moveList) if (!emit(m) || !flush()) return null;
      return out;
    }

    const orig = fromState(state);
    const start = clone(orig);
    autoplay(start);
    const ok = dfs(start);
    const res = { result: ok ? "win" : aborted ? "unknown" : "lose", nodes };
    if (ok && opts.plan) {
      let moveList = path.slice();
      // дійшли «скороченням» (усе відкрито) — дошукуємо шлях до кінця, це швидко
      if (!endState.found.every((f) => f === 13)) {
        const from = endState;
        shortcut = false; seen.clear(); path = []; nodes = 0; aborted = false;
        if (dfs(from)) moveList = moveList.concat(path); else moveList = null;
      }
      res.plan = moveList && buildPlan(orig, moveList);
    }
    return res;
  }

  const api = { solve, signature };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SoliterSolver = api;

  // Web Worker: postMessage({ id, state, opts }) → { id, result, nodes }
  if (typeof WorkerGlobalScope !== "undefined" && root instanceof WorkerGlobalScope) {
    root.onmessage = (e) => {
      const { id, state, opts } = e.data || {};
      let res;
      try { res = solve(state, opts); } catch (err) { res = { result: "unknown", nodes: 0, error: String(err) }; }
      root.postMessage({ id, ...res });
    };
  }
})(typeof self !== "undefined" ? self : this);
