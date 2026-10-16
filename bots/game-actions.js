function pick(items, offset) {
  return items.length ? items[((offset % items.length) + items.length) % items.length] : undefined;
}

// ---- Мафія: репліки ботів і тривалості фаз (дзеркало PHASE_DURATIONS з js/mafia-game.js) ----
const MAFIA_PHASE_MS = {
  role_reveal: 10000, banner_night_start: 2500, mafia_wake: 3000, doctor_wake: 3000, sheriff_wake: 3000, mafia_move: 20000, doctor_move: 15000, sheriff_move: 15000,
  banner_morning: 3500, night_reveal: 10000, last_words: 15000, day_discussion: 90000, voting: 20000,
  player_elimination_anim: 7000, banner_state: 4000,
};
const DAY_LINES = [
  "Я мирний, клянусь бабусиним борщем 🥣",
  "{x} якось підозріло мовчить…",
  "А чому {x} вчора голосував так дивно?",
  "Пропоную придивитись до {x}",
  "Я спав як немовля, нічого не бачив",
  "Хтось вночі шарудів біля мого вікна 👀",
  "Ну точно не я. Мені просто лінь когось вбивати",
  "{x}, а ти що скажеш на своє виправдання?",
  "Давайте без паніки. Хто голосує за {x}?",
  "Шериф, якщо ти тут — подай знак 😏",
];
const MAFIA_DAY_LINES = [
  "Я мирний, чесно-чесно 😇",
  "Мені здається, {x} щось приховує",
  "Не поспішаймо, бо виженемо свого",
  "{x} занадто нервує, ви помітили?",
  "Я за {x}. Інтуїція ще не підводила",
];
const MAFIA_NIGHT_LINES = [
  "Берем того, хто найбільше галасує 🔪",
  "Шерифа треба вирахувати першим",
  "Я за свого кандидата, дивіться на приціл",
  "Тихо працюємо, без шуму",
  "Вдень тримаємось разом, не палимось",
];

// ---- Сміхлист: відповіді й голоси ботів ----
const QUIPLASH_ANSWERS = [
  "Бабусин борщ з ананасом", "Кіт у податковій", "Вайфай від сусіда", "Шкарпетки з сандалями", "Голосове на 12 хвилин",
  "Таємний рецепт олів'є", "Будильник о 4:58", "Тещин холодець", "Пральна машинка, що співає", "Сало в шоколаді",
  "Групповий чат батьків", "Відпустка в Жмеринці", "Робот-пилосос із депресією", "Оновлення Windows посеред гри", "Дід на самокаті",
  "Борщ у термосі", "Квитанція за газ", "Пакет з пакетами", "Голуб із дипломом", "Сусід із перфоратором",
];

