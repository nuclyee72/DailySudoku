/**
 * composeTemplate.js — "모양 + 요소 + 난이도" 선택을 generatePuzzle()이 바로 먹을 수 있는
 * template 객체({id,label,boards,rules,difficulty})로 합성한다.
 * generatePuzzle()은 template.boards/rules/id/label만 읽으므로 정적 파일일 필요가 없다.
 */
import { shapes, getShape } from './shapes.js';
import { shuffle, pick, randInt } from './random.js';

export const ELEMENT_KEYS = ['inequality', 'consecutive', 'snake', 'turntable'];
// 난이도는 이제 1~5 숫자 슬라이더다 — 1은 예전 "쉬움", 5는 예전 "보통"(당시 유일한 최고
// 난이도)과 정확히 같은 파라미터를 쓰고, 2~4는 그 사이를 수치로 보간한 중간 단계다.
export const DIFFICULTY_LEVELS = [1, 2, 3, 4, 5];
const DEFAULT_DIFFICULTY = 3;
export const AMOUNTS = ['none', 'normal', 'many'];

export const ELEMENT_LABELS = { inequality: '부등호', consecutive: '연속', snake: '스네이크', turntable: '턴테이블' };
export const DIFFICULTY_LABELS = { 1: '쉬움', 2: '조금 쉬움', 3: '보통', 4: '조금 어려움', 5: '어려움' };
export const AMOUNT_LABELS = { none: '없음', normal: '보통', many: '많음' };

function lerp(a, b, t) { return a + (b - a) * t; }
// 1~5 레벨을 0(쉬움 끝)~1(어려움 끝) 비율로 바꾼다 — 아래 난이도별 수치들은 전부 이 비율로
// 예전 easy/normal 두 값 사이를 보간해서 얻는다("난이도 수치"로 조절한다는 게 이 부분).
function difficultyT(level) { return (level - 1) / (DIFFICULTY_LEVELS.length - 1); }

// random까지 명시적으로 false로 채워둔다 — 이게 빠지면 UI 쪽 classList.toggle(cls, elements.random)이
// undefined를 받아 "강제 false"가 아니라 "그냥 토글"로 동작해서 랜덤 버튼이 엉뚱하게 켜져 보인다.
function emptyElements() {
  return { inequality: 'none', consecutive: 'none', snake: 'none', turntable: 'none', random: false };
}

/**
 * 모양/요소의 "랜덤" 선택을 이 시점에 한 번 확정한다 — 이후 인코딩/조립은 이 결과를
 * 그대로 재사용해서, 같은 방의 다른 참가자도 동일한 값을 보게 된다.
 */
export function resolveRandomSelection({ shapeId, elements = {}, difficulty = DEFAULT_DIFFICULTY } = {}) {
  const resolvedShapeId = shapeId === 'random' ? pick(shapes).id : shapeId;

  let resolvedElements;
  if (elements.random) {
    resolvedElements = emptyElements();
    for (const key of ELEMENT_KEYS) resolvedElements[key] = pick(AMOUNTS);
  } else {
    resolvedElements = { ...emptyElements() };
    for (const key of ELEMENT_KEYS) resolvedElements[key] = AMOUNTS.includes(elements[key]) ? elements[key] : 'none';
  }

  const numericDifficulty = Number(difficulty);
  const resolvedDifficulty = DIFFICULTY_LEVELS.includes(numericDifficulty) ? numericDifficulty : DEFAULT_DIFFICULTY;

  return { shapeId: resolvedShapeId, elements: resolvedElements, difficulty: resolvedDifficulty };
}

export function encodeSelectionId(resolved) {
  const parts = ELEMENT_KEYS.filter(k => resolved.elements[k] !== 'none').map(k => `${k}-${resolved.elements[k]}`);
  return `custom:${resolved.shapeId}:${parts.length ? parts.join(',') : 'none'}:${resolved.difficulty}`;
}

export function decodeSelectionId(id) {
  if (typeof id !== 'string' || !id.startsWith('custom:')) return null;
  const [, shapeId, elementsPart, difficultyPart] = id.split(':');
  if (!shapeId || !elementsPart || !difficultyPart) return null;
  if (!getShape(shapeId)) return null;
  const elements = emptyElements();
  if (elementsPart !== 'none') {
    for (const token of elementsPart.split(',')) {
      const [key, amount] = token.split('-');
      if (ELEMENT_KEYS.includes(key) && AMOUNTS.includes(amount)) elements[key] = amount;
    }
  }
  const difficulty = Number(difficultyPart);
  if (!DIFFICULTY_LEVELS.includes(difficulty)) return null;
  return { shapeId, elements, difficulty };
}

export function describeSelection(resolved) {
  const shape = getShape(resolved.shapeId);
  const elementLabels = ELEMENT_KEYS.filter(k => resolved.elements[k] !== 'none')
    .map(k => `${ELEMENT_LABELS[k]}(${AMOUNT_LABELS[resolved.elements[k]]})`);
  const elementsText = elementLabels.length ? elementLabels.join('+') : '요소 없음';
  return `${shape?.label ?? resolved.shapeId} · ${elementsText} · ${DIFFICULTY_LABELS[resolved.difficulty]}`;
}

