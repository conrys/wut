// ==========================================================================
// Генератор розкладок Косинки (Klondike, draw-1) з перевіркою розв'язності.
//
// Принцип — той самий, що описаний як орієнтир (і справді відповідає
// публічно відомому підходу Microsoft Solitaire): розкладка тасується,
// потім пробний "солвер" з ПОВНОЮ інформацією про колоду (бачить усі
// закриті карти наперед — так само, як це робить сам генератор, а не
// гравець) намагається знайти виграшну послідовність ходів. Якщо
// знаходить — розкладка гарантовано виграшна за правильної гри.
// Якщо ні (або бюджет часу/кроків вичерпано) — тасуємо й пробуємо знову.
//
// Це НЕ математично ідеальний солвер (повний доказ розв'язності Косинки —
// дуже дорога задача навіть офлайн), а обмежений за часом і кількістю
// вузлів пошук, як і в реальних комерційних реалізаціях. Для переважної
// більшості розкладок цього достатньо, щоб знайти розв'язок за розумний
// час (мілісекунди–секунди).
//
// Підключення:
//   - Як звичайний скрипт у сторінці: <script src="js/klondike-solver.js">
//     → доступний window.KlondikeSolver.generateSolvableDeal(...)
//   - Як Web Worker: new Worker('js/klondike-solver.js'), спілкування
//     через postMessage({ cmd: 'generate', opts }) → відповідь { result }.
//     Файл сам є скриптом воркера (нічого додатково імпортувати не треба) —
//     це винесено в окремий потік саме тому, що пошук може зайняти
//     помітний час і не повинен підвішувати інтерфейс.
// ==========================================================================
(function (global) {
  const SUITS = ["S", "H", "D", "C"];
  const RED_SUITS = new Set(["H", "D"]);
  const DRAW_COUNT = 1; // скільки карт відкривається за одне тягнення зі стоку (1 = класична складна версія, 3 = полегшена)

  function colorOf(card) { return RED_SUITS.has(card.suit) ? "red" : "black"; }

  // Правильна класична послідовність: спадання на 1, чергування кольору.
  // (Без King-on-Ace — це помилка в оригінальній грі, тут не повторюємо.)
  function isSequential(upper, lower) {
    return lower.rank === upper.rank - 1 && colorOf(lower) !== colorOf(upper);
  }

  function freshShuffledDeck() {
    const deck = [];
    SUITS.forEach((s) => {
      for (let r = 1; r <= 13; r++) deck.push({ suit: s, rank: r, id: `${s}_${r}` });
    });
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
  }

  // Роздача: 7 стовпців (1..7 карт, тільки верхня "відкрита" — хоча для
  // солвера "закритість" не має значення, він бачить усе; faceUp тут лише
  // для сумісності формату з тим, що очікує головна гра).
  function dealFromDeck(deck) {
    const pool = deck.slice();
    const tableau = [];
    for (let c = 0; c < 7; c++) {
      const col = [];
      for (let i = 0; i <= c; i++) col.push(pool.pop());
      tableau.push(col.map((card, idx) => ({ ...card, faceUp: idx === col.length - 1 })));
    }
    return { tableau, stock: pool };
  }

  // ------------------------- стан для солвера -------------------------
  function toSolverState(deal) {
    return {
      tableau: deal.tableau.map((col) => col.map((c) => ({ suit: c.suit, rank: c.rank }))),
      foundations: { S: 0, H: 0, D: 0, C: 0 },
      stock: deal.stock.map((c) => ({ suit: c.suit, rank: c.rank })),
      waste: [],
    };
  }

  function cloneState(s) {
    return {
      tableau: s.tableau.map((col) => col.slice()),
      foundations: { ...s.foundations },
      stock: s.stock.slice(),
      waste: s.waste.slice(),
    };
  }

  function cardCode(c) { return c.suit + c.rank; }

  function stateSignature(s) {
    return (
      s.tableau.map((col) => col.map(cardCode).join(",")).join("|") +
      "#" + SUITS.map((su) => s.foundations[su]).join(",") +
      "#" + s.stock.map(cardCode).join(",") +
      "/" + s.waste.map(cardCode).join(",")
    );
  }

  function isWin(s) {
    return SUITS.every((su) => s.foundations[su] === 13);
  }

  function canMoveToFoundation(card, foundations) {
    return card.rank === foundations[card.suit] + 1;
  }

  function canMoveToTableauCol(cards, destCol) {
    const first = cards[0];
    if (destCol.length === 0) return first.rank === 13;
    const top = destCol[destCol.length - 1];
    return isSequential(top, first);
  }

  // Картка "безпечна" для автоматичного відправлення на фундамент, якщо
  // це точно не зашкодить майбутнім ходам — стандартне правило: туз/двійка
  // завжди безпечні; інші — якщо обидва фундаменти протилежного кольору
  // вже мають ранг не менший за (card.rank - 1).
  function isSafeAutoplay(card, foundations) {
    if (card.rank <= 2) return true;
    const oppositeSuits = RED_SUITS.has(card.suit) ? ["S", "C"] : ["H", "D"];
    return oppositeSuits.every((su) => foundations[su] >= card.rank - 1);
  }

  function applySafeAutoplays(state) {
    let changed = false;
    let progress = true;
    while (progress) {
      progress = false;
      // з відбою
      if (state.waste.length) {
        const top = state.waste[state.waste.length - 1];
        if (canMoveToFoundation(top, state.foundations) && isSafeAutoplay(top, state.foundations)) {
          state.waste.pop();
          state.foundations[top.suit]++;
          changed = true; progress = true;
          continue;
        }
      }
      // з таблиці
      for (let c = 0; c < state.tableau.length; c++) {
        const col = state.tableau[c];
        if (!col.length) continue;
        const top = col[col.length - 1];
        if (top.faceUp === false) continue; // для сумісності формату, у солвера завжди true
        if (canMoveToFoundation(top, state.foundations) && isSafeAutoplay(top, state.foundations)) {
          col.pop();
          state.foundations[top.suit]++;
          changed = true; progress = true;
          break;
        }
      }
    }
    return changed;
  }

  // Ходи відсортовані за тими ж пріоритетами, що й підказки в живій грі:
  // 0 — розкриває закриту карту, 1 — на фундамент, 2 — звільняє стовпець,
  // 3 — інший рух по таблиці, 4 — тягнути з колоди.
  function generateMoves(state) {
    const moves = [];

    if (state.waste.length) {
      const card = state.waste[state.waste.length - 1];
      if (canMoveToFoundation(card, state.foundations)) {
        moves.push({ type: "waste->foundation", tier: 1 });
      }
      for (let c = 0; c < state.tableau.length; c++) {
        if (canMoveToTableauCol([card], state.tableau[c])) {
          moves.push({ type: "waste->tableau", col: c, tier: 3 });
        }
      }
    }

    for (let c = 0; c < state.tableau.length; c++) {
      const col = state.tableau[c];
      if (!col.length) continue;
      const top = col[col.length - 1];

      if (canMoveToFoundation(top, state.foundations)) {
        const reveals = col.length > 1;
        moves.push({ type: "tableau->foundation", col: c, tier: reveals ? 0 : 1 });
      }

      // максимальна валідна послідовність, що закінчується на верхній карті
      let seqStart = col.length - 1;
      while (seqStart - 1 >= 0 && isSequential(col[seqStart - 1], col[seqStart])) seqStart--;

      for (let i = seqStart; i < col.length; i++) {
        const run = col.slice(i);
        for (let dest = 0; dest < state.tableau.length; dest++) {
          if (dest === c) continue;
          if (i === 0 && state.tableau[dest].length === 0) continue; // безглузда перестановка порожній->порожній
          if (canMoveToTableauCol(run, state.tableau[dest])) {
            const reveals = i > 0;
            const frees = i === 0;
            moves.push({ type: "tableau->tableau", fromCol: c, cardIdx: i, toCol: dest, tier: reveals ? 0 : (frees ? 2 : 3) });
          }
        }
      }
    }

    if (state.stock.length || state.waste.length) {
      moves.push({ type: "draw", tier: 4 });
    }

    moves.sort((a, b) => a.tier - b.tier);
    return moves;
  }

  function applyMove(state, move) {
    if (move.type === "waste->foundation") {
      const card = state.waste.pop();
      state.foundations[card.suit]++;
    } else if (move.type === "waste->tableau") {
      const card = state.waste.pop();
      state.tableau[move.col].push(card);
    } else if (move.type === "tableau->foundation") {
      const col = state.tableau[move.col];
      const card = col.pop();
      state.foundations[card.suit]++;
    } else if (move.type === "tableau->tableau") {
      const fromCol = state.tableau[move.fromCol];
      const run = fromCol.splice(move.cardIdx);
      state.tableau[move.toCol].push(...run);
    } else if (move.type === "draw") {
      if (state.stock.length > 0) {
        const n = Math.min(DRAW_COUNT, state.stock.length);
        for (let i = 0; i < n; i++) state.waste.push(state.stock.pop());
      } else {
        state.stock = state.waste.slice().reverse();
        state.waste = [];
      }
    }
    return state;
  }

  // ------------------------- пошук розв'язку -------------------------
  function solve(initialState, { maxNodes = 200000, maxTimeMs = 2000 } = {}) {
    const start = Date.now();
    const visited = new Set();
    let nodes = 0;
    let timedOut = false;

    function dfs(state) {
      applySafeAutoplays(state);
      if (isWin(state)) return true;

      nodes++;
      if (nodes > maxNodes || Date.now() - start > maxTimeMs) { timedOut = true; return false; }

      const sig = stateSignature(state);
      if (visited.has(sig)) return false;
      visited.add(sig);

      const moves = generateMoves(state);
      for (const mv of moves) {
        if (timedOut) return false;
        const next = applyMove(cloneState(state), mv);
        if (dfs(next)) return true;
      }
      return false;
    }

    const found = dfs(cloneState(initialState));
    return { solvable: found, timedOut: timedOut && !found };
  }

  // ------------------------- генерація з перевіркою -------------------------
  function generateSolvableDeal(opts) {
    opts = opts || {};
    const maxAttempts = opts.maxAttempts || 40;
    const perAttemptMs = opts.perAttemptMs || 900;
    const totalBudgetMs = opts.totalBudgetMs || 4000;

    const globalStart = Date.now();
    let lastDeal = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const elapsed = Date.now() - globalStart;
      if (elapsed > totalBudgetMs) break;

      const deal = dealFromDeck(freshShuffledDeck());
      lastDeal = deal;

      const remaining = totalBudgetMs - elapsed;
      const budget = Math.min(perAttemptMs, Math.max(150, remaining));
      const { solvable } = solve(toSolverState(deal), { maxTimeMs: budget, maxNodes: 200000 });

      if (solvable) {
        return { deal, verified: true, attempts: attempt + 1 };
      }
    }
    // Бюджет вичерпано — повертаємо останню розкладку без гарантії,
    // щоб гра точно почалась, а не зависла в очікуванні ідеалу.
    return { deal: lastDeal, verified: false, attempts: maxAttempts };
  }

  // ------------------------- перевірка ПОТОЧНОЇ (проміжної) позиції -------------------------
  // На відміну від generateSolvableDeal (яка перевіряє тільки початкову
  // роздачу), ці функції беруть "живий" стан реальної партії — такий, як
  // його тримає soliter.html — і відповідають: чи є ЗВІДСИ ще шлях до
  // перемоги. Це і є те, чого не вистачає простій перевірці "є хоч один
  // легальний хід": ходи можуть бути (наприклад, валет/3 туди-сюди), але
  // жоден з них більше не веде до виграшу.
  //
  // live = {
  //   tableau:    [[{suit,rank,faceUp}, ...], ...]   // 7 стовпців
  //   foundations:[[card,...],[card,...],[card,...],[card,...]] // порядок мастей = SUITS
  //   stock:      [{suit,rank}, ...]
  //   waste:      [{suit,rank}, ...]
  // }
  // Використовуємо повну інформацію (як і в генераторі) — це коректно:
  // ми лише перевіряємо існування ходу вперед для вже зіграної партії,
  // а не підглядаємо приховані карти заради підказки гравцю.
  function liveToSolverState(live) {
    const foundations = {};
    SUITS.forEach((s, i) => { foundations[s] = (live.foundations[i] || []).length; });
    return {
      tableau: live.tableau.map((col) => col.map((c) => ({ suit: c.suit, rank: c.rank }))),
      foundations,
      stock: live.stock.map((c) => ({ suit: c.suit, rank: c.rank })),
      waste: live.waste.map((c) => ({ suit: c.suit, rank: c.rank })),
    };
  }

  // Чи розв'язна поточна позиція? Повертає { solvable, timedOut }.
  // timedOut === true означає "не встигли довести ні так, ні ні" —
  // це НЕ те саме, що timedOut === false && solvable === false, коли пошук
  // справді вичерпав усі варіанти і довів, що виходу більше нема.
  function checkStillSolvable(live, opts) {
    const solverState = liveToSolverState(live);
    return solve(solverState, opts || { maxNodes: 150000, maxTimeMs: 1200 });
  }

  // Те саме, але додатково повертає ПЕРШИЙ хід знайденої переможної лінії
  // (у "сирому" вигляді з generateMoves: type + col/fromCol/cardIdx/toCol/fIdx).
  // Дає змогу підказці вести гравця по справжньому виграшному шляху замість
  // статичної евристики за тірами, яка не знає, чи хід взагалі кудись веде.
  function findWinningFirstMove(live, opts) {
    const budget = opts || { maxNodes: 150000, maxTimeMs: 1200 };
    const start = Date.now();
    const visited = new Set();
    let nodes = 0;
    let timedOut = false;
    let firstMove = null;

    function dfs(state, rootMove) {
      applySafeAutoplays(state);
      if (isWin(state)) { firstMove = rootMove; return true; }

      nodes++;
      if (nodes > budget.maxNodes || Date.now() - start > budget.maxTimeMs) { timedOut = true; return false; }

      const sig = stateSignature(state);
      if (visited.has(sig)) return false;
      visited.add(sig);

      const moves = generateMoves(state);
      for (const mv of moves) {
        if (timedOut) return false;
        const next = applyMove(cloneState(state), mv);
        if (dfs(next, rootMove || mv)) return true;
      }
      return false;
    }

    const found = dfs(cloneState(liveToSolverState(live)), null);
    return { solvable: found, timedOut: timedOut && !found, firstMove: found ? firstMove : null };
  }

  const API = {
    generateSolvableDeal, isSequential, freshShuffledDeck, dealFromDeck,
    checkStillSolvable, findWinningFirstMove,
  };

  if (typeof window !== "undefined") {
    window.KlondikeSolver = API;
  }
  // Контекст Web Worker: немає window, є self + importScripts.
  if (typeof self !== "undefined" && typeof window === "undefined") {
    self.onmessage = function (e) {
      if (!e || !e.data) return;
      if (e.data.cmd === "generate") {
        self.postMessage({ type: "generate", result: generateSolvableDeal(e.data.opts) });
      } else if (e.data.cmd === "checkSolvable") {
        self.postMessage({ type: "checkSolvable", result: checkStillSolvable(e.data.live, e.data.opts) });
      } else if (e.data.cmd === "findHint") {
        self.postMessage({ type: "findHint", result: findWinningFirstMove(e.data.live, e.data.opts) });
      }
    };
  }
})(typeof self !== "undefined" ? self : this);
