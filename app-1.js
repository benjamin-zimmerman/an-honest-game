// -----------------------------
// Board / chess state utilities
// -----------------------------
const FILES = 'abcdefgh';
const PIECE_GLYPHS = {
  K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙',
  k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟',
};
const PIECE_NAMES = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
const VALUES = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };
const MATE_SCORE = 100000;

function initialBoard() {
  return [
    'r','n','b','q','k','b','n','r',
    'p','p','p','p','p','p','p','p',
    null,null,null,null,null,null,null,null,
    null,null,null,null,null,null,null,null,
    null,null,null,null,null,null,null,null,
    null,null,null,null,null,null,null,null,
    'P','P','P','P','P','P','P','P',
    'R','N','B','Q','K','B','N','R',
  ];
}

function newState() {
  return {
    board: initialBoard(),
    turn: 'w',
    castling: { wK: true, wQ: true, bK: true, bQ: true },
    enPassant: null,
    halfmove: 0,
    fullmove: 1,
    lastMove: null,
  };
}

function cloneState(s) {
  return {
    board: s.board.slice(),
    turn: s.turn,
    castling: { ...s.castling },
    enPassant: s.enPassant,
    halfmove: s.halfmove,
    fullmove: s.fullmove,
    lastMove: s.lastMove ? { ...s.lastMove } : null,
  };
}

function colorOf(piece) {
  if (!piece) return null;
  return piece === piece.toUpperCase() ? 'w' : 'b';
}

function opponent(color) { return color === 'w' ? 'b' : 'w'; }
function rowOf(i) { return Math.floor(i / 8); }
function colOf(i) { return i % 8; }
function inBounds(r, c) { return r >= 0 && r < 8 && c >= 0 && c < 8; }
function idx(r, c) { return r * 8 + c; }
function squareName(i) { return `${FILES[colOf(i)]}${8 - rowOf(i)}`; }

function pieceAt(s, r, c) {
  return inBounds(r, c) ? s.board[idx(r, c)] : null;
}

function findKing(s, color) {
  const target = color === 'w' ? 'K' : 'k';
  return s.board.indexOf(target);
}

function isSquareAttacked(s, targetIndex, byColor) {
  const tr = rowOf(targetIndex);
  const tc = colOf(targetIndex);

  // Pawn attacks.
  const pawn = byColor === 'w' ? 'P' : 'p';
  const pawnSourceRow = tr + (byColor === 'w' ? 1 : -1);
  for (const dc of [-1, 1]) {
    const sc = tc + dc;
    if (inBounds(pawnSourceRow, sc) && pieceAt(s, pawnSourceRow, sc) === pawn) return true;
  }

  // Knight attacks.
  const knight = byColor === 'w' ? 'N' : 'n';
  const knightDeltas = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
  for (const [dr, dc] of knightDeltas) {
    const r = tr + dr, c = tc + dc;
    if (inBounds(r, c) && pieceAt(s, r, c) === knight) return true;
  }

  // Sliding attacks.
  const bishop = byColor === 'w' ? 'B' : 'b';
  const rook = byColor === 'w' ? 'R' : 'r';
  const queen = byColor === 'w' ? 'Q' : 'q';
  for (const [dr, dc] of [[-1,-1],[-1,1],[1,-1],[1,1]]) {
    let r = tr + dr, c = tc + dc;
    while (inBounds(r, c)) {
      const p = pieceAt(s, r, c);
      if (p) {
        if (p === bishop || p === queen) return true;
        break;
      }
      r += dr; c += dc;
    }
  }
  for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
    let r = tr + dr, c = tc + dc;
    while (inBounds(r, c)) {
      const p = pieceAt(s, r, c);
      if (p) {
        if (p === rook || p === queen) return true;
        break;
      }
      r += dr; c += dc;
    }
  }

  // King attacks.
  const king = byColor === 'w' ? 'K' : 'k';
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const r = tr + dr, c = tc + dc;
      if (inBounds(r, c) && pieceAt(s, r, c) === king) return true;
    }
  }
  return false;
}

function isInCheck(s, color) {
  const k = findKing(s, color);
  if (k < 0) return true;
  return isSquareAttacked(s, k, opponent(color));
}

function pushPromotionMoves(moves, from, to, captured, color, flags = '') {
  for (const promotion of ['q','r','b','n']) {
    moves.push({ from, to, captured, promotion: color === 'w' ? promotion.toUpperCase() : promotion, flags: `${flags}p` });
  }
}

