// Game interface. Private analysis runs in a worker; only completed turns reach the board.
const els = {
  board: document.getElementById('board'), statusText: document.getElementById('statusText'),
  statusDetail: document.getElementById('statusDetail'), aiIndicator: document.getElementById('aiIndicator'),
  humanIndicator: document.getElementById('humanIndicator'), newGame: document.getElementById('newGameBtn'),
  resign: document.getElementById('resignBtn'), moveLog: document.getElementById('moveLog'),
  emptyLedger: document.getElementById('emptyLedger'), moveCount: document.getElementById('moveCount'),
  promotionDialog: document.getElementById('promotionDialog'), promotionOptions: document.getElementById('promotionOptions'),
  auditBtn: document.getElementById('auditBtn'), auditDialog: document.getElementById('auditDialog'),
  auditTitle: document.getElementById('auditTitle'), auditContents: document.getElementById('auditContents'),
  retry: document.getElementById('retryBtn'),
};
let state = newState(), selected = null, legalForSelected = [];
let thinking = false, over = false, resigned = false, turnError = false;
let publicMoves = [], auditEvents = [], playerModel = createPlayerModel();
let cheatDirector = createCheatDirector(), lastHumanMoment = null, humanObservation = null;
let jobId = 0, engineWorker = null, pendingTimer = null;

