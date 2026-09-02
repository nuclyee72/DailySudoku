/**
 * deriveRules.js — template.rules를 실제 Structure 인스턴스로 바꾼다.
 * inequality/consecutive는 완성된 해의 실제 값을 보고 사후에 뽑고(항상 만족 가능),
 * snake는 해를 채우기 "전에" 값을 먼저 못박아야 하므로 별도 진입점(prefillSnakeWalks)으로 분리.
 * turntable은 규칙 자체는 없지만, 표시용 스크램블 회전량을 여기서 같이 정한다.
 */
import { Inequality } from '../structures/Inequality.js';
import { Consecutive } from '../structures/Consecutive.js';
import { Snake } from '../structures/Snake.js';
import { Turntable } from '../structures/Turntable.js';
import { pickSnakeWalk } from './snakeWalk.js';
import { rotateGrid } from './gridRotate.js';
import { shuffle, randInt, nextFloat } from './random.js';

function inRegion(region, row, col) {
  return row >= region.row && row < region.row + region.height &&
         col >= region.col && col < region.col + region.width;
}

function adjacentPairsInRegion(board, region) {
  const cellsInRegion = board.getVisibleCells().filter(c => inRegion(region, c.row, c.col));
  const set = new Set(cellsInRegion.map(c => `${c.row},${c.col}`));
  const pairs = [];
  for (const cell of cellsInRegion) {
    const right = { row: cell.row, col: cell.col + 1 };
    const down = { row: cell.row + 1, col: cell.col };
    if (set.has(`${right.row},${right.col}`)) pairs.push([{ row: cell.row, col: cell.col }, right]);
    if (set.has(`${down.row},${down.col}`)) pairs.push([{ row: cell.row, col: cell.col }, down]);
  }
  return pairs;
}

function coverageCount(total, coverage = {}) {
  if (coverage.count) {
    const [min, max] = coverage.count;
    return Math.min(randInt(min, max), total);
  }
  return Math.round(total * (coverage.ratio ?? 0.3));
}

function readGrid(board, originRow, originCol, size) {
  const grid = [];
  for (let r = 0; r < size; r++) {
    grid.push([]);
    for (let c = 0; c < size; c++) grid[r].push(board.getCell(originRow + r, originCol + c).value);
  }
  return grid;
}

function readGivenGrid(board, originRow, originCol, size) {
  const grid = [];
  for (let r = 0; r < size; r++) {
    grid.push([]);
    for (let c = 0; c < size; c++) grid[r].push(board.getCell(originRow + r, originCol + c).isGiven);
  }
  return grid;
}

function pickTurntableOrigin(board, rule, reservedKeys) {
  const size = rule.size;
  const { row, col, height, width } = rule.region;
  const candidates = [];
  for (let r = row; r <= row + height - size; r++) {
    for (let c = col; c <= col + width - size; c++) {
      let allVisible = true;
      for (let dr = 0; dr < size && allVisible; dr++) {
        for (let dc = 0; dc < size && allVisible; dc++) {
          const cell = board.getCell(r + dr, c + dc);
          if (!cell || !cell.isVisible || reservedKeys.has(`${r + dr},${c + dc}`)) allVisible = false;
        }
      }
      if (allVisible) candidates.push({ row: r, col: c });
    }
  }
  return candidates.length ? candidates[Math.floor(nextFloat() * candidates.length)] : null;
}

/**
 * turntable 규칙들의 배치를 가장 먼저 정한다(값과 무관한 순수 기하 문제라, snake 경로를 뽑기
 * 전에 확정해야 snake가 turntable 칸을 침범하지 않도록 피할 수 있다). 실패 시 null.
 * 턴테이블이 여러 개면(보드가 여럿인 모양 + 요소 개수가 난이도에 비례해 늘어난 경우)
 * 서로 다른 보드에 하나씩 배치돼도 두 보드가 3x3 모서리를 공유할 수 있어, 이미 놓은
 * 턴테이블의 칸을 reservedKeys로 누적해서 다음 턴테이블이 그 자리를 피하게 한다.
 * 반환: [{ rule, originRow, originCol, size, scrambleSteps }]
 */
export function pickTurntableOrigins(board, rules) {
  const result = [];
  const reservedKeys = new Set();
  for (const rule of rules) {
    if (rule.type !== 'turntable') continue;
    const origin = pickTurntableOrigin(board, rule, reservedKeys);
    if (!origin) return null;
    for (let r = 0; r < rule.size; r++)
      for (let c = 0; c < rule.size; c++)
        reservedKeys.add(`${origin.row + r},${origin.col + c}`);
    result.push({
      rule,
      originRow: origin.row,
      originCol: origin.col,
      size: rule.size,
      scrambleSteps: randInt(1, 3), // 0(무회전)은 스크램블이 아니므로 제외
    });
  }
  return result;
}

function turntableReservedKeys(turntableOrigins) {
  const keys = new Set();
  for (const t of turntableOrigins) {
    for (let r = 0; r < t.size; r++)
      for (let c = 0; c < t.size; c++)
        keys.add(`${t.originRow + r},${t.originCol + c}`);
  }
  return keys;
}

