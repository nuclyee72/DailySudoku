/**
 * elementInfo.js — 변형 요소별 라벨/아이콘/설명 (사이드바 · 공유 텍스트 공용)
 */
export const ELEMENT_INFO = {
  inequality: {
    label: '부등호',
    icon: '‹',
    desc: '인접한 두 칸 사이의 쐐기 표시 — 뾰족한 끝이 가리키는 칸의 숫자가 더 작아야 합니다.',
  },
  consecutive: {
    label: '연속',
    icon: '∙∙',
    desc: '표시가 있는 인접한 두 칸은 숫자가 연속(차이가 1)이어야 합니다.',
  },
  snake: {
    label: '스네이크',
    icon: '🐍',
    desc: '표시된 영역의 칸을 한 번씩 지나는 경로 — 시작 칸부터 한 걸음마다 숫자가 1씩만 오르내려야 합니다.',
  },
  turntable: {
    label: '턴테이블',
    icon: '⟳',
    desc: '3x3~4x4 영역을 90도씩 돌릴 수 있는 판 — 돌리면 숫자·초기 제공 칸·메모가 함께 회전합니다.',
  },
};

export function elementLabel(key) { return ELEMENT_INFO[key]?.label ?? key; }
export function elementIcon(key) { return ELEMENT_INFO[key]?.icon ?? '?'; }
