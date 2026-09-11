// Bounded playthroughs at several move-error targets, with reproducible random streams.
const assert = require('node:assert/strict');
const { loadCore, seededRandom } = require('./helpers.cjs');
const C = loadCore();
const search = { maxDepth: 2, timeMs: 80, nodeCap: 6000 };
const results = [];
for (const target of [8, 60, 140]) {
  for (const seed of [23, 47]) {
    const humanRandom = seededRandom(seed), machineRandom = seededRandom(seed + 1000);
    let state = C.newState(), model = C.createPlayerModel(), director = C.createCheatDirector();
    const events = [], machineLosses = [], humanLosses = [];
    const started = performance.now();
    for (let turn = 0; turn < 40 && !C.gameStatus(state).over; turn++) {
      assert.equal(state.turn, 'w');
      const analysis = C.analyzePosition(state, search);
      const selected = analysis.moves.map(entry => ({ ...entry, cost: Math.abs(entry.score - analysis.bestScore - target) + humanRandom() * 10 }))
        .sort((a, b) => a.cost - b.cost)[0];
      const before = state, move = selected.move;
      state = C.applyMove(state, move);
      const humanMoment = { humanSwing: C.evaluate(before) - C.evaluate(state), gaveCheck: C.isInCheck(state, 'b'), capturedValue: 0 };
      const result = C.planMachineTurn({ state, model, director, humanObservation: { before, move }, humanMoment }, {
        playerSearch: search, machineSearch: search, relocationSearch: search, randomFn: machineRandom,
      });
      if (result.event) {
        events.push(result.event);
        assert.ok(events.length <= 4);
        if (events.length > 1) assert.ok(events.at(-1).turn - events.at(-2).turn >= 6);
      }
      if (result.move) assert.ok(C.generateLegalMoves(result.beforeOfficial).some(m => C.moveKey(m) === C.moveKey(result.move)));
      if (result.diagnostics) {
        machineLosses.push(Math.min(300, result.diagnostics.chosenLoss));
        if (result.diagnostics.humanLoss !== null) humanLosses.push(Math.min(300, result.diagnostics.humanLoss));
      }
      state = result.state; model = result.model; director = result.director;
      assert.equal(state.board.filter(p => p === 'k').length, 1);
      assert.equal(state.board.filter(p => p === 'K').length, 1);
      if (!result.move) break;
    }
    const average = a => Math.round(a.reduce((sum, n) => sum + n, 0) / Math.max(1, a.length));
    const result = { playerTarget: target, seed, fullmove: state.fullmove, status: C.gameStatus(state),
      shifts: events.map(e => ({ move: e.turn, from: C.squareName(e.from), to: C.squareName(e.to), motive: e.motive })),
      measuredHumanLoss: average(humanLosses), measuredMachineLoss: average(machineLosses),
      estimatedHumanLoss: Math.round(model.meanLoss), seconds: Math.round((performance.now() - started) / 1000) };
    results.push(result); console.log(JSON.stringify(result));
  }
}
console.log(JSON.stringify({ games: results.length, complete: results.filter(r => r.status.over).length, totalShifts: results.reduce((n, r) => n + r.shifts.length, 0) }));
