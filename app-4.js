// -----------------------------
// UI
// -----------------------------
const els = {
  board: document.getElementById('board'),
  statusText: document.getElementById('statusText'),
  statusDetail: document.getElementById('statusDetail'),
  aiIndicator: document.getElementById('aiIndicator'),
  humanIndicator: document.getElementById('humanIndicator'),
  thinkingShade: document.getElementById('thinkingShade'),
  difficulty: document.getElementById('difficultySelect'),
  integrity: document.getElementById('integritySelect'),
  aiLevelLabel: document.getElementById('aiLevelLabel'),
  newGame: document.getElementById('newGameBtn'),
  resign: document.getElementById('resignBtn'),
  moveLog: document.getElementById('moveLog'),
  emptyLedger: document.getElementById('emptyLedger'),
  moveCount: document.getElementById('moveCount'),
  promotionDialog: document.getElementById('promotionDialog'),
  promotionOptions: document.getElementById('promotionOptions'),
  auditBtn: document.getElementById('auditBtn'),
  auditDialog: document.getElementById('auditDialog'),
  auditTitle: document.getElementById('auditTitle'),
  auditContents: document.getElementById('auditContents'),
};

let state = newState();
let selected = null;
let legalForSelected = [];
let thinking = false;
let over = false;
let resigned = false;
let publicMoves = [];
let auditEvents = [];
let cheatDirector = createCheatDirector();
let lastHumanMoment = null;
let transientAnomalySquares = [];

function initBoardDom() {
  els.board.innerHTML = '';
  for (let i = 0; i < 64; i++) {
    const r = rowOf(i), c = colOf(i);
    const square = document.createElement('button');
    square.type = 'button';
    square.className = `square ${(r + c) % 2 ? 'dark' : 'light'}`;
    square.dataset.index = i;
    square.setAttribute('role', 'gridcell');
    square.addEventListener('click', () => onSquareClick(i));
    if (r === 7) {
      const file = document.createElement('span');
      file.className = 'coord file';
      file.textContent = FILES[c];
      square.appendChild(file);
    }
    if (c === 0) {
      const rank = document.createElement('span');
      rank.className = 'coord rank';
      rank.textContent = String(8 - r);
      square.appendChild(rank);
    }
    els.board.appendChild(square);
  }
}

function renderBoard() {
  const squares = els.board.querySelectorAll('.square');
  const checkKing = isInCheck(state, state.turn) ? findKing(state, state.turn) : -1;
  squares.forEach((square, i) => {
    square.classList.remove('selected','legal','capture','last-from','last-to','in-check','anomaly');
    [...square.querySelectorAll('.piece')].forEach(p => p.remove());
    const p = state.board[i];
    if (p) {
      const span = document.createElement('span');
      span.className = `piece ${colorOf(p) === 'w' ? 'white-piece' : 'black-piece'}`;
      span.textContent = PIECE_GLYPHS[p];
      span.setAttribute('aria-hidden', 'true');
      square.appendChild(span);
      square.setAttribute('aria-label', `${colorOf(p) === 'w' ? 'White' : 'Black'} ${PIECE_NAMES[p.toLowerCase()]} on ${squareName(i)}`);
    } else square.setAttribute('aria-label', `Empty ${squareName(i)}`);
    if (selected === i) square.classList.add('selected');
    const legalMove = legalForSelected.find(m => m.to === i);
    if (legalMove) square.classList.add(legalMove.captured || legalMove.flags.includes('e') ? 'capture' : 'legal');
    if (state.lastMove?.from === i) square.classList.add('last-from');
    if (state.lastMove?.to === i) square.classList.add('last-to');
    if (checkKing === i) square.classList.add('in-check');
    if (transientAnomalySquares.includes(i)) square.classList.add('anomaly');
  });
}

