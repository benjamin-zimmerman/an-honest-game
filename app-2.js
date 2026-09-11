// -----------------------------
// AI
// -----------------------------
const AI_SETTINGS = {
  1: { label: 'Casual', depth: 1, time: 120, noise: 170 },
  2: { label: 'Club', depth: 2, time: 320, noise: 85 },
  3: { label: 'Sharp', depth: 3, time: 650, noise: 28 },
  4: { label: 'Expert', depth: 3, time: 1100, noise: 6 },
  5: { label: 'Predatory', depth: 4, time: 1700, noise: 0 },
};

const INTEGRITY_CONFIG = {
  restrained: { baseline: 0.045, edgeBoost: 0.24, eventBoost: 0.12, droughtBoost: 0.12, guaranteeMove: 14, cooldown: 4, maxCheats: 3 },
  dubious: { baseline: 0.085, edgeBoost: 0.40, eventBoost: 0.18, droughtBoost: 0.18, guaranteeMove: 12, cooldown: 3, maxCheats: 4 },
  corrupt: { baseline: 0.14, edgeBoost: 0.52, eventBoost: 0.24, droughtBoost: 0.24, guaranteeMove: 10, cooldown: 2, maxCheats: 6 },
};

function positionalBonus(piece, i, totalMaterial) {
  const color = colorOf(piece);
  const type = piece.toLowerCase();
  const r = rowOf(i), c = colOf(i);
  const rr = color === 'w' ? r : 7 - r;
  const centerDistance = Math.abs(3.5 - r) + Math.abs(3.5 - c);
  let bonus = 0;
  if (type === 'p') {
    const advanced = color === 'w' ? (6 - r) : (r - 1);
    bonus += advanced * 9;
    if (c >= 2 && c <= 5) bonus += 8;
  }
  if (type === 'n') bonus += Math.round((7 - centerDistance) * 8);
  if (type === 'b') bonus += Math.round((7 - centerDistance) * 4);
  if (type === 'r') {
    const rankFromEnemy = color === 'w' ? r : 7 - r;
    if (rankFromEnemy === 1) bonus += 22;
  }
  if (type === 'q') bonus += Math.round((7 - centerDistance) * 1.2);
  if (type === 'k') {
    if (totalMaterial > 3000) {
      const backRank = color === 'w' ? 7 : 0;
      if (r === backRank && (c === 6 || c === 2)) bonus += 32;
      bonus -= Math.round((7 - centerDistance) * 3);
    } else {
      bonus += Math.round((7 - centerDistance) * 6);
    }
  }
  return bonus;
}

function evaluate(s) {
  let score = 0;
  let totalMaterial = 0;
  for (const p of s.board) if (p && p.toLowerCase() !== 'k') totalMaterial += VALUES[p.toLowerCase()];
  for (let i = 0; i < 64; i++) {
    const p = s.board[i];
    if (!p) continue;
    const sign = colorOf(p) === 'b' ? 1 : -1;
    score += sign * (VALUES[p.toLowerCase()] + positionalBonus(p, i, totalMaterial));
  }
  if (isInCheck(s, 'w')) score += 28;
  if (isInCheck(s, 'b')) score -= 28;
  return score;
}

function moveOrderScore(move) {
  let score = 0;
  if (move.captured) score += 10 * VALUES[move.captured.toLowerCase()];
  if (move.promotion) score += VALUES[move.promotion.toLowerCase()] + 700;
  if (move.flags.includes('k') || move.flags.includes('q')) score += 60;
  return score;
}

function positionKey(s, depth) {
  return `${s.board.map(p => p || '.').join('')}/${s.turn}/${s.castling.wK?1:0}${s.castling.wQ?1:0}${s.castling.bK?1:0}${s.castling.bQ?1:0}/${s.enPassant ?? '-'}:${depth}`;
}

