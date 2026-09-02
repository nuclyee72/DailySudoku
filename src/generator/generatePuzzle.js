/**
 * generatePuzzle.js — 템플릿 → { id, name, structures, givens } 오케스트레이션.
 * buildPuzzle()과 반환 형태를 맞춰서 main.js의 loadPuzzle()이 그대로 재사용되게 한다.
 */
import { Board } from '../core/Board.js';
import { createStandardSudokuStructures } from '../structures/StandardSudoku.js';
import { dedupStructures } from '../puzzles/builder/index.js';
import { fillRandomSolution } from './backtrack.js';
import {
  pickTurntableOrigins, turntableReservedKeys,
  prefillSnakeWalks, deriveRuleStructures, scrambledTurntableGrid,
} from './deriveRules.js';
import { carveGivens } from './carveGivens.js';
import { relaxTurntableAmbiguity } from './turntableAmbiguity.js';
import { restoreRatioFor } from './composeTemplate.js';
import { nextFloat } from './random.js';

const MAX_ATTEMPTS = 20;
// 보드 개수/규칙이 많은 조합은 시도당 소요 시간 편차가 커서(특히 fillRandomSolution이
// 사전에 값이 많이 박힌 보드에서 막힐 때) 고정 횟수만으로는 총 소요 시간을 가늠할 수
// 없다 — 전체 생성에 쓸 수 있는 총 시간을 못박아 두고, 그 안에서 될 때까지(또는
// MAX_ATTEMPTS까지) 재시도한다.
const GENERATE_TIME_BUDGET_MS = 30000;

/**
 * 부등호의 "작은 쪽" 칸이 given으로 1이거나 "큰 쪽" 칸이 given으로 9면, 그 부등호는
 * row/col 유일성만으로 항상 참이라(같은 행/열엔 같은 숫자가 없으니 나머지 칸은 자동으로
 * 1보다 크거나 9보다 작음) 아무 정보도 주지 않는 장식성 표시가 된다 — "1<"·"9>" 패턴.
 * 턴테이블에 걸친 칸은 회전에 따라 표시되는 값/given 여부가 바뀌므로 건드리지 않는다.
 */
function isTrivialInequality(board, turntableOf, structure) {
  const cellA = board.getCell(structure.a.row, structure.a.col);
  const cellB = board.getCell(structure.b.row, structure.b.col);
  if (turntableOf(cellA.row, cellA.col) || turntableOf(cellB.row, cellB.col)) return false;
  const smaller = structure.greater === 'a' ? cellB : cellA;
  const larger = structure.greater === 'a' ? cellA : cellB;
  if (smaller.isGiven && smaller.value === 1) return true;
  if (larger.isGiven && larger.value === 9) return true;
  return false;
}