function generatePseudoMoves(s, color, capturesOnly = false) {
  const moves = [];
  for (let from = 0; from < 64; from++) {
    const piece = s.board[from];
    if (!piece || colorOf(piece) !== color) continue;
    const type = piece.toLowerCase();
    const r = rowOf(from), c = colOf(from);

    if (type === 'p') {
      const step = color === 'w' ? -1 : 1;
      const startRow = color === 'w' ? 6 : 1;
      const promoRow = color === 'w' ? 0 : 7;
      const nextRow = r + step;

      if (!capturesOnly && inBounds(nextRow, c) && !pieceAt(s, nextRow, c)) {
        const to = idx(nextRow, c);
        if (nextRow === promoRow) pushPromotionMoves(moves, from, to, null, color);
        else moves.push({ from, to, captured: null, promotion: null, flags: '' });

        const jumpRow = r + step * 2;
        if (r === startRow && !pieceAt(s, jumpRow, c)) {
          moves.push({ from, to: idx(jumpRow, c), captured: null, promotion: null, flags: 'd' });
        }
      }

      for (const dc of [-1, 1]) {
        const rr = r + step, cc = c + dc;
        if (!inBounds(rr, cc)) continue;
        const to = idx(rr, cc);
        const target = s.board[to];
        if (target && colorOf(target) === opponent(color)) {
          if (rr === promoRow) pushPromotionMoves(moves, from, to, target, color, 'c');
          else moves.push({ from, to, captured: target, promotion: null, flags: 'c' });
        } else if (s.enPassant === to) {
          const capturedIndex = idx(r, cc);
          const expectedPawn = color === 'w' ? 'p' : 'P';
          if (s.board[capturedIndex] === expectedPawn) {
            moves.push({ from, to, captured: expectedPawn, promotion: null, flags: 'e' });
          }
        }
      }
    }

    if (type === 'n') {
      const deltas = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
      for (const [dr, dc] of deltas) {
        const rr = r + dr, cc = c + dc;
        if (!inBounds(rr, cc)) continue;
        const to = idx(rr, cc), target = s.board[to];
        if (!target && !capturesOnly) moves.push({ from, to, captured: null, promotion: null, flags: '' });
        else if (target && colorOf(target) === opponent(color)) moves.push({ from, to, captured: target, promotion: null, flags: 'c' });
      }
    }

    if (type === 'b' || type === 'r' || type === 'q') {
      const dirs = [];
      if (type === 'b' || type === 'q') dirs.push([-1,-1],[-1,1],[1,-1],[1,1]);
      if (type === 'r' || type === 'q') dirs.push([-1,0],[1,0],[0,-1],[0,1]);
      for (const [dr, dc] of dirs) {
        let rr = r + dr, cc = c + dc;
        while (inBounds(rr, cc)) {
          const to = idx(rr, cc), target = s.board[to];
          if (!target) {
            if (!capturesOnly) moves.push({ from, to, captured: null, promotion: null, flags: '' });
          } else {
            if (colorOf(target) === opponent(color)) moves.push({ from, to, captured: target, promotion: null, flags: 'c' });
            break;
          }
          rr += dr; cc += dc;
        }
      }
    }

    if (type === 'k') {
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const rr = r + dr, cc = c + dc;
          if (!inBounds(rr, cc)) continue;
          const to = idx(rr, cc), target = s.board[to];
          if (!target && !capturesOnly) moves.push({ from, to, captured: null, promotion: null, flags: '' });
          else if (target && colorOf(target) === opponent(color)) moves.push({ from, to, captured: target, promotion: null, flags: 'c' });
        }
      }

      if (!capturesOnly && !isInCheck(s, color)) {
        if (color === 'w' && from === 60) {
          if (s.castling.wK && s.board[61] == null && s.board[62] == null && s.board[63] === 'R' &&
              !isSquareAttacked(s, 61, 'b') && !isSquareAttacked(s, 62, 'b')) {
            moves.push({ from, to: 62, captured: null, promotion: null, flags: 'k' });
          }
          if (s.castling.wQ && s.board[59] == null && s.board[58] == null && s.board[57] == null && s.board[56] === 'R' &&
              !isSquareAttacked(s, 59, 'b') && !isSquareAttacked(s, 58, 'b')) {
            moves.push({ from, to: 58, captured: null, promotion: null, flags: 'q' });
          }
        }
        if (color === 'b' && from === 4) {
          if (s.castling.bK && s.board[5] == null && s.board[6] == null && s.board[7] === 'r' &&
              !isSquareAttacked(s, 5, 'w') && !isSquareAttacked(s, 6, 'w')) {
            moves.push({ from, to: 6, captured: null, promotion: null, flags: 'k' });
          }
          if (s.castling.bQ && s.board[3] == null && s.board[2] == null && s.board[1] == null && s.board[0] === 'r' &&
              !isSquareAttacked(s, 3, 'w') && !isSquareAttacked(s, 2, 'w')) {
            moves.push({ from, to: 2, captured: null, promotion: null, flags: 'q' });
          }
        }
      }
    }
  }
  return moves;
}