function alphaBeta(s, depth, alpha, beta, ctx, ply = 0) {
  ctx.nodes++;
  if ((ctx.nodes & 511) === 0 && (performance.now() > ctx.deadline || ctx.nodes > ctx.nodeCap)) {
    ctx.timedOut = true;
    return evaluate(s);
  }

  const key = positionKey(s, depth);
  const cached = ctx.tt.get(key);
  if (cached != null) return cached;

  const legal = generateLegalMoves(s, s.turn);
  if (!legal.length) {
    if (isInCheck(s, s.turn)) return s.turn === 'b' ? -MATE_SCORE + ply : MATE_SCORE - ply;
    return 0;
  }
  if (depth === 0) return quiescence(s, alpha, beta, ctx, 0);

  legal.sort((a, b) => moveOrderScore(b) - moveOrderScore(a));
  let value;
  if (s.turn === 'b') {
    value = -Infinity;
    for (const move of legal) {
      const child = applyMove(s, move);
      value = Math.max(value, alphaBeta(child, depth - 1, alpha, beta, ctx, ply + 1));
      alpha = Math.max(alpha, value);
      if (beta <= alpha || ctx.timedOut) break;
    }
  } else {
    value = Infinity;
    for (const move of legal) {
      const child = applyMove(s, move);
      value = Math.min(value, alphaBeta(child, depth - 1, alpha, beta, ctx, ply + 1));
      beta = Math.min(beta, value);
      if (beta <= alpha || ctx.timedOut) break;
    }
  }
  if (!ctx.timedOut) ctx.tt.set(key, value);
  return value;
}

function quiescence(s, alpha, beta, ctx, qDepth) {
  const standPat = evaluate(s);
  if (qDepth >= 2) return standPat;
  if (s.turn === 'b') {
    if (standPat >= beta) return beta;
    alpha = Math.max(alpha, standPat);
    const captures = generateLegalMoves(s, 'b', true).sort((a,b) => moveOrderScore(b)-moveOrderScore(a));
    for (const m of captures) {
      const score = quiescence(applyMove(s, m), alpha, beta, ctx, qDepth + 1);
      if (score >= beta) return beta;
      alpha = Math.max(alpha, score);
      if (ctx.timedOut) break;
    }
    return alpha;
  }
  if (standPat <= alpha) return alpha;
  beta = Math.min(beta, standPat);
  const captures = generateLegalMoves(s, 'w', true).sort((a,b) => moveOrderScore(b)-moveOrderScore(a));
  for (const m of captures) {
    const score = quiescence(applyMove(s, m), alpha, beta, ctx, qDepth + 1);
    if (score <= alpha) return alpha;
    beta = Math.min(beta, score);
    if (ctx.timedOut) break;
  }
  return beta;
}

function chooseAiMove(s, level, psychology = null) {
  const cfg = AI_SETTINGS[level];
  const moves = generateLegalMoves(s, 'b');
  if (!moves.length) return null;
  moves.sort((a,b) => moveOrderScore(b)-moveOrderScore(a));

  const ctx = {
    nodes: 0,
    nodeCap: level >= 5 ? 120000 : level === 4 ? 72000 : 38000,
    deadline: performance.now() + cfg.time,
    timedOut: false,
    tt: new Map(),
  };

  let scored = [];
  for (const move of moves) {
    const child = applyMove(s, move);
    let score = alphaBeta(child, Math.max(0, cfg.depth - 1), -Infinity, Infinity, ctx, 1);
    if (cfg.noise) score += (Math.random() * 2 - 1) * cfg.noise;
    scored.push({ move, score });
    if (ctx.timedOut && scored.length >= 2) break;
  }
  if (!scored.length) return moves[0];
  scored.sort((a,b) => b.score - a.score);

  if (psychology?.inviteConfidence && scored.length > 1) {
    const best = scored[0].score;
    const maxConcession = { 1: 220, 2: 175, 3: 135, 4: 105, 5: 80 }[level] ?? 120;
    const gentle = scored
      .filter(x => best - x.score <= maxConcession && x.score <= 45)
      .sort((a,b) => Math.abs(a.score + 45) - Math.abs(b.score + 45));
    if (gentle.length && Math.random() < 0.68) return gentle[0].move;
  }

  if (level === 1 && scored.length > 1 && Math.random() < 0.38) return scored[Math.floor(Math.random() * Math.min(4, scored.length))].move;
  if (level === 2 && scored.length > 1 && Math.random() < 0.16) return scored[Math.floor(Math.random() * Math.min(3, scored.length))].move;
  return scored[0].move;
}
