/**
 * share.js — 데일리 결과 공유 텍스트 + 3x3 박스 정답률 이모지 그리드.
 *
 * 그리드: 퍼즐의 각 3x3 박스마다 "비-기본칸 중 정답과 일치하는 비율"을 5단계 색(각 20%)으로.
 *   0–20% ⬛ · 20–40% 🟫 · 40–60% 🟧 · 60–80% 🟨 · 80–100% 🟩 · (전부 기본칸) ⬜
 *
 * 공유 텍스트 형식:
 *   2026-09-02 · 스탠다드 · 12분 34초 · 100% ✅ [‹ 🐍]   (요소는 이모지만 [] 안에, 스탠다드는 요소 없음)
 *   (빈 줄)
 *   <그리드>
 *   (빈 줄)
 *   <링크>
 */
import { ELEMENT_INFO } from './elementInfo.js';

export const VARIANT_LABEL = { standard: '스탠다드', extended: '익스텐디드' };

/** 요소 키 배열 → "[아이콘 아이콘]" (없으면 빈 문자열) */
export function elementBracket(keys) {
  const icons = (keys ?? []).map((k) => ELEMENT_INFO[k]?.icon).filter(Boolean).join(' ');
  return icons ? `[${icons}]` : '';
}

const TIER_EMOJI = ['⬛', '🟫', '🟧', '🟨', '🟩'];
const ALL_GIVEN_EMOJI = '⬜';
const GAP = '　'; // 전각 공백 — 겹치지 않은 박스 자리

/** 퍼즐에 존재하는 유일한 3x3 박스 원점들 (겹친 판이면 공유 박스는 1개로) */
function boxOrigins(shape) {
  const set = new Map();
  for (const b of shape.boards) {
    for (let r = 0; r < 9; r += 3) {
      for (let c = 0; c < 9; c += 3) {
        const or = b.row + r, oc = b.col + c;
        set.set(`${or},${oc}`, { row: or, col: oc });
      }
    }
  }
  return [...set.values()];
}

/** 비-기본칸 중 정답과 일치하는 비율(%) — 결과창·공유 공용 */
export function completionPct(board, solutionMap) {
  let total = 0, correct = 0;
  for (const cell of board.getVisibleCells()) {
    const key = `${cell.row},${cell.col}`;
    if (cell.isGiven || !solutionMap.has(key)) continue;
    total++;
    if (cell.value === solutionMap.get(key)) correct++;
  }
  return total ? Math.round((correct / total) * 100) : 0;
}

/**
 * @param {import('../core/Board.js').Board} board
 * @param {Map<string, number>} solutionMap  "r,c" -> 정답값 (턴테이블 칸 제외)
 * @param {{boards: {row,col}[]}} shape
 * @returns {string[]} 이모지 행 배열
 */
export function buildShareGrid(board, solutionMap, shape) {
  const origins = boxOrigins(shape);
  const boxRows = [...new Set(origins.map((o) => o.row))].sort((a, b) => a - b);
  const boxCols = [...new Set(origins.map((o) => o.col))].sort((a, b) => a - b);
  const present = new Set(origins.map((o) => `${o.row},${o.col}`));

  const lines = [];
  for (const br of boxRows) {
    let line = '';
    for (const bc of boxCols) {
      if (!present.has(`${br},${bc}`)) { line += GAP; continue; }
      let total = 0, correct = 0;
      for (let r = br; r < br + 3; r++) {
        for (let c = bc; c < bc + 3; c++) {
          const key = `${r},${c}`;
          if (!solutionMap.has(key)) continue;
          const cell = board.getCell(r, c);
          if (!cell || cell.isGiven) continue;
          total++;
          if (cell.value === solutionMap.get(key)) correct++;
        }
      }
      if (total === 0) { line += ALL_GIVEN_EMOJI; continue; }
      const tier = Math.min(4, Math.floor((correct / total) * 5));
      line += TIER_EMOJI[tier];
    }
    lines.push(line);
  }
  return lines;
}

function formatMinSec(ms) {
  const t = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(t / 60)}분 ${t % 60}초`;
}

/** 데일리 결과 공유용 전체 텍스트 */
export function buildShareText({ date, variant, status, elapsedMs, elements, board, solutionMap, shape, url }) {
  const pct = completionPct(board, solutionMap);
  const mark = status === 'solved' ? '✅' : '❌';

  let line1 = `${date} · ${VARIANT_LABEL[variant] ?? variant} · ${formatMinSec(elapsedMs)} · ${pct}% ${mark}`;
  if (variant === 'extended' && elements) {
    const bracket = elementBracket([elements.main, elements.sub]);
    if (bracket) line1 += ` ${bracket}`;
  }

  const parts = [line1, '', ...buildShareGrid(board, solutionMap, shape), ''];
  if (url) parts.push(url);
  return parts.join('\n');
}
