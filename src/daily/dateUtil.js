/**
 * dateUtil.js — 데일리 경계는 KST(UTC+9) 자정 고정.
 * 브라우저·Node 공용 (DOM/Date 표준 API만 사용).
 */
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 주어진 시각(기본: 지금) 기준 KST 날짜를 'YYYY-MM-DD'로 */
export function dateStrKST(at = Date.now()) {
  const d = new Date(at + KST_OFFSET_MS);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 'YYYY-MM-DD'를 하루 이동 */
export function shiftDateStr(dateStr, deltaDays) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const base = Date.UTC(y, m - 1, d);
  const moved = new Date(base + deltaDays * 86400000);
  const yy = moved.getUTCFullYear();
  const mm = String(moved.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(moved.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/** 다음 KST 자정까지 남은 ms */
export function msUntilNextKSTMidnight(at = Date.now()) {
  const shifted = at + KST_OFFSET_MS;
  const dayMs = shifted % 86400000;
  return 86400000 - dayMs;
}

/** ms → "HH:MM:SS" */
export function formatCountdown(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}
