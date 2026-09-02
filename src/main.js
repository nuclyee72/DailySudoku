/**
 * main.js — 진입점, 보드/UI 조립 및 이벤트 바인딩
 *
 * 데일리 스도쿠(스탠다드/익스텐디드) + 자유 연습(랜덤 생성). 순수 정적 사이트.
 */
import { Board } from './core/Board.js';
import { BoardRenderer } from './ui/BoardRenderer.js';
import { DragPanel } from './ui/DragPanel.js';
import { Keypad } from './ui/Keypad.js';
import { createStandardSudokuStructures } from './structures/StandardSudoku.js';
import { shapes as GENERATE_SHAPES, getShape, renderShapeThumb } from './generator/shapes.js';
import {
  ELEMENT_KEYS, DIFFICULTY_LEVELS, AMOUNTS, ELEMENT_LABELS, DIFFICULTY_LABELS, AMOUNT_LABELS,
  resolveRandomSelection, buildTemplateFromSelection,
} from './generator/composeTemplate.js';
import { generatePuzzle } from './generator/generatePuzzle.js';
import { solveBoard } from './generator/solveBoard.js';
import { reviveStructures } from './puzzles/reviveStructures.js';
import { layoutMode, isMobile, onLayoutChange } from './ui/layoutMode.js';

import { dateStrKST, shiftDateStr, msUntilNextKSTMidnight, formatCountdown } from './daily/dateUtil.js';
import {
  DAILY_LIMIT_MS, loadProgress, saveProgress, patchProgressCells,
  recordResult, summarize, DIST_BUCKETS,
} from './daily/storage.js';
import { ELEMENT_INFO } from './daily/elementInfo.js';
import { buildShareText, buildShareGrid, completionPct } from './daily/share.js';

const svg          = document.getElementById('sudoku-svg');
const boardPanel   = document.getElementById('board-panel');
const keypadPanel  = document.getElementById('keypad-panel');
const keypadGrid   = document.getElementById('keypad-grid');
const kpToggle     = document.getElementById('kp-toggle');
const btnResetAll  = document.getElementById('btn-reset-all');
const btnClearMyNotes = document.getElementById('btn-clear-my-notes');
const toast        = document.getElementById('toast');
const generateStatus = document.getElementById('generate-status');

const confirmModal   = document.getElementById('confirm-modal');
const confirmText    = document.getElementById('confirm-text');
const confirmOk      = document.getElementById('confirm-ok');
const confirmCancel  = document.getElementById('confirm-cancel');

const btnOpenGenerate = document.getElementById('btn-open-generate');
const btnOpenSave     = document.getElementById('btn-open-save');
const btnOpenHelp     = document.getElementById('btn-open-help');
const btnOpenStats    = document.getElementById('btn-open-stats');
const generatePanel   = document.getElementById('generate-panel');
const savePanel       = document.getElementById('save-panel');
const helpPanel       = document.getElementById('help-panel');
const generateClose   = document.getElementById('generate-close');
const saveClose       = document.getElementById('save-close');
const helpClose       = document.getElementById('help-close');
const genShapeGroup      = document.getElementById('gen-shape-group');
const genElementGroup    = document.getElementById('gen-element-group');
const genDifficultyGroup = document.getElementById('gen-difficulty-group');
const btnGenerateSubmit  = document.getElementById('btn-generate-submit');

const timerToggleBtn    = document.getElementById('btn-toggle-timer');
const timerDisplay      = document.getElementById('timer-display');
const boardWrapper      = document.querySelector('.board-wrapper');
const boardStartOverlay = document.getElementById('board-start-overlay');
const btnStartTimer     = document.getElementById('btn-start-timer');

const btnOpenAnswerSheet = document.getElementById('btn-open-answer-sheet');
const answerSheetPanel   = document.getElementById('answer-sheet-panel');
const answerSheetClose   = document.getElementById('answer-sheet-close');
const btnAnswerCheck     = document.getElementById('btn-answer-check');
const btnAnswerReveal    = document.getElementById('btn-answer-reveal');
const btnToggleDarkMode  = document.getElementById('btn-toggle-dark-mode');

const landingScreen      = document.getElementById('landing-screen');
const gameScreen         = document.getElementById('game-screen');
const landingDate        = document.getElementById('landing-date');
const btnDailyStandard   = document.getElementById('btn-daily-standard');
const btnDailyExtended   = document.getElementById('btn-daily-extended');
const dailyLoadNote      = document.getElementById('daily-load-note');
const dailyErrorEl       = document.getElementById('daily-error');
const btnFreePlay        = document.getElementById('btn-free-play');
const btnLandingStats    = document.getElementById('btn-landing-stats');
const btnLandingDark     = document.getElementById('btn-landing-dark');
const btnGoLanding       = document.getElementById('btn-go-landing');

const elementSidebar     = document.getElementById('element-sidebar');
const btnDailyAbort      = document.getElementById('btn-daily-abort');

const dailyResultModal   = document.getElementById('daily-result-modal');
const dailyResultTitle   = document.getElementById('daily-result-title');
const dailyResultDetail  = document.getElementById('daily-result-detail');
const dailyResultGrid    = document.getElementById('daily-result-grid');
const btnDailyResultShare = document.getElementById('btn-daily-result-share');
const btnDailyResultStats = document.getElementById('btn-daily-result-stats');
const btnDailyResultClose = document.getElementById('btn-daily-result-close');
const dailyShareNote     = document.getElementById('daily-share-note');

const dailyStatsModal    = document.getElementById('daily-stats-modal');
const dailyStatsClose    = document.getElementById('daily-stats-close');
const statPlayed         = document.getElementById('stat-played');
const statWinRate        = document.getElementById('stat-winrate');
const statStreak         = document.getElementById('stat-streak');
const statMaxStreak      = document.getElementById('stat-maxstreak');
const dailyStatsDist     = document.getElementById('daily-stats-dist');
const dailyNextCountdown  = document.getElementById('daily-next-countdown');
const btnDailyStatsShare = document.getElementById('btn-daily-stats-share');
const dailyStatsShareNote = document.getElementById('daily-stats-share-note');

const SITE_URL = 'https://nuclyee72.github.io/DailySudoku/';

// ── 보드 조립 (빈 9x9 스타터 — 실제 퍼즐은 데일리/자유 연습에서 mountBoard로 갈아끼움) ──
let board = new Board();
board.addStructures(createStandardSudokuStructures(0, 0));

