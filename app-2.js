// Position analysis and within-game opponent calibration.
// Scores are centipawns from Black's perspective. No Elo claim is made.
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

function positionalBonus(piece, i, totalMaterial) {
  const color = colorOf(piece), type = piece.toLowerCase();
  const r = rowOf(i), c = colOf(i);
  const center = 7 - Math.abs(3.5 - r) - Math.abs(3.5 - c);
  if (type === 'p') {
    const advanced = color === 'w' ? 6 - r : r - 1;
    return advanced * (totalMaterial < 2200 ? 18 : 9) + (c >= 2 && c <= 5 ? 8 : 0);
  }
  if (type === 'n') return Math.round(center * 8);
  if (type === 'b') return Math.round(center * 4);
  if (type === 'r') return (color === 'w' ? r === 1 : r === 6) ? 22 : 0;
  if (type === 'q') return Math.round(center * 1.2);
  if (totalMaterial < 2200) return Math.round(center * 8);
  return ((r === (color === 'w' ? 7 : 0) && (c === 2 || c === 6)) ? 32 : 0) - Math.round(center * 3);
}

function evaluate(s) {
  let score = 0, total = 0;
  for (const p of s.board) if (p && p.toLowerCase() !== 'k') total += VALUES[p.toLowerCase()];
  for (let i = 0; i < 64; i++) {
    const p = s.board[i];
    if (p) score += (colorOf(p) === 'b' ? 1 : -1) * (VALUES[p.toLowerCase()] + positionalBonus(p, i, total));
  }
  if (isInCheck(s, 'w')) score += 28;
  if (isInCheck(s, 'b')) score -= 28;
  return score;
}

function moveOrderScore(move) {
  return (move.captured ? 10 * VALUES[move.captured.toLowerCase()] : 0) +
    (move.promotion ? VALUES[move.promotion.toLowerCase()] + 700 : 0) +
    (/[kq]/.test(move.flags) ? 60 : 0);
}

function moveKey(move) { return move.from + ':' + move.to + ':' + (move.promotion || ''); }
function positionKey(s) {
  return s.board.map(p => p || '.').join('') + '/' + s.turn + '/' +
    Object.values(s.castling).map(Number).join('') + '/' + s.enPassant + '/' + s.halfmove;
}
function searchExpired(ctx) {
  ctx.nodes++;
  if (ctx.nodes >= ctx.nodeCap || ((ctx.nodes & 127) === 0 && performance.now() >= ctx.deadline)) ctx.timedOut = true;
  return ctx.timedOut;
}
function terminalScore(s, legal, ply) {
  if (!legal.length) return isInCheck(s, s.turn) ? (s.turn === 'b' ? -MATE_SCORE + ply : MATE_SCORE - ply) : 0;
  if (s.halfmove >= 100 || insufficientMaterial(s)) return 0;
  return null;
}

function quiescence(s, alpha, beta, ctx, ply = 0, qDepth = 0) {
  if (searchExpired(ctx)) return evaluate(s);
  const legal = generateLegalMoves(s);
  const terminal = terminalScore(s, legal, ply);
  if (terminal !== null) return terminal;
  const checked = isInCheck(s, s.turn);
  if (qDepth >= 4) return evaluate(s);
  const sign = s.turn === 'b' ? 1 : -1;
  let value = checked ? -sign * Infinity : evaluate(s);
  // Standing pat in check misses forced evasions and corrupts both calibration and rescue.
  if (!checked) {
    if (sign === 1) { if (value >= beta) return value; alpha = Math.max(alpha, value); }
    else { if (value <= alpha) return value; beta = Math.min(beta, value); }
  }
  const moves = checked ? legal : legal.filter(m => m.captured || m.promotion);
  moves.sort((a, b) => moveOrderScore(b) - moveOrderScore(a));
  for (const move of moves) {
    const score = quiescence(applyMove(s, move), alpha, beta, ctx, ply + 1, qDepth + 1);
    value = sign === 1 ? Math.max(value, score) : Math.min(value, score);
    if (sign === 1) alpha = Math.max(alpha, value); else beta = Math.min(beta, value);
    if (alpha >= beta || ctx.timedOut) break;
  }
  return value;
}

function alphaBeta(s, depth, alpha, beta, ctx, ply = 0) {
  if (searchExpired(ctx)) return evaluate(s);
  if (depth <= 0) return quiescence(s, alpha, beta, ctx, ply);
  const originalAlpha = alpha, originalBeta = beta;
  // Mate distance depends on ply. Keep it in the key.
  const key = positionKey(s) + ':' + ply;
  const cached = ctx.tt.get(key);
  if (cached && cached.depth >= depth) {
    if (cached.flag === 'exact') return cached.score;
    if (cached.flag === 'lower') alpha = Math.max(alpha, cached.score);
    else beta = Math.min(beta, cached.score);
    if (alpha >= beta) return cached.score;
  }
  const legal = generateLegalMoves(s);
  const terminal = terminalScore(s, legal, ply);
  if (terminal !== null) return terminal;
  legal.sort((a, b) => moveOrderScore(b) - moveOrderScore(a));
  let value = s.turn === 'b' ? -Infinity : Infinity;
  for (const move of legal) {
    const score = alphaBeta(applyMove(s, move), depth - 1, alpha, beta, ctx, ply + 1);
    value = s.turn === 'b' ? Math.max(value, score) : Math.min(value, score);
    if (s.turn === 'b') alpha = Math.max(alpha, value); else beta = Math.min(beta, value);
    if (alpha >= beta || ctx.timedOut) break;
  }
  if (!ctx.timedOut) ctx.tt.set(key, {
    depth, score: value,
    flag: value <= originalAlpha ? 'upper' : value >= originalBeta ? 'lower' : 'exact',
  });
  return value;
}

