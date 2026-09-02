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

/** 데일리 판 모양 후보 — 9x9 2판이 3칸 겹치는 배치 (세로/가로/대각) */
export const DAILY_SHAPES = ['pair_h', 'pair_v', 'pair_diag'];

// ── 요소 풀: 매일 main 풀에서 1개 + sub 풀에서 1개를 시드로 뽑는다 ──
// 여기를 바꾸면 daily/*.json 을 반드시 다시 생성해야 한다:
//   rm daily/*.json && npm run generate-daily -- 2026-09-01 30
/** main 풀 */
export const MAIN_ELEMENTS = ['inequality', 'consecutive'];
/** sub 풀 */
export const SUB_ELEMENTS = ['snake', 'turntable'];

/** 난이도는 데일리에서 항상 "보통"(3) 고정 */
export const DAILY_DIFFICULTY = 3;

const NONE_ELEMENTS = { inequality: 'none', consecutive: 'none', snake: 'none', turntable: 'none', random: false };

/** 그날의 모양/요소 조합을 결정적으로 뽑는다 */
export function pickDailyMeta(dateStr) {
  seedRng(dailySeed(dateStr) + ':meta');
  return {
    date: dateStr,
    shapeId: pick(DAILY_SHAPES),
    main: pick(MAIN_ELEMENTS),
    sub: pick(SUB_ELEMENTS),
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
    standard: { shapeId: meta.shapeId, elements: { ...NONE_ELEMENTS }, difficulty: meta.difficulty },
    extended: {
      shapeId: meta.shapeId,
      elements: { ...NONE_ELEMENTS, [meta.main]: 'normal', [meta.sub]: 'normal' },
      difficulty: meta.difficulty,
    },
  };
}