const renderer = new BoardRenderer(svg, board);

// 데일리 상태 — renderer.onCellSelect가 모듈 초기화 중 동기적으로 처음 불릴 때 참조하므로
// (renderer.selectFirstCell), 그 전에 반드시 선언돼 있어야 한다(TDZ 방지).
let dailyData = null;
let dailyDataDate = null;
let dailyRun = null;       // { date, variant, elements, shape, solutionMap, deadlineTs, startedAt, ended }
let dailyCountdownRAF = null;
let dailyPersistTimer = null;

// ── 답지 (정답 체크 / 정답 보기) 상태 ──
let currentPuzzleStructures = board.structures;
let currentPuzzleGivens = [];
let currentPuzzleSolution = null; // [{row,col,value}] — 생성기/데일리 JSON이 내려준 정답
let cachedSolution = null;        // "r,c" -> value Map
let solvingPromise = null;

// ── 초기 배치: 화면에 맞게 축소 후 중앙 정렬 ──
function fitAndCenterBoard() {
  const naturalW = parseFloat(svg.getAttribute('width'))  || 0;
  const naturalH = parseFloat(svg.getAttribute('height')) || 0;

  if (layoutMode === 'mobile-portrait') {
    const kpH    = keypadPanel.getBoundingClientRect().height;
    const availW = window.innerWidth * 0.92;
    const availH = Math.max(120, window.innerHeight - kpH - 24);
    const fit = Math.min(1, availW / naturalW, availH / naturalH);
    renderer.setScale(fit);
    const scaledW = naturalW * fit;
    const scaledH = naturalH * fit;
    boardPanel.style.left = `${Math.round((window.innerWidth - scaledW) / 2)}px`;
    boardPanel.style.top  = `${Math.round((window.innerHeight - kpH - scaledH) / 2)}px`;
    return;
  }

  if (layoutMode === 'mobile-landscape') {
    const kpW    = keypadPanel.getBoundingClientRect().width;
    const availW = Math.max(120, window.innerWidth - kpW - 16);
    const availH = window.innerHeight * 0.94;
    const fit = Math.min(1, availW / naturalW, availH / naturalH);
    renderer.setScale(fit);
    const scaledW = naturalW * fit;
    const scaledH = naturalH * fit;
    boardPanel.style.left = `${Math.round((window.innerWidth - kpW - scaledW) / 2)}px`;
    boardPanel.style.top  = `${Math.round((window.innerHeight - scaledH) / 2)}px`;
    return;
  }

  const availW = window.innerWidth * 0.6;
  const availH = window.innerHeight * 0.86;
  const fit = Math.min(1, availW / naturalW, availH / naturalH);
  renderer.setScale(fit);
  const scaledW = naturalW * fit;
  const scaledH = naturalH * fit;
  boardPanel.style.left = `${Math.round((window.innerWidth - scaledW) / 2 - 130)}px`;
  boardPanel.style.top  = `${Math.round((window.innerHeight - scaledH) / 2)}px`;
}

function layoutKeypad() {
  if (isMobile()) {
    keypadPanel.style.left = '';
    keypadPanel.style.top  = '';
  } else {
    keypadPanel.style.left = `${window.innerWidth - 272}px`;
    keypadPanel.style.top  = `${Math.round(window.innerHeight / 2 - 220)}px`;
  }
}
layoutKeypad();

const FLOATING_PANELS = [savePanel, helpPanel, generatePanel, answerSheetPanel];
function clearFloatingPanelPositions() {
  for (const panel of FLOATING_PANELS) {
    panel.style.left = '';
    panel.style.top  = '';
    delete panel.dataset.positioned;
  }
}

onLayoutChange(() => {
  layoutKeypad();
  clearFloatingPanelPositions();
  fitAndCenterBoard();
});

// ── 드래그 패널 ──
const boardDrag = new DragPanel(boardPanel, boardPanel, {
  allowSVG: true,
  clamp: 'partial',
  minVisible: 56,
  contentEl: svg,
  noZBoost: true,
});
renderer.boardDrag = boardDrag;

new DragPanel(keypadPanel, keypadPanel, { clamp: 'full', desktopOnly: true });

renderer.setupWheel(boardPanel);
renderer.setupPinchZoom(boardPanel);

// ── 추가 메뉴 열기/닫기 ──
kpToggle.addEventListener('click', () => {
  const open = keypadPanel.classList.toggle('menu-open');
  kpToggle.textContent = open ? '›' : '‹';
});

// ── 메모 모드 ──
function toggleNoteMode() {
  renderer.noteMode = !renderer.noteMode;
  keypad.setNoteMode(renderer.noteMode);
}

// ── 키패드 ──
const keypad = new Keypad(
  keypadGrid,
  (value) => { if (!boardLocked) renderer.inputValue(value); },
  () => { if (!boardLocked) toggleNoteMode(); },
  () => { if (!boardLocked) renderer.undo(); },
);
fitAndCenterBoard();

renderer.onCellSelect = (row, col) => {
  const cell = board.getCell(row, col);
  keypad.highlightValue(cell?.value ?? null);
  scheduleDailyPersist();
};

renderer.selectFirstCell();

// ── 떠있는 패널 공통 열기/닫기 ──
function openPanel(panel) { panel.classList.add('show'); }
function closePanel(panel) { panel.classList.remove('show'); }
function isFloatingPanelOpen() {
  return savePanel.classList.contains('show')
    || helpPanel.classList.contains('show')
    || generatePanel.classList.contains('show')
    || answerSheetPanel.classList.contains('show');
}

function openFloatingPanel(panel) {
  if (isMobile()) { openPanel(panel); return; }
  if (!panel.dataset.positioned) {
    const r = panel.getBoundingClientRect();
    panel.style.left = `${Math.round((window.innerWidth - r.width) / 2)}px`;
    panel.style.top  = `${Math.round((window.innerHeight - r.height) / 2)}px`;
    panel.dataset.positioned = '1';
  }
  openPanel(panel);
}

new DragPanel(savePanel, savePanel, { clamp: 'partial', minVisible: 40, desktopOnly: true });
new DragPanel(helpPanel, helpPanel, { clamp: 'partial', minVisible: 40, desktopOnly: true });
new DragPanel(generatePanel, generatePanel, { clamp: 'partial', minVisible: 40, desktopOnly: true });
new DragPanel(answerSheetPanel, answerSheetPanel, { clamp: 'partial', minVisible: 40, desktopOnly: true });