function analyzePosition(s, options = {}) {
  const legal = generateLegalMoves(s);
  const terminal = terminalScore(s, legal, 0);
  if (terminal !== null) return { moves: [], bestScore: terminal, depth: 0, nodes: 0, layers: [] };
  const sign = s.turn === 'b' ? 1 : -1;
  // Every root move gets a score; an interrupted deeper iteration is discarded in full.
  let scored = legal.map(move => {
    const child = applyMove(s, move);
    const ended = terminalScore(child, generateLegalMoves(child), 1);
    return { move, score: ended === null ? evaluate(child) : ended };
  }).sort((a, b) => sign * (b.score - a.score));
  const layers = [{ depth: 0, moves: scored, bestScore: scored[0].score }];
  const ctx = {
    nodes: 0, nodeCap: options.nodeCap ?? 90000,
    deadline: performance.now() + (options.timeMs ?? 850), timedOut: false, tt: new Map(),
  };
  let completedDepth = 0;
  for (let depth = 1; depth <= (options.maxDepth ?? 4); depth++) {
    const iteration = [];
    for (const entry of scored) {
      const score = alphaBeta(applyMove(s, entry.move), depth - 1, -Infinity, Infinity, ctx, 1);
      if (ctx.timedOut) break;
      iteration.push({ move: entry.move, score });
    }
    if (ctx.timedOut) break;
    scored = iteration.sort((a, b) => sign * (b.score - a.score));
    completedDepth = depth;
    layers.push({ depth, moves: scored, bestScore: scored[0].score });
    if (Math.abs(scored[0].score) > MATE_SCORE - 100) break;
  }
  return { moves: scored, bestScore: scored[0].score, depth: completedDepth, nodes: ctx.nodes, layers };
}

function createPlayerModel() {
  return { samples: 0, meanLoss: 45, recentLosses: [], machineSamples: 0, machineMeanLoss: 0 };
}
function recordHumanQuality(model, loss, options = {}) {
  // Forced moves do not tell us how strong the player is.
  if (options.forced || !Number.isFinite(loss)) return { ...model };
  const boundedLoss = clamp(loss, 0, 250);
  const recentLosses = [...model.recentLosses, boundedLoss].slice(-12);
  const rate = model.samples < 5 ? 0.30 : 0.18;
  return {
    ...model, samples: model.samples + 1, recentLosses,
    meanLoss: model.meanLoss * (1 - rate) + boundedLoss * rate,
  };
}
function observeHumanMove(before, move, model, options = {}) {
  const analysis = analyzePosition(before, { maxDepth: 3, timeMs: 650, nodeCap: 55000, ...options });
  const played = analysis.moves.find(entry => moveKey(entry.move) === moveKey(move));
  if (!played || analysis.moves.length < 2 || analysis.depth < 1) return { model, analysis, loss: null };
  const loss = Math.max(0, played.score - analysis.bestScore);
  return { model: recordHumanQuality(model, loss), analysis, loss };
}
function calibrationTarget(model) {
  // A little less accurate than the observed player, not a fixed difficulty level.
  return clamp(model.meanLoss * 1.12 + 12, 12, 292);
}
function chooseCalibratedMove(s, analysis, model, options = {}) {
  if (!analysis.moves.length) return null;
  const random = options.randomFn ?? Math.random;
  const best = analysis.bestScore;
  const targetLoss = calibrationTarget(model);
  const viable = analysis.moves.filter(entry =>
    best < -MATE_SCORE / 2 || entry.score > -MATE_SCORE / 2);
  const choices = viable.length ? viable : analysis.moves;
  const ranked = choices.map(entry => {
    const loss = Math.max(0, best - entry.score);
    // Position shaping is bounded by the same error budget, so it cannot throw a queen
    // simply to create a dramatic comeback. Forced moves can be equally strong.
    const whiteEdgePreference = options.inviteConfidence && entry.score > 35 ?
      Math.min(18, (entry.score - 35) * 0.08) : 0;
    return { ...entry, loss, distance: Math.abs(loss - targetLoss) + whiteEdgePreference + random() * 8 };
  }).sort((a, b) => a.distance - b.distance);
  const chosen = ranked[0];
  return { move: chosen.move, loss: chosen.loss, targetLoss, score: chosen.score };
}
function chooseAiMove(s, model = createPlayerModel(), options = {}) {
  const analysis = analyzePosition(s, options);
  return chooseCalibratedMove(s, analysis, typeof model === 'object' ? model : createPlayerModel(), options)?.move ?? null;
}