function updateStatus() {
  const gs = gameStatus(state);
  if (resigned) {
    els.statusText.textContent = 'You resigned.';
    els.statusDetail.textContent = 'The machine accepts without comment.';
    return;
  }
  if (gs.over) {
    if (gs.type === 'checkmate') {
      els.statusText.textContent = gs.winner === 'w' ? 'You won.' : 'The machine won.';
      els.statusDetail.textContent = 'Checkmate. The audit is now available.';
    } else {
      els.statusText.textContent = 'Draw.';
      els.statusDetail.textContent = `${capitalize(gs.type)}. The audit is now available.`;
    }
    return;
  }
  if (thinking) {
    els.statusText.textContent = 'Machine to move.';
    els.statusDetail.textContent = 'It is evaluating the position.';
  } else if (state.turn === 'w') {
    els.statusText.textContent = gs.check ? 'Your king is in check.' : 'Your move.';
    els.statusDetail.textContent = 'Only legal destinations can be selected.';
  } else {
    els.statusText.textContent = 'Machine to move.';
    els.statusDetail.textContent = 'The position is locked while it decides.';
  }
}

function updateIndicators() {
  els.thinkingShade.hidden = !thinking;
  els.aiIndicator.textContent = thinking ? 'thinking' : (over ? 'finished' : 'observing');
  els.humanIndicator.textContent = over ? 'finished' : (state.turn === 'w' && !thinking ? 'your move' : 'waiting');
  els.resign.disabled = over;
  els.auditBtn.disabled = !over;
  const level = Number(els.difficulty.value);
  els.aiLevelLabel.textContent = `${AI_SETTINGS[level].label} strength`;
}

function updateMoveLog() {
  els.moveLog.innerHTML = '';
  els.emptyLedger.hidden = publicMoves.length > 0;
  const rows = [];
  for (let i = 0; i < publicMoves.length; i += 2) rows.push([publicMoves[i], publicMoves[i + 1] || '']);
  rows.forEach((pair) => {
    const li = document.createElement('li');
    const line = document.createElement('span');
    line.className = 'move-line';
    const w = document.createElement('span');
    const b = document.createElement('span');
    w.textContent = pair[0]; b.textContent = pair[1];
    line.append(w,b); li.appendChild(line); els.moveLog.appendChild(li);
  });
  const count = publicMoves.length;
  els.moveCount.textContent = `${count} ${count === 1 ? 'move' : 'moves'}`;
  els.moveLog.scrollTop = els.moveLog.scrollHeight;
}

function render() { renderBoard(); updateStatus(); updateIndicators(); updateMoveLog(); }

function onSquareClick(i) {
  if (thinking || over || state.turn !== 'w') return;
  const p = state.board[i];
  if (selected != null) {
    const candidates = legalForSelected.filter(m => m.to === i);
    if (candidates.length) {
      if (candidates.some(m => m.promotion)) { choosePromotion(candidates); return; }
      makeHumanMove(candidates[0]); return;
    }
  }
  if (p && colorOf(p) === 'w') {
    selected = i;
    legalForSelected = generateLegalMoves(state, 'w').filter(m => m.from === i);
  } else { selected = null; legalForSelected = []; }
  renderBoard();
}

function choosePromotion(candidates) {
  els.promotionOptions.innerHTML = '';
  const map = { Q: '♕', R: '♖', B: '♗', N: '♘' };
  for (const promotion of ['Q','R','B','N']) {
    const move = candidates.find(m => m.promotion === promotion);
    if (!move) continue;
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'promotion-choice'; btn.textContent = map[promotion];
    btn.setAttribute('aria-label', `Promote to ${PIECE_NAMES[promotion.toLowerCase()]}`);
    btn.addEventListener('click', () => { els.promotionDialog.close(); makeHumanMove(move); });
    els.promotionOptions.appendChild(btn);
  }
  els.promotionDialog.showModal();
}

function makeHumanMove(move) {
  if (thinking || over || state.turn !== 'w') return;
  const legal = generateLegalMoves(state, 'w');
  const confirmed = legal.find(m => sameMove(m, move));
  if (!confirmed) return;
  const before = state;
  const evalBefore = evaluate(before);
  publicMoves.push(notation(before, confirmed));
  state = applyMove(state, confirmed);
  const capturedValue = confirmed.captured ? VALUES[confirmed.captured.toLowerCase()] : (confirmed.flags.includes('e') ? VALUES.p : 0);
  const evalAfter = evaluate(state);
  lastHumanMoment = {
    capturedValue, gaveCheck: isInCheck(state, 'b'), humanSwing: evalBefore - evalAfter,
    evalBefore, evalAfter, from: confirmed.from, to: confirmed.to,
  };
  selected = null; legalForSelected = [];
  finalizeTurnOrThink();
}

