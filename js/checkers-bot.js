// ==========================================================================
// checkers-bot.js — простий бот на minimax + alpha-beta поверх CheckersRules.
// Без залежностей і без сервера. Структура файлу дзеркалить chess-bot.js.
// Підключати ПІСЛЯ checkers-rules.js, ПЕРЕД checkers-game.js.
//
// Важливо: у цьому рушії правил один "хід" (move) — це один стрибок. Серія
// обов'язкових взять одніє фігурою — це кілька послідовних ходів з тим самим
// state.turn (forcedFrom тримає чергу на місці). Пошук нижче про це не
// думає спеціально: R.allLegalMoves() і так повертає лише ходи forcedFrom-
// фігури, коли серія триває, тож дерево пошуку саме звужується куди треба.
// ==========================================================================
(function () {
  const R = window.CheckersRules;

  const MATE = 1000000;
  const MAN_VALUE = 100;
  const KING_VALUE = 130;

  function evaluate(state) {
    let score = 0;
    for (let i = 0; i < 64; i++) {
      const p = state.board[i];
      if (!p) continue;
      const color = R.pieceColor(p), type = R.pieceType(p);
      let val = type === "K" ? KING_VALUE : MAN_VALUE;
      if (type === "M") {
        // невелика заохота простій шашці посуватись до дамкування —
        // без цього бот на низькій глибині не бачить сенсу йти вперед
        const row = R.rowOf(i);
        val += (color === "w" ? (7 - row) : row) * 2;
      }
      score += color === "w" ? val : -val;
    }
    return score;
  }

  function expandMoves(state) {
    const moves = R.allLegalMoves(state);
    // взяття спершу — кращий порядок ходів для альфа-бета
    moves.sort((a, b) => (b.captured !== null ? 1 : 0) - (a.captured !== null ? 1 : 0));
    return moves;
  }

  function search(state, depth, alpha, beta) {
    const status = R.gameStatus(state);
    if (status.status === "no-moves") return state.turn === "w" ? -MATE - depth : MATE + depth;
    if (depth === 0) return evaluate(state);

    const moves = expandMoves(state);
    if (state.turn === "w") {
      let best = -Infinity;
      for (const mv of moves) {
        best = Math.max(best, search(R.makeMove(state, mv), depth - 1, alpha, beta));
        alpha = Math.max(alpha, best);
        if (beta <= alpha) break;
      }
      return best;
    }
    let best = Infinity;
    for (const mv of moves) {
      best = Math.min(best, search(R.makeMove(state, mv), depth - 1, alpha, beta));
      beta = Math.min(beta, best);
      if (beta <= alpha) break;
    }
    return best;
  }

  // depth: 2 = легко, 4 = середньо, 6 = складно (див. BOT_DEPTH у checkers.html)
  function pickMove(state, depth) {
    const moves = expandMoves(state);
    if (!moves.length) return null;
    const maximizing = state.turn === "w";
    let best = maximizing ? -Infinity : Infinity;
    let bestMoves = [];
    for (const mv of moves) {
      const val = search(R.makeMove(state, mv), depth - 1, -Infinity, Infinity);
      if (maximizing ? val > best : val < best) {
        best = val;
        bestMoves = [mv];
      } else if (val === best) {
        bestMoves.push(mv);
      }
    }
    return bestMoves[Math.floor(Math.random() * bestMoves.length)];
  }

  window.CheckersBot = { pickMove, evaluate };
})();