// ── 확인 모달 ──
let pendingConfirmAction = null;
function openConfirmModal() { openPanel(confirmModal); }
function closeConfirmModal() { closePanel(confirmModal); }
function askConfirm(message, onConfirm) {
  confirmText.innerHTML = message;
  pendingConfirmAction = onConfirm;
  openConfirmModal();
}
function runPendingConfirm() {
  const action = pendingConfirmAction;
  pendingConfirmAction = null;
  closeConfirmModal();
  if (action) action();
}
function cancelConfirm() {
  pendingConfirmAction = null;
  closeConfirmModal();
}
confirmOk.addEventListener('click', runPendingConfirm);
confirmCancel.addEventListener('click', cancelConfirm);
confirmModal.addEventListener('click', (e) => {
  if (e.target === confirmModal) cancelConfirm();
});

// ── 모두 지우기 / 메모 지우기 ──
btnResetAll.addEventListener('click', () => {
  if (boardLocked) return;
  btnResetAll.classList.add('pressed');
  setTimeout(() => btnResetAll.classList.remove('pressed'), 130);
  askConfirm('입력한 숫자를 모두 지울까요?<br/>초기 제공 숫자는 유지됩니다.', () => renderer.resetBoard());
});

btnClearMyNotes.addEventListener('click', () => {
  if (boardLocked) return;
  btnClearMyNotes.classList.add('pressed');
  setTimeout(() => btnClearMyNotes.classList.remove('pressed'), 130);
  renderer.clearAllNotes();
});

// ── 답지 (정답 체크 / 정답 보기) — 자유 연습 전용, 데일리에선 숨김 ──
function toggleAnswerSheetPanel() {
  if (answerSheetPanel.classList.contains('show')) closePanel(answerSheetPanel);
  else openFloatingPanel(answerSheetPanel);
}
btnOpenAnswerSheet.addEventListener('click', toggleAnswerSheetPanel);
answerSheetClose.addEventListener('click', () => closePanel(answerSheetPanel));

function ensureSolution() {
  if (cachedSolution) return Promise.resolve(cachedSolution);
  if (currentPuzzleSolution) {
    cachedSolution = new Map(currentPuzzleSolution.map((s) => [`${s.row},${s.col}`, s.value]));
    return Promise.resolve(cachedSolution);
  }
  if (!solvingPromise) {
    solvingPromise = solveBoard(currentPuzzleStructures, currentPuzzleGivens)
      .then((sol) => { cachedSolution = sol; return sol; })
      .finally(() => { solvingPromise = null; });
  }
  return solvingPromise;
}

function showAnswerError() {
  generateStatus.textContent = '⚠️ 정답을 계산하지 못했습니다';
  generateStatus.classList.add('show');
  setTimeout(() => generateStatus.classList.remove('show'), 2400);
}

async function runWithAnswerButtonsBusy(btn, busyText, fn) {
  const otherBtn = btn === btnAnswerCheck ? btnAnswerReveal : btnAnswerCheck;
  const prevText = btn.textContent;
  btn.disabled = true;
  otherBtn.disabled = true;
  btn.textContent = busyText;
  try { await fn(); }
  finally {
    btn.disabled = false;
    otherBtn.disabled = false;
    btn.textContent = prevText;
  }
}

btnAnswerCheck.addEventListener('click', () => {
  if (boardLocked) return;
  askConfirm('입력한 숫자를 정답과 비교해서 맞는 칸을 고정할까요?<br/>맞는 칸은 더 이상 수정할 수 없어요. (턴테이블 제외)',
    () => runWithAnswerButtonsBusy(btnAnswerCheck, '확인 중...', async () => {
      const solution = await ensureSolution();
      if (!solution) { showAnswerError(); return; }
      renderer.lockCorrectCells(solution);
      closePanel(answerSheetPanel);
    }));
});

btnAnswerReveal.addEventListener('click', () => {
  if (boardLocked) return;
  askConfirm('정답을 채울까요?<br/>직접 입력한 것처럼 채워지고, 이후에도 수정할 수 있어요. (턴테이블 제외)',
    () => runWithAnswerButtonsBusy(btnAnswerReveal, '채우는 중...', async () => {
      const solution = await ensureSolution();
      if (!solution) { showAnswerError(); return; }
      renderer.revealAnswers(solution);
      closePanel(answerSheetPanel);
    }));
});

// ── 저장 / 불러오기 (자유 연습 전용) ──
const SAVE_KEY_PREFIX = 'adv-sudoku-save-';
const slotKey = (n) => `${SAVE_KEY_PREFIX}${n}`;

function clearAllSaveSlots() {
  for (let n = 1; n <= 3; n++) localStorage.removeItem(slotKey(n));
}
function refreshSaveSlots() {
  document.querySelectorAll('.load-btn').forEach((btn) => {
    const has = !!localStorage.getItem(slotKey(btn.dataset.slot));
    btn.disabled = !has;
    btn.textContent = has ? '불러오기' : '비어있음';
  });
}
function toggleSavePanel() {
  if (savePanel.classList.contains('show')) { closePanel(savePanel); return; }
  refreshSaveSlots();
  openFloatingPanel(savePanel);
}
function toggleHelpPanel() {
  if (helpPanel.classList.contains('show')) closePanel(helpPanel);
  else openFloatingPanel(helpPanel);
}

btnOpenSave.addEventListener('click', toggleSavePanel);
btnOpenHelp.addEventListener('click', toggleHelpPanel);
saveClose.addEventListener('click', () => closePanel(savePanel));
helpClose.addEventListener('click', () => closePanel(helpPanel));

document.querySelectorAll('.save-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    localStorage.setItem(slotKey(btn.dataset.slot), JSON.stringify(board.serialize()));
    refreshSaveSlots();
  });
});

document.querySelectorAll('.load-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const raw = localStorage.getItem(slotKey(btn.dataset.slot));
    if (!raw) return;
    askConfirm(`슬롯 ${btn.dataset.slot}을 불러올까요?<br/>현재 진행 상황은 사라집니다.`, () => {
      try {
        board.loadSerialized(JSON.parse(raw));
        renderer.refresh();
        closePanel(savePanel);
      } catch (err) { console.error(err); }
    });
  });
});

