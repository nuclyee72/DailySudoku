/**
 * snakeWalk.js — 스네이크 규칙용 랜덤 경로 + 값 선정.
 * 그리디 랜덤워크는 목표 길이 전에 막다른 길에 몰릴 수 있어, 백트래킹 DFS로 경로를 뽑는다.
 * 값 배정은 Snake.js의 실제 규칙(경로를 따라 "한 걸음마다 값이 1씩만 차이나는" 해밀턴
 * 경로)과 똑같이 맞춘다 — 단조증가/감소하는 1~9 등차수열이 아니라, 예를 들어
 * 1-2-3-2-3-4-5-6-7-6-5처럼 오르내리며 값이 반복될 수 있는 걸음(walk)이라, 경로 길이가
 * 9칸을 넘어갈 수도 있다(9개 숫자만 도는 단조 수열이었을 땐 9칸이 수학적 한계였음).
 * 경로가 정해지면 셀마다 이전 셀 값에서 ±1인 후보를 백트래킹으로 시도하면서
 * board.getPeers()로 즉시 row/col/box 충돌을 검사한다(이 시점엔 row/col/box 구조체만
 * 존재하므로 getPeers()를 써도 안전 — 아직 inequality/consecutive/turntable 구조체가
 * board에 없음).
 */
import { shuffle, randInt, pick, nextFloat } from './random.js';

function key(row, col) { return `${row},${col}`; }

const DIRS = [[0, 1], [0, -1], [1, 0], [-1, 0]];

/**
 * 후보 칸이 "직전 칸 말고" 이미 지나온 칸과 몇 군데나 붙어있는지 센다 — 높을수록 경로가
 * 일자로 뻗기보다 제 몸 옆으로 다시 붙어 뭉쳐지는 모양이 된다.
 */
function clusterBonus(row, col, fromRow, fromCol, visited) {
  let bonus = 0;
  for (const [dr, dc] of DIRS) {
    const nr = row + dr, nc = col + dc;
    if (nr === fromRow && nc === fromCol) continue;
    if (visited.has(key(nr, nc))) bonus++;
  }
  return bonus;
}

/** 뭉침 점수가 높은 후보일수록 먼저 시도될 확률이 높도록 가중치를 둔 순서로 섞는다. */
function weightedByCluster(scored) {
  const pool = [...scored];
  const ordered = [];
  while (pool.length) {
    const total = pool.reduce((sum, p) => sum + p.weight, 0);
    let r = nextFloat() * total;
    let idx = pool.findIndex(p => (r -= p.weight) <= 0);
    if (idx === -1) idx = pool.length - 1;
    ordered.push(pool.splice(idx, 1)[0].cell);
  }
  return ordered;
}

class WalkNodeCapExceeded extends Error {}

/**
 * 뭉침 편향은 자기 몸 옆으로 자꾸 붙으려다 스스로를 가두는(더 갈 곳이 없어지는) 경우가
 * 늘어서, 특히 목표 길이가 길거나(어려움) 이미 다른 스네이크가 자리를 많이 차지한
 * 상태에서는 DFS 백트래킹이 훨씬 깊어질 수 있다 — nodeCap으로 한 시도당 탐색량을
 * 제한하고, 초과하면 그 시작 칸은 포기하고 pickSnakeWalk의 다음 시도(다른 시작 칸)로
 * 넘어간다(backtrack.js의 NodeCapExceeded와 같은 패턴).
 */
function buildWalk(board, region, targetLen, reservedKeys, nodeCap = 4000) {
  const inRegion = (r, c) =>
    r >= region.row && r < region.row + region.height &&
    c >= region.col && c < region.col + region.width &&
    !reservedKeys.has(key(r, c));

  const candidates = board.getVisibleCells().filter(c => inRegion(c.row, c.col));
  if (candidates.length < targetLen) return null;

  const start = pick(candidates);
  const visited = new Set();
  const path = [];
  let nodes = 0;

  function dfs(cell) {
    if (++nodes > nodeCap) throw new WalkNodeCapExceeded();
    visited.add(key(cell.row, cell.col));
    path.push(cell);
    if (path.length === targetLen) return true;

    const scored = [];
    for (const [dr, dc] of DIRS) {
      const nr = cell.row + dr, nc = cell.col + dc;
      const next = board.getCell(nr, nc);
      if (!next || !next.isVisible || !inRegion(nr, nc) || visited.has(key(nr, nc))) continue;
      // 뭉침 보너스 1개당 가중치 +2(직선으로 쭉 뻗는 후보는 보너스 0이라 기본 가중치 1만 유지) —
      // 너무 세게 주면(예전 +4) 스스로를 가두는 막다른 경로를 자주 골라 백트래킹이 폭주한다.
      scored.push({ cell: next, weight: clusterBonus(nr, nc, cell.row, cell.col, visited) * 2 + 1 });
    }

    for (const next of weightedByCluster(scored)) {
      if (dfs(next)) return true;
    }

    visited.delete(key(cell.row, cell.col));
    path.pop();
    return false;
  }

  try {
    return dfs(start) ? path : null;
  } catch (e) {
    if (e instanceof WalkNodeCapExceeded) return null;
    throw e;
  }
}

function peerConflict(board, cell, value) {
  return board.getPeers(cell.row, cell.col)
    .some(({ row, col }) => board.getCell(row, col)?.value === value);
}

/**
 * path[0]부터 순서대로, 매 칸마다 "이전 칸 값 ±1" 후보를 백트래킹으로 시도해 채운다.
 * Snake.js의 실제 검증 규칙과 동일한 걸음(한 걸음마다 1씩만 차이) — 값이 오르내리며
 * 반복돼도 되므로 경로 길이가 9칸을 넘어도 값 자체는 항상 배정 가능하다(막히는 건
 * row/col/box 충돌 때문일 뿐).
 */
function assignPathValues(board, path) {
  const n = path.length;

  function fillFrom(index, prevValue) {
    if (index === n) return true;
    const cell = path[index];
    const candidates = shuffle([prevValue - 1, prevValue + 1].filter(v => v >= 1 && v <= 9));
    for (const v of candidates) {
      if (peerConflict(board, cell, v)) continue;
      cell.value = v;
      if (fillFrom(index + 1, v)) return true;
      cell.value = null;
    }
    return false;
  }

  const startCell = path[0];
  for (const v0 of shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9])) {
    if (peerConflict(board, startCell, v0)) continue;
    startCell.value = v0;
    if (fillFrom(1, v0)) return true;
    startCell.value = null;
  }
  return false;
}

/**
 * region 안에서 [minLen,maxLen] 길이의 자기회피 경로를 찾아 값까지 채워 넣는다.
 * 성공 시 { cells:[{row,col}], start:{row,col} }, 여러 번 시도해도 실패하면 null.
 */
export function pickSnakeWalk(board, region, [minLen, maxLen], attempts = 40, reservedKeys = new Set()) {
  const targetLen = randInt(minLen, maxLen);

  for (let i = 0; i < attempts; i++) {
    const path = buildWalk(board, region, targetLen, reservedKeys);
    if (!path) continue;
    if (assignPathValues(board, path)) {
      return {
        cells: path.map(c => ({ row: c.row, col: c.col })),
        start: { row: path[0].row, col: path[0].col },
      };
    }
  }
  return null;
}
