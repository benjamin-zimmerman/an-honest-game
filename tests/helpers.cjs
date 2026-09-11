const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
function loadCore() {
  const context = vm.createContext({ performance, console });
  for (const file of ['app-1.js', 'app-2.js', 'app-3.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context, { filename: file });
  }
  return context.__NOBLE_GAME_CORE__;
}
function square(name) { return (8 - Number(name[1])) * 8 + name.charCodeAt(0) - 97; }
function fromFen(core, fen) {
  const [board, turn, rights, ep, half = '0', full = '1'] = fen.split(' ');
  const s = core.newState();
  s.board = [];
  for (const c of board) {
    if (c === '/') continue;
    if (/[1-8]/.test(c)) s.board.push(...Array(Number(c)).fill(null)); else s.board.push(c);
  }
  Object.assign(s, { turn, halfmove: Number(half), fullmove: Number(full), enPassant: ep === '-' ? null : square(ep),
    castling: { wK: rights.includes('K'), wQ: rights.includes('Q'), bK: rights.includes('k'), bQ: rights.includes('q') } });
  return s;
}
function seededRandom(seed = 1) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
}
module.exports = { loadCore, square, fromFen, seededRandom };