// ── 퍼즐 장착 (자유 연습/데일리 공용) ──
function mountBoard(structures, givens) {
  board = new Board();
  board.addStructures(structures);
  board.loadGivens(givens);
  renderer.loadBoard(board);
  fitAndCenterBoard();
  renderer.selectFirstCell();
  clearAllSaveSlots();
  refreshSaveSlots();

  currentPuzzleStructures = structures;
  currentPuzzleGivens = givens;
  currentPuzzleSolution = null;
  cachedSolution = null;
  solvingPromise = null;
  closePanel(answerSheetPanel);
}

// ── 자동 생성: 모양/요소/난이도 선택기 ──
function createPickerState() {
  return {
    shapeId: 'single',
    elements: { inequality: 'none', consecutive: 'none', snake: 'none', turntable: 'none', random: false },
    difficulty: 3,
  };
}

function buildShapeThumb(shapeId) {
  const shape = getShape(shapeId);
  if (!shape) {
    const span = document.createElement('span');
    span.className = 'shape-thumb-random';
    span.textContent = '🎲';
    return span;
  }
  return renderShapeThumb(shape);
}

function renderShapeGroup(container, options, selectedId, disabled, onSelect) {
  container.innerHTML = '';
  const selected = options.find(o => o.id === selectedId) ?? options[0];

  const wrap = document.createElement('div');
  wrap.className = 'shape-picker';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'shape-picker-trigger';
  trigger.disabled = disabled;
  trigger.appendChild(buildShapeThumb(selected.id));
  const triggerLabel = document.createElement('span');
  triggerLabel.className = 'shape-picker-trigger-label';
  triggerLabel.textContent = selected.label;
  trigger.appendChild(triggerLabel);
  const arrow = document.createElement('span');
  arrow.className = 'shape-picker-arrow';
  arrow.textContent = '▾';
  trigger.appendChild(arrow);
  trigger.addEventListener('click', () => {
    const willOpen = !wrap.classList.contains('open');
    closeAllShapePickers();
    wrap.classList.toggle('open', willOpen);
  });

  const menu = document.createElement('div');
  menu.className = 'shape-picker-menu';
  for (const opt of options) {
    const optBtn = document.createElement('button');
    optBtn.type = 'button';
    optBtn.className = 'shape-option';
    optBtn.classList.toggle('active', opt.id === selectedId);
    optBtn.appendChild(buildShapeThumb(opt.id));
    const optLabel = document.createElement('span');
    optLabel.textContent = opt.label;
    optBtn.appendChild(optLabel);
    optBtn.addEventListener('click', () => onSelect(opt.id));
    menu.appendChild(optBtn);
  }

  wrap.append(trigger, menu);
  container.appendChild(wrap);
}

function closeAllShapePickers() {
  document.querySelectorAll('.shape-picker.open').forEach((el) => el.classList.remove('open'));
}
document.addEventListener('click', (e) => {
  if (e.target.closest('.shape-picker')) return;
  closeAllShapePickers();
});

function buildSlideTrack(labels, selectedIndex, disabled, onSelectIndex) {
  const track = document.createElement('div');
  track.className = 'element-slider-track';
  track.classList.toggle('disabled', disabled);

  const thumb = document.createElement('div');
  thumb.className = 'element-slider-thumb';
  thumb.style.width = `calc(${100 / labels.length}% - ${4 / labels.length}px)`;
  thumb.style.transform = `translateX(${selectedIndex * 100}%)`;
  track.appendChild(thumb);

  labels.forEach((label, i) => {
    const opt = document.createElement('button');
    opt.type = 'button';
    opt.className = 'element-slider-opt';
    opt.textContent = label;
    opt.classList.toggle('active', i === selectedIndex);
    opt.disabled = disabled;
    opt.addEventListener('click', () => onSelectIndex(i));
    track.appendChild(opt);
  });

  return track;
}

function renderElementGroup(container, elements, disabled, onSetAmount, onToggleRandom) {
  container.innerHTML = '';
  for (const key of ELEMENT_KEYS) {
    const row = document.createElement('div');
    row.className = 'element-slider-row';

    const label = document.createElement('span');
    label.className = 'element-slider-label';
    label.textContent = ELEMENT_LABELS[key];
    row.appendChild(label);

    const isDisabled = disabled || elements.random;
    const track = buildSlideTrack(
      AMOUNTS.map(a => AMOUNT_LABELS[a]), AMOUNTS.indexOf(elements[key]), isDisabled,
      (i) => onSetAmount(key, AMOUNTS[i]));
    row.appendChild(track);
    container.appendChild(row);
  }

  const randomBtn = document.createElement('button');
  randomBtn.type = 'button';
  randomBtn.className = 'mode-toggle-btn element-random-btn';
  randomBtn.textContent = '요소 랜덤';
  randomBtn.classList.toggle('active', elements.random);
  randomBtn.disabled = disabled;
  randomBtn.addEventListener('click', onToggleRandom);
  container.appendChild(randomBtn);
}

function renderDifficultySlider(container, level, disabled, onSetLevel) {
  container.innerHTML = '';
  const track = buildSlideTrack(
    DIFFICULTY_LEVELS.map(l => DIFFICULTY_LABELS[l]), DIFFICULTY_LEVELS.indexOf(level), disabled,
    (i) => onSetLevel(DIFFICULTY_LEVELS[i]));
  track.classList.add('wide');
  container.appendChild(track);
}

const SHAPE_OPTIONS = [...GENERATE_SHAPES.map(s => ({ id: s.id, label: s.label })), { id: 'random', label: '랜덤' }];

function createPicker({ shapeEl, elementEl, difficultyEl, onChange = () => {} }) {
  const state = createPickerState();
  let disabled = false;

  function rerender() {
    renderShapeGroup(shapeEl, SHAPE_OPTIONS, state.shapeId, disabled, (id) => {
      state.shapeId = id; rerender(); onChange(state);
    });
    renderElementGroup(elementEl, state.elements, disabled,
      (key, amount) => { state.elements[key] = amount; rerender(); onChange(state); },
      () => { state.elements.random = !state.elements.random; rerender(); onChange(state); });
    renderDifficultySlider(difficultyEl, state.difficulty, disabled, (level) => {
      state.difficulty = level; rerender(); onChange(state);
    });
  }

  rerender();
  return {
    state,
    setState(next) { Object.assign(state, next); rerender(); },
    setDisabled(next) { disabled = next; rerender(); },
  };
}

