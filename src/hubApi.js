/**
 * hubApi.js — ProjectDaily 허브(/ProjectDaily/)가 카드 안에서 이 게임의 통계를 보여 줄 때 쓰는 모듈.
 * 게임 통계창과 같은 계산(storage · share)을 그대로 쓴다. DOM은 건드리지 않는다.
 * (세 게임 모두 같은 모양: stats · calendarShareText · todayShareText)
 */
import { dateStrKST } from './daily/dateUtil.js';
import { summarize, loadProgress, DIST_BUCKETS, FAIL_BUCKETS } from './daily/storage.js';
import { buildCalendarShareText, buildShareText } from './daily/share.js';
import { Board } from './core/Board.js';
import { reviveStructures } from './puzzles/reviveStructures.js';

const SITE_URL = 'https://nuclyee72.github.io/DailySudoku/';

/** 숫자 4개 + 분포 막대 */
export function stats(mode) {
  const s = summarize(mode, dateStrKST());
  return {
    played: s.played, winRate: s.winRate, curStreak: s.curStreak, maxStreak: s.maxStreak,
    distTitle: '완성 시간 분포',
    dist: DIST_BUCKETS.map((label, i) => ({ label, count: s.distribution[i], fail: i >= DIST_BUCKETS.length - FAIL_BUCKETS })),
  };
}

/** 📋 달력 공유 문구 */
export function calendarShareText(mode, year, month) {
  const { results } = summarize(mode, dateStrKST());
  return buildCalendarShareText({ variant: mode, results, year, month, url: SITE_URL });
}

/** 오늘 결과 공유 문구 — 오늘 그 모드를 아직 안 끝냈으면 null */
export async function todayShareText(mode) {
  const today = dateStrKST();
  const prog = loadProgress(today, mode);
  if (!prog || prog.status === 'playing') return null;
  const res = await fetch(new URL(`../daily/${today}.json`, import.meta.url), { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${today} 퍼즐을 찾을 수 없음`);
  const data = await res.json();
  const vd = data[mode];
  // 저장된 셀로 임시 보드를 만들어 공유 그리드를 계산 (게임 통계창과 같은 방식)
  const board = new Board();
  board.addStructures(reviveStructures(vd.structures));
  board.loadGivens(vd.givens);
  if (prog.cells) board.loadSerialized(prog.cells);
  const solutionMap = new Map((vd.solution ?? []).map((s) => [`${s.row},${s.col}`, s.value]));
  return buildShareText({
    date: today, variant: mode, status: prog.status, elapsedMs: prog.elapsedMs,
    board, solutionMap, shape: data.shape, url: SITE_URL,
  });
}
