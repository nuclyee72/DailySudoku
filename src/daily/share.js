/**
 * share.js — 데일리 결과 공유 텍스트 + 3x3 박스 정답률 이모지 그리드.
 *
 * 그리드: 퍼즐의 각 3x3 박스마다 "비-기본칸 중 정답과 일치하는 비율"을 5단계 색(각 20%)으로.
 *   0–20% 🟫 · 20–40% 🟥 · 40–60% 🟧 · 60–80% 🟨 · 80–100% 🟩 · (전부 기본칸) ⬜
 *   겹치지 않은(판 없는) 자리 = ⬛. 공백 대신 이모지로 채워야 앱마다 폭이 안 어긋난다
 *   (공백과 이모지의 폭 비율이 앱/폰트마다 달라 정렬이 절대 안 맞음).
 *
 * 공유 텍스트 형식 (결과창 제목/상세와 같은 2줄 구성):
 *   2026-09-02 · 익스텐디드
 *   12분 34초 · 100% ✅          (어떤 요소가 들어갔는지는 표시하지 않음)
 *   (빈 줄)
 *   <그리드>
 *   (빈 줄)
 *   <링크>
 */
export const VARIANT_LABEL = { standard: '스탠다드', extended: '익스텐디드' };

const TIER_EMOJI = ['🟫', '🟥', '🟧', '🟨', '🟩'];
const ALL_GIVEN_EMOJI = '⬜';
const GAP = '⬛'; // 판이 없는 자리 — 공백은 앱마다 폭이 달라 정렬이 안 맞으므로 이모지로 채운다

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
      line += TIER_EMOJI[Math.min(4, Math.floor((correct / total) * 5))];
    }
    lines.push(line);
  }
  return lines;
}

function formatMinSec(ms) {
  const t = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(t / 60)}분 ${t % 60}초`;
}

const CAL_EMOJI = { solved: '🟩', fail: '🟥', miss: '⬜', pad: '⬛' };

/**
 * 통계 달력을 이모지 텍스트로. results = { 'YYYY-MM-DD': { status, ... } }
 * 성공 🟩 · 실패 🟥 · 안 함 ⬜ · 달 밖(주 정렬용) ⬛
 */
export function buildCalendarShareText({ variant, results, year, month, url }) {
  const firstDow    = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push(CAL_EMOJI.pad);
  let wins = 0, fails = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const r = results[ds];
    if (r && r.status === 'solved') { cells.push(CAL_EMOJI.solved); wins++; }
    else if (r) { cells.push(CAL_EMOJI.fail); fails++; }
    else cells.push(CAL_EMOJI.miss);
  }
  while (cells.length % 7 !== 0) cells.push(CAL_EMOJI.pad);
  const rows = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7).join(''));

  const head = `데일리 스도쿠 ${VARIANT_LABEL[variant] ?? variant} · ${year}-${String(month).padStart(2, '0')}`;
  const parts = [head, `✅ ${wins}  ❌ ${fails}`, '', ...rows, ''];
  if (url) parts.push(url);
  return parts.join('\n');
}

/** 데일리 결과 공유용 전체 텍스트 */
export function buildShareText({ date, variant, status, elapsedMs, board, solutionMap, shape, url }) {
  const pct = completionPct(board, solutionMap);
  const mark = status === 'solved' ? '✅' : '❌';

  const head = `${date} · ${VARIANT_LABEL[variant] ?? variant}`;
  const detail = `${formatMinSec(elapsedMs)} · ${pct}% ${mark}`;

  const parts = [head, detail, '', ...buildShareGrid(board, solutionMap, shape), ''];
  if (url) parts.push(url);
  return parts.join('\n');
}