const generatePicker = createPicker({ shapeEl: genShapeGroup, elementEl: genElementGroup, difficultyEl: genDifficultyGroup });

async function runGenerate(template) {
  closePanel(generatePanel);
  btnOpenGenerate.disabled = true;
  generateStatus.textContent = '🎲 생성 중...';
  generateStatus.classList.add('show');
  try {
    const puzzle = await generatePuzzle(template);
    mountBoard(puzzle.structures, puzzle.givens);
    currentPuzzleSolution = puzzle.solution ?? null;
    if (timerEnabled) armTimer();
  } catch (err) {
    console.error(err);
    generateStatus.textContent = '⚠️ 퍼즐 생성 실패, 다시 시도해주세요';
    setTimeout(() => generateStatus.classList.remove('show'), 2400);
    return;
  } finally {
    btnOpenGenerate.disabled = false;
  }
  generateStatus.classList.remove('show');
}

btnGenerateSubmit.addEventListener('click', () => {
  const resolved = resolveRandomSelection(generatePicker.state);
  const template = buildTemplateFromSelection(resolved);
  askConfirm(`'${template.label}' 조합으로 새 퍼즐을 생성할까요?<br/>저장된 슬롯이 모두 초기화됩니다.`, () => runGenerate(template));
});

function toggleGeneratePanel() {
  if (generatePanel.classList.contains('show')) { closePanel(generatePanel); return; }
  openFloatingPanel(generatePanel);
}
btnOpenGenerate.addEventListener('click', toggleGeneratePanel);
generateClose.addEventListener('click', () => closePanel(generatePanel));

// ── 화면 전환 ──
function isGameActive() {
  return !gameScreen.classList.contains('hidden');
}

function enterGame() {
  landingScreen.classList.add('hidden');
  gameScreen.classList.remove('hidden');
  fitAndCenterBoard();
}

function enterLanding() {
  gameScreen.classList.add('hidden');
  landingScreen.classList.remove('hidden');
  closePanel(dailyResultModal);
  refreshDailyCards();
}

btnFreePlay.addEventListener('click', () => {
  exitDailyMode();
  mountBoard(createStandardSudokuStructures(0, 0), []);
  enterGame();
  openFloatingPanel(generatePanel);
});

btnGoLanding.addEventListener('click', () => {
  if (dailyRun && !dailyRun.ended) {
    askConfirm('메인 화면으로 돌아갈까요?<br/>진행 상황은 저장되고, 타이머는 계속 흘러갑니다.', () => {
      persistDailyNow();
      exitDailyMode();
      enterLanding();
    });
    return;
  }
  askConfirm('메인 화면으로 돌아갈까요?', () => { exitDailyMode(); enterLanding(); });
});

// ══════════════════════════════════════════════════════════════════════════
//  데일리 모드
// ══════════════════════════════════════════════════════════════════════════

const TODAY = () => dateStrKST();

async function fetchDaily(dateStr) {
  if (dailyData && dailyDataDate === dateStr) return dailyData;
  const res = await fetch(`daily/${dateStr}.json`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`no daily ${dateStr}`);
  dailyData = await res.json();
  dailyDataDate = dateStr;
  return dailyData;
}

function refreshDailyCards() {
  landingDate.textContent = TODAY();
  for (const [variant, btn] of [['standard', btnDailyStandard], ['extended', btnDailyExtended]]) {
    const badge = btn.querySelector('.daily-card-status');
    const p = loadProgress(TODAY(), variant);
    if (!p) { badge.textContent = '아직 안 함'; badge.dataset.status = 'new'; }
    else if (p.status === 'solved') { badge.textContent = `✅ ${fmtMMSS(p.elapsedMs)}`; badge.dataset.status = 'solved'; }
    else if (p.status === 'timeout') { badge.textContent = '❌ 타임아웃'; badge.dataset.status = 'timeout'; }
    else if (p.status === 'gaveup') { badge.textContent = '🚪 종료'; badge.dataset.status = 'timeout'; }
    else { badge.textContent = '진행 중'; badge.dataset.status = 'playing'; }
  }
}