function gameActionsQuiplash(room, bots, now) {
  const updates = {};
  const actions = [];
  const phase = room.phase;
  const startedAt = room.phaseStartedAt || now;
  const since = now - startedAt;
  const players = room.players || {};
  const conn = Object.entries(players).filter(([, p]) => p && p.lastSeen && now - p.lastSeen < 120000).map(([n]) => n);
  const round = room.round || 0;
  const matchups = Object.keys(room.matchups || {}).sort().map((k) => room.matchups[k]);
  for (const bot of bots) {
    if (!players[bot.name]) continue;
    // кожен бот «думає» по-своєму: відповідає за 4–30 с, голосує за 2–12 с
    if (phase === "answering") {
      const thinkMs = 4000 + ((bot.index * 5300 + round * 1700) % 26000);
      if (since < thinkMs) continue;
      if (room.gallery) {
        const mine = (room.gallery.answers || {})[bot.name];
        const answerer = !Array.isArray(room.roundAnswerers) || room.roundAnswerers.includes(bot.name);
        if (answerer && !mine) {
          updates[`gallery/answers/${bot.name}`] = pick(QUIPLASH_ANSWERS, bot.index * 3 + round * 7);
          actions.push(`${bot.name}: caption`);
        }
        continue;
      }
      // по одній відповіді за тік — виглядає живіше
      const m = matchups.find((x) => (x.playerAId === bot.name && !x.answerA) || (x.playerBId === bot.name && !x.answerB));
      if (m) {
        const side = m.playerAId === bot.name && !m.answerA ? "A" : "B";
        updates[`matchups/${m.id}/answer${side}`] = pick(QUIPLASH_ANSWERS, bot.index * 5 + matchups.indexOf(m) * 3 + round);
        actions.push(`${bot.name}: answered`);
      }
    } else if (phase === "voting") {
      if (room.voteRevealAt && now < room.voteRevealAt) continue;
      const thinkMs = 2000 + ((bot.index * 2900 + (room.currentMatchupIndex || 0) * 1300) % 10000);
      if (since < thinkMs) continue;
      if (room.gallery) {
        if ((room.gallery.votes || {})[bot.name]) continue;
        const authors = Object.keys(room.gallery.answers || {}).filter((n) => n !== bot.name && room.gallery.answers[n]);
        const target = pick(authors, bot.index + round);
        if (target) { updates[`gallery/votes/${bot.name}`] = target; actions.push(`${bot.name}: gallery vote`); }
        continue;
      }
      const m = matchups[room.currentMatchupIndex || 0];
      if (!m || (m.votes || {})[bot.name]) continue;
      const twoPlayer = conn.length === 2;
      const participant = m.playerAId === bot.name || m.playerBId === bot.name;
      if (participant && !twoPlayer) continue;
      let choice = (bot.index + (room.currentMatchupIndex || 0)) % 3 === 0 ? "B" : "A";
      if (twoPlayer) choice = m.playerAId === bot.name ? "B" : "A";
      updates[`matchups/${m.id}/votes/${bot.name}`] = choice;
      actions.push(`${bot.name}: voted ${choice}`);
    }
  }
  return { updates, actions };
}

