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

function gameActions(game, room, bots, now) {
  const updates = {};
  const actions = [];
  const players = room.players || {};

  function set(path, value, label) {
    updates[path] = value;
    actions.push(label);
  }

  if (game === "humanbingo") {
    if (room.phase !== "playing") return { updates, actions };
    const names = Object.keys(players);
    for (const bot of bots) {
      const card = (room.cards && room.cards[bot.name]) || [];
      const targets = names.filter((name) => name !== bot.name);
      if (!targets.length) continue;
      for (let i = 0; i < card.length; i++) {
        const key = `marks/${bot.name}/${card[i]}`;
        if (room.marks && room.marks[bot.name] && room.marks[bot.name][card[i]]) continue;
        set(key, targets[(i + bot.index) % targets.length], `${bot.name}: marked bingo card`);
      }
    }
    return { updates, actions };
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

  if (["whofrom", "court", "bets", "charades", "fakenews", "naklep"].includes(game)) {
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
        if (stage.kind === "encode" && stage.data && stage.data.encoder === bot.name) {
          set(`inputs/${bot.name}`, `${stage.id}:e:🐱🎩`, `${bot.name}: encoded the word`);
        } else if (stage.kind === "guess" && stage.data && Array.isArray(stage.data.answers)) {
          const answer = stage.data.answers[0];
          if (answer) set(`inputs/${bot.name}`, `${stage.id}:${now + bot.index}`, `${bot.name}: guessed the word`);
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

      if (game === "naklep") {
        if (stage.kind === "pick-name") {
          const target = pick((stage.names || []).filter((name) => name !== bot.name), bot.index);
          if (target) set(`inputs/${bot.name}`, `${stage.id}:${target}`, `${bot.name}: guessed who the fact belongs to`);
        } else if (stage.kind === "choice") {
          const choice = (stage.options || []).find((item) => item.id === "no") || (stage.options || [])[0];
          if (choice) set(`inputs/${bot.name}`, `${stage.id}:${choice.id}`, `${bot.name}: answered the question`);
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

  throw new Error(`Unsupported game action handler: ${game}`);
}

module.exports = { gameActions };