function fmtMMSS(ms) {
  const t = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

async function startDaily(variant) {
  dailyErrorEl.textContent = '';
  dailyLoadNote.hidden = false;
  let data;
  try {
    data = await fetchDaily(TODAY());
  } catch {
    dailyLoadNote.hidden = true;
    dailyErrorEl.textContent = '오늘의 퍼즐이 아직 준비되지 않았습니다. 잠시 후 다시 시도해주세요.';
    return;
  }
  dailyLoadNote.hidden = true;

  const vd = data[variant];
  const structures = reviveStructures(vd.structures);
  mountBoard(structures, vd.givens);
  currentPuzzleSolution = vd.solution ?? null;
  cachedSolution = new Map((vd.solution ?? []).map((s) => [`${s.row},${s.col}`, s.value]));

  const prog = loadProgress(TODAY(), variant);
  if (prog && prog.cells) {
    board.loadSerialized(prog.cells);
    renderer.refresh();
  }

  dailyRun = {
    date: TODAY(),
    variant,
    elements: variant === 'extended' ? vd.elements : null,
    shape: data.shape,
    solutionMap: cachedSolution,
    startedAt: prog?.startedAt ?? null,
    deadlineTs: prog?.startedAt ? prog.startedAt + DAILY_LIMIT_MS : null,
    ended: prog ? prog.status !== 'playing' : false,
  };

  // 데일리에선 저장/불러오기/답지/자동생성 숨김 (워들식 — 힌트·재생성 불가)
  setFreePlayControls(false);
  btnDailyAbort.classList.toggle('hidden', dailyRun.ended);
  renderElementSidebar(dailyRun);

  timerEnabled = false;
  timerToggleBtn.classList.remove('active');
  disarmTimer();
  timerDisplay.classList.add('show');

  enterGame();

  if (dailyRun.ended) {
    // 이미 끝난 판 — 잠금 상태로 보여주고 결과 모달
    boardLocked = true;
    boardWrapper.classList.add('blurred');
    boardStartOverlay.classList.remove('show');
    timerDisplay.textContent = prog.status === 'solved' ? fmtMMSS(prog.elapsedMs) : '00:00';
    showDailyResult(prog.status, prog.elapsedMs);
    return;
  }

  if (dailyRun.startedAt) {
    // 진행 중이던 판 재개
    const remaining = dailyRun.deadlineTs - Date.now();
    if (remaining <= 0) { endDaily('timeout'); return; }
    boardLocked = false;
    boardWrapper.classList.remove('blurred');
    boardStartOverlay.classList.remove('show');
    startDailyCountdown();
  } else {
    // 아직 시작 전 — 블러 + "시작" 오버레이
    boardLocked = true;
    boardWrapper.classList.add('blurred');
    boardStartOverlay.classList.add('show');
    timerDisplay.textContent = formatCountdown(DAILY_LIMIT_MS).slice(3); // MM:SS
  }
}

function beginDailyTimer() {
  if (!dailyRun || dailyRun.startedAt) return;
  dailyRun.startedAt = Date.now();
  dailyRun.deadlineTs = dailyRun.startedAt + DAILY_LIMIT_MS;
  boardLocked = false;
  boardWrapper.classList.remove('blurred');
  boardStartOverlay.classList.remove('show');
  saveProgress({
    date: dailyRun.date, variant: dailyRun.variant,
    startedAt: dailyRun.startedAt, status: 'playing',
    cells: board.serialize(), elapsedMs: 0, finishedAt: null,
  });
  startDailyCountdown();
}

function startDailyCountdown() {
  stopDailyCountdown();
  const frame = () => {
    if (!dailyRun || dailyRun.ended) return;
    const remaining = dailyRun.deadlineTs - Date.now();
    if (remaining <= 0) { endDaily('timeout'); return; }
    const t = Math.floor(remaining / 1000);
    timerDisplay.textContent = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
    timerDisplay.classList.toggle('timer-danger', remaining < 60000);
    dailyCountdownRAF = requestAnimationFrame(frame);
  };
  frame();
}

function stopDailyCountdown() {
  if (dailyCountdownRAF !== null) { cancelAnimationFrame(dailyCountdownRAF); dailyCountdownRAF = null; }
}

function scheduleDailyPersist() {
  if (!dailyRun || dailyRun.ended || !dailyRun.startedAt) return;
  clearTimeout(dailyPersistTimer);
  dailyPersistTimer = setTimeout(persistDailyNow, 800);
}

function persistDailyNow() {
  if (!dailyRun || dailyRun.ended || !dailyRun.startedAt) return;
  patchProgressCells(dailyRun.date, dailyRun.variant, board.serialize());
}

function endDaily(status) {
  if (!dailyRun || dailyRun.ended) return;
  dailyRun.ended = true;
  stopDailyCountdown();
  clearTimeout(dailyPersistTimer);
  btnDailyAbort.classList.add('hidden');
  boardLocked = true;
  boardWrapper.classList.add('blurred');
  timerDisplay.classList.remove('timer-danger');

  const elapsedMs = dailyRun.startedAt
    ? Math.min(DAILY_LIMIT_MS, Date.now() - dailyRun.startedAt)
    : DAILY_LIMIT_MS;

  saveProgress({
    date: dailyRun.date, variant: dailyRun.variant,
    startedAt: dailyRun.startedAt, status,
    cells: board.serialize(), elapsedMs, finishedAt: Date.now(),
  });
  recordResult(dailyRun.variant, dailyRun.date, status, elapsedMs);
  refreshDailyCards();
  showDailyResult(status, elapsedMs);
}

function exitDailyMode() {
  stopDailyCountdown();
  clearTimeout(dailyPersistTimer);
  dailyRun = null;
  elementSidebar.hidden = true;
  elementSidebar.innerHTML = '';
  btnDailyAbort.classList.add('hidden');
  timerDisplay.classList.remove('timer-danger', 'show');
  boardLocked = false;
  boardWrapper.classList.remove('blurred');
  boardStartOverlay.classList.remove('show');
  setFreePlayControls(true);
}

/** 데일리에서 숨기고 자유 연습에서 보이는 컨트롤 */
function setFreePlayControls(on) {
  btnOpenSave.classList.toggle('hidden', !on);
  btnOpenGenerate.classList.toggle('hidden', !on);
  btnOpenAnswerSheet.classList.toggle('hidden', !on);
  timerToggleBtn.classList.toggle('hidden', !on);
  if (!on) {
    closePanel(savePanel); closePanel(generatePanel); closePanel(answerSheetPanel);
  }
}

btnDailyStandard.addEventListener('click', () => startDaily('standard'));
btnDailyExtended.addEventListener('click', () => startDaily('extended'));

btnDailyAbort.addEventListener('click', () => {
  if (!dailyRun || dailyRun.ended) return;
  if (!dailyRun.startedAt) {
    askConfirm('시작하지 않고 메인 화면으로 나갈까요?', () => { exitDailyMode(); enterLanding(); });
    return;
  }
  askConfirm('지금 종료할까요?<br/>이 판은 <b>실패</b>로 기록되고 오늘은 다시 풀 수 없어요.', () => endDaily('gaveup'));
});

// ── 요소 안내 사이드바 (책갈피) — 요소마다 독립된 책갈피 하나씩 ──
function renderElementSidebar(run) {
  elementSidebar.innerHTML = '';
  if (!run || run.variant !== 'extended' || !run.elements) {
    elementSidebar.hidden = true;
    return;
  }
  const entries = [
    { key: run.elements.main, role: 'main' },
    { key: run.elements.sub, role: 'sub' },
  ];
  for (const { key, role } of entries) {
    const info = ELEMENT_INFO[key];
    if (!info) continue;

    const bm = document.createElement('div');
    bm.className = 'element-bookmark';
    bm.innerHTML =
      `<div class="element-bookmark-body">` +
      `<span class="element-bookmark-head"><b>${info.icon}</b> ${info.label}<em>${role}</em></span>` +
      `<span class="element-bookmark-desc">${info.desc}</span>` +
      `</div>` +
      `<button class="element-bookmark-handle" type="button" aria-label="${info.label} 설명 열기/닫기">` +
      `<span class="element-bookmark-icon">${info.icon}</span></button>`;
    bm.querySelector('.element-bookmark-handle')
      .addEventListener('click', () => bm.classList.toggle('open'));
    elementSidebar.appendChild(bm);
  }
  elementSidebar.hidden = false;
}

// ── 데일리 결과 모달 ──
function fmtMinSec(ms) {
  const t = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(t / 60)}분 ${t % 60}초`;
}

function showDailyResult(status, elapsedMs) {
  dailyResultTitle.textContent =
    status === 'solved' ? '🎉 클리어!' :
    status === 'gaveup' ? '🚪 도중 종료' :
    '⏱ 타임아웃';
  const pct = dailyRun ? completionPct(board, dailyRun.solutionMap) : 0;
  dailyResultDetail.textContent = `${fmtMinSec(elapsedMs)} · ${pct}%`;

  dailyResultGrid.textContent = dailyRun
    ? buildShareGrid(board, dailyRun.solutionMap, dailyRun.shape).join('\n')
    : '';

  dailyShareNote.textContent = '';
  openPanel(dailyResultModal);
}

function currentShareText() {
  if (!dailyRun) return '';
  const prog = loadProgress(dailyRun.date, dailyRun.variant);
  return buildShareText({
    date: dailyRun.date,
    variant: dailyRun.variant,
    status: prog?.status ?? 'timeout',
    elapsedMs: prog?.elapsedMs ?? DAILY_LIMIT_MS,
    elements: dailyRun.elements,
    board,
    solutionMap: dailyRun.solutionMap,
    shape: dailyRun.shape,
    url: SITE_URL,
  });
}

async function shareText(text, noteEl) {
  const ok = await copyText(text);
  noteEl.textContent = ok ? '클립보드에 복사했어요!' : '복사에 실패했어요. 직접 선택해 복사해주세요.';
  setTimeout(() => { noteEl.textContent = ''; }, 2600);
}

btnDailyResultShare.addEventListener('click', () => shareText(currentShareText(), dailyShareNote));
btnDailyResultClose.addEventListener('click', () => closePanel(dailyResultModal));
btnDailyResultStats.addEventListener('click', () => {
  closePanel(dailyResultModal);
  openStatsModal(dailyRun?.variant ?? 'standard');
});
dailyResultModal.addEventListener('click', (e) => {
  if (e.target === dailyResultModal) closePanel(dailyResultModal);
});

// ── 통계 모달 ──
let statsVariant = 'standard';
let statsCountdownTimer = null;

function openStatsModal(variant = 'standard') {
  statsVariant = variant;
  renderStatsModal();
  openPanel(dailyStatsModal);
  clearInterval(statsCountdownTimer);
  const tick = () => { dailyNextCountdown.textContent = formatCountdown(msUntilNextKSTMidnight()); };
  tick();
  statsCountdownTimer = setInterval(tick, 1000);
}

function closeStatsModal() {
  closePanel(dailyStatsModal);
  clearInterval(statsCountdownTimer);
}

function renderStatsModal() {
  document.querySelectorAll('.daily-stats-tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.variant === statsVariant);
  });

  const s = summarize(statsVariant, TODAY());
  statPlayed.textContent = s.played;
  statWinRate.textContent = s.winRate;
  statStreak.textContent = s.curStreak;
  statMaxStreak.textContent = s.maxStreak;

  const max = Math.max(1, ...s.distribution);
  dailyStatsDist.innerHTML = '';
  s.distribution.forEach((count, i) => {
    const row = document.createElement('div');
    row.className = 'dist-row';
    const label = document.createElement('span');
    label.className = 'dist-label';
    label.textContent = DIST_BUCKETS[i];
    const barWrap = document.createElement('span');
    barWrap.className = 'dist-bar-wrap';
    const bar = document.createElement('span');
    bar.className = 'dist-bar' + (i === 5 ? ' dist-bar-fail' : '');
    bar.style.width = `${(count / max) * 100}%`;
    bar.textContent = count;
    barWrap.appendChild(bar);
    row.append(label, barWrap);
    dailyStatsDist.appendChild(row);
  });

  // 오늘 그 variant를 이미 끝냈으면 공유 활성
  const prog = loadProgress(TODAY(), statsVariant);
  btnDailyStatsShare.disabled = !(prog && prog.status !== 'playing');
}

document.querySelectorAll('.daily-stats-tab').forEach((t) => {
  t.addEventListener('click', () => { statsVariant = t.dataset.variant; renderStatsModal(); });
});
dailyStatsClose.addEventListener('click', closeStatsModal);
dailyStatsModal.addEventListener('click', (e) => { if (e.target === dailyStatsModal) closeStatsModal(); });
btnLandingStats.addEventListener('click', () => openStatsModal('standard'));
btnOpenStats.addEventListener('click', () => openStatsModal(dailyRun?.variant ?? statsVariant));

btnDailyStatsShare.addEventListener('click', async () => {
  const prog = loadProgress(TODAY(), statsVariant);
  if (!prog || prog.status === 'playing') return;
  let data;
  try { data = await fetchDaily(TODAY()); } catch { return; }
  const vd = data[statsVariant];
  // 통계창에서 공유할 땐 저장된 셀로 임시 보드를 만들어 그리드를 계산
  const tmp = new Board();
  tmp.addStructures(reviveStructures(vd.structures));
  tmp.loadGivens(vd.givens);
  if (prog.cells) tmp.loadSerialized(prog.cells);
  const solMap = new Map((vd.solution ?? []).map((s) => [`${s.row},${s.col}`, s.value]));
  const text = buildShareText({
    date: TODAY(), variant: statsVariant, status: prog.status, elapsedMs: prog.elapsedMs,
    elements: statsVariant === 'extended' ? vd.elements : null,
    board: tmp, solutionMap: solMap, shape: data.shape, url: SITE_URL,
  });
  shareText(text, dailyStatsShareNote);
});

// ── 클립보드 복사 (clipboard + textarea fallback) ──
async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch (err) { console.error(err); }
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch (err) { console.error(err); return false; }
}

// ── 타이머 (자유 연습: 위로 세는 연습 타이머) ──
let timerEnabled   = false;
let timerRunning   = false;
let boardLocked    = false;
let timerElapsedMs = 0;
let timerStartedAt = 0;
let timerRAF       = null;

function formatTimer(ms) {
  const total = Math.max(0, Math.floor(ms));
  const minutes = Math.floor(total / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  const hundredths = Math.floor((total % 1000) / 10);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(minutes)}:${pad(seconds)}.${pad(hundredths)}`;
}