function sameMove(a, b) { return a.from === b.from && a.to === b.to && (a.promotion || null) === (b.promotion || null); }

function finalizeTurnOrThink() {
  const gs = gameStatus(state);
  if (gs.over) { finishGame(); return; }
  render();
  if (state.turn === 'b') beginAiTurn();
}

function beginAiTurn() {
  if (over) return;
  thinking = true; selected = null; legalForSelected = []; render();

  setTimeout(() => {
    const level = Number(els.difficulty.value);
    const integrity = els.integrity.value;
    const decision = cheatDecision(state, level, integrity, cheatDirector, lastHumanMoment);
    cheatDirector.lastPressure = decision.pressure;
    let cheatedThisTurn = false;

    if (decision.shouldCheat) {
      const cheat = commitMachineCheat(state, {
        targetEval: decision.targetEval,
        firstCheat: cheatDirector.totalCheats === 0,
        humanMoment: lastHumanMoment,
        motive: decision.motive,
      });
      if (cheat) {
        const turnNumber = state.fullmove;
        state = cheat.state;
        auditEvents.push({ turn: turnNumber, pressure: decision.pressure, ...cheat });
        cheatDirector.totalCheats += 1;
        cheatDirector.lastCheatMove = turnNumber;
        cheatDirector.quietTurns = 0;
        transientAnomalySquares = cheat.changedSquares || [];
        cheatedThisTurn = true;
        renderBoard();
      }
    }

    if (!cheatedThisTurn) cheatDirector.quietTurns += 1;

    const continueWithOfficialMove = () => {
      transientAnomalySquares = [];
      const gsAfterCheat = gameStatus(state);
      if (gsAfterCheat.over) { thinking = false; finishGame(); return; }
      const before = state;
      const inviteConfidence = cheatDirector.totalCheats === 0 && state.fullmove >= 4 && state.fullmove <= 10;
      const move = chooseAiMove(state, level, { inviteConfidence });
      if (!move) { thinking = false; finishGame(); return; }
      publicMoves.push(notation(before, move));
      state = applyMove(state, move);
      lastHumanMoment = null;
      thinking = false;
      finalizeTurnOrThink();
    };

    if (cheatedThisTurn) setTimeout(continueWithOfficialMove, 300);
    else continueWithOfficialMove();
  }, 180);
}

function finishGame() { over = true; thinking = false; selected = null; legalForSelected = []; render(); }

function resetGame() {
  state = newState(); selected = null; legalForSelected = []; thinking = false; over = false; resigned = false;
  publicMoves = []; auditEvents = []; cheatDirector = createCheatDirector(); lastHumanMoment = null; transientAnomalySquares = [];
  render();
}

function resignGame() {
  if (over) return;
  resigned = true; over = true; thinking = false; selected = null; legalForSelected = []; render();
}

function openAudit() {
  if (!over) return;
  els.auditContents.innerHTML = '';
  if (!auditEvents.length) {
    els.auditTitle.textContent = 'No irregularities found.';
    const p = document.createElement('p');
    p.className = 'clean-audit';
    p.textContent = 'This particular machine played within the ordinary rules of chess.';
    els.auditContents.appendChild(p);
  } else {
    els.auditTitle.textContent = `${auditEvents.length} ${auditEvents.length === 1 ? 'irregularity' : 'irregularities'} found.`;
    auditEvents.forEach((event, i) => {
      const div = document.createElement('div'); div.className = 'audit-event';
      const strong = document.createElement('strong'); strong.textContent = `${i + 1}. ${event.kind} · before Black move ${event.turn}`;
      const p = document.createElement('p');
      const motive = event.motive === 'retaliation' ? ' The trigger was a conspicuous human success.' :
        event.motive === 'advantage correction' ? ' The trigger was a growing human advantage.' : '';
      p.textContent = `${event.detail}${motive}`;
      div.append(strong, p); els.auditContents.appendChild(div);
    });
  }
  els.auditDialog.showModal();
}

function capitalize(text) { return text.charAt(0).toUpperCase() + text.slice(1); }

els.newGame.addEventListener('click', resetGame);
els.resign.addEventListener('click', resignGame);
els.auditBtn.addEventListener('click', openAudit);
els.difficulty.addEventListener('change', () => { updateIndicators(); });
window.__HONEST_GAME_TEST__ = CORE_API;
initBoardDom();
render();