function gameActions(game, room, bots, now) {
  if (game === "quiplash") return gameActionsQuiplash(room, bots, now);
  const updates = {};
  const actions = [];
  const players = room.players || {};

  function set(path, value, label) {
    updates[path] = value;
    actions.push(label);
  }

  if (game === "dilemmas") {
    if (room.phase === "voting") {
      for (const bot of bots) {
        if (!(room.order || []).includes(bot.name)) continue;
        const currentVote = room.votes && room.votes[bot.name];
        if (currentVote === `${room.currentRound}:a` || currentVote === `${room.currentRound}:b`) continue;
        const choice = (room.currentRound + bot.index) % 2 === 0 ? "a" : "b";
        set(`votes/${bot.name}`, `${room.currentRound}:${choice}`, `${bot.name}: voted ${choice}`);
      }
    } else if (room.phase === "final") {
      for (const bot of bots) {
        const task = room.final && room.final.tasks && room.final.tasks[bot.name];
        if (task && task.chosen == null) {
          set(`final/tasks/${bot.name}/chosen`, 0, `${bot.name}: picked a final task`);
        }
      }
    }
    return { updates, actions };
  }

  if (["whofrom", "court", "bets", "charades", "fakenews"].includes(game)) {
    if (room.phase !== "round" || !room.stage) return { updates, actions };
    const stage = room.stage;
    const expected = stage.expect || [];
    const rawInputs = room.inputs || {};
    const currentInput = (name) => {
      const raw = rawInputs[name];
      if (typeof raw !== "string") return null;
      const separator = raw.indexOf(":");
      return separator >= 0 && Number(raw.slice(0, separator)) === stage.id
        ? raw.slice(separator + 1)
        : null;
    };

    for (const bot of bots) {
      if (!(expected.includes(bot.name)) || currentInput(bot.name) !== null) continue;

      if (game === "charades") {
        if (!stage.data || stage.data.encoder !== bot.name) continue; // відгадують уголос — ботам-глядачам нічого тиснути
        const seenKey = `ch:${stage.id}`;
        if (!memoSeen[seenKey]) memoSeen[seenKey] = now;
        const since = now - memoSeen[seenKey];
        const seed = stage.id * 7 + bot.index * 3;
        const mine = room.inputs && room.inputs[bot.name];
        if (stage.kind === "encode") {
          // «думає» 6–20 с, потім шле 2–4 випадкові емодзі (бот не розуміє слова — так і задумано, людям смішніше)
          if (mine || since < 6000 + (seed * 1300) % 14000) continue;
          const n = 2 + (seed % 3);
          const code = Array.from({ length: n }, (_, i) => pick(CHARADES_EMOJI, seed + i * 5)).join("");
          set(`inputs/${bot.name}`, `${stage.id}:e:${code}`, `${bot.name}: зашифрував ${code}`);
        } else if (stage.kind === "guess") {
          // слухає 12–25 с; найчастіше «чує» одного-двох людей, інколи — нікого
          if ((typeof mine === "string" && mine.indexOf(`${stage.id}:d:`) === 0) || since < 12000 + (seed * 1700) % 13000) continue;
          const others = (room.order || []).filter((name) => name !== bot.name);
          const humans = others.filter((name) => !bots.some((b) => b.name === name));
          const pool = humans.length ? humans : others;
          const count = seed % 4 === 0 ? 0 : 1 + (seed % 2);
          const heard = [];
          for (let i = 0; i < count && i < pool.length; i++) heard.push(pick(pool, seed + i));
          const uniq = [...new Set(heard)];
          set(`inputs/${bot.name}`, `${stage.id}:d:${uniq.join("|")}`, `${bot.name}: вгадали — ${uniq.join(", ") || "ніхто"}`);
        }
        continue;
      }

      if (game === "fakenews") {
        if (stage.kind === "write") {
          const headline = `Терміново: ${bot.name} знайшов неймовірну історію №${stage.id}`;
          set(`inputs/${bot.name}`, `${stage.id}:${headline.slice(0, 90)}`, `${bot.name}: wrote a headline`);
        } else if (stage.kind === "vote") {
          const authors = (stage.data && stage.data.authors) || [];
          const option = (stage.options || []).find((item) => authors[Number(item.id)] !== bot.name);
          if (option) set(`inputs/${bot.name}`, `${stage.id}:${option.id}`, `${bot.name}: voted for a headline`);
        }
        continue;
      }


      if (stage.kind === "pick-name") {
        const target = pick((stage.names || []).filter((name) => name !== bot.name), bot.index + (room.roundNo || 0));
        if (target) set(`inputs/${bot.name}`, `${stage.id}:${target}`, `${bot.name}: voted for a player`);
      } else if (stage.kind === "choice") {
        const choice = pick(stage.options || [], bot.index + (room.roundNo || 0));
        if (choice) set(`inputs/${bot.name}`, `${stage.id}:${choice.id}`, `${bot.name}: chose ${choice.id}`);
      }
    }
    return { updates, actions };
  }

  if (game === "teli") {
    // drawings: [{ ref, seed }] — run-tests пише їх у teli_drawings ДО оновлення кімнати
    const drawings = [];
    if (room.phase !== "active") return { updates, actions, drawings };
    const round = room.currentRound;
    const PHRASES = ["кіт на даху", "бабуся на скейті", "пес-космонавт", "борщ у космосі", "жираф у трамваї", "дракон п'є чай", "робот на риболовлі", "слон на велосипеді"];
    for (const bot of bots) {
      const task = room.assignments && room.assignments[bot.name];
      if (!task || task.round !== round || (room.submitted && room.submitted[bot.name] === round + 1)) continue;
      if (task.type === "text") {
        const content = task.prompt && task.prompt.type === "drawing"
          ? `схоже на «${pick(PHRASES, bot.index + round + 3)}»`
          : pick(PHRASES, bot.index * 3 + round);
        set(`books/${task.bookIndex}/${round}`, { type: "text", content, authorName: bot.name }, `${bot.name}: wrote «${content}»`);
      } else {
        const ref = `${room.gameId}/${task.bookIndex}_${round}`;
        drawings.push({ ref, seed: (room.gameId || 1) + bot.index * 7919 + round });
        set(`books/${task.bookIndex}/${round}`, { type: "drawing", ref, authorName: bot.name }, `${bot.name}: drew a doodle`);
      }
      updates[`submitted/${bot.name}`] = round + 1;
    }
    return { updates, actions, drawings };
  }

  if (game === "mafia") {
    const alive = Object.entries(players).filter(([, p]) => p && p.alive !== false).map(([n]) => n);
    const moves = room.moves || {}, votes = room.votes || {}, dayReady = room.dayReady || {};
    const phase = room.phase || "lobby";
    const night = room.nightNumber || 0;
    const since = now - ((room.phaseDeadline || now) - (MAFIA_PHASE_MS[phase] || 0)); // скільки мс триває фаза
    for (const bot of bots) {
      const me = players[bot.name];
      if (!me) continue;
      if (phase === "lobby") {
        if (!me.ready) set(`players/${bot.name}/ready`, true, `${bot.name}: ready`);
        continue;
      }
      if (me.alive === false) continue;
      const others = alive.filter((n) => n !== bot.name);
      const offset = bot.index + night;
      // кожен бот «думає» трохи по-своєму — не всі тиснуть в ту ж мить
      const thinkMs = 1500 + ((bot.index * 1700 + night * 900) % 6000);
      const thought = since >= thinkMs;

      // репліки в чат: раз на фазу на бота, з затримкою
      // (чат чиститься на старті кожної гри, тож перевірка по самому чату)
      const pk = `${night}|${phase}`;
      const chatAt = 2500 + ((bot.index * 2300) % 9000);
      const chatted = Object.values(room.chat || {}).some((m) => m && m.username === bot.name && m.pk === pk);
      if (since >= chatAt && !chatted) {
        let line = null, channel = null, status = null;
        if (phase === "day_discussion" || (phase === "voting" && bot.index % 3 === 0)) {
          const lines = me.role === "mafia" ? MAFIA_DAY_LINES : DAY_LINES;
          const suspect = pick(others.filter((n) => !(me.role === "mafia" && players[n].role === "mafia")), offset + 1);
          line = pick(lines, offset + bot.index * 3).replace("{x}", suspect || "хтось");
          channel = "day"; status = "day";
        } else if (phase === "mafia_move" && me.role === "mafia" && alive.some((n) => n !== bot.name && players[n].role === "mafia")) {
          line = pick(MAFIA_NIGHT_LINES, offset);
          channel = "mafia_move"; status = "role_mafia";
        }
        if (line) {
          set(`chat/bot_${now}_${bot.index}`, { username: bot.name, text: line, at: now, channel, status, pk }, `${bot.name}: chat`);
        }
      }
      if (!thought) continue;

      if (phase === "mafia_move" && me.role === "mafia" && !moves[bot.name]) {
        // сім'я тягнеться до цілі, яку вже обрав хтось із своїх
        const teamPick = Object.entries(moves).map(([u, m]) => players[u] && players[u].role === "mafia" && m && m.target).find(Boolean);
        const target = teamPick || pick(others.filter((n) => players[n].role !== "mafia"), offset);
        set(`moves/${bot.name}`, target ? { choice: "target", target } : { choice: "skip", target: null }, `${bot.name}: mafia move`);
      } else if (phase === "doctor_move" && me.role === "doctor" && !moves[bot.name]) {
        // кілька лікарів-ботів розходяться по різних цілях
        const target = (night + bot.index) % 2 ? bot.name : pick(others, offset + bot.index * 3) || bot.name;
        set(`moves/${bot.name}`, { choice: "target", target }, `${bot.name}: doctor saves ${target === bot.name ? "self" : "someone"}`);
      } else if (phase === "sheriff_move" && me.role === "sheriff" && !moves[bot.name]) {
        const checked = new Set(Object.values(room.sheriffLog || {}).map((e) => e && e.target));
        const target = pick(others.filter((n) => !checked.has(n)), offset) || pick(others, offset);
        if (target) set(`moves/${bot.name}`, { choice: "target", target }, `${bot.name}: sheriff checks`);
      } else if (phase === "day_discussion" && !dayReady[bot.name] && since >= thinkMs + 6000) {
        set(`dayReady/${bot.name}`, true, `${bot.name}: ready to vote`);
      } else if (phase === "voting" && !votes[bot.name]) {
        // половина ботів підтягується до лідера голосування, решта — свій вибір
        const tally = {};
        Object.values(votes).forEach((t) => { tally[t] = (tally[t] || 0) + 1; });
        const leader = Object.entries(tally).filter(([n]) => n !== bot.name && alive.includes(n)).sort((a, b) => b[1] - a[1])[0];
        let pool = others;
        if (me.role === "mafia") pool = others.filter((n) => players[n].role !== "mafia");
        const target = (leader && bot.index % 2 === 0 && !(me.role === "mafia" && players[leader[0]].role === "mafia")) ? leader[0] : pick(pool, offset);
        if (target) set(`votes/${bot.name}`, target, `${bot.name}: voted`);
      }
    }
    return { updates, actions };
  }

  // Шпигун: гра вголос — ботам нічого натискати, вони просто «сидять» у колі
  if (game === "spy") return { updates, actions };

  // Мемологія: бот кидає мем через 3–15 с і голосує за чужий через 2–10 с
  if (game === "memology") {
    const r = room.round;
    if (room.phase !== "active" || !r) return { updates, actions };
    const key = `${room.roundNumber}:${r.subPhase}`;
    if (!memoSeen[key]) memoSeen[key] = now;
    const since = now - memoSeen[key];
    const subs = r.submissions || {}, votes = r.votes || {};
    const deck = room.deck || {};
    const pool = [].concat(Object.values(deck.new || {}), Object.values(deck.played || {})).filter((c) => typeof c === "string");
    for (const bot of bots) {
      if (!players[bot.name]) continue;
      const offset = bot.index * 7 + (room.roundNumber || 0) * 3;
      if (r.subPhase === "submitting" && subs[bot.name] === undefined && pool.length) {
        if (since < 3000 + ((bot.index * 4100 + (room.roundNumber || 0) * 1300) % 12000)) continue;
        const taken = new Set(Object.values(subs));
        const card = pool.filter((c) => !taken.has(c))[offset % Math.max(1, pool.length - taken.size)] || pick(pool, offset);
        set(`round/submissions/${bot.name}`, card, `${bot.name}: кинув мем`);
      } else if (r.subPhase === "voting" && !votes[bot.name]) {
        if (since < 2000 + ((bot.index * 2900) % 8000)) continue;
        const others = Object.keys(subs).filter((n) => n !== bot.name).sort();
        const target = pick(others, offset);
        if (target) set(`round/votes/${bot.name}`, target, `${bot.name}: проголосував`);
      }
    }
    return { updates, actions };
  }

  throw new Error(`Unsupported game action handler: ${game}`);
}
const memoSeen = {};
const CHARADES_EMOJI = ["🐱", "🎩", "🚀", "🌊", "🔥", "🍕", "👑", "🦁", "🎸", "💔", "🌙", "⚡", "🧙", "🏠", "🚗", "🐉", "🍎", "🎬", "❄️", "🌈", "💰", "🤖", "🦈", "⏰", "🎂", "🧠", "👻", "🌻"];

module.exports = { gameActions };
