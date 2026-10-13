// ==========================================================================
// party-modes.js — режими «Вечірки» як ЧИСТІ функції (без DOM і без Firebase),
// тому їх можна тестувати окремо. Рушій (party-game.js) викликає їх на хості.
//
// Режим:
//   id, title, icon, desc, minPlayers, defaultRounds,
//   startSet(ctx)            → стан набору (JSON), зберігається в room.deck
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
  const MS = { vote: 15000, bet: 15000, decide: 20000, reveal: 45000 };

  function texts(list, ctx, count) {
    return ctx.shuffle((list || []).filter((x) => x.level <= ctx.level)).slice(0, count).map((x) => x.text);
  }
  function sortedCounts(counts) { // [[ім'я, голосів]] за спаданням, далі за алфавітом
    return Object.entries(counts).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  }
  function courtSpeakDuration(ctx) {
    const seconds = Number(ctx.settings && ctx.settings.courtSpeakSeconds);
    return (Number.isInteger(seconds) && seconds >= 5 && seconds <= 300 ? seconds : 15) * 1000;
  }
  function reveal(stage, fields) { // stage — етап, що закінчився: з нього беремо питання/ситуацію й ролі
    return Object.assign({ kind: "reveal", title: "Результат", text: stage.text, roles: stage.roles || [], durationMs: MS.reveal, bars: [], lines: [], penalties: {}, points: {} }, fields);
  }

  // ------------------------------------------------------------------
  // Хто з нас? — швидке голосування за ім'я
  // ------------------------------------------------------------------
  const whofrom = {
    id: "whofrom", title: "Хто з нас?", icon: "🗳️", minPlayers: 3, defaultRounds: 8,
    desc: "Питання, усі за 15 секунд обирають одне ім'я. Найпопулярніший п'є, а ще ті, хто проголосував самотньо.",
    startSet(ctx) { return { items: texts(SEED.WHOFROM, ctx, ctx.totalRounds) }; },
    startRound(ctx) {
      return { kind: "pick-name", title: "Хто з нас?", text: ctx.state.items[ctx.roundNo], names: ctx.order.slice(), expect: ctx.order.slice(), durationMs: MS.vote };
    },
    onEnd(ctx, stage, inputs) {
      const counts = {};
      Object.values(inputs).forEach((t) => { if (ctx.order.includes(t)) counts[t] = (counts[t] || 0) + 1; });
      const sorted = sortedCounts(counts);
      const voters = Object.keys(inputs).length;
      const top = sorted.length ? sorted[0][1] : 0;
      const bars = sorted.slice(0, 8).map(([name, value]) => ({ name, value }));
      if (top < 2) { // голоси розкидались — нікого не винне
        return reveal(stage, { headline: voters ? "Голоси розкидались" : "Ніхто не проголосував", bars, lines: [voters ? "Ніхто не набрав двох голосів — без ковтків" : ""].filter(Boolean) });
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
      return reveal(stage, { headline: `🏆 ${winners.join(", ")}`, bars, lines, penalties });
    },
  };

  // ------------------------------------------------------------------
  // Суд Лінча — звинувачений, адвокат і вердикт присяжних
  // ------------------------------------------------------------------
  const VERDICT = [{ id: "guilty", label: "🔴 Винен" }, { id: "forgive", label: "🟢 Простити" }];
  const court = {
    id: "court", title: "Суд Лінча", icon: "⚖️", minPlayers: 3, defaultRounds: 6,
    desc: "Двоє виправдовуються й захищають, решта виносить вирок. Винен — п'є звинувачений, простили — п'є весь суд.",
    startSet(ctx) { return { items: texts(SEED.COURT, ctx, ctx.totalRounds), seat: ctx.shuffle(ctx.order.slice()) }; },
    startRound(ctx) {
      const seat = ctx.state.seat, n = ctx.roundNo, N = seat.length;
      const accused = seat[(2 * n) % N], lawyer = seat[(2 * n + 1) % N];
      return {
        kind: "show", title: "Суд Лінча", text: "Звинувачений " + ctx.state.items[n],
        roles: [{ label: "Звинувачений", name: accused }, { label: "Адвокат", name: lawyer }],
        hint: "🎤 Слово має звинувачений: виправдовується вголос", durationMs: courtSpeakDuration(ctx), data: { step: "accused", accused, lawyer },
      };
    },
    onEnd(ctx, stage, inputs) {
      const d = stage.data;
      if (d.step === "accused") {
        return { kind: "show", title: "Суд Лінча", text: stage.text, roles: stage.roles, hint: "🎤 Слово має адвокат: захищає будь-яким абсурдом", durationMs: courtSpeakDuration(ctx), data: Object.assign({}, d, { step: "lawyer" }) };
      }
      if (d.step === "lawyer") {
        const jurors = ctx.order.filter((n) => n !== d.accused && n !== d.lawyer);
        return { kind: "choice", title: "Вердикт", text: stage.text, roles: stage.roles, hint: "Ваш вирок?", options: VERDICT, expect: jurors, durationMs: MS.vote, data: Object.assign({}, d, { step: "verdict", jurors }) };
      }
      // вердикт → результат
      const jurors = d.jurors;
      const g = Object.values(inputs).filter((v) => v === "guilty").length;
      const f = Object.values(inputs).filter((v) => v === "forgive").length;
      const bars = [{ label: "🔴 Винен", value: g }, { label: "🟢 Простити", value: f }];
      if (g > f) return reveal(stage, { headline: `🔴 Винен: ${d.accused} п'є`, bars, lines: ["Більшість проти звинуваченого"], penalties: { [d.accused]: 1 } });
      if (f > g) {
        const penalties = {}; jurors.forEach((n) => { penalties[n] = 1; });
        return reveal(stage, { headline: `🟢 Простили: суд п'є`, bars, lines: [`${d.lawyer} переконав(ла) суд: +1 бал`, "Простили — отже п'є вся колегія присяжних"], penalties, points: { [d.lawyer]: 1 } });
      }
      return reveal(stage, { headline: "⚖️ Порівну: адвокат не переконав", bars, lines: [`${d.lawyer} п'є за нічию`], penalties: { [d.lawyer]: 1 } });
    },
  };

  // ------------------------------------------------------------------
  // Ставки — інші ставлять, чи виконає жертва завдання
  // ------------------------------------------------------------------
  const BET = [{ id: "do", label: "💪 Зробить" }, { id: "quit", label: "🥤 Здасться" }];
  const DECIDE = [{ id: "do", label: "💪 Роблю" }, { id: "quit", label: "🥤 Здаюсь і п'ю" }];
  const bets = {
    id: "bets", title: "Ставки", icon: "🎲", minPlayers: 3, defaultRounds: 6,
    desc: "Жертві дають завдання, а інші ставлять: зробить чи здасться. Хто схибив — п'є, жертва, що здалась, теж.",
    startSet(ctx) { return { items: texts(SEED.BETS, ctx, ctx.totalRounds), seat: ctx.shuffle(ctx.order.slice()) }; },
    startRound(ctx) {
      const victim = ctx.state.seat[ctx.roundNo % ctx.state.seat.length];
      return {
        kind: "choice", title: "Ставки", text: ctx.state.items[ctx.roundNo], roles: [{ label: "Жертва", name: victim }],
        hint: "Ваша ставка: виконає чи здасться?", options: BET, expect: ctx.order.filter((n) => n !== victim), durationMs: MS.bet,
        data: { step: "bet", victim },
      };
    },
    onEnd(ctx, stage, inputs) {
      const d = stage.data;
      if (d.step === "bet") {
        return { kind: "choice", title: "Рішення", text: stage.text, roles: stage.roles, hint: "Виконуєш чи здаєшся?", options: DECIDE, expect: [d.victim], durationMs: MS.decide, data: { step: "decide", victim: d.victim, bets: inputs } };
      }
      const decision = inputs[d.victim] === "do" ? "do" : "quit";
      const penalties = {}, points = {};
      Object.entries(d.bets || {}).forEach(([n, b]) => { if (b === decision) points[n] = 1; else penalties[n] = 1; });
      if (decision === "quit") penalties[d.victim] = (penalties[d.victim] || 0) + 1;
      const bd = Object.values(d.bets || {}), doBets = bd.filter((b) => b === "do").length, quitBets = bd.length - doBets;
      const right = Object.keys(points);
      return reveal(stage, {
        headline: decision === "do" ? `💪 ${d.victim} зробив(ла)!` : `🥤 ${d.victim} здався(лась) і п'є`,
        bars: [{ label: "💪 Зробить", value: doBets }, { label: "🥤 Здасться", value: quitBets }],
        lines: [right.length ? `Вгадали: ${right.length} (+1 бал кожному)` : "Ніхто не вгадав"],
        penalties, points,
      });
    },
  };

  const MODES = { whofrom, court, bets };
  window.PartyModes = { MODES, ORDER: ["whofrom", "court", "bets"], DURATIONS: MS };
})();
