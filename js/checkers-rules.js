// ==========================================================================
// checkers-rules.js — чистий рушій правил укр./рос. шашок (Russian draughts).
// Без DOM/Firebase — те саме ядро використовують і онлайн-гра
// (checkers-game.js), і локальний pass-and-play в checkers.html.
// Структура файлу навмисно дзеркалить chess-rules.js.
//
// Представлення дошки: масив 64 клітинок, той самий idx = row*8+col, що й
// у шахах (row 0 = верхня горизонталь, білі внизу). Фігури стоять лише на
// ТЕМНИХ клітинках: (row+col) непарне.
// Фігура — рядок з 2 символів: колір ('w'|'b') + тип ('M' — проста шашка,
// 'K' — дамка), напр. "wM", "bK". Порожня клітинка — null.
//
// Правила (класичні укр./рос. шашки):
//  - проста шашка ходить на 1 клітинку по діагоналі ТІЛЬКИ вперед;
//  - проста шашка б'є на 1 клітинку по діагоналі в БУДЬ-якому з 4 напрямків
//    (вперед і назад), стрибаючи через ворожу шашку на порожню клітинку;
//  - дамка ("літає") — ходить і б'є на будь-яку відстань по діагоналі, поки
//    клітинки порожні; б'є, якщо після ворожої шашки є хоча б одна порожня
//    клітинка для приземлення (можна на будь-яку з них);
//  - взяття ОБОВ'ЯЗКОВЕ: якщо хоч одна своя фігура може бити — ходити можна
//    лише биттям; серія взять одніє фігурою триває, поки є подальші взяття;
//  - проста шашка, що дійшла до останньої горизонталі, ОДРАЗУ стає дамкою —
//    і хід на цьому завершується, навіть якщо формально можливе продовження
//    серії (стандартне тлумачення правил).
//
// Стан гри (GameState):
//   {
//     board: [64 значення],
//     turn: "w" | "b",
//     forcedFrom: idx | null,     // якщо не null — хід можливий лише цією
//                                 // фігурою (продовження серії взять)
//     lastMove: { from, to, captured: idx|null, promoted: bool } | null,
//     history: [ { from, to, captured, promoted, san } ... ],
//   }
// ==========================================================================
(function () {
  const FILES = "abcdefgh";

  function idxOf(row, col) { return row * 8 + col; }
  function rowOf(idx) { return Math.floor(idx / 8); }
  function colOf(idx) { return idx % 8; }
  function inBounds(row, col) { return row >= 0 && row < 8 && col >= 0 && col < 8; }
  function isDarkSquare(row, col) { return (row + col) % 2 === 1; }

  function squareName(idx) {
    return FILES[colOf(idx)] + (8 - rowOf(idx));
  }

  function pieceColor(p) { return p ? p[0] : null; }
  function pieceType(p) { return p ? p[1] : null; }
  function otherColor(c) { return c === "w" ? "b" : "w"; }

  const DIAG_DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

  // ------------------------- початкова розстановка -------------------------
  function initialBoard() {
    const board = new Array(64).fill(null);
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        if (!isDarkSquare(row, col)) continue;
        if (row <= 2) board[idxOf(row, col)] = "bM";
        else if (row >= 5) board[idxOf(row, col)] = "wM";
      }
    }
    return board;
  }

  function initialState() {
    return {
      board: initialBoard(),
      turn: "w",
      forcedFrom: null,
      lastMove: null,
      history: [],
    };
  }

  // ------------------------- пошук ходів однієї фігури -------------------------
  // Прості (небойові) ходи.
  function simpleMovesFrom(board, idx) {
    const p = board[idx];
    if (!p) return [];
    const color = pieceColor(p), type = pieceType(p);
    const row = rowOf(idx), col = colOf(idx);
    const out = [];
    if (type === "K") {
      for (const [dr, dc] of DIAG_DIRS) {
        let r = row + dr, c = col + dc;
        while (inBounds(r, c) && !board[idxOf(r, c)]) {
          out.push({ to: idxOf(r, c), captured: null });
          r += dr; c += dc;
        }
      }
    } else {
      const dir = color === "w" ? -1 : 1;
      for (const dc of [-1, 1]) {
        const r = row + dir, c = col + dc;
        if (inBounds(r, c) && !board[idxOf(r, c)]) out.push({ to: idxOf(r, c), captured: null });
      }
    }
    return out;
  }

  // Ходи-взяття (один "стрибок" — одне взяття за раз; ланцюг продовжується
  // окремими викликами makeMove через forcedFrom).
  function captureMovesFrom(board, idx) {
    const p = board[idx];
    if (!p) return [];
    const color = pieceColor(p), type = pieceType(p);
    const row = rowOf(idx), col = colOf(idx);
    const out = [];
    if (type === "K") {
      for (const [dr, dc] of DIAG_DIRS) {
        let r = row + dr, c = col + dc;
        // проходимо порожні клітинки в пошуках першої фігури на промені
        while (inBounds(r, c) && !board[idxOf(r, c)]) { r += dr; c += dc; }
        if (!inBounds(r, c)) continue;
        const hit = board[idxOf(r, c)];
        if (pieceColor(hit) === color) continue; // своя фігура — не перестрибнути
        const capturedIdx = idxOf(r, c);
        let lr = r + dr, lc = c + dc;
        while (inBounds(lr, lc) && !board[idxOf(lr, lc)]) {
          out.push({ to: idxOf(lr, lc), captured: capturedIdx });
          lr += dr; lc += dc;
        }
      }
    } else {
      for (const [dr, dc] of DIAG_DIRS) {
        const mr = row + dr, mc = col + dc;
        if (!inBounds(mr, mc)) continue;
        const mid = board[idxOf(mr, mc)];
        if (!mid || pieceColor(mid) === color) continue;
        const lr = row + dr * 2, lc = col + dc * 2;
        if (!inBounds(lr, lc) || board[idxOf(lr, lc)]) continue;
        out.push({ to: idxOf(lr, lc), captured: idxOf(mr, mc) });
      }
    }
    return out;
  }

  function hasAnyCapture(state, color) {
    for (let i = 0; i < 64; i++) {
      const p = state.board[i];
      if (!p || pieceColor(p) !== color) continue;
      if (captureMovesFrom(state.board, i).length) return true;
    }
    return false;
  }

  // ------------------------- легальні ходи (з урахуванням обов'язкового биття) -------------------------
  function legalMovesFrom(state, idx) {
    if (state.forcedFrom !== null) {
      if (idx !== state.forcedFrom) return [];
      return captureMovesFrom(state.board, idx);
    }
    const p = state.board[idx];
    if (!p || pieceColor(p) !== state.turn) return [];
    if (hasAnyCapture(state, state.turn)) return captureMovesFrom(state.board, idx);
    return simpleMovesFrom(state.board, idx);
  }

  function allLegalMoves(state) {
    const out = [];
    const sources = state.forcedFrom !== null ? [state.forcedFrom] : Array.from({ length: 64 }, (_, i) => i);
    for (const i of sources) {
      const p = state.board[i];
      if (!p || pieceColor(p) !== state.turn) continue;
      for (const m of legalMovesFrom(state, i)) out.push(Object.assign({ from: i }, m));
    }
    return out;
  }

  function isLastRow(color, row) {
    return color === "w" ? row === 0 : row === 7;
  }

  // ------------------------- застосування ходу -------------------------
  function makeMove(state, move) {
    const legal = legalMovesFrom(state, move.from);
    const found = legal.find((m) => m.to === move.to);
    if (!found) return null;

    const board = state.board.slice();
    const piece = board[move.from];
    const color = pieceColor(piece);
    let type = pieceType(piece);
    board[move.from] = null;
    if (found.captured !== null) board[found.captured] = null;

    let promoted = false;
    if (type === "M" && isLastRow(color, rowOf(move.to))) {
      type = "K";
      promoted = true;
    }
    board[move.to] = color + type;

    let turn = state.turn, forcedFrom = null;
    if (found.captured !== null && !promoted && captureMovesFrom(board, move.to).length) {
      turn = state.turn; // серія триває — той самий гравець ходить далі
      forcedFrom = move.to;
    } else {
      turn = otherColor(state.turn);
      forcedFrom = null;
    }

    const san = squareName(move.from) + (found.captured !== null ? "x" : "-") + squareName(move.to) + (promoted ? "=K" : "");
    const lastMove = { from: move.from, to: move.to, captured: found.captured, promoted };

    return {
      board, turn, forcedFrom, lastMove,
      history: state.history.concat([Object.assign({ san }, lastMove)]),
    };
  }

  // ------------------------- статус гри -------------------------
  function gameStatus(state) {
    const legal = allLegalMoves(state);
    if (legal.length === 0) {
      return { status: "no-moves", winner: otherColor(state.turn) };
    }
    return { status: "playing", winner: null };
  }

  // ------------------------- (де)серіалізація для RTDB -------------------------
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
      forcedFrom: state.forcedFrom === null || state.forcedFrom === undefined ? -1 : state.forcedFrom,
      lastMove: state.lastMove ? {
        from: state.lastMove.from,
        to: state.lastMove.to,
        captured: state.lastMove.captured === null || state.lastMove.captured === undefined ? -1 : state.lastMove.captured,
        promoted: !!state.lastMove.promoted,
      } : null,
      history: state.history.map((h) => ({
        from: h.from, to: h.to,
        captured: h.captured === null || h.captured === undefined ? -1 : h.captured,
        promoted: !!h.promoted, san: h.san,
      })),
    };
  }
  function decodeState(obj) {
    return {
      board: decodeBoard(obj.board),
      turn: obj.turn,
      forcedFrom: obj.forcedFrom === -1 || obj.forcedFrom === undefined ? null : obj.forcedFrom,
      lastMove: obj.lastMove ? {
        from: obj.lastMove.from, to: obj.lastMove.to,
        captured: obj.lastMove.captured === -1 ? null : obj.lastMove.captured,
        promoted: !!obj.lastMove.promoted,
      } : null,
      history: (obj.history || []).map((h) => ({
        from: h.from, to: h.to,
        captured: h.captured === -1 ? null : h.captured,
        promoted: !!h.promoted, san: h.san,
      })),
    };
  }

  window.CheckersRules = {
    idxOf, rowOf, colOf, squareName, isDarkSquare,
    pieceColor, pieceType, otherColor,
    initialBoard, initialState,
    legalMovesFrom, allLegalMoves, hasAnyCapture,
    makeMove, gameStatus,
    encodeState, decodeState,
  };
})();