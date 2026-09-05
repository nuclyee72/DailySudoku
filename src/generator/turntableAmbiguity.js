/**
 * turntableAmbiguity.js — 턴테이블 회전 "그럴듯함" 보정.
 * 캐빙이 끝난 직후, 턴테이블 4방향 중 지금 보이는 given 값만으로 즉시 모순 없이 통하는
 * 방향이 1개뿐이면(나머지 3개는 척 보기만 해도 틀렸다는 걸 알 수 있으면) 돌려서 맞추는
 * 재미가 사라진다 — 안 그래도 정답인 방향을 아는 셈이니 회전 기믹이 무의미해진다.
 * 턴테이블 자신의 칸과 그 바깥 row/col/box 이웃 중 일부를 유일해가 깨지지 않는 선에서
 * 추가로 지워서, 최소 두 방향은 "그럴듯해" 보이게(=즉시 모순나지 않게) 만든다.
 */
import { countSolutions, makeCheckers } from './backtrack.js';
import { scrambledTurntableGrid } from './deriveRules.js';
import { key } from './peerIndex.js';
import { shuffle, pick } from './random.js';

/**
 * 회전 rot 하나가 지금 보이는 given만으로 즉시 충돌 없이 통하는지. 빈 칸은 아직 안
 * 보이니 어떤 값이 와도 상관없어 항상 통과로 취급한다.
 */
function isRotationPlausible(board, turntable, checkers, rot) {
  const { usedMask, extraOk } = checkers;
  const { originRow, originCol, size } = turntable;
  const { values, givens } = scrambledTurntableGrid(board, { originRow, originCol, size, scrambleSteps: rot });
  const backup = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const cell = board.getCell(originRow + r, originCol + c);
      backup.push({ cell, value: cell.value });
      cell.value = givens[r][c] ? values[r][c] : null;
    }
  }
  const valid = backup.every(({ cell }) => cell.value === null || (!(usedMask(cell) & (1 << cell.value)) && extraOk(cell)));
  for (const { cell, value } of backup) cell.value = value; // 다음 회전 계산 전 반드시 복구
  return valid;
}

/**
 * 지금 보이는 given만으로 즉시 통하는(=row/col/box peer, 부가 구조체와 충돌 없는) 회전이
 * 몇 개인지 센다(0~4). 회전 0(무회전=진짜 정답 배치)은 캐빙 결과 그대로라 항상 그럴듯하다.
 */
export function countPlausibleRotations(board, turntable, checkers) {
  let plausible = 0;
  for (let rot = 0; rot < 4; rot++) {
    if (isRotationPlausible(board, turntable, checkers, rot)) plausible++;
  }
  return plausible;
}

/**
 * turntables 배열의 각 턴테이블마다 그럴듯한 방향이 minPlausible개 이상 되도록, 턴테이블
 * 자신의 칸 + row/col/box로 이어진 바깥 이웃 중 given인 칸을 무작위 순서로 하나씩 지워본다.
 * 지워서 유일해가 깨지면 되돌리고, 그대로 유일하면 지운 채로 둔다(그럴듯함이 실제로
 * 나아졌는지는 다음 후보로 넘어가기 전 다시 잰다). 시간 예산을 넘기거나 후보가 떨어지면
 * 그 턴테이블은 포기하고 다음으로 넘어간다 — 완벽히 못 고쳐도 생성 실패는 아니다.
 *
 * 그런데 위 과정은 "4방향 중 최소 2개는 그럴듯함"만 보장할 뿐, 정작 화면에 나갈 회전
 * (turntable.scrambleSteps — deriveRules가 값과 무관하게 미리 무작위로 정해둔 것)이 그
 * 그럴듯한 후보 안에 들어있는지는 보장하지 않는다. 회전 0(무회전)은 캐빙 결과 그대로라
 * 항상 그럴듯해서 minPlausible=2는 "0 + 아무 비-0 회전 하나"만으로도 채워지는데, 그
 * "아무 비-0 회전"이 하필 scrambleSteps가 아닐 수 있다 — 이러면 given끼리 충돌한 채로
 * 퍼즐이 나간다(실제로 재현됨). 그래서 각 턴테이블마다 마지막에 scrambleSteps 자신이
 * 그럴듯한지 확인하고, 아니면 지금 그럴듯한 다른 비-0 회전으로 바꿔치기한다.
 * 반환값 — true면 모든 턴테이블이 충돌 없는 회전으로 나갈 수 있음(그대로 사용해도 됨),
 * false면 적어도 하나가 비-0 회전 전부 충돌이라 못 고쳤다는 뜻이므로 호출 쪽에서
 * generatePuzzle 전체를 다른 시드로 재시도해야 한다.
 */
export async function relaxTurntableAmbiguity(board, turntables, { minPlausible = 2, nodeCap = 30000, timeBudgetMs = 6000, chunkSize = 8 } = {}) {
  if (!turntables.length) return true;

  const checkers = makeCheckers(board);
  const deadline = Date.now() + timeBudgetMs;
  let checksSinceYield = 0;
  let allShippable = true;

  for (const turntable of turntables) {
    if (Date.now() <= deadline && countPlausibleRotations(board, turntable, checkers) < minPlausible) {
      const candidateKeys = new Set();
      for (let r = 0; r < turntable.size; r++) {
        for (let c = 0; c < turntable.size; c++) {
          const row = turntable.originRow + r, col = turntable.originCol + c;
          candidateKeys.add(key(row, col));
          for (const peerKey of checkers.peerIndex.get(key(row, col)) ?? []) candidateKeys.add(peerKey);
        }
      }

      const candidates = shuffle([...candidateKeys])
        .map(k => { const [row, col] = k.split(',').map(Number); return board.getCell(row, col); })
        .filter(cell => cell && cell.isGiven);

      for (const cell of candidates) {
        if (Date.now() > deadline) break;
        if (countPlausibleRotations(board, turntable, checkers) >= minPlausible) break;

        const prevValue = cell.value;
        cell.isGiven = false;
        cell.value = null;
        const { count, capped } = countSolutions(board, { cap: 2, turntableRegions: turntables, nodeCap, checkers });
        if (capped || count !== 1) {
          cell.value = prevValue;
          cell.isGiven = true;
        }

        // countSolutions는 비싸질 수 있어(어려움 난이도, 큰 턴테이블) 탭이 안 멈추게 주기적으로 양보한다.
        if (++checksSinceYield >= chunkSize) {
          checksSinceYield = 0;
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      }
    }

    // 실제 출력 회전이 안전한지 마지막에 반드시 확인 — 위 루프가 시간 예산/후보 소진으로
    // 일찍 끝났어도 이 검사 자체는 가볍다(회전당 NxN칸 충돌 체크, countSolutions 아님).
    const plausibleNonZero = [1, 2, 3].filter(rot => isRotationPlausible(board, turntable, checkers, rot));
    if (!plausibleNonZero.includes(turntable.scrambleSteps)) {
      if (plausibleNonZero.length === 0) { allShippable = false; continue; }
      turntable.scrambleSteps = pick(plausibleNonZero);
    }
  }

  return allShippable;
}
