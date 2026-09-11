const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCore, square, fromFen, seededRandom } = require('./helpers.cjs');
const C = loadCore();
const fixedSearch = { maxDepth: 2, timeMs: Infinity, nodeCap: Infinity };
const inventory = s => Array.from(s.board).filter(Boolean).sort().join('');
const copy = x => JSON.parse(JSON.stringify(x));

test('ordinary chess still has 20 / 400 / 8902 opening continuations', () => {
  function perft(s, depth) { return depth ? C.generateLegalMoves(s).reduce((n, m) => n + perft(C.applyMove(s, m), depth - 1), 0) : 1; }
  assert.equal(perft(C.newState(), 1), 20);
  assert.equal(perft(C.newState(), 2), 400);
  assert.equal(perft(C.newState(), 3), 8902);
});

test('all relocations preserve inventory, White, kings, counters, and one-square distance', () => {
  const random = seededRandom(17);
  let state = C.newState(), checked = 0;
  for (let ply = 0; ply < 90; ply++) {
    if (C.gameStatus(state).over) break;
    if (state.turn === 'b') {
      const original = JSON.stringify(state);
      for (const candidate of C.enumerateCheatCandidates(state)) {
        const after = candidate.state;
        assert.equal(inventory(after), inventory(state));
        const changed = state.board.map((p, i) => p !== after.board[i] ? i : -1).filter(i => i !== -1);
        assert.equal(changed.length, 2);
        assert.equal(state.board[candidate.to], null);
        assert.equal(after.board[candidate.from], null);
        assert.equal(after.board[candidate.to], state.board[candidate.from]);
        assert.equal(candidate.piece, candidate.piece.toLowerCase());
        assert.equal(Math.max(Math.abs(Math.floor(candidate.from / 8) - Math.floor(candidate.to / 8)), Math.abs(candidate.from % 8 - candidate.to % 8)), 1);
        state.board.forEach((p, i) => { if (p && p === p.toUpperCase()) assert.equal(after.board[i], p); });
        assert.equal(C.isInCheck(after, 'w'), false);
        assert.equal(C.isInCheck(after, 'b'), false);
        assert.ok(C.generateLegalMoves(after).length);
        assert.equal(after.turn, state.turn);
        assert.equal(after.fullmove, state.fullmove);
        assert.equal(after.halfmove, state.halfmove);
        assert.deepEqual(copy(after.lastMove), copy(state.lastMove));
        if (candidate.piece === 'p') assert.ok(candidate.to >= 8 && candidate.to < 56);
        if (candidate.piece === 'b') assert.equal((Math.floor(candidate.from / 8) + candidate.from % 8) % 2, (Math.floor(candidate.to / 8) + candidate.to % 8) % 2);
        checked++;
      }
      assert.equal(JSON.stringify(state), original);
    }
    const moves = C.generateLegalMoves(state);
    state = C.applyMove(state, moves[Math.floor(random() * moves.length)]);
  }
  assert.ok(checked > 250, 'exercise many different board positions');
});

test('relocations revoke king/rook castling rights and stale en-passant', () => {
  const s = fromFen(C, 'r3k2r/8/8/8/8/8/8/4K3 b kq - 0 12');
  s.enPassant = square('e3');
  const candidates = C.enumerateCheatCandidates(s);
  const king = candidates.find(c => c.from === square('e8') && c.to === square('e7'));
  assert.ok(king);
  assert.equal(king.state.castling.bK, false); assert.equal(king.state.castling.bQ, false);
  const rook = candidates.find(c => c.from === square('h8') && c.to === square('g8'));
  assert.ok(rook); assert.equal(rook.state.castling.bK, false); assert.equal(rook.state.castling.bQ, true);
  assert.equal(rook.state.enPassant, null);
});

test('cheating pressure follows trouble, with opening, spacing, total cap, and reserve', () => {
  const s = C.newState(); s.turn = 'b'; s.fullmove = 12;
  const director = C.createCheatDirector();
  const decision = (score, d = director) => C.cheatDecision(s, d, null, { bestScore: score }, () => 0);
  assert.ok(decision(-280).pressure > decision(-45).pressure);
  assert.equal(decision(400).shouldCheat, false);
  s.fullmove = 99; assert.equal(decision(400).pressure, 0);
  s.fullmove = 5; assert.equal(decision(-280).shouldCheat, false);
  s.fullmove = 12;
  assert.equal(decision(-280, { ...director, lastCheatMove: 7 }).shouldCheat, false);
  assert.equal(decision(-280, { ...director, lastCheatMove: 6 }).shouldCheat, true);
  assert.equal(decision(-280, { ...director, totalCheats: 3 }).shouldCheat, false);
  assert.equal(decision(-99999, { ...director, totalCheats: 3 }).shouldCheat, true);
  assert.equal(decision(-99999, { ...director, totalCheats: 4 }).shouldCheat, false);
});