function applyMove(s, move) {
  const ns = cloneState(s);
  const piece = ns.board[move.from];
  const color = colorOf(piece);
  const type = piece.toLowerCase();
  const fromRow = rowOf(move.from), toRow = rowOf(move.to);
  const capturedOnTarget = ns.board[move.to];

  ns.board[move.from] = null;

  if (move.flags.includes('e')) {
    const captureIndex = idx(fromRow, colOf(move.to));
    ns.board[captureIndex] = null;
  }

  ns.board[move.to] = move.promotion || piece;

  if (move.flags.includes('k')) {
    if (color === 'w') { ns.board[63] = null; ns.board[61] = 'R'; }
    else { ns.board[7] = null; ns.board[5] = 'r'; }
  }
  if (move.flags.includes('q')) {
    if (color === 'w') { ns.board[56] = null; ns.board[59] = 'R'; }
    else { ns.board[0] = null; ns.board[3] = 'r'; }
  }

  // Castling rights are lost when kings/rooks move or a corner rook is captured.
  if (piece === 'K') { ns.castling.wK = false; ns.castling.wQ = false; }
  if (piece === 'k') { ns.castling.bK = false; ns.castling.bQ = false; }
  if (move.from === 63 || move.to === 63) ns.castling.wK = false;
  if (move.from === 56 || move.to === 56) ns.castling.wQ = false;
  if (move.from === 7 || move.to === 7) ns.castling.bK = false;
  if (move.from === 0 || move.to === 0) ns.castling.bQ = false;

  ns.enPassant = null;
  if (type === 'p' && Math.abs(toRow - fromRow) === 2) {
    ns.enPassant = idx((fromRow + toRow) / 2, colOf(move.from));
  }

  const wasCapture = Boolean(capturedOnTarget) || move.flags.includes('e');
  ns.halfmove = (type === 'p' || wasCapture) ? 0 : ns.halfmove + 1;
  if (color === 'b') ns.fullmove += 1;
  ns.turn = opponent(color);
  ns.lastMove = { from: move.from, to: move.to };
  return ns;
}

function generateLegalMoves(s, color = s.turn, capturesOnly = false) {
  const pseudo = generatePseudoMoves(s, color, capturesOnly);
  const legal = [];
  for (const move of pseudo) {
    if (move.captured?.toLowerCase() === 'k') continue;
    const next = applyMove(s, move);
    if (!isInCheck(next, color)) legal.push(move);
  }
  return legal;
}

function gameStatus(s) {
  const legal = generateLegalMoves(s, s.turn);
  if (!legal.length) {
    if (isInCheck(s, s.turn)) return { over: true, type: 'checkmate', winner: opponent(s.turn) };
    return { over: true, type: 'stalemate', winner: null };
  }
  if (s.halfmove >= 100) return { over: true, type: 'fifty-move draw', winner: null };
  if (insufficientMaterial(s)) return { over: true, type: 'insufficient material', winner: null };
  return { over: false, check: isInCheck(s, s.turn) };
}

function insufficientMaterial(s) {
  const pieces = s.board.filter(Boolean);
  const nonKings = pieces.filter(p => p.toLowerCase() !== 'k');
  if (!nonKings.length) return true;
  if (nonKings.length === 1 && ['b','n'].includes(nonKings[0].toLowerCase())) return true;
  return false;
}

function notation(before, move) {
  const piece = before.board[move.from];
  if (move.flags.includes('k')) return 'O-O';
  if (move.flags.includes('q')) return 'O-O-O';
  const type = piece.toLowerCase();
  const piecePrefix = type === 'p' ? '' : piece.toUpperCase();
  const capture = move.captured || move.flags.includes('e') ? '×' : '–';
  const promo = move.promotion ? `=${move.promotion.toUpperCase()}` : '';
  return `${piecePrefix}${squareName(move.from)}${capture}${squareName(move.to)}${promo}`;
}
