// ==========================================================================
// chess-bot.js — простий бот на minimax + alpha-beta поверх ChessRules.
// Без залежностей і без сервера — рахує прямо в браузері гравця.
// Підключати ПІСЛЯ chess-rules.js, ПЕРЕД chess-game.js (порядок між ним і
// game.js не критичний — бот лише читає window.ChessRules).
// ==========================================================================
(function () {
  const R = window.ChessRules;

  const PIECE_VALUE = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 0 };

  // Спрощені piece-square tables (з погляду білих; для чорних беремо те саме
  // значення з дзеркальної клітинки) — заохочують займати центр, виводити
  // коня/слона з початкової лінії, штовхати центральні пішаки, ховати короля
  // в рокіровку. Стандартна ідея з навчальних матеріалів з написання
  // шахових рушіїв, не якийсь секретний рецепт.
  const PST_P = [
     0,  0,  0,  0,  0,  0,  0,  0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
     5,  5, 10, 25, 25, 10,  5,  5,
     0,  0,  0, 20, 20,  0,  0,  0,
     5, -5,-10,  0,  0,-10, -5,  5,
     5, 10, 10,-20,-20, 10, 10,  5,
     0,  0,  0,  0,  0,  0,  0,  0,
  ];
  const PST_N = [
    -50,-40,-30,-30,-30,-30,-40,-50,
    -40,-20,  0,  0,  0,  0,-20,-40,
    -30,  0, 10, 15, 15, 10,  0,-30,
    -30,  5, 15, 20, 20, 15,  5,-30,
    -30,  0, 15, 20, 20, 15,  0,-30,
    -30,  5, 10, 15, 15, 10,  5,-30,
    -40,-20,  0,  5,  5,  0,-20,-40,
    -50,-40,-30,-30,-30,-30,-40,-50,
  ];
  const PST_B = [
    -20,-10,-10,-10,-10,-10,-10,-20,
    -10,  0,  0,  0,  0,  0,  0,-10,
    -10,  0,  5, 10, 10,  5,  0,-10,
    -10,  5,  5, 10, 10,  5,  5,-10,
    -10,  0, 10, 10, 10, 10,  0,-10,
    -10, 10, 10, 10, 10, 10, 10,-10,
    -10,  5,  0,  0,  0,  0,  5,-10,
    -20,-10,-10,-10,-10,-10,-10,-20,
  ];
  const PST_R = [
     0,  0,  0,  0,  0,  0,  0,  0,
     5, 10, 10, 10, 10, 10, 10,  5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
     0,  0,  0,  5,  5,  0,  0,  0,
  ];
  const PST_Q = [
    -20,-10,-10, -5, -5,-10,-10,-20,
    -10,  0,  0,  0,  0,  0,  0,-10,
    -10,  0,  5,  5,  5,  5,  0,-10,
     -5,  0,  5,  5,  5,  5,  0, -5,
      0,  0,  5,  5,  5,  5,  0, -5,
    -10,  5,  5,  5,  5,  5,  0,-10,
    -10,  0,  5,  0,  0,  0,  0,-10,
    -20,-10,-10, -5, -5,-10,-10,-20,
  ];
  const PST_K = [
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -20,-30,-30,-40,-40,-30,-30,-20,
    -10,-20,-20,-20,-20,-20,-20,-10,
     20, 20,  0,  0,  0,  0, 20, 20,
     20, 30, 10,  0,  0, 10, 30, 20,
  ];
  const PST = { P: PST_P, N: PST_N, B: PST_B, R: PST_R, Q: PST_Q, K: PST_K };

  function pstValue(type, idx, color) {
    const table = PST[type];
    if (!table) return 0;
    // таблиці записані "з погляду білих" (idx 0 = верх дошки, 8-ма
    // горизонталь); для чорних беремо значення з клітинки, симетричної
    // відносно центру дошки — усі таблиці навмисно симетричні по колонках,
    // тож повний розворот на 180° еквівалентний розвороту лише по рядку.
    return table[color === "w" ? idx : 63 - idx];
  }

  const MATE = 1000000;

  function evaluate(state) {
    let score = 0;
    for (let i = 0; i < 64; i++) {
      const p = state.board[i];
      if (!p) continue;
      const color = R.pieceColor(p), type = R.pieceType(p);
      const val = PIECE_VALUE[type] + pstValue(type, i, color);
      score += color === "w" ? val : -val;
    }
    return score;
  }

  function expandMoves(state) {
    const moves = R.allLegalMoves(state).map((m) => {
      if (R.needsPromotion(state, m.from, m.to)) return { from: m.from, to: m.to, promotion: "Q" };
      return m;
    });
    // взяття спершу — альфа-бета ріже значно більше гілок при хорошому
    // впорядкуванні ходів
    moves.sort((a, b) => (state.board[b.to] ? 1 : 0) - (state.board[a.to] ? 1 : 0));
    return moves;
  }

  function search(state, depth, alpha, beta) {
    const status = R.gameStatus(state);
    if (status.status === "checkmate") return state.turn === "w" ? -MATE - depth : MATE + depth;
    if (status.status === "stalemate" || status.status === "draw-50move" || status.status === "draw-material") return 0;
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

  // depth: 1 = легко, 2 = середньо, 3 = складно (див. BOT_DEPTH у chess.html)
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
    // серед рівноцінних ходів — випадковий, щоб бот не грав щоразу однаково
    return bestMoves[Math.floor(Math.random() * bestMoves.length)];
  }

  window.ChessBot = { pickMove, evaluate };
})();