test('a mating net can be escaped by an adjacent knight shift, without changing material', () => {
  const s = fromFen(C, '5R1k/6np/3K4/8/8/8/8/8 b - - 0 14');
  assert.equal(C.gameStatus(s).type, 'checkmate');
  const cheat = C.commitMachineCheat(s, { decision: { emergency: true, targetScore: 35, motive: 'escaping a mating threat' }, searchOptions: fixedSearch, randomFn: () => 0 });
  assert.ok(cheat);
  assert.equal(cheat.from, square('g7')); assert.equal(cheat.to, square('g8'));
  assert.equal(inventory(cheat.state), inventory(s));
  assert.equal(C.gameStatus(cheat.state).over, false);
});

test('an inescapable mate is not rewritten as a machine victory', () => {
  const s = fromFen(C, 'r1bqkb1r/pppp1Qpp/2n2n2/4p3/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 0 4');
  assert.equal(C.gameStatus(s).type, 'checkmate');
  const result = C.planMachineTurn({ state: s, model: C.createPlayerModel(), director: C.createCheatDirector() }, {
    machineSearch: fixedSearch, relocationSearch: fixedSearch, randomFn: () => 0,
  });
  assert.equal(result.move, null); assert.equal(result.event, null);
  assert.equal(C.gameStatus(result.state).winner, 'w');
});

test('player calibration reacts to move quality, ignores forced moves, and adapts back', () => {
  let strong = C.createPlayerModel(), weak = C.createPlayerModel();
  for (let i = 0; i < 20; i++) { strong = C.recordHumanQuality(strong, 4); weak = C.recordHumanQuality(weak, 130); }
  assert.ok(C.calibrationTarget(strong) < 25);
  assert.ok(C.calibrationTarget(weak) > 130);
  const unchanged = C.recordHumanQuality(strong, 180, { forced: true });
  assert.deepEqual(copy(unchanged), copy(strong));
  const previous = weak.meanLoss;
  for (let i = 0; i < 12; i++) weak = C.recordHumanQuality(weak, 0);
  assert.ok(weak.meanLoss < previous / 3);
});

test('actual queen blunder is measured against alternatives in the same position', () => {
  const s = fromFen(C, '4r1k1/8/8/8/8/8/4Q3/6K1 w - - 0 12');
  const move = C.generateLegalMoves(s).find(m => m.from === square('e2') && m.to === square('e4'));
  const observation = C.observeHumanMove(s, move, C.createPlayerModel(), fixedSearch);
  assert.ok(observation.loss > 500);
  assert.equal(observation.model.samples, 1);
  assert.ok(observation.model.meanLoss > 45);
});

test('machine concessions track the estimate instead of a fixed strength', () => {
  const moves = C.generateLegalMoves({ ...C.newState(), turn: 'b' }).slice(0, 5);
  const analysis = { bestScore: 200, moves: moves.map((move, i) => ({ move, score: [200, 180, 140, 90, -50][i] })) };
  const strong = C.chooseCalibratedMove(C.newState(), analysis, { ...C.createPlayerModel(), meanLoss: 4 }, { randomFn: () => 0 });
  const weak = C.chooseCalibratedMove(C.newState(), analysis, { ...C.createPlayerModel(), meanLoss: 120 }, { randomFn: () => 0 });
  assert.equal(strong.loss, 20); assert.ok(weak.loss > strong.loss);
  const forced = C.chooseCalibratedMove(C.newState(), { moves: [analysis.moves[0]], bestScore: 200 }, C.createPlayerModel());
  assert.equal(forced.loss, 0);
});

test('timed search scores all root moves and discards incomplete deeper passes', () => {
  const s = C.newState();
  const analysis = C.analyzePosition(s, { nodeCap: 1, maxDepth: 8, timeMs: Infinity });
  assert.equal(analysis.moves.length, 20); assert.equal(analysis.depth, 0);
  assert.ok(analysis.moves.every(m => Number.isFinite(m.score)));
});

test('check search examines evasions and sees mate; king captures are never legal', () => {
  const s = fromFen(C, '5R1k/6np/3K4/8/8/8/8/8 b - - 0 14');
  assert.equal(C.analyzePosition(s, fixedSearch).bestScore, -100000);
  const malformed = fromFen(C, '4k3/4Q3/8/8/8/8/8/4K3 w - - 0 12');
  assert.ok(C.generateLegalMoves(malformed).every(m => m.captured !== 'k'));
});

test('normal planned turns stay legal, preserve input, and update calibration', () => {
  const before = C.newState();
  const move = C.generateLegalMoves(before).find(m => m.from === square('e2') && m.to === square('e4'));
  const input = { state: C.applyMove(before, move), model: C.createPlayerModel(), director: C.createCheatDirector(), humanObservation: { before, move } };
  const original = JSON.stringify(input);
  const result = C.planMachineTurn(input, { playerSearch: fixedSearch, machineSearch: fixedSearch, randomFn: () => 0.5 });
  assert.equal(result.event, null);
  assert.ok(C.generateLegalMoves(input.state).some(m => C.moveKey(m) === C.moveKey(result.move)));
  assert.equal(result.state.turn, 'w'); assert.equal(result.model.samples, 1);
  assert.equal(JSON.stringify(input), original);
});
