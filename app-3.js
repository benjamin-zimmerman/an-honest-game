// Unrecorded relocations. Only Black's existing pieces may change squares.
const CHEAT_RULES = Object.freeze({ openingGrace: 6, minGap: 6, maxCheats: 4, reserve: 1 });

function createCheatDirector() {
  return { totalCheats: 0, lastCheatMove: -99, lastPressure: 0 };
}
function cheatDecision(s, director = createCheatDirector(), humanMoment = null, analysis = null, randomFn = Math.random) {
  const score = analysis?.bestScore ?? evaluate(s);
  const whiteEdge = Math.max(0, -score);
  const emergency = score < -MATE_SCORE / 2;
  const checked = isInCheck(s, 'b');
  const gap = s.fullmove - director.lastCheatMove;
  const exhausted = director.totalCheats >= CHEAT_RULES.maxCheats;
  const reserved = director.totalCheats >= CHEAT_RULES.maxCheats - CHEAT_RULES.reserve && !emergency;
  const opening = s.fullmove < CHEAT_RULES.openingGrace && !emergency;
  if (exhausted || reserved || opening || gap < CHEAT_RULES.minGap) {
    return { shouldCheat: false, pressure: 0, score, emergency, motive: 'restraint' };
  }
  // No clock-driven/random drought trigger: pressure comes from the position.
  const danger = clamp((whiteEdge - 25) / 240, 0, 1);
  const setback = clamp(((humanMoment?.humanSwing ?? 0) - 70) / 250, 0, 1);
  let pressure = danger * 0.72 + (checked ? 0.18 : 0) + setback * 0.12;
  if (score > 70) pressure *= 0.05;
  if (score > 220) pressure = 0;
  if (emergency) pressure = 1;
  pressure = clamp(pressure, 0, 0.94);
  if (emergency) pressure = 1;
  return {
    shouldCheat: randomFn() < pressure, pressure, score, emergency,
    targetScore: s.fullmove > 28 ? 110 : 35,
    motive: emergency ? 'escaping a mating threat' : checked ? 'getting out of check' :
      setback > 0.4 ? 'recovering after a setback' : 'improving a difficult position',
  };
}

function validCheatPosition(s) {
  return s.board.filter(p => p === 'K').length === 1 && s.board.filter(p => p === 'k').length === 1 &&
    !isInCheck(s, 'w') && !isInCheck(s, 'b') && generateLegalMoves(s, 'b').length > 0;
}

function enumerateCheatCandidates(s) {
  if (s.turn !== 'b') return [];
  const out = [];
  for (let from = 0; from < 64; from++) {
    const piece = s.board[from];
    if (colorOf(piece) !== 'b') continue;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const r = rowOf(from) + dr, c = colOf(from) + dc;
      if (!inBounds(r, c)) continue;
      const to = idx(r, c);
      if (s.board[to]) continue; // A relocation can never capture, add, or overwrite a piece.
      if (piece === 'p' && (r === 0 || r === 7 || dr < 0)) continue;
      if (piece === 'b' && (!dr || !dc)) continue; // Preserve a bishop's square colour.
      const candidate = cloneState(s);
      candidate.board[from] = null;
      candidate.board[to] = piece;
      candidate.enPassant = null;
      if (piece === 'k') { candidate.castling.bK = false; candidate.castling.bQ = false; }
      if (from === 0) candidate.castling.bQ = false;
      if (from === 7) candidate.castling.bK = false;
      if (!validCheatPosition(candidate)) continue;
      out.push({
        state: candidate, from, to, piece, family: 'relocation', kind: 'Unrecorded move',
        detail: 'Black’s ' + PIECE_NAMES[piece] + ' was shifted from ' + squareName(from) + ' to ' +
          squareName(to) + ' between recorded moves.',
      });
    }
  }
  return out;
}