function boundingRegion(boards) {
  const minRow = Math.min(...boards.map(b => b.row));
  const minCol = Math.min(...boards.map(b => b.col));
  const maxRow = Math.max(...boards.map(b => b.row + 9));
  const maxCol = Math.max(...boards.map(b => b.col + 9));
  return { row: minRow, col: minCol, height: maxRow - minRow, width: maxCol - minCol };
}

// 스네이크 길이, 턴테이블 크기 범위 — 난이도가 높을수록 위쪽 한계가 늘어나 더 길거나 큰
// 것도 "나올 수 있게"만 한다(항상 그렇게 되는 건 아니고 매번 범위 안에서 무작위). 예전
// easy/normal 두 값을 양 끝으로 두고 5단계를 그 사이에서 수치로 보간한다.
// 턴테이블은 4x4까지만 — 5x5는 회전 손잡이 조작이 너무 부담스러워 최대 크기를 낮췄다.
const SNAKE_LENGTH_EASY = [5, 7], SNAKE_LENGTH_HARD = [7, 10];
const TURNTABLE_SIZE_EASY = [3, 3], TURNTABLE_SIZE_HARD = [3, 4];

function snakeLengthRangeFor(level) {
  const t = difficultyT(level);
  return [Math.round(lerp(SNAKE_LENGTH_EASY[0], SNAKE_LENGTH_HARD[0], t)), Math.round(lerp(SNAKE_LENGTH_EASY[1], SNAKE_LENGTH_HARD[1], t))];
}

function turntableSizeRangeFor(level) {
  const t = difficultyT(level);
  return [Math.round(lerp(TURNTABLE_SIZE_EASY[0], TURNTABLE_SIZE_HARD[0], t)), Math.round(lerp(TURNTABLE_SIZE_EASY[1], TURNTABLE_SIZE_HARD[1], t))];
}

// "쉬움"에서 캐빙 후 되돌리는 given 비율 — 예전 EASY_RESTORE_RATIO(easy=0.35, normal=0)를
// 그대로 양 끝으로 삼아 보간한다. generatePuzzle.js가 캐빙 직후 복원량을 정할 때 쓴다.
const RESTORE_RATIO_EASY = 0.35, RESTORE_RATIO_HARD = 0;
export function restoreRatioFor(level) {
  return lerp(RESTORE_RATIO_EASY, RESTORE_RATIO_HARD, difficultyT(level));
}

// 부등호/연속은 "얼마나 많은 인접 칸-쌍에 표시할지" 비율로, 스네이크/턴테이블은 "보드
// 몇 개에 배치할지" 개수로 양을 조절한다 — 난이도와는 독립된 축이라 같은 난이도에서도
// 요소를 많이/적게 넣을 수 있다. 보드당 최대 1개까지만 배치해서, 같은 종류의 규칙끼리는
// 애초에 같은 보드를 두고 다툴 일이 없게 한다(다른 보드끼리 3x3 모서리를 공유하는 경우의
// 충돌은 prefillSnakeWalks가 이미 배치한 자리를 reservedKeys로 피해가며 처리한다).
const COVERAGE_RATIO_BY_AMOUNT = {
  inequality: { normal: 0.25, many: 0.45 },
  consecutive: { normal: 0.5, many: 0.8 },
};

function scaledCount(boardCount, amount) {
  if (amount === 'normal') return Math.max(1, Math.ceil(boardCount / 2));
  return boardCount; // many — 모든 보드에 하나씩
}

export function buildTemplateFromSelection(resolved) {
  const shape = getShape(resolved.shapeId);
  if (!shape) throw new Error(`알 수 없는 모양: ${resolved.shapeId}`);
  const boards = shape.boards;
  const region = boundingRegion(boards);
  const rules = [];

  if (resolved.elements.inequality !== 'none') {
    rules.push({ type: 'inequality', region, coverage: { ratio: COVERAGE_RATIO_BY_AMOUNT.inequality[resolved.elements.inequality] } });
  }
  if (resolved.elements.consecutive !== 'none') {
    rules.push({ type: 'consecutive', region, coverage: { ratio: COVERAGE_RATIO_BY_AMOUNT.consecutive[resolved.elements.consecutive] } });
  }
  if (resolved.elements.snake !== 'none') {
    const count = scaledCount(boards.length, resolved.elements.snake);
    const lengthRange = snakeLengthRangeFor(resolved.difficulty);
    for (const board of shuffle([...boards]).slice(0, count)) {
      rules.push({ type: 'snake', region: { row: board.row, col: board.col, height: 9, width: 9 }, length: lengthRange });
    }
  }
  if (resolved.elements.turntable !== 'none') {
    const count = scaledCount(boards.length, resolved.elements.turntable);
    const [minSize, maxSize] = turntableSizeRangeFor(resolved.difficulty);
    for (const board of shuffle([...boards]).slice(0, count)) {
      const size = randInt(minSize, maxSize);
      rules.push({ type: 'turntable', region: { row: board.row, col: board.col, height: 9, width: 9 }, size });
    }
  }

  return {
    id: encodeSelectionId(resolved),
    label: describeSelection(resolved),
    boards,
    rules,
    difficulty: resolved.difficulty,
    // 데일리는 명시적 복원 비율을 실어 보낸다(없으면 generatePuzzle이 난이도에서 계산)
    restoreRatio: resolved.restoreRatio,
  };
}
