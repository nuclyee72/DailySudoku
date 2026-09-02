/**
 * storage.js — 데일리 진행 상태 + 통계 localStorage 저장/복원.
 * 모든 접근은 try/catch로 감싼다(프라이빗 모드/차단 브라우저에서도 게임은 되게).
 */
import { shiftDateStr } from './dateUtil.js';

export const DAILY_LIMIT_MS = 15 * 60 * 1000; // 15분

const PROGRESS_KEY = (date, variant) => `dsudoku:progress:${date}:${variant}`;
const STATS_KEY = (variant) => `dsudoku:stats:${variant}`;

function readJSON(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function writeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 저장 실패해도 진행엔 지장 없음 */ }
}

// ── 진행 상태 ──

/** { date, variant, startedAt, status, cells, elapsedMs, finishedAt } | null */
export function loadProgress(date, variant) {
  return readJSON(PROGRESS_KEY(date, variant));
}

export function saveProgress(progress) {
  writeJSON(PROGRESS_KEY(progress.date, progress.variant), progress);
}

/** 진행 중 보드 스냅샷만 갱신 (셀 입력 디바운스에서 호출) */
export function patchProgressCells(date, variant, cells) {
  const p = loadProgress(date, variant);
  if (!p || p.status !== 'playing') return;
  p.cells = cells;
  saveProgress(p);
}

// ── 통계 ──

/** { results: { [date]: { status: 'solved'|'timeout'|'gaveup', elapsedMs, pct } } } */
export function loadStats(variant) {
  const s = readJSON(STATS_KEY(variant));
  return s && s.results ? s : { results: {} };
}

/** 하루의 결과를 1회만 기록 (이미 기록돼 있으면 무시). pct = 완성률(%) — 실패 구간 분류에 씀 */
export function recordResult(variant, date, status, elapsedMs, pct = 0) {
  const s = loadStats(variant);
  if (s.results[date]) return s;
  s.results[date] = { status, elapsedMs, pct };
  writeJSON(STATS_KEY(variant), s);
  return s;
}

// ── 집계 (통계창) ──

// 정답: 10분 미만 한 칸("~10분") + 10~15분 1분 간격 6칸.
// 실패: 완성률을 25% 간격 4칸으로(타임아웃/도중종료 시 얼마나 채웠는지).
// DIST_BUCKETS.length === BUCKET_EDGES_MIN.length + FAIL_BUCKETS 를 항상 유지할 것.
const BUCKET_EDGES_MIN = [10, 11, 12, 13, 14, 15];
export const FAIL_BUCKETS = 4;
export const DIST_BUCKETS = [
  '~10분', '10–11분', '11–12분', '12–13분', '13–14분', '14–15분',
  '❌ ~25%', '❌ ~50%', '❌ ~75%', '❌ ~100%',
];

export function bucketIndexFor(status, elapsedMs, pct = 0) {
  const solvedBuckets = DIST_BUCKETS.length - FAIL_BUCKETS;
  if (status !== 'solved') {
    const q = Math.min(FAIL_BUCKETS - 1, Math.max(0, Math.floor((pct || 0) / 25)));
    return solvedBuckets + q;
  }
  const min = elapsedMs / 60000;
  for (let i = 0; i < BUCKET_EDGES_MIN.length; i++) {
    if (min < BUCKET_EDGES_MIN[i]) return i;
  }
  return BUCKET_EDGES_MIN.length - 1; // 15분에 딱 맞춰 푼 극단값 → 마지막 정답 칸으로
}

/**
 * @param {string} todayStr 현재 KST 날짜 — 연승 계산 기준
 * @returns {{ played, wins, winRate, curStreak, maxStreak, distribution: number[],
 *   results: Record<string,{status,elapsedMs,pct}>, avgSolveMs: number|null, avgFailPct: number|null }}
 */
export function summarize(variant, todayStr) {
  const { results } = loadStats(variant);
  const dates = Object.keys(results).sort();
  const played = dates.length;
  let wins = 0;
  const distribution = DIST_BUCKETS.map(() => 0);
  let solveMsSum = 0, failPctSum = 0, failCount = 0;
  for (const d of dates) {
    const r = results[d];
    if (r.status === 'solved') { wins++; solveMsSum += r.elapsedMs || 0; }
    else { failCount++; failPctSum += r.pct || 0; }
    distribution[bucketIndexFor(r.status, r.elapsedMs, r.pct)]++;
  }

  // 최고 연승: 날짜가 하루씩 이어지면서 solved인 최장 구간
  let maxStreak = 0, run = 0, prev = null;
  for (const d of dates) {
    const consecutive = prev && shiftDateStr(prev, 1) === d;
    if (results[d].status === 'solved') {
      run = consecutive ? run + 1 : 1;
    } else {
      run = 0;
    }
    if (run > maxStreak) maxStreak = run;
    prev = d;
  }

  // 현재 연승: 오늘(또는 어제)부터 뒤로 이어지는 solved
  let curStreak = 0;
  let cursor = results[todayStr] ? todayStr : shiftDateStr(todayStr, -1);
  while (results[cursor] && results[cursor].status === 'solved') {
    curStreak++;
    cursor = shiftDateStr(cursor, -1);
  }

  return {
    played,
    wins,
    winRate: played ? Math.round((wins / played) * 100) : 0,
    curStreak,
    maxStreak,
    distribution,
    results,
    avgSolveMs: wins ? solveMsSum / wins : null,
    avgFailPct: failCount ? failPctSum / failCount : null,
  };
}
