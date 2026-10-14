function pick(items, offset) {
  return items.length ? items[((offset % items.length) + items.length) % items.length] : undefined;
}

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
    for (const bot of bots) {
      const me = players[bot.name];
      if (!me) continue;
      if ((room.phase || "lobby") === "lobby") {
        if (!me.ready) set(`players/${bot.name}/ready`, true, `${bot.name}: ready`);
        continue;
      }
      if (me.alive === false) continue;
      const others = alive.filter((n) => n !== bot.name);
      const offset = bot.index + (room.nightNumber || 0);
      if (room.phase === "mafia_move" && me.role === "mafia" && !moves[bot.name]) {
        const target = pick(others.filter((n) => players[n].role !== "mafia"), offset);
        set(`moves/${bot.name}`, target ? { choice: "target", target } : { choice: "skip", target: null }, `${bot.name}: mafia move`);
      } else if (room.phase === "doctor_move" && me.role === "doctor" && !moves[bot.name]) {
        set(`moves/${bot.name}`, { choice: "target", target: bot.name }, `${bot.name}: doctor saves self`);
      } else if (room.phase === "sheriff_move" && me.role === "sheriff" && !moves[bot.name]) {
        const target = pick(others, offset);
        if (target) set(`moves/${bot.name}`, { choice: "target", target }, `${bot.name}: sheriff checks`);
      } else if (room.phase === "day_discussion" && !dayReady[bot.name]) {
        set(`dayReady/${bot.name}`, true, `${bot.name}: ready to vote`);
      } else if (room.phase === "voting" && !votes[bot.name]) {
        const target = pick(others, offset);
        if (target) set(`votes/${bot.name}`, target, `${bot.name}: voted`);
      }
    }
    return { updates, actions };
  }

  throw new Error(`Unsupported game action handler: ${game}`);
}

module.exports = { gameActions };
