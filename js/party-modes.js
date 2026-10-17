// ==========================================================================
// party-modes.js — режими «Вечірки» як ЧИСТІ функції (без DOM і без Firebase),
// тому їх можна тестувати окремо. Рушій (party-game.js) викликає їх на хості.
//
// Режим:
//   id, title, icon, desc, minPlayers,
//   startSet(ctx)            → стан набору (JSON), зберігається в room.deck; items — питання (скільки їх, стільки раундів)
//   startRound(ctx)          → перший етап раунду
//   onEnd(ctx, stage, inputs)→ наступний етап (останній — "reveal")
//
// ctx: { order, present, level, roundNo, totalRounds, state, shuffle(arr) }
//   inputs — { ім'я: значення } лише для поточного етапу.
//
// Етап: { kind, title, text, hint, roles:[{label,name}], names, options:[{id,label}],
//         expect:[імена], durationMs, data }
//   kind: "pick-name" (обрати ім'я) | "choice" (кнопки options) | "show" (лише дивитись)
//         | "reveal" (результат: headline, bars, lines, penalties, points)
//   penalties { ім'я: ковтків }, points { ім'я: балів } — рушій застосує їх з лімітом.
// ==========================================================================
(function () {
  const SEED = window.PartySeed || {};
  const MIN_TIMER_SECONDS = 20, MAX_TIMER_SECONDS = 120, DEFAULT_TIMER_SECONDS = 60;
  const MS = { reveal: 45000 };

  // Етапи з відповідями (є кого чекати) можна грати без таймера — settings.timersOff.
  // Промова в «Суді» не має кого чекати, тому її таймер не вимикається.
  const SKIPPABLE_TIMERS = ["voteSeconds", "betSeconds", "decideSeconds"];
  function timerMs(ctx, key) {
    if (ctx.settings && ctx.settings.timersOff === true && SKIPPABLE_TIMERS.includes(key)) return 0;
    const value = Number(ctx.settings && ctx.settings[key]);
    const seconds = Number.isInteger(value) ? value : DEFAULT_TIMER_SECONDS;
    return Math.min(MAX_TIMER_SECONDS, Math.max(MIN_TIMER_SECONDS, seconds)) * 1000;
  }

  // Спершу питання, яких компанія ще не бачила (js/core/prompt-history.js), далі — найдавніші.
  const PH = window.PromptHistory;
  ["whofrom", "court", "bets"].forEach((k) => PH && PH.preload("party_" + k));
  function texts(key, list, ctx, count) {
    const pool = (list || []).filter((x) => x.level <= ctx.level);
    const picked = (PH ? PH.order("party_" + key, pool, (x) => x.text) : ctx.shuffle(pool)).slice(0, count).map((x) => x.text);
    if (PH) PH.mark("party_" + key, picked);
    return picked;
  }
  function sortedCounts(counts) { // [[ім'я, голосів]] за спаданням, далі за алфавітом
    return Object.entries(counts).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  }
  function courtSpeakDuration(ctx) {
    return timerMs(ctx, "courtSpeakSeconds");
  }
  function reveal(stage, fields) { // stage — етап, що закінчився: з нього беремо питання/ситуацію й ролі
    return Object.assign({ kind: "reveal", title: "Результат", text: stage.text, roles: stage.roles || [], durationMs: MS.reveal, bars: [], lines: [], penalties: {}, points: {} }, fields);
  }

  // ------------------------------------------------------------------
  // Хто з нас? — швидке голосування за ім'я
  // ------------------------------------------------------------------
  const whofrom = {
    id: "whofrom", title: "Хто з нас?", icon: "🗳️", minPlayers: 3,
    desc: "Питання, усі обирають одне ім'я за таймером. Найпопулярніший п'є, а ще ті, хто проголосував самотньо.",
    startSet(ctx) { return { items: texts("whofrom", SEED.WHOFROM, ctx, ctx.totalRounds) }; },
    startRound(ctx) {
      return { kind: "pick-name", title: "Хто з нас?", text: ctx.state.items[ctx.roundNo], names: ctx.order.slice(), expect: ctx.order.slice(), durationMs: timerMs(ctx, "voteSeconds") };
    },
    onEnd(ctx, stage, inputs) {
      const counts = {};
      Object.values(inputs).forEach((t) => { if (ctx.order.includes(t)) counts[t] = (counts[t] || 0) + 1; });
      const sorted = sortedCounts(counts);
      const voters = Object.keys(inputs).length;
      const top = sorted.length ? sorted[0][1] : 0;
      const bars = sorted.slice(0, 8).map(([name, value]) => ({ name, value }));
      if (top < 2) { // голоси розкидались — нікого не винне
        return reveal(stage, { headline: voters ? "Голоси розкидались" : "Ніхто не проголосував", bars, lines: [voters ? "Ніхто не набрав двох голосів — без ковтків" : ""].filter(Boolean), data: { winners: [], top } });
      }
      const winners = sorted.filter(([, c]) => c === top).map(([n]) => n).slice(0, 3);
      const penalties = {};
      winners.forEach((n) => { penalties[n] = 1; });
      // «самотній вибір»: голосував за того, хто отримав лише цей один голос; не більше N/5 людей
      const lone = Object.keys(inputs).filter((v) => counts[inputs[v]] === 1 && !penalties[v]);
      const loneMax = Math.max(1, Math.floor(ctx.order.length / 5));
      ctx.shuffle(lone).slice(0, loneMax).forEach((n) => { penalties[n] = 1; });
      const lines = [`${winners.join(", ")} — найбільше голосів (${top}) і ковток`];
      const loneDrinkers = Object.keys(penalties).filter((n) => !winners.includes(n));
      if (loneDrinkers.length) lines.push(`Самотній вибір, теж ковток: ${loneDrinkers.join(", ")}`);
      return reveal(stage, { headline: winners.join(", "), bars, lines, penalties, data: { winners, top, lone: loneDrinkers } });
    },
  };

  // ------------------------------------------------------------------
  // Суд Лінча — прокурор звинувачує, адвокат захищає, звинувачений мовчить, присяжні судять
  // ------------------------------------------------------------------
  const VERDICT = [{ id: "guilty", label: "Винен" }, { id: "forgive", label: "Простити" }];
  const court = {
    id: "court", title: "Суд Лінча", icon: "⚖️", minPlayers: 4,
    desc: "Прокурор звинувачує, адвокат захищає, звинувачений мовчить, решта виносить вирок. Винен — п'є звинувачений, простили — п'є весь суд.",
    startSet(ctx) { return { items: texts("court", SEED.COURT, ctx, ctx.totalRounds), seat: ctx.shuffle(ctx.order.slice()) }; },
    startRound(ctx) {
      // три ролі по колу з кроком k = N/3: за N раундів кожен гравець рівно раз звинувачений,
      // раз прокурор і раз адвокат, і не в сусідніх раундах (зсув на 3 при N кратному 3
      // давав одним і тим самим людям одну й ту саму роль щоразу)
      const seat = ctx.state.seat, n = ctx.roundNo, N = seat.length, k = Math.max(1, Math.floor(N / 3));
      const accused = seat[n % N], prosecutor = seat[(n + k) % N], lawyer = seat[(n + 2 * k) % N];
      return {
        kind: "show", title: "Суд Лінча", text: "Звинувачений " + ctx.state.items[n],
        roles: [{ label: "Звинувачений", name: accused }, { label: "Прокурор", name: prosecutor }, { label: "Адвокат", name: lawyer }],
        hint: "Слово має прокурор: звинувачує вголос. Звинувачений мовчить", durationMs: courtSpeakDuration(ctx), data: { step: "prosecutor", accused, prosecutor, lawyer },
      };
    },
    onEnd(ctx, stage, inputs) {
      const d = stage.data;
      if (d.step === "prosecutor") {
        return { kind: "show", title: "Суд Лінча", text: stage.text, roles: stage.roles, hint: "Слово має адвокат: захищає будь-яким абсурдом. Звинувачений мовчить", durationMs: courtSpeakDuration(ctx), data: Object.assign({}, d, { step: "lawyer" }) };
      }
      if (d.step === "lawyer") {
        const jurors = ctx.order.filter((n) => n !== d.accused && n !== d.lawyer && n !== d.prosecutor);
        return {         kind: "choice", title: "Вердикт", text: stage.text, roles: stage.roles, hint: "Ваш вирок?", options: VERDICT, expect: jurors, durationMs: timerMs(ctx, "voteSeconds"), data: Object.assign({}, d, { step: "verdict", jurors }) };
      }
      // вердикт → результат
      const jurors = d.jurors;
      const g = Object.values(inputs).filter((v) => v === "guilty").length;
      const f = Object.values(inputs).filter((v) => v === "forgive").length;
      const bars = [{ label: "Винен", value: g }, { label: "Простити", value: f }];
      const vd = (verdict) => Object.assign({}, d, { verdict, guilty: g, forgive: f });
      if (g > f) return reveal(stage, { headline: `Винен: ${d.accused} п'є`, bars, lines: ["Більшість проти звинуваченого", d.prosecutor ? `${d.prosecutor} переконав(ла) суд: +1 бал` : ""].filter(Boolean), penalties: { [d.accused]: 1 }, points: d.prosecutor ? { [d.prosecutor]: 1 } : {}, data: vd("guilty") });
      if (f > g) {
        const penalties = {}; jurors.forEach((n) => { penalties[n] = 1; });
        return reveal(stage, { headline: "Простили: суд п'є", bars, lines: [`${d.lawyer} переконав(ла) суд: +1 бал`, "Простили — отже п'є вся колегія присяжних"], penalties, points: { [d.lawyer]: 1 }, data: vd("forgive") });
      }
      if (d.prosecutor) return reveal(stage, { headline: "Порівну: ніхто не переконав", bars, lines: [`${d.prosecutor} і ${d.lawyer} п'ють за нічию`], penalties: { [d.prosecutor]: 1, [d.lawyer]: 1 }, data: vd("tie") });
      return reveal(stage, { headline: "Порівну: адвокат не переконав", bars, lines: [`${d.lawyer} п'є за нічию`], penalties: { [d.lawyer]: 1 }, data: vd("tie") });
    },
  };

  // ------------------------------------------------------------------
  // Ставки — інші ставлять, чи виконає жертва завдання
  // ------------------------------------------------------------------
  const BET = [{ id: "do", label: "Зробить" }, { id: "quit", label: "Здасться" }];
  const DECIDE = [{ id: "do", label: "Роблю" }, { id: "quit", label: "Здаюсь і п'ю" }];
  const bets = {
    id: "bets", title: "Ставки", icon: "🎲", minPlayers: 3,
    desc: "Жертві дають завдання, а інші ставлять: зробить чи здасться. Хто схибив — п'є, жертва, що здалась, теж.",
    startSet(ctx) { return { items: texts("bets", SEED.BETS, ctx, ctx.totalRounds), seat: ctx.shuffle(ctx.order.slice()) }; },
    startRound(ctx) {
      const victim = ctx.state.seat[ctx.roundNo % ctx.state.seat.length];
      return {
        kind: "choice", title: "Ставки", text: ctx.state.items[ctx.roundNo], roles: [{ label: "Жертва", name: victim }],
        hint: "Ваша ставка: виконає чи здасться?", options: BET, expect: ctx.order.filter((n) => n !== victim), durationMs: timerMs(ctx, "betSeconds"),
        data: { step: "bet", victim },
      };
    },
    onEnd(ctx, stage, inputs) {
      const d = stage.data;
      if (d.step === "bet") {
        return { kind: "choice", title: "Рішення", text: stage.text, roles: stage.roles, hint: "Виконуєш чи здаєшся?", options: DECIDE, expect: [d.victim], durationMs: timerMs(ctx, "decideSeconds"), data: { step: "decide", victim: d.victim, bets: inputs } };
      }
      const decision = inputs[d.victim] === "do" ? "do" : "quit";
      const penalties = {}, points = {};
      Object.entries(d.bets || {}).forEach(([n, b]) => { if (b === decision) points[n] = 1; else penalties[n] = 1; });
      if (decision === "quit") penalties[d.victim] = (penalties[d.victim] || 0) + 1;
      const bd = Object.values(d.bets || {}), doBets = bd.filter((b) => b === "do").length, quitBets = bd.length - doBets;
      const right = Object.keys(points);
      return reveal(stage, {
        headline: decision === "do" ? `${d.victim} зробив(ла)!` : `${d.victim} здався(лась) і п'є`,
        bars: [{ label: "Зробить", value: doBets }, { label: "Здасться", value: quitBets }],
        lines: [right.length ? `Вгадали: ${right.length} (+1 бал кожному)` : "Ніхто не вгадав"],
        penalties, points, data: { victim: d.victim, decision, bets: d.bets || {} },
      });
    },
  };

  const MODES = { whofrom, court, bets };
  window.PartyModes = { MODES, ORDER: ["whofrom", "court", "bets"], DURATIONS: MS };
})();