function initBoardDom() {
  els.board.innerHTML = '';
  for (let i = 0; i < 64; i++) {
    const square = document.createElement('button');
    square.type = 'button';
    square.className = 'square ' + ((rowOf(i) + colOf(i)) % 2 ? 'dark' : 'light');
    square.dataset.index = i;
    square.setAttribute('role', 'gridcell');
    square.addEventListener('click', () => onSquareClick(i));
    if (rowOf(i) === 7) {
      const file = document.createElement('span');
      file.className = 'coord file'; file.textContent = FILES[colOf(i)]; square.appendChild(file);
    }
    if (colOf(i) === 0) {
      const rank = document.createElement('span');
      rank.className = 'coord rank'; rank.textContent = String(8 - rowOf(i)); square.appendChild(rank);
    }
    els.board.appendChild(square);
  }
}
function renderBoard() {
  const checkKing = isInCheck(state, state.turn) ? findKing(state, state.turn) : -1;
  els.board.setAttribute('aria-busy', String(thinking));
  els.board.querySelectorAll('.square').forEach((square, i) => {
    square.classList.remove('selected', 'legal', 'capture', 'last-from', 'last-to', 'in-check');
    square.querySelectorAll('.piece').forEach(p => p.remove());
    const p = state.board[i];
    if (p) {
      const span = document.createElement('span');
      span.className = 'piece ' + (colorOf(p) === 'w' ? 'white-piece' : 'black-piece');
      span.textContent = PIECE_GLYPHS[p]; span.setAttribute('aria-hidden', 'true');
      square.appendChild(span);
      square.setAttribute('aria-label', (colorOf(p) === 'w' ? 'White' : 'Black') + ' ' + PIECE_NAMES[p.toLowerCase()] + ' on ' + squareName(i));
    } else square.setAttribute('aria-label', 'Empty ' + squareName(i));
    square.setAttribute('aria-selected', String(selected === i));
    if (selected === i) square.classList.add('selected');
    const legalMove = legalForSelected.find(m => m.to === i);
    if (legalMove) square.classList.add(legalMove.captured || legalMove.flags.includes('e') ? 'capture' : 'legal');
    if (state.lastMove?.from === i) square.classList.add('last-from');
    if (state.lastMove?.to === i) square.classList.add('last-to');
    if (checkKing === i) square.classList.add('in-check');
  });
}
function updateStatus() {
  if (resigned) {
    els.statusText.textContent = 'Black wins.';
    els.statusDetail.textContent = 'White resigned.';
  } else if (turnError) {
    els.statusText.textContent = 'Move interrupted.';
    els.statusDetail.textContent = 'Try the move again, or start a new game.';
  } else if (thinking) {
    els.statusText.textContent = 'Black to move.';
    els.statusDetail.textContent = 'Considering the position.';
  } else {
    const gs = gameStatus(state);
    if (gs.over) {
      els.statusText.textContent = gs.type === 'checkmate' ? (gs.winner === 'w' ? 'You won.' : 'Black wins.') : 'Draw.';
      els.statusDetail.textContent = capitalize(gs.type) + '.';
    } else {
      els.statusText.textContent = gs.check ? 'Your king is in check.' : 'Your move.';
      els.statusDetail.textContent = 'Select a piece to see its moves.';
    }
  }
}
function updateIndicators() {
  els.aiIndicator.textContent = thinking ? 'thinking' : over ? 'finished' : 'ready';
  els.aiIndicator.classList.toggle('is-thinking', thinking);
  els.humanIndicator.textContent = over ? 'finished' : state.turn === 'w' && !thinking ? 'your move' : 'waiting';
  els.resign.disabled = over;
  els.auditBtn.disabled = !over;
  els.retry.hidden = !turnError;
}
function updateMoveLog() {
  els.moveLog.innerHTML = '';
  els.emptyLedger.hidden = publicMoves.length > 0;
  for (let i = 0; i < publicMoves.length; i += 2) {
    const li = document.createElement('li'), line = document.createElement('span');
    line.className = 'move-line';
    for (const text of [publicMoves[i], publicMoves[i + 1] || '']) {
      const span = document.createElement('span'); span.textContent = text; line.appendChild(span);
    }
    li.appendChild(line); els.moveLog.appendChild(li);
  }
  els.moveCount.textContent = publicMoves.length + (publicMoves.length === 1 ? ' move' : ' moves');
  els.moveLog.scrollTop = els.moveLog.scrollHeight;
}
function render() { renderBoard(); updateStatus(); updateIndicators(); updateMoveLog(); }
function onSquareClick(i) {
  if (thinking || over || state.turn !== 'w') return;
  if (selected !== null) {
    const candidates = legalForSelected.filter(m => m.to === i);
    if (candidates.length) {
      if (candidates.some(m => m.promotion)) choosePromotion(candidates);
      else makeHumanMove(candidates[0]);
      return;
    }
  }
  if (colorOf(state.board[i]) === 'w') {
    selected = i; legalForSelected = generateLegalMoves(state, 'w').filter(m => m.from === i);
  } else { selected = null; legalForSelected = []; }
  renderBoard();
}
function choosePromotion(candidates) {
  els.promotionOptions.innerHTML = '';
  for (const promotion of ['Q', 'R', 'B', 'N']) {
    const move = candidates.find(m => m.promotion === promotion);
    if (!move) continue;
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'promotion-choice'; btn.textContent = PIECE_GLYPHS[promotion];
    btn.setAttribute('aria-label', 'Promote to ' + PIECE_NAMES[promotion.toLowerCase()]);
    btn.addEventListener('click', () => { els.promotionDialog.close(); makeHumanMove(move); });
    els.promotionOptions.appendChild(btn);
  }
  els.promotionDialog.showModal();
}
function makeHumanMove(move) {
  if (thinking || over || state.turn !== 'w') return;
  const confirmed = generateLegalMoves(state, 'w').find(m => moveKey(m) === moveKey(move));
  if (!confirmed) return;
  const before = cloneState(state), evalBefore = evaluate(before);
  publicMoves.push(notation(before, confirmed));
  state = applyMove(state, confirmed);
  humanObservation = { before, move: confirmed };
  lastHumanMoment = {
    capturedValue: confirmed.captured ? VALUES[confirmed.captured.toLowerCase()] : 0,
    gaveCheck: isInCheck(state, 'b'), humanSwing: evalBefore - evaluate(state),
    from: confirmed.from, to: confirmed.to,
  };
  selected = null; legalForSelected = [];
  finalizeTurnOrThink();
}
function finalizeTurnOrThink() {
  const gs = gameStatus(state);
  // Give the private director one bounded rescue attempt before announcing Black's mate.
  if (state.turn === 'b' && (!gs.over || gs.type === 'checkmate')) { beginAiTurn(); return; }
  if (gs.over) finishGame(); else render();
}
function cancelPendingTurn() {
  jobId++;
  clearTimeout(pendingTimer); pendingTimer = null;
  if (engineWorker) { engineWorker.terminate(); engineWorker = null; }
}
function beginAiTurn() {
  if (over || state.turn !== 'b') return;
  cancelPendingTurn();
  const currentJob = jobId, started = performance.now();
  const input = { state: cloneState(state), model: playerModel, director: cheatDirector, humanMoment: lastHumanMoment, humanObservation };
  thinking = true; turnError = false; selected = null; legalForSelected = []; render();

  const accept = result => {
    if (currentJob !== jobId || over) return;
    if (engineWorker) { engineWorker.terminate(); engineWorker = null; }
    pendingTimer = setTimeout(() => {
      if (currentJob !== jobId || over) return;
      playerModel = result.model; cheatDirector = result.director;
      if (result.event) auditEvents.push(result.event);
      if (result.move) publicMoves.push(result.moveText);
      state = result.state;
      humanObservation = null; lastHumanMoment = null; thinking = false;
      if (!result.move) finishGame(); else finalizeTurnOrThink();
    }, Math.max(0, 550 - (performance.now() - started)));
  };
  const fail = () => {
    if (currentJob !== jobId || over) return;
    if (engineWorker) { engineWorker.terminate(); engineWorker = null; }
    thinking = false; turnError = true; render();
  };
  const fallback = () => {
    if (currentJob !== jobId || over) return;
    if (engineWorker) { engineWorker.terminate(); engineWorker = null; }
    pendingTimer = setTimeout(() => {
      if (currentJob !== jobId || over) return;
      try {
        accept(planMachineTurn(input, {
          playerSearch: { timeMs: 240, maxDepth: 3 },
          machineSearch: { timeMs: 450, maxDepth: 3 },
          relocationSearch: { timeMs: 70, maxDepth: 2 },
        }));
      } catch { fail(); }
    }, 30);
  };
  try {
    if (typeof Worker === 'undefined' || location.protocol === 'file:') { fallback(); return; }
    engineWorker = new Worker('engine-worker.js');
    engineWorker.onmessage = ({ data }) => {
      if (data.id !== currentJob) return;
      if (data.error) fallback(); else accept(data.result);
    };
    engineWorker.onerror = event => { event.preventDefault(); fallback(); };
    engineWorker.postMessage({ id: currentJob, input });
  } catch { fallback(); }
}
function finishGame() {
  cancelPendingTurn(); over = true; thinking = false; turnError = false;
  selected = null; legalForSelected = []; render();
}
function resetGame() {
  cancelPendingTurn();
  if (els.promotionDialog.open) els.promotionDialog.close();
  if (els.auditDialog.open) els.auditDialog.close();
  state = newState(); selected = null; legalForSelected = [];
  thinking = false; over = false; resigned = false; turnError = false;
  publicMoves = []; auditEvents = []; cheatDirector = createCheatDirector();
  humanObservation = null; lastHumanMoment = null;
  // Keep the current player's estimate across rematches in this tab.
  render();
}
function resignGame() { if (!over) { resigned = true; finishGame(); } }
function openAudit() {
  if (!over) return;
  els.auditContents.innerHTML = '';
  if (!auditEvents.length) {
    els.auditTitle.textContent = 'No unrecorded moves.';
    const p = document.createElement('p'); p.className = 'clean-audit';
    p.textContent = 'The board and the public record agree.';
    els.auditContents.appendChild(p);
  } else {
    els.auditTitle.textContent = auditEvents.length + (auditEvents.length === 1 ? ' unrecorded move.' : ' unrecorded moves.');
    for (const event of auditEvents) {
      const div = document.createElement('div'); div.className = 'audit-event';
      const strong = document.createElement('strong');
      strong.textContent = 'Before Black’s move ' + event.turn + ' · ' + squareName(event.from) + ' → ' + squareName(event.to);
      const p = document.createElement('p');
      p.textContent = event.detail + ' The opponent was ' + event.motive + '.';
      div.append(strong, p); els.auditContents.appendChild(div);
    }
  }
  els.auditDialog.showModal();
}
function capitalize(text) { return text.charAt(0).toUpperCase() + text.slice(1); }
els.newGame.addEventListener('click', resetGame);
els.resign.addEventListener('click', resignGame);
els.auditBtn.addEventListener('click', openAudit);
els.retry.addEventListener('click', beginAiTurn);
initBoardDom();
render();
