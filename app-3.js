// -----------------------------
// Private machine-only rule layer
// -----------------------------
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

function createCheatDirector() {
  return { totalCheats: 0, lastCheatMove: -99, quietTurns: 0, lastPressure: 0 };
}

function cheatDecision(s, level, integrity, director = createCheatDirector(), humanMoment = null, randomFn = Math.random) {
  const cfg = INTEGRITY_CONFIG[integrity] ?? INTEGRITY_CONFIG.dubious;
  const moveNo = s.fullmove;
  const evalBlack = evaluate(s);
  const whiteEdge = -evalBlack;
  const turnsSinceCheat = moveNo - director.lastCheatMove;

  if (moveNo < 6 || turnsSinceCheat <= cfg.cooldown || director.totalCheats >= cfg.maxCheats) {
    return { shouldCheat: false, pressure: 0, evalBlack, whiteEdge, targetEval: 25, motive: 'restraint' };
  }

  const edgeSignal = clamp((whiteEdge - 30) / 190, 0, 1);
  const captured = humanMoment?.capturedValue ?? 0;
  const swing = humanMoment?.humanSwing ?? 0;
  const gaveCheck = Boolean(humanMoment?.gaveCheck);
  const eventSignal = clamp(
    (captured >= 300 ? 0.72 : captured >= 100 ? 0.36 : 0) +
    (gaveCheck ? 0.34 : 0) +
    clamp((swing - 55) / 220, 0, 0.55),
    0, 1
  );

  const honestRun = director.totalCheats === 0 ? moveNo : turnsSinceCheat;
  const droughtStart = director.totalCheats === 0 ? 8 : cfg.cooldown + 2;
  const droughtSignal = clamp((honestRun - droughtStart) / 7, 0, 1);
  let pressure = cfg.baseline + cfg.edgeBoost * edgeSignal + cfg.eventBoost * eventSignal + cfg.droughtBoost * droughtSignal;

  if (director.totalCheats === 0 && moveNo < 9 && edgeSignal < 0.15 && eventSignal < 0.3) pressure *= 0.18;
  if (evalBlack > 220) pressure *= 0.16;
  else if (evalBlack > 110) pressure *= 0.42;

  if (director.totalCheats === 0 && moveNo >= cfg.guaranteeMove && evalBlack < 100) {
    pressure = Math.max(pressure, whiteEdge > 20 ? 0.92 : 0.58);
  }
  if (captured >= 500 || (captured >= 300 && gaveCheck) || swing >= 260) pressure = Math.max(pressure, 0.82);

  pressure = clamp(pressure, 0, 0.96);
  const targetEval = clamp(25 + Math.max(0, whiteEdge - 60) * 0.16, -10, 80);
  const motive = eventSignal > 0.62 ? 'retaliation' : edgeSignal > 0.35 ? 'advantage correction' : 'opportunism';
  return { shouldCheat: randomFn() < pressure, pressure, evalBlack, whiteEdge, targetEval, motive, edgeSignal, eventSignal, droughtSignal };
}

function machineMayCheat(s, level, integrity, director = createCheatDirector(), humanMoment = null) {
  return cheatDecision(s, level, integrity, director, humanMoment).shouldCheat;
}

function validCheatPosition(candidate) {
  if (findKing(candidate, 'w') < 0 || findKing(candidate, 'b') < 0) return false;
  if (isInCheck(candidate, 'b')) return false;
  if (isInCheck(candidate, 'w')) return false;
  return generateLegalMoves(candidate, 'b').length > 0;
}

function cheatCandidate(state, kind, detail, family, changedSquares, salience) {
  state.enPassant = null;
  return { state, kind, detail, family, changedSquares, salience, afterEval: evaluate(state) };
}