async function tryGenerate(template) {
  const board = new Board();
  const structures = dedupStructures(
    template.boards.flatMap(({ row, col }) => createStandardSudokuStructures(row, col))
  );
  board.addStructures(structures);

  const rules = template.rules ?? [];

  // turntable 배치는 값과 무관한 순수 기하 문제라 가장 먼저 정한다 — snake가 그 칸을
  // 침범하면 "항상 given+회전 미지수"와 "일반 칸"이 동시에 성립할 수 없기 때문.
  const turntableOrigins = pickTurntableOrigins(board, rules);
  if (turntableOrigins === null) return null; // 자리 못 찾음 — 전체 재시도
  const reservedKeys = turntableReservedKeys(turntableOrigins);

  const snakeWalks = prefillSnakeWalks(board, rules, reservedKeys);
  if (snakeWalks === null) return null; // 경로를 못 뽑음 — 전체 재시도

  if (!(await fillRandomSolution(board))) return null; // 해 채우기 실패 — 전체 재시도

  const { structures: ruleStructures, turntables } = deriveRuleStructures(board, rules, snakeWalks, turntableOrigins);
  board.addStructures(ruleStructures);

  // 캐빙(given 제거)으로 값이 지워지기 전, 모든 칸이 아직 "진짜" 정답값을 갖고 있는 지금
  // 스냅샷을 떠서 정답 체크/보기 기능에 그대로 실어 보낸다. 이후 given이 아닌 칸만 갖고
  // 다시 풀어내려 하면(특히 턴테이블이 있는 퍼즐) 그 영역이 회전 자유도 때문에 어떤 배치가
  // "진짜"인지 알 방법이 없어 유일하지 않은 다른 해로 수렴할 수 있다 — 실제로 이 문제가
  // 재현됨을 확인했다. 턴테이블 칸 자체는 회전 때문에 칸별 정답이 고정되지 않으므로 애초에
  // 스냅샷에도 담지 않는다(정답 체크/보기가 그 칸들을 대상에서 제외하는 것과 동일한 기준).
  const turntableSolveKeys = board.getTurntableCellKeys();
  const solution = [];
  for (const cell of board.getVisibleCells()) {
    if (turntableSolveKeys.has(`${cell.row},${cell.col}`)) continue;
    solution.push({ row: cell.row, col: cell.col, value: cell.value });
  }

  const difficulty = template.difficulty ?? 3;
  const { removedCells } = await carveGivens(board, { turntableRegions: turntables, requireLogicSolvable: true });

  // 무작위 대신 "가장 나중에 지워진" 칸부터 되돌린다 — removedCells는 캐빙 루프가 지운
  // 순서 그대로 쌓이므로, 뒤쪽일수록 이미 다른 칸이 많이 지워진 빠듯한 상태에서 지워진
  // 칸(=복구하기 가장 어려운 칸)이다. 무작위 복원은 어려운 지점을 그대로 남겨둘 수 있지만,
  // 이렇게 하면 실제로 어려운 지점부터 겨냥해서 낮출 수 있다. 난이도가 높을수록(5=예전
  // "보통") restoreRatioFor가 0에 가까워져 사실상 복원이 없어진다.
  const restoreCount = Math.round(removedCells.length * restoreRatioFor(difficulty));
  if (restoreCount > 0) { // slice(-0)은 slice(0)과 같아서 전체를 복원해버리므로 반드시 방어
    for (const { cell, value } of removedCells.slice(-restoreCount)) {
      cell.isGiven = true;
      cell.value = value;
    }
  }

  // 회전 없이도 정답 방향이 뻔히 보이면(4방향 중 그럴듯한 게 1개뿐이면) 턴테이블이
  // 장식으로 전락한다 — 난이도와 무관하게 항상 보정한다.
  await relaxTurntableAmbiguity(board, turntables);

  const scrambleByOrigin = new Map(
    turntables.map(t => [`${t.originRow},${t.originCol}`, scrambledTurntableGrid(board, t)])
  );
  const turntableOf = (row, col) => turntables.find(t =>
    row >= t.originRow && row < t.originRow + t.size && col >= t.originCol && col < t.originCol + t.size);

  // given으로 드러난 1/9 옆의 정보 없는 부등호("1<"·"9>")는 제거한다 — 지워도 남은 given
  // 숫자 자체가 안 바뀌므로 유일해 여부에는 영향이 없다(부등호가 강제하던 조건이 애초에
  // row/col 유일성만으로 항상 성립했던 것뿐이라 재검증이 필요 없음).
  board.structures = board.structures.filter((s) =>
    s.type !== 'inequality' || !isTrivialInequality(board, turntableOf, s));

  const givens = [];
  for (const cell of board.getVisibleCells()) {
    const owner = turntableOf(cell.row, cell.col);
    if (!owner) {
      if (!cell.isGiven) continue;
      givens.push({ row: cell.row, col: cell.col, value: cell.value });
      continue;
    }
    // 턴테이블 소유 칸은 캐빙이 정한 given/blank가 "회전 0" 기준이라, cell.isGiven을 직접
    // 보는 대신 스크램블 회전이 반영된 givens grid로 이 좌표가 (표시상) given인지 판단한다.
    const { values, givens: givenGrid } = scrambleByOrigin.get(`${owner.originRow},${owner.originCol}`);
    const r = cell.row - owner.originRow, c = cell.col - owner.originCol;
    if (!givenGrid[r][c]) continue;
    givens.push({ row: cell.row, col: cell.col, value: values[r][c] });
  }

  return {
    id: `${template.id}-${Math.floor(nextFloat() * 1e9).toString(36)}`,
    name: template.label,
    structures: board.structures,
    givens,
    solution, // [{row,col,value}], 턴테이블 칸 제외 - 정답 체크/보기 기능이 그대로 사용
    // 난이도를 "라벨"이 아니라 측정된 값으로도 남겨둔다(지금은 UI에 안 쓰지만 추후 조정/표시에 재사용 가능)
    stats: { givenCount: givens.length, totalCells: board.getVisibleCells().length },
  };
}

export async function generatePuzzle(template) {
  const deadline = Date.now() + GENERATE_TIME_BUDGET_MS;
  for (let attempt = 0; attempt < MAX_ATTEMPTS && Date.now() < deadline; attempt++) {
    const result = await tryGenerate(template);
    if (result) return result;
  }
  throw new Error(`퍼즐 생성 실패: ${template.label ?? template.id} (재시도 초과)`);
}