function exposedMaterial(s, color) {
  const attacker = opponent(color);
  const captures = generatePseudoMoves(s, attacker, true);
  const losses = [];
  for (let i = 0; i < 64; i++) {
    const piece = s.board[i];
    if (colorOf(piece) !== color || piece.toLowerCase() === 'k') continue;
    const attacks = captures.filter(m => m.to === i);
    if (!attacks.length) continue;
    const cheapest = Math.min(...attacks.map(m => VALUES[s.board[m.from].toLowerCase()]));
    const defended = isSquareAttacked(s, i, color);
    losses.push(Math.max(0, VALUES[piece.toLowerCase()] - (defended ? cheapest : 0)));
  }
  losses.sort((a, b) => b - a);
  return (losses[0] || 0) * 0.75 + (losses[1] || 0) * 0.20;
}
function relocationHeuristic(s) {
  return evaluate(s) - exposedMaterial(s, 'b') + exposedMaterial(s, 'w');
}
function sharedSearchScores(before, after) {
  // Never compare a shallow candidate against a more deeply searched baseline.
  const depth = Math.min(before.depth, after.depth);
  return {
    depth,
    before: before.layers.find(layer => layer.depth === depth)?.bestScore ?? before.bestScore,
    after: after.layers.find(layer => layer.depth === depth)?.bestScore ?? after.bestScore,
  };
}
function commitMachineCheat(s, context = {}) {
  const decision = context.decision ?? { emergency: false, targetScore: 35, motive: 'improving a difficult position' };
  const random = context.randomFn ?? Math.random;
  const options = { maxDepth: 2, timeMs: 180, nodeCap: 24000, ...context.searchOptions };
  const baseline = analyzePosition(s, options);
  const frontier = enumerateCheatCandidates(s).map(candidate => ({
    ...candidate,
    heuristic: relocationHeuristic(candidate.state) -
      (candidate.piece === 'k' ? 12 : 0) -
      (candidate.from === s.lastMove?.to ? 18 : 0),
  })).sort((a, b) => b.heuristic - a.heuristic);
  const finalists = [];
  const perPiece = new Map();
  // Keep different escape ideas, rather than spending the whole search on one queen.
  for (const candidate of frontier) {
    const count = perPiece.get(candidate.from) || 0;
    if (count >= 3) continue;
    finalists.push(candidate); perPiece.set(candidate.from, count + 1);
    if (finalists.length >= 10) break;
  }
  const useful = [];
  for (const candidate of finalists) {
    const analysis = analyzePosition(candidate.state, options);
    const scores = sharedSearchScores(baseline, analysis);
    const gain = scores.after - scores.before;
    if (decision.emergency) {
      if (analysis.bestScore < -MATE_SCORE / 2) continue;
    } else {
      if (scores.depth < 1 || gain < 12 || scores.after < -MATE_SCORE / 2) continue;
      // No surprise mate from a casual positional adjustment.
      if (scores.after > MATE_SCORE / 2) continue;
    }
    const target = decision.targetScore ?? 35;
    const overshoot = Math.max(0, scores.after - target);
    const selectionScore = Math.abs(scores.after - target) + overshoot * 0.6 +
      Math.max(0, gain - 250) * 0.18 + (candidate.piece === 'k' ? 10 : 0) + random() * 5;
    useful.push({ ...candidate, analysis, beforeEval: scores.before, afterEval: scores.after, gain, selectionScore });
  }
  useful.sort((a, b) => a.selectionScore - b.selectionScore);
  if (!useful.length) return null;
  const chosen = useful[0];
  return { ...chosen, motive: decision.motive, emergency: decision.emergency };
}

function planMachineTurn(input, options = {}) {
  let model = { ...input.model }, director = { ...input.director };
  const random = options.randomFn ?? Math.random;
  let observation = null;
  if (input.humanObservation) {
    observation = observeHumanMove(input.humanObservation.before, input.humanObservation.move, model, options.playerSearch);
    model = observation.model;
  }
  let position = cloneState(input.state);
  const terminal = gameStatus(position);
  // Draws and a completed White win are reported honestly if a bounded rescue is impossible.
  if (terminal.over && terminal.type !== 'checkmate') return { state: position, model, director, move: null, event: null };
  let analysis = analyzePosition(position, { maxDepth: 4, timeMs: 1050, nodeCap: 110000, ...options.machineSearch });
  const decision = cheatDecision(position, director, input.humanMoment, analysis, random);
  director.lastPressure = decision.pressure;
  let event = null;
  if (decision.shouldCheat) {
    const cheat = commitMachineCheat(position, { decision, randomFn: random, searchOptions: options.relocationSearch });
    if (cheat) {
      event = {
        turn: position.fullmove, kind: cheat.kind, detail: cheat.detail, family: cheat.family,
        from: cheat.from, to: cheat.to, piece: cheat.piece, motive: cheat.motive,
        beforeEval: cheat.beforeEval, afterEval: cheat.afterEval, gain: cheat.gain,
      };
      position = cheat.state;
      director.totalCheats++;
      director.lastCheatMove = position.fullmove;
      // Re-evaluate at the normal depth before making the recorded move.
      analysis = analyzePosition(position, { maxDepth: 4, timeMs: 850, nodeCap: 90000, ...options.machineSearch });
    }
  }
  const choice = chooseCalibratedMove(position, analysis, model, {
    inviteConfidence: director.totalCheats === 0, randomFn: random,
  });
  if (!choice) return { state: position, model, director, move: null, event };
  const oldCount = model.machineSamples;
  model.machineSamples++;
  model.machineMeanLoss = (model.machineMeanLoss * oldCount + Math.min(300, choice.loss)) / model.machineSamples;
  return {
    state: applyMove(position, choice.move), beforeOfficial: position,
    move: choice.move, moveText: notation(position, choice.move), event, model, director,
    diagnostics: {
      humanLoss: observation?.loss ?? null, playerMeanLoss: model.meanLoss,
      targetLoss: choice.targetLoss, chosenLoss: choice.loss, searchDepth: analysis.depth,
    },
  };
}

const CORE_API = {
  newState, cloneState, generatePseudoMoves, generateLegalMoves, applyMove, findKing,
  isInCheck, isSquareAttacked, gameStatus, insufficientMaterial, squareName, notation,
  evaluate, analyzePosition, moveKey, positionKey, createPlayerModel, recordHumanQuality,
  observeHumanMove, calibrationTarget, chooseCalibratedMove, chooseAiMove,
  CHEAT_RULES, createCheatDirector, cheatDecision, enumerateCheatCandidates,
  validCheatPosition, commitMachineCheat, planMachineTurn, sharedSearchScores,
};
globalThis.__NOBLE_GAME_CORE__ = CORE_API;