/**
 * snake 규칙들의 경로/값을 해 채우기 전에 먼저 확정한다. turntable 칸(reservedKeys)은
 * 지나갈 수 없다 — 같은 칸이 "항상 given + 회전 미지수"와 "값을 추리하는 일반 칸"을
 * 동시에 만족할 수 없기 때문. 실패하면 null(호출 쪽에서 전체 재시도).
 * 스네이크가 여러 개일 때(보드가 여럿인 모양에서 난이도에 비례해 개수가 늘어난 경우)도
 * 서로 다른 보드에 하나씩 배치되지만 두 보드가 모서리를 공유할 수 있어, 먼저 뽑은 경로의
 * 칸을 reservedKeys에 누적해서 다음 스네이크가 그 칸을 다시 지나가지 않게 한다.
 */
export function prefillSnakeWalks(board, rules, reservedKeys = new Set()) {
  const walks = [];
  for (const rule of rules) {
    if (rule.type !== 'snake') continue;
    const walk = pickSnakeWalk(board, rule.region, rule.length ?? [4, 7], 40, reservedKeys);
    if (!walk) return null;
    for (const cell of walk.cells) reservedKeys.add(`${cell.row},${cell.col}`);
    walks.push({ rule, walk });
  }
  return walks;
}

function pairKey(a, b) {
  const ka = `${a.row},${a.col}`, kb = `${b.row},${b.col}`;
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

/**
 * 완성된 해(board 전체가 채워진 상태) + 미리 정해둔 snake 경로/turntable 배치를 보고
 * 실제 규칙 구조체를 만든다.
 * 반환: { structures, turntables: [{originRow,originCol,size,scrambleSteps}] }
 * turntables는 이후 countSolutions의 회전 분기, 최종 결과 조립의 스크램블 표시에 쓰인다.
 */
export function deriveRuleStructures(board, rules, snakeWalks, turntableOrigins) {
  const structures = [];
  const turntables = [];
  // 부등호/연속 규칙이 같은 보드(영역)에 함께 걸리면 같은 칸-쌍에 둘 다 표시될 수 있어
  // (부등호 꺾쇠 + 연속 점이 같은 자리에 겹쳐 그려짐) 규칙 종류를 가리지 않고 공유한다.
  const usedPairKeys = new Set();

  for (const rule of rules) {
    if (rule.type === 'inequality') {
      const pairs = adjacentPairsInRegion(board, rule.region)
        .filter(([a, b]) => !usedPairKeys.has(pairKey(a, b)));
      const n = coverageCount(pairs.length, rule.coverage);
      for (const [a, b] of shuffle(pairs).slice(0, n)) {
        const va = board.getCell(a.row, a.col).value;
        const vb = board.getCell(b.row, b.col).value;
        structures.push(new Inequality(a, b, va > vb ? 'a' : 'b'));
        usedPairKeys.add(pairKey(a, b));
      }
    } else if (rule.type === 'consecutive') {
      const pairs = adjacentPairsInRegion(board, rule.region)
        .filter(([a, b]) => !usedPairKeys.has(pairKey(a, b)))
        .filter(([a, b]) => Math.abs(board.getCell(a.row, a.col).value - board.getCell(b.row, b.col).value) === 1);
      const n = coverageCount(pairs.length, rule.coverage);
      for (const [a, b] of shuffle(pairs).slice(0, n)) {
        structures.push(new Consecutive(a, b));
        usedPairKeys.add(pairKey(a, b));
      }
    } else if (rule.type === 'snake') {
      const found = snakeWalks.find(w => w.rule === rule);
      if (found) structures.push(new Snake(found.walk.cells, found.walk.start));
    } else if (rule.type === 'turntable') {
      const found = turntableOrigins.find(t => t.rule === rule);
      if (!found) continue;
      structures.push(new Turntable(found.originRow, found.originCol, found.size));
      turntables.push(found);
    }
  }

  return { structures, turntables };
}

export { turntableReservedKeys };

/**
 * 턴테이블 영역의 진짜 값 + given 여부를 스크램블 회전(표시용)으로 함께 옮긴 두 grid를 돌려준다.
 * 캐빙이 정한 given/blank 패턴은 "회전 0" 기준이라, 화면에 보여줄 회전이 적용되면 어느 좌표가
 * given으로 보일지도 값과 나란히 돌아가야 한다 — rotateGrid는 순수 배열 회전이라 boolean에도
 * 그대로 재사용된다.
 */
export function scrambledTurntableGrid(board, turntable) {
  const valueGrid = readGrid(board, turntable.originRow, turntable.originCol, turntable.size);
  const givenGrid = readGivenGrid(board, turntable.originRow, turntable.originCol, turntable.size);
  return {
    values: rotateGrid(valueGrid, turntable.scrambleSteps),
    givens: rotateGrid(givenGrid, turntable.scrambleSteps),
  };
}