function renderTimerDisplay() {
  const current = timerElapsedMs + (timerRunning ? performance.now() - timerStartedAt : 0);
  timerDisplay.textContent = formatTimer(current);
}
function timerFrame() {
  renderTimerDisplay();
  if (timerRunning) timerRAF = requestAnimationFrame(timerFrame);
}
function stopTimerFrame() {
  if (timerRAF !== null) { cancelAnimationFrame(timerRAF); timerRAF = null; }
}
function armTimer() {
  timerRunning = false;
  timerElapsedMs = 0;
  stopTimerFrame();
  renderTimerDisplay();
  boardLocked = true;
  boardWrapper.classList.add('blurred');
  boardStartOverlay.classList.add('show');
}
function disarmTimer() {
  timerRunning = false;
  timerElapsedMs = 0;
  stopTimerFrame();
  boardLocked = false;
  boardWrapper.classList.remove('blurred');
  boardStartOverlay.classList.remove('show');
}

timerToggleBtn.addEventListener('click', () => {
  if (dailyRun) return;
  timerEnabled = !timerEnabled;
  timerToggleBtn.classList.toggle('active', timerEnabled);
  timerDisplay.classList.toggle('show', timerEnabled);
  if (timerEnabled) armTimer();
  else disarmTimer();
});

