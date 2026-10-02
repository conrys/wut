// ==========================================================================
// durak-rules.js — чистий рушій правил "Підкидного Дурака" (36 карт).
// Без DOM/Firebase — те саме ядро для онлайн-гри (durak-game.js) і
// потенційного локального режиму.
//
// Карти — той самий формат {rank, suit}, що й у покері (rank 6-14, де
// 11=J,12=Q,13=K,14=A; suit S/H/D/C) — 36-карткова колода без 2-5. Це
// зроблено НАВМИСНЕ: рендер карти (makeCardEl) з poker.html можна
// перевикористати як є, той самий формат.
//
// ПРАВИЛА коротко:
// - Роздача по 6 карт кожному, козир — масть останньої карти колоди
//   (лишається видимою "знизу" колоди, тягнеться найостаннішою).
// - Першим атакує той, у кого найменший козир на руках.
// - Атакуючий кладе карту; захисник б'є її старшою картою тієї ж масті
//   АБО козирем (якщо атакуюча карта не козир); козир проти козиря —
//   старший ранг.
// - ПІДКИДАННЯ: будь-хто за столом (крім захисника) може докинути карту
//   одного з рангів, що вже лежать на столі (атакуючі чи биті) — доки
//   карт на столі не більше 6 і не більше, ніж карт було в захисника на
//   старті раунду.
// - Захисник або відбиває ВСІ карти, або "бере" — тоді забирає геть усі
//   карти зі столу собі в руку.
// - Хід атаки: якщо захисник відбив УСІ карти — атакує далі ВІН САМ; якщо
//   забрав — його чергу атакувати пропускають, атакує наступний після нього.
//   (Про переведення дивись нижче — після нього "захисник" для цих правил
//   це вже той, на кого перевели, а не початковий.)
// - Після раунду всі, крім того, хто щойно забрав (якщо забирав), добирають
//   карти з колоди до 6, починаючи зі старого атакуючого, по колу.
// - Хто спорожнив руку, коли колода вже закінчилась — виходить з гри
//   (переможець). Останній з картами на руках — дурак.
// ==========================================================================
(function () {
  const SUITS = ["S", "H", "D", "C"];
  const RANKS = [6, 7, 8, 9, 10, 11, 12, 13, 14];
  const RANK_LABEL = { 14: "A", 13: "K", 12: "Q", 11: "J" };
  function rankLabel(r) { return RANK_LABEL[r] || String(r); }

  function freshDeck() {
    const deck = [];
    for (const s of SUITS) for (const r of RANKS) deck.push({ rank: r, suit: s });
    return deck;
  }
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function sameCard(a, b) { return a.rank === b.rank && a.suit === b.suit; }

  // тримп б'є не-тримп; та сама масть — старший ранг; інакше не б'є
  function beats(defendCard, attackCard, trumpSuit) {
    if (defendCard.suit === attackCard.suit) return defendCard.rank > attackCard.rank;
    if (defendCard.suit === trumpSuit && attackCard.suit !== trumpSuit) return true;
    return false;
  }

  function cloneState(state) {
    const hands = {};
    Object.keys(state.hands).forEach((u) => { hands[u] = state.hands[u].slice(); });
    return {
      deck: state.deck.slice(),
      trumpSuit: state.trumpSuit,
      trumpCard: state.trumpCard,
      hands,
      order: state.order.slice(),
      attackerIdx: state.attackerIdx,
      defenderIdx: state.defenderIdx,
      table: state.table.map((t) => ({ attack: t.attack, defend: t.defend || null })),
      passed: state.passed.slice(),
      discardCount: state.discardCount,
      finishedOrder: state.finishedOrder.slice(),
      result: state.result,
      lastAction: state.lastAction,
      settings: state.settings,
    };
  }

  // ------------------------- початок гри -------------------------
  // settings.throwInMode: "all" (підкидає будь-хто, крім захисника — типово)
  //   | "neighbors" (лише атакуючий і гравець одразу ПІСЛЯ захисника)
  // settings.perevodnoy: bool — дозволити переведення ходу (див. transferCard нижче)
  function defaultSettings() { return { throwInMode: "all", perevodnoy: false }; }

  function initialState(usernames, settings) {
    if (!usernames || usernames.length < 2) return null;
    const deck = shuffle(freshDeck()); // тягнемо з КІНЦЯ (pop) — deck[0] лишається "знизу" й тягнеться останньою
    const hands = {};
    usernames.forEach((u) => { hands[u] = []; });
    for (let i = 0; i < 6; i++) for (const u of usernames) hands[u].push(deck.pop());
    // 6 гравців × 6 карт = вся колода роздана, у колоді нічого не лишилось:
    // за правилами козир тоді — остання роздана карта (у останнього гравця)
    const trumpCard = deck.length ? deck[0] : hands[usernames[usernames.length - 1]][5];
    const trumpSuit = trumpCard.suit;

    let firstAttacker = usernames[0], lowestRank = Infinity;
    usernames.forEach((u) => {
      hands[u].forEach((c) => { if (c.suit === trumpSuit && c.rank < lowestRank) { lowestRank = c.rank; firstAttacker = u; } });
    });
    const attackerIdx = usernames.indexOf(firstAttacker);
    const defenderIdx = (attackerIdx + 1) % usernames.length;

    return {
      deck, trumpSuit, trumpCard, hands, order: usernames.slice(),
      attackerIdx, defenderIdx, table: [], passed: [],
      settings: Object.assign(defaultSettings(), settings || {}),
      discardCount: 0, finishedOrder: [], result: null, lastAction: null,
    };
  }

  function defenderName(state) { return state.order[state.defenderIdx]; }
  function attackerName(state) { return state.order[state.attackerIdx]; }
  function maxAttacksThisRound(state) {
    const defended = state.table.filter((t) => t.defend).length;
    return Math.min(6, (state.hands[defenderName(state)] || []).length + defended);
  }

  function prevAliveIdx(order, finishedOrder, fromIdx) {
    const n = order.length;
    for (let step = 1; step <= n; step++) {
      const idx = (fromIdx - step + n * 2) % n;
      if (!finishedOrder.includes(order[idx])) return idx;
    }
    return fromIdx;
  }
  // хто зараз може підкидати (крім самого захисника й самого першого ходу
  // раунду, який завжди лише від attackerName): "all" — будь-хто; "neighbors"
  // — лише той, хто сидить одразу ПЕРЕД захисником (як правило, це і є
  // атакуючий) і одразу ПІСЛЯ нього.
  function eligibleThrowers(state) {
    const alive = state.order.filter((u) => !state.finishedOrder.includes(u));
    if (state.settings && state.settings.throwInMode === "neighbors") {
      const prev = state.order[prevAliveIdx(state.order, state.finishedOrder, state.defenderIdx)];
      const next = state.order[nextAliveIdx(state.order, state.finishedOrder, state.defenderIdx)];
      return new Set([prev, next].filter((u) => u !== defenderName(state)));
    }
    return new Set(alive.filter((u) => u !== defenderName(state)));
  }

  // ------------------------- підказки для UI -------------------------
  // які карти гравця зараз можна підкинути (порожньо, якщо не його черга/не можна)
  function throwableCards(state, username) {
    if (state.result || username === defenderName(state) || state.finishedOrder.includes(username)) return [];
    const hand = state.hands[username] || [];
    if (state.table.length === 0) return username === attackerName(state) ? hand.slice() : [];
    if (!eligibleThrowers(state).has(username)) return [];
    if (state.table.length >= maxAttacksThisRound(state)) return [];
    const allowedRanks = new Set();
    state.table.forEach((t) => { allowedRanks.add(t.attack.rank); if (t.defend) allowedRanks.add(t.defend.rank); });
    return hand.filter((c) => allowedRanks.has(c.rank));
  }
  // які слоти на столі захисник зараз може відбити і чим
  function defendableSlots(state, username) {
    if (state.result || username !== defenderName(state)) return [];
    const hand = state.hands[username] || [];
    const out = [];
    state.table.forEach((t, i) => {
      if (t.defend) return;
      const cards = hand.filter((c) => beats(c, t.attack, state.trumpSuit));
      if (cards.length) out.push({ slotIndex: i, cards });
    });
    return out;
  }
  function canTake(state, username) {
    return !state.result && username === defenderName(state) && state.table.length > 0;
  }
  function canPass(state, username) {
    if (state.result || username === defenderName(state) || state.finishedOrder.includes(username)) return false;
    if (!state.table.length) return false;
    return !state.passed.includes(username);
  }
  function allTableDefended(state) { return state.table.length > 0 && state.table.every((t) => t.defend); }

  // ПЕРЕВІД: доки на столі жодна карта ще не відбита і всі вони одного
  // рангу, захисник МІСТЬ (не зобов'язаний) покласти свою карту ТОГО Ж
  // рангу замість захисту — тоді захист усього столу (включно з щойно
  // доданою картою) переходить до НАСТУПНОГО гравця. Не залежить від того,
  // козирна карта чи ні — головне збіг рангу.
  function canTransfer(state, username) {
    if (!state.settings || !state.settings.perevodnoy) return false;
    if (state.result || username !== defenderName(state)) return false;
    if (!state.table.length || !state.table.every((t) => !t.defend)) return false;
    const rank = state.table[0].attack.rank;
    const hand = state.hands[username] || [];
    return hand.some((c) => c.rank === rank);
  }
  function transferableCards(state, username) {
    if (!canTransfer(state, username)) return [];
    const rank = state.table[0].attack.rank;
    return (state.hands[username] || []).filter((c) => c.rank === rank);
  }
  function transferCard(state, username, card) {
    if (!canTransfer(state, username)) return null;
    const rank = state.table[0].attack.rank;
    if (card.rank !== rank) return null;
    const hand = state.hands[username];
    const ci = hand.findIndex((c) => sameCard(c, card));
    if (ci === -1) return null;

    const next = cloneState(state);
    next.hands[username].splice(ci, 1);
    next.table.push({ attack: card, defend: null });
    next.defenderIdx = nextAliveIdx(next.order, next.finishedOrder, next.defenderIdx);
    next.passed = []; // новий захисник — підкидання знову відкрите
    next.lastAction = { type: "transfer", by: username, card };
    return next;
  }

  // ------------------------- дуже простий бот -------------------------
  // Мінімальна евристика для тестування: ніколи не переводить (щоб не
  // ускладнювати), захищається/підкидає НАЙДЕШЕВШОЮ придатною картою
  // (козир дорожчий за будь-яку не-козирну), кидає все що може підкинути,
  // пасує лише коли підкидати вже нічим.
  function cardValue(card, trumpSuit) { return (card.suit === trumpSuit ? 100 : 0) + card.rank; }
  function cheapest(cards, trumpSuit) {
    return cards.slice().sort((a, b) => cardValue(a, trumpSuit) - cardValue(b, trumpSuit))[0];
  }
  // повертає { type: "throw"|"defend"|"take"|"pass", ... } або null, якщо
  // боту зараз нема чого робити (наприклад, він захисник, а стіл ще порожній)
  function botAction(state, username) {
    if (state.result || state.finishedOrder.includes(username)) return null;
    if (username === defenderName(state)) {
      const slots = defendableSlots(state, username);
      if (slots.length) {
        const slot = slots[0];
        return { type: "defend", slotIndex: slot.slotIndex, card: cheapest(slot.cards, state.trumpSuit) };
      }
      // Все вже відбито — просто чекаємо, поки підкидаючі спасують (бито).
      // Брати можна лише коли Є невідбита карта, яку нічим бити.
      if (state.table.some((t) => !t.defend)) return { type: "take" };
      return null;
    }
    const throwables = throwableCards(state, username);
    if (throwables.length) return { type: "throw", card: cheapest(throwables, state.trumpSuit) };
    if (canPass(state, username)) return { type: "pass" };
    return null;
  }

  // ------------------------- дії -------------------------
  function throwCard(state, username, card) {
    if (state.result) return null;
    if (username === defenderName(state)) return null;
    const hand = state.hands[username];
    if (!hand) return null;
    const ci = hand.findIndex((c) => sameCard(c, card));
    if (ci === -1) return null;

    if (state.table.length === 0) {
      if (username !== attackerName(state)) return null;
    } else {
      if (!eligibleThrowers(state).has(username)) return null;
      const allowedRanks = new Set();
      state.table.forEach((t) => { allowedRanks.add(t.attack.rank); if (t.defend) allowedRanks.add(t.defend.rank); });
      if (!allowedRanks.has(card.rank)) return null;
    }
    if (state.table.length >= maxAttacksThisRound(state)) return null;

    const next = cloneState(state);
    next.hands[username].splice(ci, 1);
    next.table.push({ attack: card, defend: null });
    next.passed = []; // нова карта на столі — усі мають заново підтвердити "бито"
    next.lastAction = { type: "throw", by: username, card };
    return next;
  }

  function defendCard(state, username, slotIndex, card) {
    if (state.result) return null;
    if (username !== defenderName(state)) return null;
    const slot = state.table[slotIndex];
    if (!slot || slot.defend) return null;
    const hand = state.hands[username];
    const ci = hand.findIndex((c) => sameCard(c, card));
    if (ci === -1) return null;
    if (!beats(card, slot.attack, state.trumpSuit)) return null;

    const next = cloneState(state);
    next.hands[username].splice(ci, 1);
    next.table[slotIndex] = { attack: slot.attack, defend: card };
    next.passed = [];
    next.lastAction = { type: "defend", by: username, card };
    return next;
  }

  function passAttack(state, username) {
    if (!canPass(state, username)) return null;
    const next = cloneState(state);
    next.passed.push(username);
    next.lastAction = { type: "pass", by: username };
    return maybeResolveRound(next);
  }

  function takeCards(state, username) {
    if (!canTake(state, username)) return null;
    const next = cloneState(state);
    const gained = [];
    next.table.forEach((t) => { gained.push(t.attack); if (t.defend) gained.push(t.defend); });
    next.hands[username] = next.hands[username].concat(gained);
    next.table = [];
    next.passed = [];
    next.lastAction = { type: "take", by: username, count: gained.length };
    return finishRoundRotation(next, { taken: true, takerUsername: username });
  }

  function maybeResolveRound(state) {
    const defender = defenderName(state);
    const eligible = state.order.filter((u) => u !== defender && !state.finishedOrder.includes(u));
    const allPassed = eligible.length > 0 && eligible.every((u) => state.passed.includes(u));
    if (!allPassed || !allTableDefended(state)) return state;
    const next = cloneState(state);
    const cardsCount = next.table.reduce((n, t) => n + 1 + (t.defend ? 1 : 0), 0);
    next.discardCount += cardsCount;
    next.table = [];
    next.passed = [];
    next.lastAction = { type: "bito" };
    return finishRoundRotation(next, { taken: false });
  }

  function nextAliveIdx(order, finishedOrder, fromIdx) {
    const n = order.length;
    for (let step = 1; step <= n; step++) {
      const idx = (fromIdx + step) % n;
      if (!finishedOrder.includes(order[idx])) return idx;
    }
    return fromIdx;
  }
  // перший ЖИВИЙ гравець, починаючи ВІД idx включно (а не з наступного) —
  // для випадку "сам захисник стає атакуючим", коли той самий захисник міг
  // щойно вийти з гри (спорожнив руку останнім ходом захисту)
  function firstAliveFrom(order, finishedOrder, idx) {
    const n = order.length;
    for (let step = 0; step < n; step++) {
      const i = (idx + step) % n;
      if (!finishedOrder.includes(order[i])) return i;
    }
    return idx;
  }

  function finishRoundRotation(state, { taken, takerUsername }) {
    const oldAttackerIdx = state.attackerIdx;
    const oldDefenderIdx = state.defenderIdx;
    const n = state.order.length;

    // добір карт: усі (крім того, хто щойно забрав), починаючи зі старого
    // атакуючого, по колу, до 6 карт, поки є колода
    for (let step = 0; step < n; step++) {
      const idx = (oldAttackerIdx + step) % n;
      const u = state.order[idx];
      if (state.finishedOrder.includes(u)) continue;
      if (taken && u === takerUsername) continue;
      while (state.hands[u].length < 6 && state.deck.length > 0) state.hands[u].push(state.deck.pop());
    }

    // хто спорожнів і колоди вже нема — вибуває (переможець, у порядку виходу)
    if (state.deck.length === 0) {
      state.order.forEach((u) => {
        if (!state.finishedOrder.includes(u) && state.hands[u].length === 0) state.finishedOrder.push(u);
      });
    }

    const remaining = state.order.filter((u) => !state.finishedOrder.includes(u));
    if (remaining.length <= 1) {
      state.result = remaining.length === 1 ? { loser: remaining[0] } : { draw: true };
      state.attackerIdx = -1; state.defenderIdx = -1;
      return state;
    }

    state.attackerIdx = taken
      ? nextAliveIdx(state.order, state.finishedOrder, oldDefenderIdx)   // забрав — пропускаємо його, атакує наступний
      : firstAliveFrom(state.order, state.finishedOrder, oldDefenderIdx); // відбився — атакує сам (чи перший живий після нього, якщо саме цим ходом вийшов з гри)
    state.defenderIdx = nextAliveIdx(state.order, state.finishedOrder, state.attackerIdx);
    return state;
  }

  window.DurakRules = {
    rankLabel,
    initialState, beats, defaultSettings,
    attackerName, defenderName, maxAttacksThisRound, allTableDefended, eligibleThrowers,
    throwableCards, defendableSlots, canTake, canPass, canTransfer, transferableCards,
    throwCard, defendCard, passAttack, takeCards, transferCard, botAction,
  };
})();