function enumerateCheatCandidates(s) {
  const out = [];
  const whitePawns = [];
  for (let i = 0; i < 64; i++) if (s.board[i] === 'P') whitePawns.push(i);
  if (whitePawns.length > 3) {
    for (const target of whitePawns) {
      const candidate = cloneState(s);
      candidate.board[target] = null;
      if (!validCheatPosition(candidate)) continue;
      out.push(cheatCandidate(candidate, 'Unrecorded subtraction', `A white pawn on ${squareName(target)} was removed from the position without a move.`, 'remove-pawn', [target], 0.82));
    }
  }

  for (let from = 0; from < 64; from++) {
    if (s.board[from] !== 'p') continue;
    const r = rowOf(from), c = colOf(from);
    const rr = r + 1;
    if (!inBounds(rr, c) || rr === 7) continue;
    const to = idx(rr, c);
    if (s.board[to]) continue;
    const candidate = cloneState(s);
    candidate.board[from] = null;
    candidate.board[to] = 'p';
    candidate.enPassant = null;
    if (!validCheatPosition(candidate)) continue;
    out.push(cheatCandidate(candidate, 'Additional action', `A black pawn advanced from ${squareName(from)} to ${squareName(to)} before Black's recorded move.`, 'extra-tempo', [from, to], 1.0));
  }

  for (let target = 0; target < 64; target++) {
    if (s.board[target] !== 'p' || rowOf(target) <= 1 || rowOf(target) >= 7) continue;
    for (const promoted of ['n','b','r','q']) {
      const candidate = cloneState(s);
      candidate.board[target] = promoted;
      if (!validCheatPosition(candidate)) continue;
      out.push(cheatCandidate(candidate, 'Premature promotion', `A black pawn on ${squareName(target)} was administratively reclassified as a ${PIECE_NAMES[promoted]}.`, 'promotion', [target], promoted === 'q' ? 0.94 : 0.9));
    }
  }

  const knights = [];
  for (let i = 0; i < 64; i++) if (s.board[i] === 'n') knights.push(i);
  const empties = [];
  for (let i = 8; i < 56; i++) if (!s.board[i]) empties.push(i);
  for (const from of knights) {
    const fr = rowOf(from), fc = colOf(from);
    for (const to of empties) {
      const dr = Math.abs(rowOf(to)-fr), dc = Math.abs(colOf(to)-fc);
      if ((dr === 2 && dc === 1) || (dr === 1 && dc === 2)) continue;
      if (dr + dc < 2 || dr + dc > 5) continue;
      const candidate = cloneState(s);
      candidate.board[from] = null;
      candidate.board[to] = 'n';
      if (!validCheatPosition(candidate)) continue;
      out.push(cheatCandidate(candidate, 'Unauthorized relocation', `A black knight moved from ${squareName(from)} to ${squareName(to)} outside the move record.`, 'knight-relocation', [from, to], 0.96));
    }
  }

  const blackPawnCount = s.board.filter(p => p === 'p').length;
  if (blackPawnCount < 8) {
    for (let r = 2; r <= 5; r++) {
      for (let c = 0; c < 8; c++) {
        const target = idx(r,c);
        if (s.board[target]) continue;
        const candidate = cloneState(s);
        candidate.board[target] = 'p';
        if (!validCheatPosition(candidate)) continue;
        out.push(cheatCandidate(candidate, 'Inventory discrepancy', `A new black pawn appeared on ${squareName(target)} without an originating move.`, 'add-pawn', [target], 0.78));
      }
    }
  }
  return out;
}

function commitMachineCheat(s, context = {}) {
  const beforeEval = evaluate(s);
  const targetEval = context.targetEval ?? 30;
  const firstCheat = Boolean(context.firstCheat);
  const humanMoment = context.humanMoment ?? null;
  const candidates = enumerateCheatCandidates(s)
    .map(candidate => ({ ...candidate, gain: candidate.afterEval - beforeEval }))
    .filter(candidate => candidate.gain > 18);
  if (!candidates.length) return null;

  for (const candidate of candidates) {
    let score = Math.abs(candidate.afterEval - targetEval);
    if (candidate.afterEval > 180) score += (candidate.afterEval - 180) * 1.7;
    if (candidate.gain > 360) score += (candidate.gain - 360) * 1.1;
    score -= candidate.salience * (firstCheat ? 74 : 26);
    if ((humanMoment?.capturedValue ?? 0) >= 300 || humanMoment?.gaveCheck) {
      if (candidate.family === 'extra-tempo' || candidate.family === 'knight-relocation') score -= 34;
    }
    score += Math.random() * 18;
    candidate.selectionScore = score;
  }

  candidates.sort((a,b) => a.selectionScore - b.selectionScore);
  const chosen = candidates[0];
  return {
    state: chosen.state, kind: chosen.kind, detail: chosen.detail, family: chosen.family,
    changedSquares: chosen.changedSquares, beforeEval, afterEval: chosen.afterEval, gain: chosen.gain,
    motive: context.motive ?? 'advantage correction',
  };
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const CORE_API = {
  newState, cloneState, generatePseudoMoves, generateLegalMoves, applyMove,
  isInCheck, isSquareAttacked, gameStatus, insufficientMaterial, squareName,
  notation, evaluate, chooseAiMove, createCheatDirector, cheatDecision,
  machineMayCheat, enumerateCheatCandidates, commitMachineCheat,
};
globalThis.__HONEST_GAME_CORE__ = CORE_API;