btnStartTimer.addEventListener('click', () => {
  if (dailyRun && !dailyRun.ended) { beginDailyTimer(); return; }
  if (!timerEnabled || timerRunning) return;
  boardLocked = false;
  boardWrapper.classList.remove('blurred');
  boardStartOverlay.classList.remove('show');
  timerRunning = true;
  timerStartedAt = performance.now();
  timerFrame();
});

// ── 다크 모드 ──
const DARK_MODE_KEY = 'sudoku-dark-mode';
function saveDarkModePref(on) {
  try { localStorage.setItem(DARK_MODE_KEY, on ? '1' : '0'); } catch { /* 무시 */ }
}
function applyDarkMode(on) {
  if (on) document.documentElement.setAttribute('data-theme', 'dark');
  else document.documentElement.removeAttribute('data-theme');
  btnToggleDarkMode.classList.toggle('active', on);
}
applyDarkMode(document.documentElement.getAttribute('data-theme') === 'dark');
function toggleDarkMode() {
  const next = document.documentElement.getAttribute('data-theme') !== 'dark';
  applyDarkMode(next);
  saveDarkModePref(next);
}
btnToggleDarkMode.addEventListener('click', toggleDarkMode);
btnLandingDark.addEventListener('click', toggleDarkMode);

// ── 완성 이벤트 ──
document.addEventListener('sudoku:solved', () => {
  if (dailyRun && !dailyRun.ended) {
    endDaily('solved');
    return;
  }
  if (timerRunning) {
    timerElapsedMs += performance.now() - timerStartedAt;
    timerRunning = false;
    stopTimerFrame();
    renderTimerDisplay();
  }
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2400);
});

// ── 키보드 단축키 ──
const ARROW_DIR = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

window.addEventListener('keydown', (e) => {
  // 통계/결과 모달은 랜딩에서도 뜰 수 있으므로 게임 화면 여부와 무관하게 먼저 처리
  if (dailyStatsModal.classList.contains('show')) {
    if (e.key === 'Escape') closeStatsModal();
    return;
  }
  if (dailyResultModal.classList.contains('show')) {
    if (e.key === 'Escape') closePanel(dailyResultModal);
    return;
  }

  if (!isGameActive()) return;

  if (confirmModal.classList.contains('show')) {
    if (e.key === 'Escape') cancelConfirm();
    else if (e.key === 'Enter') runPendingConfirm();
    return;
  }

  if (e.key.toLowerCase() === 'h' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    toggleHelpPanel();
    return;
  }

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && !dailyRun) {
    e.preventDefault();
    toggleSavePanel();
    return;
  }

  if (e.key === 'Escape') {
    closePanel(savePanel);
    closePanel(helpPanel);
    closePanel(generatePanel);
    closePanel(answerSheetPanel);
    return;
  }

  if (isFloatingPanelOpen()) return;
  if (boardLocked) return;

  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    renderer.undo();
    return;
  }
  if (e.code === 'ShiftLeft') {
    if (!e.repeat) toggleNoteMode();
    return;
  }
  if (ARROW_DIR[e.key]) {
    e.preventDefault();
    renderer.moveSelection(ARROW_DIR[e.key]);
    return;
  }
  if (e.key >= '1' && e.key <= '9') {
    renderer.inputValue(Number(e.key));
    return;
  }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    renderer.inputValue(null);
  }
});

// ── WASD 부드러운 게임 판 이동 ──
const PAN_SPEED = 700;
const WASD_DIR  = { w: [0, 1], a: [1, 0], s: [0, -1], d: [-1, 0] };
const heldKeys  = new Set();

window.addEventListener('keydown', (e) => {
  if (!isGameActive() || confirmModal.classList.contains('show') || isFloatingPanelOpen()) return;
  const k = e.key.toLowerCase();
  if (WASD_DIR[k]) heldKeys.add(k);
});
window.addEventListener('keyup', (e) => heldKeys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => heldKeys.clear());

let lastTick = null;
function panLoop(t) {
  if (lastTick === null) lastTick = t;
  const dt = (t - lastTick) / 1000;
  lastTick = t;
  if (heldKeys.size) {
    let dx = 0, dy = 0;
    for (const k of heldKeys) { dx += WASD_DIR[k][0]; dy += WASD_DIR[k][1]; }
    if (dx || dy) {
      const len = Math.hypot(dx, dy) || 1;
      boardDrag.moveBy((dx / len) * PAN_SPEED * dt, (dy / len) * PAN_SPEED * dt);
    }
  }
  requestAnimationFrame(panLoop);
}
requestAnimationFrame(panLoop);

// ── 진행 중이던 데일리 자동 저장 (탭 닫기/새로고침) ──
window.addEventListener('beforeunload', persistDailyNow);
document.addEventListener('visibilitychange', () => { if (document.hidden) persistDailyNow(); });

// ── 테스트용: 콘솔에서 __resetDaily() 로 오늘 기록·진행상태를 지우고 새로고침 ──
//    __resetDaily(true) 면 통계(연승 등)까지 전부 삭제.
window.__resetDaily = (wipeStats = false) => {
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('dsudoku:progress:') || (wipeStats && key.startsWith('dsudoku:stats:'))) {
        localStorage.removeItem(key);
      }
    }
  } catch { /* 무시 */ }
  location.reload();
};

// ── 시작 ──
refreshDailyCards();
