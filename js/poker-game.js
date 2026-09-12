// ==========================================================================
// Покер (Техаський Холдем, No-Limit) — перша гра серії, написана одразу на
// online-engine.js, без старого Node.js-прототипу. Підключати після
// online-engine.js.
//
// АРХІТЕКТУРА
// -----------
// На відміну від Шпигуна/Хто я?/Мемологія (де host — просто "хто показує
// кнопку старту"), тут host РЕАЛЬНО веде симуляцію: тасує колоду, роздає
// карти, рахує хід ботів, визначає завершення раунду ставок і переможця на
// шоудауні. Тому це перша гра, що використовує lockedHost: true — з
// CAS-переобранням хоста, якщо попередній відключився.
//
// Хост веде гру через "тік" (setInterval, стартує в onBecomeHost) — не
// миттєво реагує на кожен стан, а раз на ~700мс перевіряє: чий зараз хід,
// чи час боту "подумати" й походити, чи завершився раунд ставок, чи час
// відкривати наступну вулицю чи рахувати шоудаун. Так бот ходить з
// невеликою природною затримкою, а не миттєво.
//
// МІСЦЯ ЗА СТОЛОМ
// ---------------
// Місця не існують заздалегідь. Перший гравець, що заходить, атомарно
// (RTDB-транзакція на seats) створює стіл одразу як "я + 2 боти". Кожен
// наступний гравець тією ж транзакцією забирає місце бота, якщо воно є;
// коли боти скінчились — додається нове місце. Місця ніколи не видаляються
// (як і в решті серії — гравець, що відключився, лишається за столом,
// просто неактивний).
//
// ⚠️ ЧЕСНЕ ЗАСТЕРЕЖЕННЯ ПРО ЗАКРИТІ КАРТИ
// ----------------------------------------
// На відміну від Мемологія (де "анонімність" — то й була лише UI-конвенція
// для жарту), тут закриті карти суперників — це прямо ігрова цінність. RTDB
// у цього проєкту відкрита на читання для друзів (як і всюди в серії), тому
// технічно гравець з devtools може прочитати чужі holeCards напряму з бази.
// Інтерфейс показує тільки ВЛАСНІ карти, але це так само чесність на довірі,
// як і решта проєкту — не криптографічна гарантія. Якщо колись стане
// критично (наприклад, ставки перестануть бути умовними) — єдиний правильний
// фікс: Cloud Function, яка сама роздає і віддає кожному лише його карти.
// Зараз, за твоїми словами, фішки нічому реальному не відповідають, тож я
// свідомо не ускладнюю цим архітектуру зараз.
// ==========================================================================
(function () {
  const STARTING_STACK = 1000;
  const SMALL_BLIND = 10;
  const BIG_BLIND = 20;
  const BOT_THINK_MS = 900;
  const HAND_RESULT_PAUSE_MS = 8000;
  const HOST_TICK_MS = 700;
  const SUITS = ["S", "H", "D", "C"];

  const ROOM_SCHEMA = {
    hostUsername: null,
    seats: {},
    dealerSeat: null,
    hand: null,
    handNumber: 0,
    players: {},
  };

  const Engine = window.OnlineEngine.create("poker", {
    lockedHost: true,
    onEmptyPlayer: () => ({}),
  });

  let username = null;
  let onStateChange = () => {};
  let hostTickTimer = null;
  let seatClaimInFlight = false;

  // ------------------------- допоміжні -------------------------
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function freshDeck() {
    const deck = [];
    for (const s of SUITS) for (let r = 2; r <= 14; r++) deck.push({ rank: r, suit: s });
    return shuffle(deck);
  }
  function seatKeysSorted(seats) {
    return Object.keys(seats || {}).sort((a, b) => Number(a) - Number(b));
  }
  function isHost(state) {
    return !!(state && username && state.hostUsername === username);
  }
  function connectedHumanSeats(state) {
    const seats = state.seats || {};
    return seatKeysSorted(seats).filter((k) => {
      const s = seats[k];
      if (s.occupantType === "bot") return true; // боти завжди "готові"
      const p = state.players && state.players[s.username];
      return p && Engine.isConnected(p);
    });
  }

  // ------------------------- оцінка руки -------------------------
  function evaluate5(cards) {
    const ranks = cards.map((c) => c.rank).sort((a, b) => b - a);
    const suits = cards.map((c) => c.suit);
    const isFlush = suits.every((s) => s === suits[0]);
    const counts = {};
    ranks.forEach((r) => (counts[r] = (counts[r] || 0) + 1));
    const groups = Object.entries(counts)
      .map(([r, c]) => ({ rank: Number(r), count: c }))
      .sort((a, b) => b.count - a.count || b.rank - a.rank);
    const uniqRanks = [...new Set(ranks)];
    let straightHigh = null;
    if (uniqRanks.length === 5) {
      if (uniqRanks[0] - uniqRanks[4] === 4) straightHigh = uniqRanks[0];
      else if (uniqRanks.join(",") === "14,5,4,3,2") straightHigh = 5;
    }
    if (isFlush && straightHigh) return { category: 8, name: "Стріт-флеш", tiebreak: [straightHigh] };
    if (groups[0].count === 4) return { category: 7, name: "Каре", tiebreak: [groups[0].rank, groups[1].rank] };
    if (groups[0].count === 3 && groups[1] && groups[1].count === 2) return { category: 6, name: "Фул-хаус", tiebreak: [groups[0].rank, groups[1].rank] };
    if (isFlush) return { category: 5, name: "Флеш", tiebreak: ranks };
    if (straightHigh) return { category: 4, name: "Стріт", tiebreak: [straightHigh] };
    if (groups[0].count === 3) return { category: 3, name: "Трійка", tiebreak: [groups[0].rank, ...groups.slice(1).map((g) => g.rank)] };
    if (groups[0].count === 2 && groups[1] && groups[1].count === 2) {
      const pairRanks = [groups[0].rank, groups[1].rank].sort((a, b) => b - a);
      return { category: 2, name: "Дві пари", tiebreak: [...pairRanks, groups[2].rank] };
    }
    if (groups[0].count === 2) return { category: 1, name: "Пара", tiebreak: [groups[0].rank, ...groups.slice(1).map((g) => g.rank)] };
    return { category: 0, name: "Старша карта", tiebreak: ranks };
  }
  function compareHandValue(a, b) {
    if (a.category !== b.category) return a.category - b.category;
    for (let i = 0; i < Math.max(a.tiebreak.length, b.tiebreak.length); i++) {
      const av = a.tiebreak[i] || 0, bv = b.tiebreak[i] || 0;
      if (av !== bv) return av - bv;
    }
    return 0;
  }
  function best5of7(cards7) {
    const combos = [];
    (function combo(start, chosen) {
      if (chosen.length === 5) { combos.push(chosen.slice()); return; }
      for (let i = start; i < cards7.length; i++) {
        chosen.push(cards7[i]);
        combo(i + 1, chosen);
        chosen.pop();
      }
    })(0, []);
    let best = null;
    for (const c of combos) {
      const val = evaluate5(c);
      if (!best || compareHandValue(val, best) > 0) best = val;
    }
    return best;
  }

  // ------------------------- side-pot'и -------------------------
  function computeSidePots(contributions, foldedSet) {
    const entries = Object.entries(contributions).filter(([, amt]) => amt > 0);
    const layers = [...new Set(entries.map(([, amt]) => amt))].sort((a, b) => a - b);
    const pots = [];
    let prevLayer = 0;
    for (const layer of layers) {
      const contributors = entries.filter(([, amt]) => amt >= layer);
      const potAmount = (layer - prevLayer) * contributors.length;
      if (potAmount > 0) {
        const eligible = contributors.filter(([seat]) => !foldedSet.has(seat)).map(([seat]) => seat);
        pots.push({ amount: potAmount, eligibleSeats: eligible });
      }
      prevLayer = layer;
    }
    return pots;
  }

  // ------------------------- місця за столом -------------------------
  function claimSeat(who) {
    if (seatClaimInFlight) return Promise.resolve();
    seatClaimInFlight = true;
    return Engine.roomRef.child("seats").transaction((seats) => {
      if (seats === null || seats === undefined) {
        return {
          "0": { occupantType: "human", username: who, stack: STARTING_STACK },
          "1": { occupantType: "bot", botId: "bot_1", stack: STARTING_STACK },
          "2": { occupantType: "bot", botId: "bot_2", stack: STARTING_STACK },
        };
      }
      for (const key in seats) {
        if (seats[key].occupantType === "human" && seats[key].username === who) return seats;
      }
      const botKey = Object.keys(seats).find((k) => seats[k].occupantType === "bot");
      const next = Object.assign({}, seats);
      if (botKey) {
        next[botKey] = { occupantType: "human", username: who, stack: seats[botKey].stack };
        return next;
      }
      const maxIdx = Object.keys(seats).reduce((m, k) => Math.max(m, Number(k)), -1);
      next[String(maxIdx + 1)] = { occupantType: "human", username: who, stack: STARTING_STACK };
      return next;
    }).finally(() => { seatClaimInFlight = false; });
  }

  // ------------------------- роздача (веде тільки host) -------------------------
  function nextDealerSeat(seats, currentDealer) {
    const keys = seatKeysSorted(seats);
    if (!keys.length) return null;
    if (currentDealer === null || keys.indexOf(String(currentDealer)) === -1) return keys[0];
    const idx = keys.indexOf(String(currentDealer));
    return keys[(idx + 1) % keys.length];
  }

  function startNewHand(state) {
    const seats = state.seats;
    const keys = seatKeysSorted(seats);
    if (keys.length < 2) return;

    const seatUpdates = {};
    keys.forEach((k) => { if ((seats[k].stack || 0) <= 0) seatUpdates["seats/" + k + "/stack"] = STARTING_STACK; });

    const dealerSeat = nextDealerSeat(seats, state.dealerSeat);
    const dealerIdx = keys.indexOf(dealerSeat);
    const heads = keys.length === 2;
    const sbSeat = heads ? dealerSeat : keys[(dealerIdx + 1) % keys.length];
    const bbSeat = heads ? keys[(dealerIdx + 1) % keys.length] : keys[(dealerIdx + 2) % keys.length];

    const deck = freshDeck();
    const seatsInHand = {};
    keys.forEach((k) => {
      seatsInHand[k] = { holeCards: [deck.pop(), deck.pop()], betThisRound: 0, totalBet: 0, folded: false, allIn: false, acted: false };
    });

    function stackOf(k) { return seatUpdates["seats/" + k + "/stack"] !== undefined ? seatUpdates["seats/" + k + "/stack"] : (seats[k].stack || 0); }
    function postBlind(seatKey, amount) {
      const stack = stackOf(seatKey);
      const real = Math.min(stack, amount);
      seatsInHand[seatKey].betThisRound = real;
      seatsInHand[seatKey].totalBet = real;
      if (real >= stack) seatsInHand[seatKey].allIn = true;
      seatUpdates["seats/" + seatKey + "/stack"] = stack - real;
    }
    postBlind(sbSeat, SMALL_BLIND);
    postBlind(bbSeat, BIG_BLIND);

    const toActSeat = heads ? sbSeat : keys[(dealerIdx + 3) % keys.length];

    Engine.roomRef.update(Object.assign({
      dealerSeat,
      handNumber: (state.handNumber || 0) + 1,
      hand: {
        street: "preflop",
        deckRemaining: deck,
        community: [],
        seatsInHand,
        toActSeat,
        currentBet: BIG_BLIND,
        minRaise: BIG_BLIND,
        lastAggressorSeat: bbSeat,
        lastActionAt: Date.now(),
        resultText: null,
        sbSeat, bbSeat,
      },
    }, seatUpdates));
  }

  // повертає впорядкований (за позицією відносно дилера) список місць, що
  // фізично можуть ще ходити цієї роздачі (не фолднули, не в олл-іні)
  function actionOrder(seats, hand) {
    const keys = seatKeysSorted(seats);
    return keys.filter((k) => hand.seatsInHand[k] && !hand.seatsInHand[k].folded);
  }

  function liveNonAllIn(hand, keys) {
    return keys.filter((k) => !hand.seatsInHand[k].folded && !hand.seatsInHand[k].allIn);
  }

  function seatAfter(keys, seatKey) {
    const idx = keys.indexOf(seatKey);
    if (idx === -1) return keys[0];
    return keys[(idx + 1) % keys.length];
  }

  function isBettingRoundComplete(hand, allKeys) {
    const live = liveNonAllIn(hand, allKeys).filter((k) => !hand.seatsInHand[k].folded);
    const notFolded = allKeys.filter((k) => !hand.seatsInHand[k].folded);
    if (notFolded.length <= 1) return true;
    if (live.length === 0) return true; // усі, хто лишився, — в олл-іні
    return live.every((k) => hand.seatsInHand[k].acted && hand.seatsInHand[k].betThisRound === hand.currentBet);
  }

  function applyAction(state, seatKey, action, amount) {
    const hand = state.hand;
    if (!hand || hand.toActSeat !== seatKey) return;
    const seatState = hand.seatsInHand[seatKey];
    if (!seatState || seatState.folded || seatState.allIn) return;
    const seatInfo = state.seats[seatKey];
    const stack = seatInfo.stack || 0;
    const toCall = hand.currentBet - seatState.betThisRound;

    const updates = {};
    if (action === "fold") {
      updates["hand/seatsInHand/" + seatKey + "/folded"] = true;
      updates["hand/seatsInHand/" + seatKey + "/acted"] = true;
    } else if (action === "check") {
      if (toCall > 0) return;
      updates["hand/seatsInHand/" + seatKey + "/acted"] = true;
    } else if (action === "call") {
      const real = Math.min(stack, toCall);
      updates["hand/seatsInHand/" + seatKey + "/betThisRound"] = seatState.betThisRound + real;
      updates["hand/seatsInHand/" + seatKey + "/totalBet"] = seatState.totalBet + real;
      updates["hand/seatsInHand/" + seatKey + "/acted"] = true;
      updates["seats/" + seatKey + "/stack"] = stack - real;
      if (real >= stack) updates["hand/seatsInHand/" + seatKey + "/allIn"] = true;
    } else if (action === "bet" || action === "raise") {
      const raiseTo = Math.max(0, Math.min(stack + seatState.betThisRound, amount));
      const isAllIn = raiseTo >= stack + seatState.betThisRound;
      const delta = raiseTo - seatState.betThisRound;
      if (delta <= 0) return;
      const isFullRaise = raiseTo >= hand.currentBet + hand.minRaise;
      updates["hand/seatsInHand/" + seatKey + "/betThisRound"] = raiseTo;
      updates["hand/seatsInHand/" + seatKey + "/totalBet"] = seatState.totalBet + delta;
      updates["hand/seatsInHand/" + seatKey + "/acted"] = true;
      updates["seats/" + seatKey + "/stack"] = stack - delta;
      if (isAllIn) updates["hand/seatsInHand/" + seatKey + "/allIn"] = true;
      if (raiseTo > hand.currentBet) {
        updates["hand/currentBet"] = raiseTo;
        if (isFullRaise) updates["hand/minRaise"] = raiseTo - hand.currentBet;
        updates["hand/lastAggressorSeat"] = seatKey;
        // повний рейз відкриває дію заново всім живим, хто ще не в олл-іні
        const allKeys = seatKeysSorted(state.seats);
        allKeys.forEach((k) => {
          if (k === seatKey) return;
          const s = hand.seatsInHand[k];
          if (s && !s.folded && !s.allIn) updates["hand/seatsInHand/" + k + "/acted"] = false;
        });
      }
    } else {
      return;
    }
    updates["hand/lastActionAt"] = Date.now();

    const allKeys = seatKeysSorted(state.seats);
    // рахуємо наступного, хто має ходити, ВЖЕ з урахуванням щойно застосованої дії
    const mergedHand = JSON.parse(JSON.stringify(hand));
    Object.keys(updates).forEach((path) => {
      if (!path.startsWith("hand/")) return;
      const rel = path.slice(5).split("/");
      let obj = mergedHand;
      for (let i = 0; i < rel.length - 1; i++) obj = obj[rel[i]];
      obj[rel[rel.length - 1]] = updates[path];
    });

    const notFolded = allKeys.filter((k) => !mergedHand.seatsInHand[k].folded);
    if (notFolded.length <= 1) {
      updates["hand/toActSeat"] = null;
      Engine.roomRef.update(updates).then(() => finishHandBySingleWinner(state, notFolded[0]));
      return;
    }
    if (isBettingRoundComplete(mergedHand, allKeys)) {
      updates["hand/toActSeat"] = null; // тік хоста побачить "раунд завершено, ходити нема кому" і сам відкриє наступну вулицю
    } else {
      let next = seatAfter(allKeys, seatKey);
      let guard = 0;
      while ((mergedHand.seatsInHand[next].folded || mergedHand.seatsInHand[next].allIn) && guard < allKeys.length) {
        next = seatAfter(allKeys, next);
        guard++;
      }
      updates["hand/toActSeat"] = next;
    }
    Engine.roomRef.update(updates);
  }

  function finishHandBySingleWinner(state, winnerSeat) {
    if (!winnerSeat) return;
    const hand = state.hand;
    const contributions = {};
    Object.keys(hand.seatsInHand).forEach((k) => { contributions[k] = hand.seatsInHand[k].totalBet; });
    const total = Object.values(contributions).reduce((s, v) => s + v, 0);
    const winnerName = state.seats[winnerSeat].occupantType === "bot" ? "Бот" : state.seats[winnerSeat].username;

    const updates = {};
    updates["seats/" + winnerSeat + "/stack"] = (state.seats[winnerSeat].stack || 0) + total;
    updates["hand/resultText"] = `${winnerName} забирає банк (${total}) — усі інші скинули карти`;
    updates["hand/street"] = "hand_result";
    updates["hand/resultAt"] = Date.now();
    Engine.roomRef.update(updates);
  }

  function advanceStreet(state) {
    const hand = state.hand;
    const allKeys = seatKeysSorted(state.seats);
    const deck = hand.deckRemaining.slice();
    const updates = {};

    function resetForNewRound() {
      allKeys.forEach((k) => {
        updates["hand/seatsInHand/" + k + "/betThisRound"] = 0;
        updates["hand/seatsInHand/" + k + "/acted"] = false;
      });
      updates["hand/currentBet"] = 0;
      updates["hand/minRaise"] = BIG_BLIND;
    }

    if (hand.street === "preflop") {
      deck.pop(); // burn
      const community = [deck.pop(), deck.pop(), deck.pop()];
      updates["hand/community"] = community;
      updates["hand/street"] = "flop";
      updates["hand/deckRemaining"] = deck;
      resetForNewRound();
    } else if (hand.street === "flop") {
      deck.pop();
      updates["hand/community"] = hand.community.concat([deck.pop()]);
      updates["hand/street"] = "turn";
      updates["hand/deckRemaining"] = deck;
      resetForNewRound();
    } else if (hand.street === "turn") {
      deck.pop();
      updates["hand/community"] = hand.community.concat([deck.pop()]);
      updates["hand/street"] = "river";
      updates["hand/deckRemaining"] = deck;
      resetForNewRound();
    } else if (hand.street === "river") {
      return runShowdown(state);
    } else {
      return;
    }

    // хто ходить першим на новій вулиці — перший живий (не фолд/не олл-ін) після дилера
    const live = liveNonAllIn(hand, allKeys).filter((k) => !hand.seatsInHand[k].folded);
    const notFolded = allKeys.filter((k) => !hand.seatsInHand[k].folded);
    if (live.length === 0 || notFolded.length <= 1) {
      // усі, хто лишився, в олл-іні (чи один гравець) — самі відкриваємо карти без ставок
      updates["hand/toActSeat"] = null;
      Engine.roomRef.update(updates).then(() => {
        Engine.roomRef.once("value").then((snap) => {
          const fresh = snap.val();
          if (fresh && fresh.hand) advanceStreet(Object.assign({}, state, { hand: fresh.hand, seats: fresh.seats }));
        });
      });
      return;
    }
    let first = seatAfter(allKeys, state.dealerSeat);
    let guard = 0;
    while ((hand.seatsInHand[first].folded || hand.seatsInHand[first].allIn) && guard < allKeys.length) {
      first = seatAfter(allKeys, first);
      guard++;
    }
    updates["hand/toActSeat"] = first;
    Engine.roomRef.update(updates);
  }

  function runShowdown(state) {
    const hand = state.hand;
    const allKeys = seatKeysSorted(state.seats);
    const notFolded = allKeys.filter((k) => !hand.seatsInHand[k].folded);
    const contributions = {};
    allKeys.forEach((k) => { contributions[k] = hand.seatsInHand[k].totalBet; });
    const foldedSet = new Set(allKeys.filter((k) => hand.seatsInHand[k].folded));
    const pots = computeSidePots(contributions, foldedSet);

    const values = {};
    notFolded.forEach((k) => {
      const seven = hand.seatsInHand[k].holeCards.concat(hand.community);
      values[k] = best5of7(seven);
    });

    const updates = {};
    const winLines = [];
    pots.forEach((pot) => {
      let bestVal = null;
      let winners = [];
      pot.eligibleSeats.forEach((k) => {
        if (!values[k]) return;
        if (!bestVal || compareHandValue(values[k], bestVal) > 0) { bestVal = values[k]; winners = [k]; }
        else if (compareHandValue(values[k], bestVal) === 0) winners.push(k);
      });
      if (!winners.length) return;
      const share = Math.floor(pot.amount / winners.length);
      let remainder = pot.amount - share * winners.length;
      winners.forEach((k) => {
        const extra = remainder > 0 ? 1 : 0;
        if (remainder > 0) remainder--;
        const cur = updates["seats/" + k + "/stack"] !== undefined ? updates["seats/" + k + "/stack"] : (state.seats[k].stack || 0);
        updates["seats/" + k + "/stack"] = cur + share + extra;
      });
      const names = winners.map((k) => (state.seats[k].occupantType === "bot" ? "Бот" : state.seats[k].username));
      winLines.push(`${names.join(", ")} — ${bestVal.name} (+${pot.amount})`);
    });

    updates["hand/street"] = "hand_result";
    updates["hand/resultText"] = winLines.join(" · ");
    updates["hand/resultAt"] = Date.now();
    updates["hand/revealAll"] = true;
    Engine.roomRef.update(updates);
  }

  // ------------------------- боти -------------------------
  function botDecision(state, seatKey) {
    const hand = state.hand;
    const seatState = hand.seatsInHand[seatKey];
    const toCall = hand.currentBet - seatState.betThisRound;
    const seven = seatState.holeCards.concat(hand.community || []);
    const strength = seven.length >= 5 ? best5of7(seven).category : estimatePreflop(seatState.holeCards);
    const r = Math.random();

    if (toCall <= 0) {
      if (strength >= 3 && r < 0.35) return { action: "bet", amount: seatState.betThisRound + hand.minRaise * 2 };
      return { action: "check" };
    }
    const stack = state.seats[seatKey].stack || 0;
    const potOdds = toCall / Math.max(1, hand.currentBet * 2);
    if (strength >= 5 || (strength >= 2 && r < 0.5)) {
      if (r < 0.25 && stack > toCall) return { action: "raise", amount: seatState.betThisRound + toCall + hand.minRaise };
      return { action: "call" };
    }
    if (strength >= 1 && potOdds < 0.35) return { action: "call" };
    if (toCall <= 20 && r < 0.4) return { action: "call" };
    return { action: "fold" };
  }
  // дуже грубий preflop-евристик: пара -> 2, одномастні/конектори -> 1, інше -> 0
  function estimatePreflop(holeCards) {
    const [a, b] = holeCards;
    if (a.rank === b.rank) return 2;
    if (a.suit === b.suit || Math.abs(a.rank - b.rank) <= 2) return 1;
    return 0;
  }

  // ------------------------- тік хоста -------------------------
  function hostTick(state) {
    if (!state || !state.seats) return;
    const allKeys = seatKeysSorted(state.seats);
    if (allKeys.length < 2) return;

    if (!state.hand) {
      startNewHand(state);
      return;
    }
    const hand = state.hand;

    if (hand.street === "hand_result") {
      if (Date.now() - (hand.resultAt || 0) >= HAND_RESULT_PAUSE_MS) {
        Engine.roomRef.child("hand").set(null).then(() => {
          Engine.roomRef.once("value").then((snap) => { const fresh = snap.val(); if (fresh) startNewHand(fresh); });
        });
      }
      return;
    }

    if (!hand.toActSeat) {
      advanceStreet(state);
      return;
    }

    const seatInfo = state.seats[hand.toActSeat];
    if (seatInfo.occupantType === "bot") {
      if (Date.now() - (hand.lastActionAt || 0) < BOT_THINK_MS) return;
      const decision = botDecision(state, hand.toActSeat);
      applyAction(state, hand.toActSeat, decision.action, decision.amount);
    }
    // якщо це людина — просто чекаємо на дію з UI (playerAction нижче)
  }

  function playerAction(state, action, amount) {
    const mySeat = seatKeysSorted(state.seats).find((k) => state.seats[k].occupantType === "human" && state.seats[k].username === username);
    if (!mySeat || !state.hand || state.hand.toActSeat !== mySeat) return;
    applyAction(state, mySeat, action, amount);
  }

  // ------------------------- приєднання -------------------------
  function start(user) {
    username = user;
    Engine.start(user, { useLobby: false });

    Engine.onBecomeHost = () => {
      if (hostTickTimer) clearInterval(hostTickTimer);
      hostTickTimer = setInterval(() => {
        Engine.roomRef && Engine.roomRef.once("value").then((snap) => {
          const state = snap.val();
          if (state) hostTick(state);
        });
      }, HOST_TICK_MS);
    };
    Engine.onLoseHost = () => {
      if (hostTickTimer) { clearInterval(hostTickTimer); hostTickTimer = null; }
    };

    Engine.onStateChange = (type, data) => {
      if (type !== "room-update") return;
      onStateChange(data.room, { username, isHost: isHost(data.room) });
    };

    Engine.getOrCreateRoom(Engine.SHARED_ROOM_ID, ROOM_SCHEMA, () => ({})).then(() => {
      Engine.joinRoom(Engine.SHARED_ROOM_ID, { asPlayer: true }).then(() => claimSeat(username));
    });
  }

  function stop() { Engine.stop(); }

  function resetTable(state) {
    if (!isHost(state)) return;
    return Engine.forceResetRoom(Engine.SHARED_ROOM_ID, ROOM_SCHEMA, () => ({})).then(() => {
      Engine.joinRoom(Engine.SHARED_ROOM_ID, { asPlayer: true }).then(() => claimSeat(username));
    });
  }

  window.PokerGame = {
    STARTING_STACK, SMALL_BLIND, BIG_BLIND,
    evaluate5, compareHandValue, best5of7, computeSidePots,
    start, stop, playerAction, resetTable,
    set onStateChange(fn) { onStateChange = fn; },
  };
})();
