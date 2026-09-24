// ==========================================================================
// chess-rules.js — чистий рушій шахових правил. Без DOM/Firebase — те саме
// ядро використовують і онлайн-гра (chess-game.js), і локальний
// pass-and-play в chess.html, і майбутній режим "хід/партія дня".
//
// Представлення дошки: масив 64 клітинок, індекс 0 = a8, 63 = h1 (тобто
// індекс росте зліва направо, згори вниз, коли білі внизу) —
// row = floor(idx/8) (0 = 8-та горизонталь), col = idx%8 (0 = вертикаль a).
// Фігура — рядок з 2 символів: колір ('w'|'b') + тип ('P','N','B','R','Q','K'),
// напр. "wP", "bQ". Порожня клітинка — null.
//
// Стан гри (GameState) — простий серіалізовний об'єкт (сумісний з RTDB):
//   {
//     board: [64 значення],
//     turn: "w" | "b",
//     castling: { wK: bool, wQ: bool, bK: bool, bQ: bool }, // ще можлива рокіровка
//     enPassant: idx | null,      // клітинка "за пішаком", куди можна побити на проході
//     halfmoveClock: number,      // напівходів без взяття/ходу пішаком (для 50-ходів)
//     fullmoveNumber: number,
//     lastMove: { from, to, promotion? } | null,
//     history: [ { from, to, promotion?, san, capturedIdx? } ... ], // повна нотація партії
//   }
// ==========================================================================
(function () {
  const FILES = "abcdefgh";

  function idxOf(row, col) { return row * 8 + col; }
  function rowOf(idx) { return Math.floor(idx / 8); }
  function colOf(idx) { return idx % 8; }
  function inBounds(row, col) { return row >= 0 && row < 8 && col >= 0 && col < 8; }

  function squareName(idx) {
    return FILES[colOf(idx)] + (8 - rowOf(idx));
  }
  function squareFromName(name) {
    const col = FILES.indexOf(name[0]);
    const row = 8 - parseInt(name.slice(1), 10);
    if (col < 0 || Number.isNaN(row)) return null;
    return idxOf(row, col);
  }

  function pieceColor(p) { return p ? p[0] : null; }
  function pieceType(p) { return p ? p[1] : null; }
  function otherColor(c) { return c === "w" ? "b" : "w"; }

  // ------------------------- початкова розстановка -------------------------
  function initialBoard() {
    const back = ["R", "N", "B", "Q", "K", "B", "N", "R"];
    const board = new Array(64).fill(null);
    for (let c = 0; c < 8; c++) {
      board[idxOf(0, c)] = "b" + back[c];
      board[idxOf(1, c)] = "bP";
      board[idxOf(6, c)] = "wP";
      board[idxOf(7, c)] = "w" + back[c];
    }
    return board;
  }

  function initialState() {
    return {
      board: initialBoard(),
      turn: "w",
      castling: { wK: true, wQ: true, bK: true, bQ: true },
      enPassant: null,
      halfmoveClock: 0,
      fullmoveNumber: 1,
      lastMove: null,
      history: [],
    };
  }

  // ------------------------- генерація псевдо-легальних ходів -------------------------
  const KNIGHT_DELTAS = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
  const KING_DELTAS = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
  const BISHOP_DIRS = [[-1,-1],[-1,1],[1,-1],[1,1]];
  const ROOK_DIRS = [[-1,0],[1,0],[0,-1],[0,1]];

  function slidingMoves(board, idx, dirs, color) {
    const moves = [];
    const row = rowOf(idx), col = colOf(idx);
    for (const [dr, dc] of dirs) {
      let r = row + dr, c = col + dc;
      while (inBounds(r, c)) {
        const t = idxOf(r, c);
        const occ = board[t];
        if (!occ) { moves.push(t); }
        else { if (pieceColor(occ) !== color) moves.push(t); break; }
        r += dr; c += dc;
      }
    }
    return moves;
  }

  function steppingMoves(board, idx, deltas, color) {
    const moves = [];
    const row = rowOf(idx), col = colOf(idx);
    for (const [dr, dc] of deltas) {
      const r = row + dr, c = col + dc;
      if (!inBounds(r, c)) continue;
      const t = idxOf(r, c);
      const occ = board[t];
      if (!occ || pieceColor(occ) !== color) moves.push(t);
    }
    return moves;
  }

  function pawnMoves(state, idx, color) {
    const { board, enPassant } = state;
    const moves = [];
    const row = rowOf(idx), col = colOf(idx);
    const dir = color === "w" ? -1 : 1;
    const startRow = color === "w" ? 6 : 1;
    const oneR = row + dir;
    if (inBounds(oneR, col) && !board[idxOf(oneR, col)]) {
      moves.push(idxOf(oneR, col));
      const twoR = row + dir * 2;
      if (row === startRow && !board[idxOf(twoR, col)]) moves.push(idxOf(twoR, col));
    }
    for (const dc of [-1, 1]) {
      const c = col + dc;
      if (!inBounds(oneR, c)) continue;
      const t = idxOf(oneR, c);
      const occ = board[t];
      if (occ && pieceColor(occ) !== color) moves.push(t);
      else if (t === enPassant) moves.push(t);
    }
    return moves;
  }

  // Ходи БЕЗ фільтра по шаху (для isSquareAttacked і як база для legal-фільтра).
  // Рокіровку сюди навмисно не включаємо — вона рахується окремо
  // (attacksOnly=true використовується саме для isSquareAttacked, де
  // "чи король під атакою рокіровкою" — безглузда концепція).
  function pseudoMovesFrom(state, idx, attacksOnly) {
    const { board } = state;
    const p = board[idx];
    if (!p) return [];
    const color = pieceColor(p), type = pieceType(p);
    if (type === "N") return steppingMoves(board, idx, KNIGHT_DELTAS, color);
    if (type === "B") return slidingMoves(board, idx, BISHOP_DIRS, color);
    if (type === "R") return slidingMoves(board, idx, ROOK_DIRS, color);
    if (type === "Q") return slidingMoves(board, idx, BISHOP_DIRS.concat(ROOK_DIRS), color);
    if (type === "K") return steppingMoves(board, idx, KING_DELTAS, color);
    if (type === "P") {
      if (attacksOnly) {
        // тільки клітинки, які пішак АТАКУЄ (для isSquareAttacked) — без
        // ходу вперед, бо вперед пішак не б'є.
        const row = rowOf(idx), col = colOf(idx);
        const dir = color === "w" ? -1 : 1;
        const r = row + dir;
        const out = [];
        for (const dc of [-1, 1]) { const c = col + dc; if (inBounds(r, c)) out.push(idxOf(r, c)); }
        return out;
      }
      return pawnMoves(state, idx, color);
    }
    return [];
  }

  function isSquareAttacked(board, idx, byColor, enPassant) {
    // Використовуємо мінімальний стан-обгортку — enPassant не потрібен для
    // атак (крім пішака, де attacksOnly ігнорує en passant взагалі).
    const state = { board, enPassant: enPassant || null };
    for (let i = 0; i < 64; i++) {
      const p = board[i];
      if (!p || pieceColor(p) !== byColor) continue;
      const moves = pseudoMovesFrom(state, i, true);
      if (moves.includes(idx)) return true;
    }
    return false;
  }

  function findKing(board, color) {
    for (let i = 0; i < 64; i++) if (board[i] === color + "K") return i;
    return -1;
  }

  function inCheck(state, color) {
    const kingIdx = findKing(state.board, color);
    if (kingIdx === -1) return false;
    return isSquareAttacked(state.board, kingIdx, otherColor(color), state.enPassant);
  }

  // ------------------------- застосування ходу (без перевірки легальності) -------------------------
  function applyMoveRaw(state, move) {
    const board = state.board.slice();
    const { from, to, promotion } = move;
    const piece = board[from];
    const color = pieceColor(piece);
    const type = pieceType(piece);
    let capturedIdx = null;

    if (board[to]) capturedIdx = to;

    // взяття на проході — фактично взята пішака стоїть НЕ на клітинці "to"
    if (type === "P" && to === state.enPassant && !board[to]) {
      const capRow = rowOf(from);
      const capCol = colOf(to);
      capturedIdx = idxOf(capRow, capCol);
      board[capturedIdx] = null;
    } else if (capturedIdx !== null) {
      board[capturedIdx] = null;
    }

    board[to] = promotion ? color + promotion : piece;
    board[from] = null;

    // рокіровка — рухаємо й тура
    let rookFrom = null, rookTo = null;
    if (type === "K" && Math.abs(colOf(to) - colOf(from)) === 2) {
      const row = rowOf(from);
      if (colOf(to) === 6) { rookFrom = idxOf(row, 7); rookTo = idxOf(row, 5); }
      else if (colOf(to) === 2) { rookFrom = idxOf(row, 0); rookTo = idxOf(row, 3); }
      if (rookFrom !== null) { board[rookTo] = board[rookFrom]; board[rookFrom] = null; }
    }

    const castling = Object.assign({}, state.castling);
    if (type === "K") { castling[color + "K"] = false; castling[color + "Q"] = false; }
    if (from === idxOf(7, 0) || to === idxOf(7, 0)) castling.wQ = false;
    if (from === idxOf(7, 7) || to === idxOf(7, 7)) castling.wK = false;
    if (from === idxOf(0, 0) || to === idxOf(0, 0)) castling.bQ = false;
    if (from === idxOf(0, 7) || to === idxOf(0, 7)) castling.bK = false;

    let enPassant = null;
    if (type === "P" && Math.abs(rowOf(to) - rowOf(from)) === 2) {
      enPassant = idxOf((rowOf(to) + rowOf(from)) / 2, colOf(from));
    }

    const halfmoveClock = (type === "P" || capturedIdx !== null) ? 0 : state.halfmoveClock + 1;
    const fullmoveNumber = color === "b" ? state.fullmoveNumber + 1 : state.fullmoveNumber;

    return {
      board, castling, enPassant, halfmoveClock, fullmoveNumber,
      turn: otherColor(color),
      lastMove: { from, to, promotion: promotion || null, castleRookFrom: rookFrom, castleRookTo: rookTo, capturedIdx },
      history: state.history, // san дописує makeMove
    };
  }

  function castlingMoves(state, idx, color) {
    const { board, castling } = state;
    const row = color === "w" ? 7 : 0;
    if (idx !== idxOf(row, 4)) return [];
    if (inCheck(state, color)) return []; // не можна рокіруватись під шахом
    const moves = [];
    const opp = otherColor(color);
    // коротка (K-side)
    if (castling[color + "K"] && !board[idxOf(row, 5)] && !board[idxOf(row, 6)] &&
        board[idxOf(row, 7)] === color + "R" &&
        !isSquareAttacked(board, idxOf(row, 5), opp, state.enPassant) &&
        !isSquareAttacked(board, idxOf(row, 6), opp, state.enPassant)) {
      moves.push(idxOf(row, 6));
    }
    // довга (Q-side)
    if (castling[color + "Q"] && !board[idxOf(row, 1)] && !board[idxOf(row, 2)] && !board[idxOf(row, 3)] &&
        board[idxOf(row, 0)] === color + "R" &&
        !isSquareAttacked(board, idxOf(row, 3), opp, state.enPassant) &&
        !isSquareAttacked(board, idxOf(row, 2), opp, state.enPassant)) {
      moves.push(idxOf(row, 2));
    }
    return moves;
  }

  // ------------------------- легальні ходи (фільтр по власному шаху) -------------------------
  function legalMovesFrom(state, idx) {
    const p = state.board[idx];
    if (!p) return [];
    const color = pieceColor(p);
    if (color !== state.turn) return [];
    let targets = pseudoMovesFrom(state, idx, false);
    if (pieceType(p) === "K") targets = targets.concat(castlingMoves(state, idx, color));
    return targets.filter((to) => {
      const next = applyMoveRaw(state, { from: idx, to });
      return !inCheck(next, color);
    });
  }

  function allLegalMoves(state) {
    const out = [];
    for (let i = 0; i < 64; i++) {
      const p = state.board[i];
      if (!p || pieceColor(p) !== state.turn) continue;
      for (const to of legalMovesFrom(state, i)) out.push({ from: i, to });
    }
    return out;
  }

  function needsPromotion(state, from, to) {
    const p = state.board[from];
    if (!p || pieceType(p) !== "P") return false;
    const targetRow = rowOf(to);
    return (pieceColor(p) === "w" && targetRow === 0) || (pieceColor(p) === "b" && targetRow === 7);
  }

  // ------------------------- SAN (спрощена, без повної диз. по вертикалі+горизонталі рідкісних випадків) -------------------------
  function toSAN(state, move, legalMoves) {
    const { from, to, promotion } = move;
    const p = state.board[from];
    const type = pieceType(p);
    const isCapture = !!state.board[to] || (type === "P" && to === state.enPassant);

    if (type === "K" && Math.abs(colOf(to) - colOf(from)) === 2) {
      return colOf(to) === 6 ? "O-O" : "O-O-O";
    }

    let san = "";
    if (type !== "P") {
      san += type;
      // диз.: чи є інша своя фігура того ж типу, що теж може ходити на `to`
      const ambiguous = legalMoves.filter((m) => m.from !== from && m.to === to && pieceType(state.board[m.from]) === type);
      if (ambiguous.length) {
        const sameFile = ambiguous.some((m) => colOf(m.from) === colOf(from));
        const sameRank = ambiguous.some((m) => rowOf(m.from) === rowOf(from));
        if (!sameFile) san += FILES[colOf(from)];
        else if (!sameRank) san += (8 - rowOf(from));
        else san += squareName(from);
      }
    } else if (isCapture) {
      san += FILES[colOf(from)];
    }
    if (isCapture) san += "x";
    san += squareName(to);
    if (promotion) san += "=" + promotion;

    const next = applyMoveRaw(state, move);
    if (inCheck(next, next.turn)) {
      san += allLegalMoves(next).length === 0 ? "#" : "+";
    }
    return san;
  }

  function makeMove(state, move) {
    const legal = legalMovesFrom(state, move.from);
    if (!legal.includes(move.to)) return null;
    if (needsPromotion(state, move.from, move.to) && !move.promotion) return null;

    const all = allLegalMoves(state);
    const san = toSAN(state, move, all);
    const next = applyMoveRaw(state, move);
    next.history = state.history.concat([{
      from: move.from, to: move.to, promotion: move.promotion || null, san,
    }]);
    return next;
  }

  // ------------------------- статус гри -------------------------
  function isInsufficientMaterial(board) {
    const pieces = board.filter(Boolean);
    if (pieces.length > 4) return false;
    const nonKing = pieces.filter((p) => pieceType(p) !== "K");
    if (nonKing.length === 0) return true; // K vs K
    if (nonKing.length === 1 && (pieceType(nonKing[0]) === "N" || pieceType(nonKing[0]) === "B")) return true; // K+N/B vs K
    if (nonKing.length === 2 && nonKing.every((p) => pieceType(p) === "B")) {
      // K+B vs K+B, обидва слони одного кольору клітинки
      const bishopIdxs = [];
      for (let i = 0; i < 64; i++) if (board[i] && pieceType(board[i]) === "B") bishopIdxs.push(i);
      const colorOf = (i) => (rowOf(i) + colOf(i)) % 2;
      if (bishopIdxs.length === 2 && colorOf(bishopIdxs[0]) === colorOf(bishopIdxs[1])) return true;
    }
    return false;
  }

  // Позиція для правила потрійного повторення: дошка + черга + права на
  // рокіровку + клітинка взяття на проході. Свідомо НЕ включаємо
  // halfmoveClock/fullmoveNumber/lastMove/history — це саме "та сама
  // позиція", а не "та сама партія до цього моменту".
  function positionSignature(state) {
    const c = state.castling;
    return encodeBoard(state.board) + "|" + state.turn + "|" +
      (c.wK ? 1 : 0) + (c.wQ ? 1 : 0) + (c.bK ? 1 : 0) + (c.bQ ? 1 : 0) + "|" +
      (state.enPassant === null || state.enPassant === undefined ? -1 : state.enPassant);
  }

  // Рахуємо, скільки разів поточна позиція вже зустрічалась за партію.
  // Навмисно рахуємо реплеєм історії з initialState(), а не окремим полем
  // у GameState — так не треба нічого нового серіалізувати для RTDB, і
  // рушій лишається "чистою функцією" від board+history, як і задумано.
  function countRepetitions(state) {
    let cur = initialState();
    const counts = Object.create(null);
    const bump = (sig) => { counts[sig] = (counts[sig] || 0) + 1; };
    bump(positionSignature(cur));
    for (const h of state.history) {
      cur = applyMoveRaw(cur, { from: h.from, to: h.to, promotion: h.promotion });
      bump(positionSignature(cur));
    }
    return counts[positionSignature(state)] || 0;
  }

  function gameStatus(state) {
    const legal = allLegalMoves(state);
    const check = inCheck(state, state.turn);
    if (legal.length === 0) {
      return check
        ? { status: "checkmate", winner: otherColor(state.turn) }
        : { status: "stalemate", winner: null };
    }
    if (state.halfmoveClock >= 100) return { status: "draw-50move", winner: null };
    if (isInsufficientMaterial(state.board)) return { status: "draw-material", winner: null };
    // Правило потрійного повторення — саме те, що ловить "вічний шах"
    // ботом (наприклад, ферзем з двох полів): бот не мухлює, гра просто
    // не мала способу побачити повторення. Бота нічого не треба
    // "перебивати" — це не оцінка ходу, а окрема перевірка результату
    // партії ПІСЛЯ того, як хід уже зроблено.
    if (countRepetitions(state) >= 3) return { status: "draw-repetition", winner: null };
    return { status: check ? "check" : "playing", winner: null };
  }

  // ------------------------- (де)серіалізація для RTDB -------------------------
  // RTDB не любить масиви з розкиданими null (перетворює на sparse-об'єкт при
  // читанні) — кодуємо дошку одним рядком (2 символи на клітинку, "--" —
  // порожньо) і уникаємо null у числових полях (заміна на -1).
  function encodeBoard(board) {
    return board.map((p) => p || "--").join("");
  }
  function decodeBoard(str) {
    const out = new Array(64).fill(null);
    for (let i = 0; i < 64; i++) {
      const cell = str.slice(i * 2, i * 2 + 2);
      out[i] = cell === "--" ? null : cell;
    }
    return out;
  }
  function encodeState(state) {
    return {
      board: encodeBoard(state.board),
      turn: state.turn,
      castling: state.castling,
      enPassant: state.enPassant === null || state.enPassant === undefined ? -1 : state.enPassant,
      halfmoveClock: state.halfmoveClock,
      fullmoveNumber: state.fullmoveNumber,
      lastMove: state.lastMove ? {
        from: state.lastMove.from,
        to: state.lastMove.to,
        promotion: state.lastMove.promotion || "",
        castleRookFrom: state.lastMove.castleRookFrom === null || state.lastMove.castleRookFrom === undefined ? -1 : state.lastMove.castleRookFrom,
        castleRookTo: state.lastMove.castleRookTo === null || state.lastMove.castleRookTo === undefined ? -1 : state.lastMove.castleRookTo,
        capturedIdx: state.lastMove.capturedIdx === null || state.lastMove.capturedIdx === undefined ? -1 : state.lastMove.capturedIdx,
      } : null,
      history: state.history.map((h) => ({ from: h.from, to: h.to, promotion: h.promotion || "", san: h.san })),
    };
  }
  function decodeState(obj) {
    return {
      board: decodeBoard(obj.board),
      turn: obj.turn,
      castling: obj.castling,
      enPassant: obj.enPassant === -1 || obj.enPassant === undefined ? null : obj.enPassant,
      halfmoveClock: obj.halfmoveClock || 0,
      fullmoveNumber: obj.fullmoveNumber || 1,
      lastMove: obj.lastMove ? {
        from: obj.lastMove.from, to: obj.lastMove.to,
        promotion: obj.lastMove.promotion || null,
        castleRookFrom: obj.lastMove.castleRookFrom === -1 ? null : obj.lastMove.castleRookFrom,
        castleRookTo: obj.lastMove.castleRookTo === -1 ? null : obj.lastMove.castleRookTo,
        capturedIdx: obj.lastMove.capturedIdx === -1 ? null : obj.lastMove.capturedIdx,
      } : null,
      history: (obj.history || []).map((h) => ({ from: h.from, to: h.to, promotion: h.promotion || null, san: h.san })),
    };
  }

  window.ChessRules = {
    idxOf, rowOf, colOf, squareName, squareFromName,
    pieceColor, pieceType, otherColor,
    initialBoard, initialState,
    legalMovesFrom, allLegalMoves, needsPromotion,
    makeMove, inCheck, gameStatus,
    encodeState, decodeState,
  };
})();