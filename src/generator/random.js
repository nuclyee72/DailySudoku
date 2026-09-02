/**
 * random.js — 생성기 전역에서 쓰는 랜덤 유틸.
 *
 * 기본은 Math.random 이지만, seedRng(seedStr)로 결정적 PRNG(mulberry32)를 심을 수 있다.
 * 데일리 퍼즐은 GitHub Actions가 날짜 시드로 한 번만 생성해 커밋하므로 전원이 동일한
 * 퍼즐을 받지만, 시드를 넣어 두면 같은 날짜 재생성이 멱등해지고 디버깅이 쉬워진다.
 */

let _rng = Math.random;

/** 문자열 → 32bit 해시 (cyrb53 축약판) */
function hashStr(str) {
  let h1 = 0xdeadbeef ^ str.length;
  let h2 = 0x41c6ce57 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0);
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** seedStr(문자열/숫자)로 결정적 PRNG를 심는다. 인자 없이 부르면 Math.random으로 되돌린다. */
export function seedRng(seedStr) {
  if (seedStr === undefined || seedStr === null) { _rng = Math.random; return; }
  _rng = mulberry32(typeof seedStr === 'number' ? (seedStr >>> 0) : hashStr(String(seedStr)));
}

/** 현재 심어진 rng의 [0,1) 난수 — Math.random을 직접 쓰던 자리에서 이 함수를 쓴다. */
export function nextFloat() {
  return _rng();
}

export function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(_rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function randInt(minInclusive, maxInclusive) {
  return minInclusive + Math.floor(_rng() * (maxInclusive - minInclusive + 1));
}

export function pick(arr) {
  return arr[Math.floor(_rng() * arr.length)];
}
