/**
 * shapes.js — 자동 생성 "모양" 레지스트리. 보드 원점(3의 배수) 배치만 담는다 —
 * 어떤 규칙(부등호/연속/스네이크/턴테이블)을 붙일지는 composeTemplate.js가 요소 선택을 보고
 * 매번 합성한다. "랜덤"은 여기 저장하지 않고 선택 시점에 이 목록 중 하나로 해석한다.
 */
export const shapes = [
  { id: 'single', label: '단일 1개', boards: [{ row: 0, col: 0 }] },
  { id: 'pair_h', label: '가로 2개', boards: [{ row: 0, col: 0 }, { row: 0, col: 6 }] },
  { id: 'pair_v', label: '세로 2개', boards: [{ row: 0, col: 0 }, { row: 6, col: 0 }] },
  { id: 'pair_diag', label: '대각 2개', boards: [{ row: 0, col: 0 }, { row: 6, col: 6 }] },
  // 6x6(박스 2x2 = 4개) 겹침 — 대각으로 더 깊게. 오프셋은 3의 배수라 3x3 박스 격자가 유지됨.
  { id: 'pair_diag6', label: '대각 깊게 2개', boards: [{ row: 0, col: 0 }, { row: 3, col: 3 }] },
  // 3x6(박스 2개) 코너 겹침 — 아래판이 오른쪽 아래로 {6,3} 이동
  { id: 'pair_corner', label: '코너 3x6 2개', boards: [{ row: 0, col: 0 }, { row: 6, col: 3 }] },
  { id: 'staircase3', label: '계단형 3개', boards: [{ row: 0, col: 0 }, { row: 6, col: 6 }, { row: 12, col: 12 }] },
  { id: 'row3', label: '가로 3개', boards: [{ row: 0, col: 0 }, { row: 0, col: 6 }, { row: 0, col: 12 }] },
  {
    id: 'diamond4',
    label: '마름모형 4개',
    boards: [
      { row: 0, col: 6 },  // 위
      { row: 6, col: 12 }, // 오른쪽
      { row: 12, col: 6 }, // 아래
      { row: 6, col: 0 },  // 왼쪽
    ],
  },
];

export function getShape(shapeId) {
  return shapes.find(s => s.id === shapeId) ?? null;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** 모양의 보드 배치를 미니어처 SVG로 그려준다(자동 생성 선택 UI 미리보기용). */
export function renderShapeThumb(shape) {
  const rows = shape.boards.map(b => b.row);
  const cols = shape.boards.map(b => b.col);
  const minRow = Math.min(...rows);
  const minCol = Math.min(...cols);
  const w = Math.max(...cols) + 9 - minCol;
  const h = Math.max(...rows) + 9 - minRow;

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.classList.add('shape-thumb-svg');
  for (const b of shape.boards) {
    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('x', b.col - minCol);
    rect.setAttribute('y', b.row - minRow);
    rect.setAttribute('width', 9);
    rect.setAttribute('height', 9);
    rect.setAttribute('rx', 1.2);
    svg.appendChild(rect);
  }
  return svg;
}
