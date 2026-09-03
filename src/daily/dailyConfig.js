/**
 * dailyConfig.js — 날짜 → 데일리 퍼즐 "설계"(모양/요소/난이도) 합성.
 * DOM 의존이 없어 브라우저와 Node(생성 스크립트) 양쪽에서 import 가능.
 *
 * 실제 퍼즐 생성은 GitHub Actions(scripts/generate-daily.mjs)가 이 설계로 한 번만 돌려
 * daily/<date>.json 에 커밋한다. 브라우저는 그 JSON을 fetch만 하므로 이 파일을 직접
 * 쓰진 않지만(요소 정보는 JSON 안에 함께 담김), 참고/재현용으로 공용 위치에 둔다.
 */
import { seedRng, pick } from '../generator/random.js';

export function dailySeed(dateStr) { return `daily:${dateStr}`; }

/** 데일리 판 모양 후보 — 9x9 2판 겹침 (가로/세로/↘↙ 대각 3칸·6칸·3x6) */
export const DAILY_SHAPES = [
  'pair_h', 'pair_v',
  'pair_diag', 'pair_diag6', 'pair_corner',
  'pair_diag_bl', 'pair_diag6_bl', 'pair_corner_bl',
];

// ── 요소 풀: 매일 main 풀에서 1개 + sub 풀에서 1개를 시드로 뽑는다 ──
// 아래 상수(요소 풀 / 난이도 / 복원 비율)를 바꾸면 daily/*.json 을 반드시 다시 생성해야 한다:
//   rm daily/*.json && npm run generate-daily -- 2026-09-01 30
/** main 풀 */
export const MAIN_ELEMENTS = ['inequality', 'consecutive'];
/**
 * sub 풀 — 턴테이블은 생성기(회전 스크램블 + 유일해 검사)가 불안정해서 데일리에서 뺐다.
 * 자유 연습에서는 계속 쓸 수 있다. 고치면 다시 넣고 daily/*.json 재생성할 것.
 */
export const SUB_ELEMENTS = ['snake'];

/** 스네이크 길이·턴테이블 크기 범위를 정하는 난이도 — 데일리는 "보통"(3) 고정 */
export const DAILY_DIFFICULTY = 3;

/**
 * 겹침이 큰 모양 — 턴테이블과 조합하면 생성기가 유일해를 보장 못 함
 * (회전 자유도 + 이중으로 겹친 행/열 제약). 이 모양이 나오면 sub는 스네이크로 강제.
 */
export const TIGHT_SHAPES = ['pair_diag6', 'pair_corner', 'pair_diag6_bl', 'pair_corner_bl'];

/**
 * 캐빙(given 최대 제거) 직후 되돌릴 given 비율. 난이도 3의 기본값은 0.175지만
 * 데일리는 시작을 더 빡세게 하려고 0.05로 낮춰 잡는다(값을 되돌릴수록 쉬워짐).
 * generatePuzzle 이 template.restoreRatio 로 받아 restoreRatioFor(difficulty)를 덮어쓴다.
 */
export const DAILY_RESTORE_RATIO = 0.05;

const NONE_ELEMENTS = { inequality: 'none', consecutive: 'none', snake: 'none', turntable: 'none', random: false };

/** 그날의 모양/요소 조합을 결정적으로 뽑는다 */
export function pickDailyMeta(dateStr) {
  seedRng(dailySeed(dateStr) + ':meta');
  const shapeId = pick(DAILY_SHAPES);
  const main = pick(MAIN_ELEMENTS);
  let sub = pick(SUB_ELEMENTS);
  if (TIGHT_SHAPES.includes(shapeId) && sub === 'turntable') sub = 'snake';
  return {
    date: dateStr,
    shapeId,
    main,
    sub,
    difficulty: DAILY_DIFFICULTY,
  };
}

/**
 * composeTemplate.resolveRandomSelection 이 먹는 형태의 selection 2개(스탠다드/익스텐디드).
 * 스탠다드 = 요소 없음, 익스텐디드 = main 1 + sub 1 (각 'normal').
 */
export function dailySelections(dateStr) {
  const meta = pickDailyMeta(dateStr);
  return {
    meta,
    standard: {
      shapeId: meta.shapeId, elements: { ...NONE_ELEMENTS },
      difficulty: meta.difficulty, restoreRatio: DAILY_RESTORE_RATIO,
    },
    extended: {
      shapeId: meta.shapeId,
      elements: { ...NONE_ELEMENTS, [meta.main]: 'normal', [meta.sub]: 'normal' },
      difficulty: meta.difficulty, restoreRatio: DAILY_RESTORE_RATIO,
    },
  };
}
