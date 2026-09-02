/**
 * BoardRenderer.js — SVG 기반 스도쿠 게임판 렌더링
 * - 마우스 커서 기준 휠 줌
 * - boardDrag 참조를 통해 드래그 중 셀 클릭 억제
 */
import { Validator } from '../core/Validator.js';

const CELL       = 56;
const PAD        = 8;
const THIN       = 1;
const THICK      = 3;
const GRID_THICK = 6; // 9x9 판 전체 테두리 — 3x3 박스 테두리(THICK)보다 두껍게
const DRAW_WIDTH = 3.5; // 그리기 펜 굵기
// 손가락 터치는 접촉면이 넓어서 실제 터치 좌표 그대로 그리면 손가락에 잉크가 가려져
// "터치한 곳과 그려지는 곳이 다르다"고 느껴진다 — 손가락 위로 살짝 띄워서 그리면(다른 드로잉
// 앱들의 통상적인 처리) 항상 손끝 바로 위에 획이 보인다. 화면 픽셀 단위라 확대해도 항상 같은
// 시각적 거리만큼 떠 보인다. 마우스/펜은 접촉면 문제가 없으므로 오프셋을 주지 않는다.
const TOUCH_DRAW_Y_OFFSET = 24;

export class BoardRenderer {
  /**
   * @param {SVGElement} svgEl
   * @param {import('../core/Board.js').Board} board
   */
  constructor(svgEl, board) {
    this.svg   = svgEl;
    this.board = board;
    this.selectedCell = null;
    this.scale = 1;
    this.onCellSelect = null;
    this.noteMode = false; // true면 숫자 입력이 실제 값이 아닌 메모(후보 숫자)로 기록됨
    this.inputLocked = false; // true면 턴테이블 회전 등 렌더러 내부 상호작용을 막는다(값 입력은 호출부가 boardLocked로 막음)

    /**
     * 설정돼 있으면(협동 모드) 값 입력이 로컬로 반영되는 대신 이 함수로만 위임되고,
     * 실제 반영은 applyRemoteCellUpdate()를 통해 서버 확정 결과가 돌아온 뒤에만 일어난다.
     */
    this.remoteInputHandler = null;

    /** remoteInputHandler와 같은 원리, 턴테이블 회전(structure, steps)용 */
    this.remoteRotateHandler = null;

    /**
     * 실행 취소 스택 — 각 항목은 [{row, col, prevValue, prevCandidates}, ...](칸 입력) 이거나
     * {type:'stroke', strokeId}(그리기 획) 중 하나 — undo()가 항목 형태를 보고 분기한다
     */
    this._undoStack = [];

    /** boardDrag 참조 — 드래그 후 클릭 억제에 사용 */
    this.boardDrag = null;

    /** 그리기 기능 — 획 목록, 켜짐 여부, 그리는 중인 획 */
    this._strokes = [];
    this.drawMode = false;
    this._activeStroke = null;
    this._activePointerId = null;

    /** 새 획을 그릴 때 쓸 색 — 싱글/배틀은 기본 펜 색, 협동은 main.js가 내 참가자 색으로 맞춰준다 */
    this.drawColor = 'var(--draw-ink)';
    /** 협동 모드에서 내가 그린 획에 붙일 참가자 id — main.js가 방 입장 시 채워준다 */
    this.myPlayerId = null;
    /** "이 참가자 그림 숨기기"로 로컬에서 감춰둔 participant id 집합 */
    this._hiddenDrawPlayers = new Set();

    /** 설정돼 있으면 로컬에서 완성된 획/삭제된 획을 알려준다(협동 모드 브로드캐스트용) */
    this.onStrokeAdded = null;
    this.onStrokeRemoved = null;

    this._els    = new Map(); // "r,c" → {rect, text, conflictRect}
    this._minRow = 0;
    this._minCol = 0;

    this.render();
  }

  // ── 좌표 변환 ──
  _px(col) { return PAD + (col - this._minCol) * CELL; }
  _py(row) { return PAD + (row - this._minRow) * CELL; }

  // ── 전체 렌더 ──
  render() {
    const { minRow, maxRow, minCol, maxCol } = this.board.getBounds();
    this._minRow = minRow;
    this._minCol = minCol;

    const W = (maxCol - minCol + 1) * CELL + PAD * 2;
    const H = (maxRow - minRow + 1) * CELL + PAD * 2;

    this.svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    this.svg.setAttribute('width',  W);
    this.svg.setAttribute('height', H);

    while (this.svg.firstChild) this.svg.removeChild(this.svg.firstChild);
    this._els.clear();
    this._filledBy = new Map();     // "r,c" → 채운 사람 색(협동 모드 전용)
    this._remoteCursors = new Map(); // playerId → {rect}(협동 모드 전용)

    this._gConflicts    = this._g('g-conflicts');
    this._gTurntableUI       = null; // 턴테이블 손잡이 — 칸 클릭 시 처음 그릴 때 새로 생성됨
    this._turntableUIStructure = null;

    this._drawCells();
    this._drawTurntableCrosses(); // 칸 배경보다 위, 숫자보다 아래
    this.svg.appendChild(this._gCellsFg);
    this._drawThinLines();
    this._drawBoxBorders();
    this._drawGridBorders();
    this._drawTurntableRings();

    this.svg.appendChild(this._gConflicts);

    // 스네이크 테두리를 부등호/연속보다 먼저(=아래) 쌓는다 — 겹칠 때 부등호/연속 표시가
    // 위로 보이도록. _updateSnakePaths()는 아래서 미리 만들어둔 빈 그룹을 그대로
    // 채우기만 하므로(내부의 lazy-생성 분기는 안전망으로 남겨둠) 자리부터 잡아둔다.
    this._gSnakeOutline = this._g('g-snake-outline');
    this.svg.appendChild(this._gSnakeOutline);
    this._gSnakePath = this._g('g-snake-path');
    this.svg.appendChild(this._gSnakePath);

    // 에러 테두리 → 스네이크 → 부등호/연속 표시 순으로 위에 쌓이도록 삽입
    this._drawInequalities();
    this._drawConsecutives();

    Validator.validate(this.board);
    this._updateAll();

    // 원격 커서 닉네임 태그 — 메모(후보 숫자)에 가려져도 무방하므로 메모보다 먼저(아래) 둔다
    this._gRemoteCursorLabels = this._g('g-remote-cursor-labels');
    this._gRemoteCursorLabels.setAttribute('pointer-events', 'none');
    this.svg.appendChild(this._gRemoteCursorLabels);

    // 메모(후보 숫자) 레이어 — 스네이크 시작점 표시 등 다른 장식에 가려지지 않도록
    // 맨 마지막 쪽(원격 커서 선택 테두리 바로 아래)에 둔다
    this.svg.appendChild(this._gCellsNotes);

    // 원격 커서 선택 테두리 — 항상 맨 위(가장 나중에 append)에 그려지도록 마지막에 추가
    this._gRemoteCursors = this._g('g-remote-cursors');
    this._gRemoteCursors.setAttribute('pointer-events', 'none');
    this.svg.appendChild(this._gRemoteCursors);

    // 그리기(펜) 레이어 — 무엇에 겹쳐 그리든 항상 보이도록 최상단에 둔다.
    // 획 목록(this._strokes)은 render()가 다시 불려도 유지되므로 여기서 다시 그려준다.
    this._gDraw = this._g('g-draw');
    this._gDraw.setAttribute('pointer-events', 'none');
    this.svg.appendChild(this._gDraw);
    for (const stroke of this._strokes) this._renderStroke(stroke);

    this.svg.classList.toggle('draw-mode', this.drawMode);
  }

  // ── 그리기(펜) ──

  /**
   * 그리기 모드일 때 게임판 밖(화면 전체)에서도 입력을 받을 수 있도록, main.js가 만든
   * 뷰포트 전체 크기의 HTML 오버레이 요소를 입력면으로 등록한다. render()가 다시 불려도
   * (퍼즐 교체 등) 이 요소 자체는 SVG 밖에 있어 계속 살아있으므로 한 번만 호출하면 된다.
   * 좌표 변환(_svgPointFromClient)은 클릭 위치가 보드 영역 밖이어도 그대로 동작한다.
   */
  bindExternalDrawSurface(el) {
    this._externalDrawSurface = el;
    this._bindDrawEvents(el);
  }

  /** 그리기 모드 on/off — 켜지면 화면 전체(게임판 밖 포함) 포인터 입력이 칸 선택 대신 그리기로 간다 */
  setDrawMode(on) {
    this.drawMode = on;
    if (this._externalDrawSurface) this._externalDrawSurface.classList.toggle('draw-mode', on);
    this.svg.classList.toggle('draw-mode', on);
    if (!on && this._activeStroke) this._endStroke();
  }

  _svgPointFromClient(clientX, clientY, pointerType) {
    const ctm = this.svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const pt = this.svg.createSVGPoint();
    pt.x = clientX;
    // 화면(스크린) 좌표 단계에서 오프셋을 적용해야 확대 배율과 무관하게 항상 같은
    // 시각적 거리만큼 손끝 위에 떠 보인다 - SVG 좌표 변환 뒤에 더하면 확대할수록 오프셋이
    // 점점 작아 보인다.
    pt.y = pointerType === 'touch' ? clientY - TOUCH_DRAW_Y_OFFSET : clientY;
    const local = pt.matrixTransform(ctm.inverse());
    return { x: local.x, y: local.y };
  }

  _strokeToPathD(points) {
    if (!points.length) return '';
    if (points.length === 1) return `M ${points[0].x} ${points[0].y} L ${points[0].x} ${points[0].y}`;
    return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  }

  /** 획 하나를 SVG path로 만들어 그리기 레이어에 붙인다(로컬 진행 중/완성 획, 원격 획 공용) */
  _renderStroke(stroke) {
    const el = this._el('path');
    el.setAttribute('fill', 'none');
    el.setAttribute('stroke', stroke.color || 'var(--draw-ink)');
    el.setAttribute('stroke-width', DRAW_WIDTH);
    el.setAttribute('stroke-linecap', 'round');
    el.setAttribute('stroke-linejoin', 'round');
    el.setAttribute('d', this._strokeToPathD(stroke.points));
    if (stroke.playerId && this._hiddenDrawPlayers.has(stroke.playerId)) el.style.display = 'none';
    stroke.el = el;
    this._gDraw.appendChild(el);
    return el;
  }

  _bindDrawEvents(rect) {
    rect.addEventListener('pointerdown', (e) => {
      if (!this.drawMode || e.button !== 0) return;
      e.preventDefault();
      rect.setPointerCapture(e.pointerId);
      this._activePointerId = e.pointerId;
      this._activeStroke = {
        id: `s${Date.now()}${Math.random().toString(36).slice(2, 8)}`,
        points: [this._svgPointFromClient(e.clientX, e.clientY, e.pointerType)],
        color: this.drawColor,
        playerId: this.myPlayerId,
      };
      this._renderStroke(this._activeStroke);
    });
    rect.addEventListener('pointermove', (e) => {
      if (!this._activeStroke || e.pointerId !== this._activePointerId) return;
      const pt = this._svgPointFromClient(e.clientX, e.clientY, e.pointerType);
      const pts = this._activeStroke.points;
      const last = pts[pts.length - 1];
      if (Math.hypot(pt.x - last.x, pt.y - last.y) < 1.5) return; // 점이 너무 촘촘히 쌓이지 않게
      pts.push(pt);
      this._activeStroke.el.setAttribute('d', this._strokeToPathD(pts));
    });
    const finish = (e) => {
      if (!this._activeStroke || e.pointerId !== this._activePointerId) return;
      this._endStroke();
    };
    rect.addEventListener('pointerup', finish);
    rect.addEventListener('pointercancel', finish);
  }

  _endStroke() {
    const stroke = this._activeStroke;
    this._activeStroke = null;
    this._activePointerId = null;
    if (!stroke) return;
    this._strokes.push(stroke);
    this._pushUndo({ type: 'stroke', strokeId: stroke.id });
    if (this.onStrokeAdded) this.onStrokeAdded({ id: stroke.id, points: stroke.points });
  }

  _removeStrokeById(id) {
    const idx = this._strokes.findIndex((s) => s.id === id);
    if (idx === -1) return false;
    const [stroke] = this._strokes.splice(idx, 1);
    stroke.el?.remove();
    return true;
  }

  /** 원격(다른 참가자)이 완성한 획을 받아 로컬에 반영 — undo 스택에는 쌓지 않는다 */
  applyRemoteStroke(stroke) {
    if (this._strokes.some((s) => s.id === stroke.id)) return;
    const copy = { id: stroke.id, points: stroke.points, color: stroke.color, playerId: stroke.playerId ?? null };
    this._strokes.push(copy);
    this._renderStroke(copy);
  }

  /** 원격에서 실행 취소된 획을 로컬에서도 제거 */
  applyRemoteStrokeRemove(strokeId) {
    this._removeStrokeById(strokeId);
  }

  /** "이 참가자 그림 숨기기" — 서버/다른 참가자에겐 영향 없는 순전히 내 화면만의 필터 */
  setPlayerStrokesHidden(playerId, hidden) {
    if (hidden) this._hiddenDrawPlayers.add(playerId);
    else this._hiddenDrawPlayers.delete(playerId);
    for (const s of this._strokes) {
      if (s.playerId === playerId && s.el) s.el.style.display = hidden ? 'none' : '';
    }
  }

  /** 모든 획을 지운다("전부 지우기" 버튼 / 원격 clear 수신 공용) */
  clearAllStrokes() {
    for (const stroke of this._strokes) stroke.el?.remove();
    this._strokes = [];
    this._undoStack = this._undoStack.filter((e) => !(e && e.type === 'stroke'));
  }

  /** 서버가 내려준 획 스냅샷과 로컬 상태를 맞춘다(참가/재접속/재동기화 시 멱등하게 호출 가능) */
  syncStrokes(strokesSnapshot) {
    const incomingIds = new Set(strokesSnapshot.map((s) => s.id));
    for (const s of [...this._strokes]) {
      if (!incomingIds.has(s.id)) this._removeStrokeById(s.id);
    }
    for (const s of strokesSnapshot) {
      if (!this._strokes.some((x) => x.id === s.id)) this.applyRemoteStroke(s);
    }
  }

  // ── 셀 배경 + 텍스트 ──
  // 배경(rect)과 글자(text/메모)를 별도 레이어로 나눠서 그린다 — 그 사이에 턴테이블
  // 중심 십자 레이어를 끼워 넣어 "칸 배경보다는 위, 숫자보다는 아래"에 두기 위함.
  _drawCells() {
    const gBg = this._g('g-cells-bg');
    const gFg = this._g('g-cells');
    // 메모는 스네이크 시작점 표시 등 다른 장식 위에 항상 보이도록 별도 최상단 레이어에 그린다
    // (render()에서 맨 마지막 쪽에 append됨) — gFg와 분리해 관리한다.
    const gNotes = this._g('g-cells-notes');
    this._gCellsNotes = gNotes;
    for (const cell of this.board.getVisibleCells()) {
      const x = this._px(cell.col), y = this._py(cell.row);

      const rect = this._el('rect');
      rect.setAttribute('x', x);           rect.setAttribute('y', y);
      rect.setAttribute('width',  CELL);   rect.setAttribute('height', CELL);
      rect.setAttribute('rx', '3');
      rect.setAttribute('fill', 'var(--cell-bg)');
      rect.style.cursor = 'pointer';
      rect.addEventListener('click', () => this._onClick(cell.row, cell.col));
      gBg.appendChild(rect);

      const text = this._el('text');
      text.setAttribute('x', x + CELL / 2);
      text.setAttribute('y', y + CELL / 2 + 1);
      text.setAttribute('text-anchor',       'middle');
      text.setAttribute('dominant-baseline', 'central');
      text.setAttribute('font-size',   Math.floor(CELL * 0.48));
      text.setAttribute('font-family', 'Outfit, Inter, sans-serif');
      text.setAttribute('pointer-events', 'none');
      text.style.userSelect = 'none';
      gFg.appendChild(text);

      // ── 메모(후보 숫자) — 셀을 1~9 위치(123/456/789)로 나눈 작은 숫자 ──
      const notesGroup = this._el('g');
      notesGroup.setAttribute('class', 'cell-notes');
      notesGroup.setAttribute('pointer-events', 'none');
      const noteTexts = [];
      for (let i = 1; i <= 9; i++) {
        const nr = Math.floor((i - 1) / 3), nc = (i - 1) % 3;
        const nt = this._el('text');
        nt.setAttribute('x', x + (nc + 0.5) * (CELL / 3));
        nt.setAttribute('y', y + (nr + 0.5) * (CELL / 3) + 1);
        nt.setAttribute('text-anchor',       'middle');
        nt.setAttribute('dominant-baseline', 'central');
        nt.setAttribute('font-size',   Math.floor(CELL / 3 * 0.68));
        nt.setAttribute('font-family', 'Outfit, Inter, sans-serif');
        nt.setAttribute('fill', 'var(--text-note)');
        notesGroup.appendChild(nt);
        noteTexts.push(nt);
      }
      gNotes.appendChild(notesGroup);

      const conflictRect = this._el('rect');
      conflictRect.setAttribute('x', x);           conflictRect.setAttribute('y', y);
      conflictRect.setAttribute('width',  CELL);   conflictRect.setAttribute('height', CELL);
      conflictRect.setAttribute('rx', '3');
      conflictRect.setAttribute('fill', 'none');
      conflictRect.setAttribute('stroke', 'var(--conflict)');
      conflictRect.setAttribute('stroke-width', GRID_THICK);
      conflictRect.setAttribute('pointer-events', 'none');
      conflictRect.setAttribute('display', 'none');
      this._gConflicts.appendChild(conflictRect);

      // "채운 사람" 마커 (협동 모드 전용) — 값이 있을 때만 보이는 우하단 삼각형, 색은 채운 플레이어 색
      const filledByMarker = this._el('polygon');
      const m = 11;
      filledByMarker.setAttribute('points', `${x + CELL},${y + CELL} ${x + CELL - m},${y + CELL} ${x + CELL},${y + CELL - m}`);
      filledByMarker.setAttribute('pointer-events', 'none');
      filledByMarker.setAttribute('display', 'none');
      gFg.appendChild(filledByMarker);

      this._els.set(`${cell.row},${cell.col}`, { rect, text, conflictRect, notesGroup, noteTexts, filledByMarker });
    }
    this.svg.appendChild(gBg);
    this._gCellsFg = gFg; // 턴테이블 십자 레이어를 그린 다음 render()에서 appendChild 됨
  }

  // ── 얇은 선 (인접 셀 경계) ──
  _drawThinLines() {
    const g   = this._g('g-thin');
    const vis = new Set(this.board.getVisibleCells().map(c => `${c.row},${c.col}`));
    for (const cell of this.board.getVisibleCells()) {
      const x = this._px(cell.col), y = this._py(cell.row);
      if (vis.has(`${cell.row},${cell.col + 1}`))
        g.appendChild(this._line(x+CELL, y, x+CELL, y+CELL, THIN, 'var(--grid-line)'));
      if (vis.has(`${cell.row + 1},${cell.col}`))
        g.appendChild(this._line(x, y+CELL, x+CELL, y+CELL, THIN, 'var(--grid-line)'));
    }
    this.svg.appendChild(g);
  }

  // ── 두꺼운 박스 경계선 ──
  _drawBoxBorders() {
    const g = this._g('g-boxes');
    for (const s of this.board.structures.filter(s => s.type === 'box3x3')) {
      const x = this._px(s.originCol), y = this._py(s.originRow);
      const r = this._el('rect');
      r.setAttribute('x', x);             r.setAttribute('y', y);
      r.setAttribute('width',  CELL * 3); r.setAttribute('height', CELL * 3);
      r.setAttribute('fill',         'none');
      r.setAttribute('stroke',       'var(--box-line)');
      r.setAttribute('stroke-width', THICK);
      r.setAttribute('rx', '4');
      g.appendChild(r);
    }
    this.svg.appendChild(g);
  }

  // ── 더 두꺼운 9x9 판 전체 경계선 (3x3 박스 경계선보다 두껍게) ──
  _drawGridBorders() {
    const g = this._g('g-grids');
    for (const s of this.board.structures.filter(s => s.type === 'grid9x9')) {
      const x = this._px(s.originCol), y = this._py(s.originRow);
      const r = this._el('rect');
      r.setAttribute('x', x);             r.setAttribute('y', y);
      r.setAttribute('width',  CELL * 9); r.setAttribute('height', CELL * 9);
      r.setAttribute('fill',         'none');
      r.setAttribute('stroke',       'var(--box-line)');
      r.setAttribute('stroke-width', GRID_THICK);
      r.setAttribute('rx', '5');
      g.appendChild(r);
    }
    this.svg.appendChild(g);
  }

  // ── 부등호 표시 (인접한 두 칸 사이, 더 작은 값 쪽을 뾰족한 끝이 가리킴) ──
  _drawInequalities() {
    const g = this._g('g-inequalities');
    const vis = new Set(this.board.getVisibleCells().map(c => `${c.row},${c.col}`));
    for (const s of this.board.structures.filter(s => s.type === 'inequality')) {
      const { a, b, greater } = s;
      if (!vis.has(`${a.row},${a.col}`) || !vis.has(`${b.row},${b.col}`)) continue;

      const ax = this._px(a.col) + CELL / 2, ay = this._py(a.row) + CELL / 2;
      const bx = this._px(b.col) + CELL / 2, by = this._py(b.row) + CELL / 2;
      const mx = (ax + bx) / 2, my = (ay + by) / 2;

      // 더 작은 값을 가져야 하는 칸 쪽으로 쐐기 끝이 향하도록 회전각 계산
      const smallerX = greater === 'a' ? bx : ax;
      const smallerY = greater === 'a' ? by : ay;
      const angle = Math.atan2(smallerY - my, smallerX - mx) * 180 / Math.PI;

      const chevron = this._el('polyline');
      const w = 7, h = 6; // 로컬 좌표: 기본적으로 -X(왼쪽)를 가리키는 꺾인 부등호 모양
      chevron.setAttribute('points', `${w},${-h} ${-w},0 ${w},${h}`);
      chevron.setAttribute('transform', `translate(${mx},${my}) rotate(${angle - 180})`);
      chevron.setAttribute('fill', 'none');
      chevron.setAttribute('stroke', 'var(--ineq-mark)');
      chevron.setAttribute('stroke-width', '2.5');
      chevron.setAttribute('stroke-linecap', 'round');
      chevron.setAttribute('stroke-linejoin', 'round');
      chevron.setAttribute('pointer-events', 'none');
      g.appendChild(chevron);
    }
    this.svg.appendChild(g);
  }

  // ── 연속 표시 (인접한 두 칸 사이, 값의 차이가 1이어야 함을 나타내는 점) ──
  _drawConsecutives() {
    const g = this._g('g-consecutives');
    const vis = new Set(this.board.getVisibleCells().map(c => `${c.row},${c.col}`));
    for (const s of this.board.structures.filter(s => s.type === 'consecutive')) {
      const { a, b } = s;
      if (!vis.has(`${a.row},${a.col}`) || !vis.has(`${b.row},${b.col}`)) continue;

      const ax = this._px(a.col) + CELL / 2, ay = this._py(a.row) + CELL / 2;
      const bx = this._px(b.col) + CELL / 2, by = this._py(b.row) + CELL / 2;
      const mx = (ax + bx) / 2, my = (ay + by) / 2;

      const dot = this._el('circle');
      dot.setAttribute('cx', mx);
      dot.setAttribute('cy', my);
      dot.setAttribute('r', 5);
      dot.setAttribute('fill', 'var(--ineq-mark)');
      dot.setAttribute('stroke', 'var(--cell-bg)');
      dot.setAttribute('stroke-width', '1.5');
      dot.setAttribute('pointer-events', 'none');
      g.appendChild(dot);
    }
    this.svg.appendChild(g);
  }

  /**
   * 중심 십자 표시 — 9x9 판 전체 테두리(GRID_THICK)와 두께를 맞춘다.
   * 색은 opacity로 옅게 만드는 대신(칸이 하이라이트되면 배경색과 겹쳐 blend 결과가 달라져
   * 보이는 문제가 있었다) 처음부터 불투명한 옅은 색(--turntable-mark-pale)을 쓴다 - 배경이
   * 뭐든 항상 같은 색으로 보인다. 선택 시에는 --tt-cross-color를 그룹에 얹어 진한 색으로 덮어쓴다.
   */
  _buildTurntableCross(centerX, centerY) {
    const cross = this._g('g-turntable-cross');
    cross.setAttribute('pointer-events', 'none');
    const armLen = 11;
    const stroke = 'var(--tt-cross-color, var(--turntable-mark-pale))';
    cross.appendChild(this._line(centerX - armLen, centerY, centerX + armLen, centerY, GRID_THICK, stroke, 'round'));
    cross.appendChild(this._line(centerX, centerY - armLen, centerX, centerY + armLen, GRID_THICK, stroke, 'round'));
    return cross;
  }

  /**
   * 모든 턴테이블 구조의 중심 십자를 칸 배경 위·숫자 아래 레이어에 항상(옅게) 그려 둔다.
   * 선택된 구조의 십자는 _showTurntableHandle()에서 같은 요소의 opacity만 바꿔 진하게 만든다.
   */
  _drawTurntableCrosses() {
    this._gTurntableCross = this._g('g-turntable-cross-layer');
    this._turntableCrossEls = new Map();
    for (const s of this.board.structures.filter(s => s.type === 'turntable')) {
      const n = s.size;
      const centerX = this._px(s.originCol) + (n * CELL) / 2;
      const centerY = this._py(s.originRow) + (n * CELL) / 2;
      const cross = this._buildTurntableCross(centerX, centerY);
      this._gTurntableCross.appendChild(cross);
      this._turntableCrossEls.set(s, cross);
    }
    this.svg.appendChild(this._gTurntableCross);
  }

  /** 모든 턴테이블 구조 주위에 옅은 점선 원을 항상 표시 (선택 시 진한 원+손잡이가 그 위에 겹쳐 그려짐) */
  _drawTurntableRings() {
    const g = this._g('g-turntable-rings');
    for (const s of this.board.structures.filter(s => s.type === 'turntable')) {
      const n = s.size;
      const centerX = this._px(s.originCol) + (n * CELL) / 2;
      const centerY = this._py(s.originRow) + (n * CELL) / 2;
      const radius  = (n * CELL * Math.SQRT2) / 2 + 8;

      const ring = this._el('circle');
      ring.setAttribute('cx', centerX);
      ring.setAttribute('cy', centerY);
      ring.setAttribute('r', radius);
      ring.setAttribute('fill', 'none');
      ring.setAttribute('stroke', 'var(--turntable-mark)');
      ring.setAttribute('stroke-width', '2');
      ring.setAttribute('stroke-dasharray', '4 4');
      ring.setAttribute('opacity', '0.35');
      ring.setAttribute('pointer-events', 'none');
      g.appendChild(ring);
    }
    this.svg.appendChild(g);
  }

  /**
   * 턴테이블 칸을 클릭했을 때, 구조를 감싸는 점선 원 + 위쪽 손잡이를 표시한다.
   * 손잡이를 드래그하면 안의 값/메모가 실시간으로 회전해 보이고, 놓으면 가장
   * 가까운 90도로 스냅되어 실제로 칸 내용이 회전 이동한다.
   */
  _showTurntableHandle(structure) {
    // 다른 턴테이블에서 옮겨온 경우, 이전 구조의 십자는 다시 옅게 되돌린다.
    if (this._turntableUIStructure && this._turntableUIStructure !== structure) {
      const prevCross = this._turntableCrossEls.get(this._turntableUIStructure);
      if (prevCross) prevCross.style.removeProperty('--tt-cross-color');
    }
    this._turntableUIStructure = structure;

    if (!this._gTurntableUI) {
      this._gTurntableUI = this._g('g-turntable-ui');
      this.svg.appendChild(this._gTurntableUI);
    }
    while (this._gTurntableUI.firstChild) this._gTurntableUI.removeChild(this._gTurntableUI.firstChild);

    const n = structure.size;
    const centerX = this._px(structure.originCol) + (n * CELL) / 2;
    const centerY = this._py(structure.originRow) + (n * CELL) / 2;
    const radius  = (n * CELL * Math.SQRT2) / 2 + 8; // 구조 모서리를 넉넉히 감싸는 정도

    const ring = this._el('circle');
    ring.setAttribute('cx', centerX);
    ring.setAttribute('cy', centerY);
    ring.setAttribute('r', radius);
    ring.setAttribute('fill', 'none');
    ring.setAttribute('stroke', 'var(--turntable-mark)');
    ring.setAttribute('stroke-width', '2');
    ring.setAttribute('stroke-dasharray', '4 4');
    ring.setAttribute('pointer-events', 'none');
    this._gTurntableUI.appendChild(ring);

    // 가운데 십자는 칸 배경/숫자 사이의 고정 레이어에 있는 요소를 그대로 진하게 만든다
    // (숫자를 가리지 않도록 그 레이어는 항상 텍스트보다 아래에 위치함).
    const cross = this._turntableCrossEls.get(structure);
    if (cross) cross.style.setProperty('--tt-cross-color', 'var(--turntable-mark)');

    const handle = this._el('circle');
    handle.setAttribute('cx', centerX);
    handle.setAttribute('cy', centerY - radius);
    handle.setAttribute('r', 9);
    handle.setAttribute('fill', 'var(--turntable-mark)');
    handle.setAttribute('stroke', 'var(--cell-bg)');
    handle.setAttribute('stroke-width', '2');
    handle.setAttribute('pointer-events', 'none'); // 입력은 아래의 더 큰 투명 히트 영역(handleHit)이 받음
    this._gTurntableUI.appendChild(handle);

    // 손가락으로도 잡기 쉽도록 보이는 손잡이보다 훨씬 큰 투명 히트 영역을 같은 위치에 겹쳐 둔다.
    const handleHit = this._el('circle');
    handleHit.setAttribute('cx', centerX);
    handleHit.setAttribute('cy', centerY - radius);
    handleHit.setAttribute('r', 18);
    handleHit.setAttribute('fill', 'transparent');
    handleHit.style.cursor = 'grab';
    handleHit.style.touchAction = 'none';
    handleHit.addEventListener('pointerdown', (e) => this._startTurntableDrag(e, structure, centerX, centerY, radius, handle, handleHit, cross));
    this._gTurntableUI.appendChild(handleHit);
  }

  _hideTurntableHandle() {
    if (this._turntableUIStructure) {
      const cross = this._turntableCrossEls.get(this._turntableUIStructure);
      if (cross) cross.style.removeProperty('--tt-cross-color');
    }
    this._turntableUIStructure = null;
    if (this._gTurntableUI) {
      while (this._gTurntableUI.firstChild) this._gTurntableUI.removeChild(this._gTurntableUI.firstChild);
    }
  }

  _startTurntableDrag(e, structure, centerX, centerY, radius, handle, handleHit, cross) {
    if (this.inputLocked) return; // 게임 종료/시작 전 — 회전 금지
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation(); // 보드 패닝(DragPanel)이 같이 시작되지 않도록 차단

    const pointerId = e.pointerId;
    handleHit.setPointerCapture(pointerId);

    const rect = this.svg.getBoundingClientRect();
    const centerClientX = rect.left + centerX * this.scale;
    const centerClientY = rect.top  + centerY * this.scale;
    const startAngle = Math.atan2(e.clientY - centerClientY, e.clientX - centerClientX);

    const cellEls = structure.coords
      .map(({ row, col }) => {
        const el = this._els.get(`${row},${col}`);
        if (!el) return null;
        return { el, cx: this._px(col) + CELL / 2, cy: this._py(row) + CELL / 2 };
      })
      .filter(Boolean);

    // 드래그 중엔 숫자/메모가 다른 칸 배경에 가려지지 않도록 맨 위 레이어로 옮겨서 그린다.
    const dragLayer = this._g('g-turntable-drag');
    for (const { el } of cellEls) {
      dragLayer.appendChild(el.text);
      dragLayer.appendChild(el.notesGroup);
    }
    this.svg.appendChild(dragLayer);

    let deltaDeg = 0;
    handleHit.style.cursor = 'grabbing';

    const onMove = (ev) => {
      if (ev.pointerId !== pointerId) return;
      const angle = Math.atan2(ev.clientY - centerClientY, ev.clientX - centerClientX);
      deltaDeg = (angle - startAngle) * 180 / Math.PI;
      const rad = deltaDeg * Math.PI / 180;
      const cos = Math.cos(rad), sin = Math.sin(rad);

      // 숫자 자체는 기울이지 않고, 중심을 기준으로 위치만 공전시킨다 (회전 없는 이동만 적용).
      for (const { el, cx, cy } of cellEls) {
        const dx = cx - centerX, dy = cy - centerY;
        const nx = centerX + (dx * cos - dy * sin);
        const ny = centerY + (dx * sin + dy * cos);
        const t = `translate(${nx - cx}, ${ny - cy})`;
        el.text.setAttribute('transform', t);
        el.notesGroup.setAttribute('transform', t);
      }
      const handleAngle = -Math.PI / 2 + rad;
      const hx = centerX + radius * Math.cos(handleAngle);
      const hy = centerY + radius * Math.sin(handleAngle);
      handle.setAttribute('cx', hx);
      handle.setAttribute('cy', hy);
      handleHit.setAttribute('cx', hx);
      handleHit.setAttribute('cy', hy);

      // 십자 표시는 숫자와 달리 회전량을 그대로 보여주는 용도이므로 실제로 돌린다.
      cross.setAttribute('transform', `rotate(${deltaDeg}, ${centerX}, ${centerY})`);
    };

    const onUp = (ev) => {
      if (ev.pointerId !== pointerId) return;
      handleHit.removeEventListener('pointermove', onMove);
      handleHit.removeEventListener('pointerup', onUp);
      handleHit.removeEventListener('pointercancel', onUp);

      const gCells = this.svg.querySelector('#g-cells');
      const steps = Math.round(deltaDeg / 90);

      if (steps !== 0 && this.remoteRotateHandler) {
        // 협동 모드 - 서버 확정(coopRotate push)이 올 때까지는 실제 값을 반영하지 않지만,
        // 미리보기를 원래 모습으로 되돌리는 대신 "목표 각도(90°*steps)"로 스냅해서 그대로 둔다.
        // 되돌렸다가 확정 응답이 온 뒤 다시 돌아가는 것처럼 보이면 회전이 안 먹은 것처럼 느껴지기 때문 -
        // 목표 각도로 스냅한 모습은 실제 회전 결과와 화면상 동일하므로 깜빡임 없이 자연스럽다.
        // applyRemoteCellUpdate/applyRemoteRotate가 확정 값을 반영할 때 이 transform을 지운다.
        const rad = steps * 90 * Math.PI / 180;
        const cos = Math.cos(rad), sin = Math.sin(rad);
        for (const { el, cx, cy } of cellEls) {
          const dx = cx - centerX, dy = cy - centerY;
          const nx = centerX + (dx * cos - dy * sin);
          const ny = centerY + (dx * sin + dy * cos);
          const t = `translate(${nx - cx}, ${ny - cy})`;
          el.text.setAttribute('transform', t);
          el.notesGroup.setAttribute('transform', t);
          if (gCells) { gCells.appendChild(el.text); gCells.appendChild(el.notesGroup); }
        }
        dragLayer.remove();
        this.remoteRotateHandler(structure, steps);
      } else {
        // 임시 상단 레이어에서 원래 칸 레이어로 되돌린다 (제자리로 돌아오므로 순서는 무관).
        for (const { el } of cellEls) {
          el.text.removeAttribute('transform');
          el.notesGroup.removeAttribute('transform');
          if (gCells) {
            gCells.appendChild(el.text);
            gCells.appendChild(el.notesGroup);
          }
        }
        dragLayer.remove();

        if (steps !== 0) {
          const changes = structure.rotate(this.board, steps);
          this._pushUndo(changes);
          Validator.validate(this.board);
          this._updateAll();
          if (this.onCellSelect && this.selectedCell) this.onCellSelect(this.selectedCell.row, this.selectedCell.col);
          if (this.board.isSolved()) {
            setTimeout(() => {
              this._celebrate();
              document.dispatchEvent(new CustomEvent('sudoku:solved'));
            }, 80);
          }
        }
      }

      if (this._turntableUIStructure === structure) this._showTurntableHandle(structure);
    };

    handleHit.addEventListener('pointermove',   onMove);
    handleHit.addEventListener('pointerup',     onUp);
    handleHit.addEventListener('pointercancel', onUp);
  }

  // ── 상태 업데이트 ──
  _updateAll() {
    this._updateSnakePaths();
    for (const [key] of this._els) {
      if (key === 'g-conflicts') continue;
      const [r, c] = key.split(',').map(Number);
      this._updateCell(r, c);
    }
  }

  /** 스네이크 구조마다 유효 경로를 다시 계산하고, 외곽선 + 경로 연결 아이콘을 갱신 */
  _updateSnakePaths() {
    // 스네이크가 아닌 다른 구조체(줄/박스/부등호/연속 등)가 낸 충돌만 모아서
    // 칸별 빨간 사각형은 "원래 룰" 위반에만 쓰이게 하고, 스네이크 자체 위반은
    // 아래 외곽선으로 따로 표시한다.
    this._nonSnakeConflictKeys = new Set();
    for (const s of this.board.structures) {
      if (s.type === 'snake') continue;
      for (const { row, col } of s.validate(this.board)) this._nonSnakeConflictKeys.add(`${row},${col}`);
    }

    const infos = this.board.structures.filter(s => s.type === 'snake').map(s => {
      const cells = s.getCells(this.board);
      const allFilled = cells.length > 0 && cells.every(c => c.value !== null);
      const path = s.longestPathFromStart(this.board);
      const complete = allFilled && path.length === cells.length;
      const color = complete ? 'var(--snake-success)' : allFilled ? 'var(--conflict)' : 'var(--snake-default)';
      return { structure: s, path, color };
    });
    this._drawSnakeOutlines(infos);
    this._drawSnakePathIcons(infos);
  }

  /**
   * 노출된 변들을 방향별로 모아 연속 구간을 하나의 선분으로 합친다.
   * (한 칸씩 따로 그리면 이어붙는 자리마다 라운드 캡이 작은 혹처럼 튀어나오므로,
   * 진짜 모서리에서만 둥글게 보이도록 먼저 합친 뒤 그린다)
   */
  _mergeEdgeRuns(items, groupOf, posOf) {
    const groups = new Map();
    for (const it of items) {
      const g = groupOf(it);
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(posOf(it));
    }
    const runs = [];
    for (const [group, vals] of groups) {
      vals.sort((a, b) => a - b);
      let start = vals[0], prev = vals[0];
      for (let i = 1; i <= vals.length; i++) {
        const v = vals[i];
        if (v === prev + 1) { prev = v; continue; }
        runs.push({ group, start, end: prev + 1 });
        if (i < vals.length) { start = v; prev = v; }
      }
    }
    return runs;
  }

  /**
   * 스네이크 구조가 차지하는 영역의 가장 바깥 테두리만 그린다 (칸별 배경/테두리가 아님).
   * 기본(미완성) 노란색 → 유효 경로 존재 시 초록 → 다 채웠는데 경로가 없으면 빨간색.
   * 모서리는 살짝 둥글게(라운드 캡), 시작 칸에는 살짝 작은 사각 테두리를 하나 더
   * 그려 두 줄처럼 보이게 표시한다.
   */
  _drawSnakeOutlines(infos) {
    if (!this._gSnakeOutline) {
      this._gSnakeOutline = this._g('g-snake-outline');
      this.svg.appendChild(this._gSnakeOutline);
    }
    while (this._gSnakeOutline.firstChild) this._gSnakeOutline.removeChild(this._gSnakeOutline.firstChild);

    // 9x9 판 전체 테두리(GRID_THICK)와 두께를 맞춘다
    const OUTLINE_W = GRID_THICK;
    for (const { structure: s, color } of infos) {
      const cellSet = new Set(s.coords.map(c => `${c.row},${c.col}`));
      const top = [], bottom = [], left = [], right = [];
      for (const { row, col } of s.coords) {
        if (!cellSet.has(`${row - 1},${col}`)) top.push({ row, col });
        if (!cellSet.has(`${row + 1},${col}`)) bottom.push({ row, col });
        if (!cellSet.has(`${row},${col - 1}`)) left.push({ row, col });
        if (!cellSet.has(`${row},${col + 1}`)) right.push({ row, col });
      }

      for (const { group: row, start: c0, end: c1 } of this._mergeEdgeRuns(top, it => it.row, it => it.col)) {
        const y = this._py(row);
        this._gSnakeOutline.appendChild(this._line(this._px(c0), y, this._px(c1), y, OUTLINE_W, color, 'round'));
      }
      for (const { group: row, start: c0, end: c1 } of this._mergeEdgeRuns(bottom, it => it.row, it => it.col)) {
        const y = this._py(row) + CELL;
        this._gSnakeOutline.appendChild(this._line(this._px(c0), y, this._px(c1), y, OUTLINE_W, color, 'round'));
      }
      for (const { group: col, start: r0, end: r1 } of this._mergeEdgeRuns(left, it => it.col, it => it.row)) {
        const x = this._px(col);
        this._gSnakeOutline.appendChild(this._line(x, this._py(r0), x, this._py(r1), OUTLINE_W, color, 'round'));
      }
      for (const { group: col, start: r0, end: r1 } of this._mergeEdgeRuns(right, it => it.col, it => it.row)) {
        const x = this._px(col) + CELL;
        this._gSnakeOutline.appendChild(this._line(x, this._py(r0), x, this._py(r1), OUTLINE_W, color, 'round'));
      }

      const sx = this._px(s.start.col), sy = this._py(s.start.row);
      const inset = 8;
      const startRect = this._el('rect');
      startRect.setAttribute('x', sx + inset);
      startRect.setAttribute('y', sy + inset);
      startRect.setAttribute('width',  CELL - inset * 2);
      startRect.setAttribute('height', CELL - inset * 2);
      startRect.setAttribute('rx', '2');
      startRect.setAttribute('fill', 'none');
      startRect.setAttribute('stroke', color);
      startRect.setAttribute('stroke-width', OUTLINE_W); // 바깥 외곽선과 두께 통일
      startRect.setAttribute('pointer-events', 'none');
      this._gSnakeOutline.appendChild(startRect);
    }
  }

  /** 시작점부터 이어지는 경로의 칸 사이마다, 물결(~) 표시로 연결을 나타낸다 */
  _drawSnakePathIcons(infos) {
    if (!this._gSnakePath) {
      this._gSnakePath = this._g('g-snake-path');
      this.svg.appendChild(this._gSnakePath);
    }
    while (this._gSnakePath.firstChild) this._gSnakePath.removeChild(this._gSnakePath.firstChild);

    for (const { path, color } of infos) {
      if (path.length < 2) continue;
      for (let i = 0; i < path.length - 1; i++) {
        const from = path[i], to = path[i + 1];
        const ax = this._px(from.col) + CELL / 2, ay = this._py(from.row) + CELL / 2;
        const bx = this._px(to.col)   + CELL / 2, by = this._py(to.row)   + CELL / 2;
        const mx = (ax + bx) / 2, my = (ay + by) / 2;
        const angle = Math.atan2(by - ay, bx - ax) * 180 / Math.PI;

        const wave = this._el('path'); // 로컬 좌표: 중심(0,0) 기준 좌우 대칭 물결(~) 한 굽이
        wave.setAttribute('d', 'M -9,0 Q -4.5,-4.5 0,0 Q 4.5,4.5 9,0');
        wave.setAttribute('transform', `translate(${mx},${my}) rotate(${angle})`);
        wave.setAttribute('fill', 'none');
        wave.setAttribute('stroke', color);
        wave.setAttribute('stroke-width', '2.5');
        wave.setAttribute('stroke-linecap', 'round');
        wave.setAttribute('pointer-events', 'none');
        this._gSnakePath.appendChild(wave);
      }
    }
  }

  _updateCell(row, col) {
    const el   = this._els.get(`${row},${col}`);
    const cell = this.board.getCell(row, col);
    if (!el || !cell) return;
    const { rect, text, conflictRect, noteTexts, filledByMarker } = el;
    const sel = this.selectedCell?.row === row && this.selectedCell?.col === col;

    const fillerColor = this._filledBy.get(`${row},${col}`);
    if (fillerColor && cell.value !== null) {
      filledByMarker.setAttribute('fill', fillerColor);
      filledByMarker.setAttribute('display', 'block');
    } else {
      filledByMarker.setAttribute('display', 'none');
    }

    rect.setAttribute('fill',
      sel               ? 'var(--cell-selected)'    :
      cell.isHighlighted ? 'var(--cell-highlighted)' :
      cell.isGiven      ? 'var(--cell-given-bg)'    :
                          'var(--cell-bg)');

    // 빨간 테두리 최상단 배치 — "원래 룰"(줄/박스/부등호/연속 등) 위반에만 표시.
    // 스네이크 자체 위반은 영역 외곽선으로 따로 표시하므로 여기선 제외한다.
    if (this._nonSnakeConflictKeys?.has(`${row},${col}`)) {
      conflictRect.setAttribute('display', 'block');
    } else {
      conflictRect.setAttribute('display', 'none');
    }

    if (cell.value !== null) {
      text.textContent = cell.value;
      text.setAttribute('fill',
        sel          ? 'var(--text-sel)'   :
        cell.isGiven ? 'var(--text-given)' :
                       'var(--text-input)');
      text.setAttribute('font-weight', cell.isGiven ? '700' : '500');
      for (const nt of noteTexts) nt.textContent = '';
    } else {
      text.textContent = '';
      for (let i = 1; i <= 9; i++) {
        noteTexts[i - 1].textContent = cell.candidates.has(i) ? String(i) : '';
      }
    }
  }

  /** 메모에 없는 숫자를 일반 입력 모드에서 입력하려 할 때, 기존 메모를 짧게 빨간색으로 점멸 */
  _flashNoteReject(row, col) {
    const el = this._els.get(`${row},${col}`);
    if (!el) return;
    el.notesGroup.classList.remove('flash-reject');
    void el.notesGroup.getBoundingClientRect(); // 애니메이션 재시작을 위한 강제 리플로우
    el.notesGroup.classList.add('flash-reject');
    setTimeout(() => el.notesGroup.classList.remove('flash-reject'), 500);
  }

  // ── 셀 클릭 ──
  _onClick(row, col) {
    if (this.boardDrag?.wasDragging()) return;
    this.selectCell(row, col);
    if (this.onCellSelect) this.onCellSelect(row, col);
  }

  selectCell(row, col) {
    const cell = this.board.getCell(row, col);
    if (!cell?.isVisible) return;

    for (const c of this.board.getVisibleCells()) c.isHighlighted = false;
    this.selectedCell = { row, col };

    // 클릭한 셀이 속한 9x9 판 필터링
    const activeGrids = this.board.structures.filter(s => 
      s.type === 'grid9x9' && 
      row >= s.originRow && row < s.originRow + 9 && 
      col >= s.originCol && col < s.originCol + 9
    );

    // 같은 숫자 하이라이트 (관련된 9x9 안에 있는 것만)
    if (cell.value !== null) {
      for (const c of this.board.getVisibleCells()) {
        if (c.value === cell.value && !(c.row === row && c.col === col)) {
          const inGrid = activeGrids.some(s => 
            c.row >= s.originRow && c.row < s.originRow + 9 && 
            c.col >= s.originCol && c.col < s.originCol + 9
          );
          if (inGrid) c.isHighlighted = true;
        }
      }
    }

    // 같은 줄, 3x3 박스 하이라이트 복원
    for (const { row: pr, col: pc } of this.board.getPeers(row, col)) {
      const p = this.board.getCell(pr, pc);
      if (p) p.isHighlighted = true;
    }

    this._updateAll();

    // 턴테이블 칸을 선택했으면 회전 손잡이를 보여주고, 아니면 숨긴다
    const turntable = this.board.structures.find(s =>
      s.type === 'turntable' && s.coords.some(c => c.row === row && c.col === col));
    if (turntable) {
      if (this._turntableUIStructure !== turntable) this._showTurntableHandle(turntable);
    } else if (this._turntableUIStructure) {
      this._hideTurntableHandle();
    }
  }

  inputValue(value) {
    if (!this.selectedCell) return;
    const { row, col } = this.selectedCell;
    const cell = this.board.getCell(row, col);
    if (!cell || cell.isGiven) return;

    // ── 지우기: 모드 상관없이 값 + 메모 모두 제거 ──
    if (value === null) {
      if (cell.value === null && cell.candidates.size === 0) return; // 지울 게 없으면 변화 없음
      if (this.remoteInputHandler) {
        this.remoteInputHandler(row, col, null);
        return;
      }
      const prevValue = cell.value;
      const prevCandidates = [...cell.candidates];
      cell.value = null;
      cell.candidates.clear();
      this._pushUndo([{ row, col, prevValue, prevCandidates }]);
      Validator.validate(this.board);
      this.selectCell(row, col);
      if (this.onCellSelect) this.onCellSelect(row, col);
      return;
    }

    // ── 메모 모드: 실제 값이 아니라 후보 숫자(작은 숫자)를 토글 ──
    if (this.noteMode) {
      if (cell.value !== null) return; // 이미 값이 있는 칸엔 메모 불가
      const prevCandidates = [...cell.candidates];
      if (cell.candidates.has(value)) cell.candidates.delete(value);
      else cell.candidates.add(value);
      this._pushUndo([{ row, col, prevValue: cell.value, prevCandidates }]);
      this._updateCell(row, col);
      if (this.onCellSelect) this.onCellSelect(row, col);
      return;
    }

    // ── 일반 입력 모드: 메모가 있는 칸엔 메모된 숫자만 입력 가능 ──
    if (cell.candidates.size > 0 && !cell.candidates.has(value)) {
      this._flashNoteReject(row, col);
      return;
    }

    if (this.remoteInputHandler) {
      this.remoteInputHandler(row, col, value);
      return;
    }

    const prevValue = cell.value;
    const prevCandidates = [...cell.candidates];
    this.board.setValue(row, col, value);
    this._pushUndo([{ row, col, prevValue, prevCandidates }]);
    Validator.validate(this.board);
    this.selectCell(row, col);
    if (this.onCellSelect) this.onCellSelect(row, col);
    if (this.board.isSolved()) {
      setTimeout(() => {
        this._celebrate();
        document.dispatchEvent(new CustomEvent('sudoku:solved'));
      }, 80);
    }
  }

  /**
   * 협동 모드 — 서버가 확정한 셀 값 하나를 반영한다(내 입력의 확정 echo든, 다른
   * 플레이어의 입력이든 동일한 경로). undo 스택에는 쌓지 않고(원격 상태는 로컬
   * undo로 되돌릴 수 없어야 함), 현재 선택은 그대로 둔 채 하이라이트만 재계산한다.
   */
  applyRemoteCellUpdate({ row, col, value, color }) {
    const cell = this.board.getCell(row, col);
    if (!cell || cell.isGiven) return;

    cell.value = value;
    // 지우기(value가 null로 확정된 경우)는 로컬 지우기와 동일하게 메모도 함께 비운다 —
    // 숫자가 채워지는 경우(내 입력이든 다른 플레이어든)는 메모를 그대로 둔다.
    if (value === null) cell.candidates.clear();
    const key = `${row},${col}`;
    if (color) this._filledBy.set(key, color);
    else this._filledBy.delete(key);

    Validator.validate(this.board);
    if (this.selectedCell) this.selectCell(this.selectedCell.row, this.selectedCell.col);
    else this._updateAll();

    if (this.board.isSolved()) {
      setTimeout(() => {
        this._celebrate();
        document.dispatchEvent(new CustomEvent('sudoku:solved'));
      }, 80);
    }
  }

  /**
   * 협동 모드 — 서버가 확정한 턴테이블 회전 결과(영역 내 모든 칸의 값/given 여부/채운사람)를
   * 한 번에 반영한다. 회전은 given 여부 자체도 옮기므로 applyRemoteCellUpdate와 달리 isGiven도
   * 함께 덮어쓴다. 메모는 협동에서 로컬 전용 스코프라 회전 후 위치가 어긋나므로 비운다.
   */
  applyRemoteRotate({ cells }) {
    for (const { row, col, value, isGiven, color } of cells) {
      const cell = this.board.getCell(row, col);
      if (!cell) continue;
      cell.value = value;
      cell.isGiven = isGiven;
      cell.candidates.clear();
      const key = `${row},${col}`;
      if (color) this._filledBy.set(key, color);
      else this._filledBy.delete(key);

      // 내가 드래그를 한 경우, 목표 각도로 스냅해둔 미리보기 transform이 아직 남아있을 수 있다 -
      // 이제 실제 값을 확정 반영하므로 지운다(안 지우면 이중으로 밀려 보임). 남이 돌린 경우엔 애초에 없어 무해한 no-op.
      const el = this._els.get(key);
      if (el) {
        el.text.removeAttribute('transform');
        el.notesGroup.removeAttribute('transform');
      }
    }

    Validator.validate(this.board);
    if (this.selectedCell) this.selectCell(this.selectedCell.row, this.selectedCell.col);
    else this._updateAll();

    if (this.board.isSolved()) {
      setTimeout(() => {
        this._celebrate();
        document.dispatchEvent(new CustomEvent('sudoku:solved'));
      }, 80);
    }
  }

  /**
   * 협동 모드 — 서버가 정답 체크/보기로 확정한 칸들(값 + given 여부)을 한 번에 반영한다.
   * 원격 반영이라 undo 스택에는 쌓지 않는다. 고정된 칸은 given처럼 보여야 하므로
   * "채운사람" 색 표시도 함께 지운다.
   */
  applyRemoteAnswerUpdate(cells) {
    for (const { row, col, value, isGiven } of cells) {
      const cell = this.board.getCell(row, col);
      if (!cell) continue;
      cell.value = value;
      cell.isGiven = isGiven;
      this._filledBy.delete(`${row},${col}`);
    }

    Validator.validate(this.board);
    if (this.selectedCell) this.selectCell(this.selectedCell.row, this.selectedCell.col);
    else this._updateAll();

    if (this.board.isSolved()) {
      setTimeout(() => {
        this._celebrate();
        document.dispatchEvent(new CustomEvent('sudoku:solved'));
      }, 80);
    }
  }

  /**
   * 협동 모드 진입/재접속 시, 그리고 진행 중 서버 스냅샷이 다시 올 때마다(참가자 목록 변경 등
   * 값과 무관한 push 포함) 호출된다. 값이 실제로 안 바뀐 칸은 아예 건드리지 않는데, 그렇지
   * 않으면 매번 로컬 메모(협동에서 로컬 전용)까지 지워버려서 관계없는 push에도 다같이 채워둔
   * 메모가 날아가는 문제가 생긴다.
   */
  loadCoopCells(cells) {
    for (const { row, col, value, color } of cells) {
      const cell = this.board.getCell(row, col);
      if (!cell || cell.isGiven || cell.value === value) continue;
      cell.value = value;
      if (value === null) cell.candidates.clear(); // 지우기로 반영된 경우만 메모도 함께 비운다
      const key = `${row},${col}`;
      if (color) this._filledBy.set(key, color);
      else this._filledBy.delete(key);
    }
    Validator.validate(this.board);
    if (this.selectedCell) this.selectCell(this.selectedCell.row, this.selectedCell.col);
    else this._updateAll();
  }

  /** 협동 모드 — 다른 플레이어의 선택 칸 위치를 색깔 테두리 + 그 아래 닉네임 태그로 표시/이동 */
  upsertRemoteCursor(playerId, row, col, color, label) {
    let entry = this._remoteCursors.get(playerId);
    if (!entry) {
      const rect = this._el('rect');
      rect.setAttribute('width', CELL - 4);
      rect.setAttribute('height', CELL - 4);
      rect.setAttribute('rx', '4');
      rect.setAttribute('fill', 'none');
      rect.setAttribute('stroke-width', '3');
      this._gRemoteCursors.appendChild(rect);

      // 닉네임 태그: 밑에 깔리는 배경 알약 모양 + 그 위 흰 글씨. 메모(후보 숫자)보다
      // 아래 레이어에 그려서, 칸에 메모가 있으면 그 위로 닉네임 태그가 덮이지 않게 한다.
      const labelBg = this._el('rect');
      labelBg.setAttribute('rx', '3');
      labelBg.setAttribute('pointer-events', 'none');
      this._gRemoteCursorLabels.appendChild(labelBg);

      const labelText = this._el('text');
      labelText.setAttribute('text-anchor', 'middle');
      labelText.setAttribute('dominant-baseline', 'central');
      labelText.setAttribute('font-size', '11');
      labelText.setAttribute('font-family', "'Inter', sans-serif");
      labelText.setAttribute('font-weight', '600');
      labelText.setAttribute('pointer-events', 'none');
      this._gRemoteCursorLabels.appendChild(labelText);

      entry = { rect, labelBg, labelText };
      this._remoteCursors.set(playerId, entry);
    }

    const x = this._px(col), y = this._py(row);
    entry.rect.setAttribute('x', x + 2);
    entry.rect.setAttribute('y', y + 2);
    entry.rect.setAttribute('stroke', color);

    entry.labelText.setAttribute('fill', this._readableTextColor(color));
    entry.labelText.textContent = label ?? '';
    const cx = x + CELL / 2;
    const labelY = y + CELL + 14;
    entry.labelText.setAttribute('x', cx);
    entry.labelText.setAttribute('y', labelY);

    const textW = entry.labelText.getBBox().width;
    const padX = 6, h = 16;
    entry.labelBg.setAttribute('x', cx - textW / 2 - padX);
    entry.labelBg.setAttribute('y', labelY - h / 2);
    entry.labelBg.setAttribute('width', textW + padX * 2);
    entry.labelBg.setAttribute('height', h);
    entry.labelBg.setAttribute('fill', color);
  }

  /** 협동 모드 — 플레이어가 나가거나 세션이 끝났을 때 커서 표시 제거 */
  removeRemoteCursor(playerId) {
    const entry = this._remoteCursors.get(playerId);
    if (!entry) return;
    entry.rect.remove();
    entry.labelBg.remove();
    entry.labelText.remove();
    this._remoteCursors.delete(playerId);
  }

  /** 협동 모드 종료 시 남은 원격 커서를 전부 지운다 */
  clearRemoteCursors() {
    for (const { rect, labelBg, labelText } of this._remoteCursors.values()) {
      rect.remove(); labelBg.remove(); labelText.remove();
    }
    this._remoteCursors.clear();
  }

  /** keepIds에 없는 playerId의 원격 커서를 지운다 (플레이어가 방을 나갔을 때 정리용) */
  pruneRemoteCursors(keepIds) {
    for (const playerId of [...this._remoteCursors.keys()]) {
      if (!keepIds.has(playerId)) this.removeRemoteCursor(playerId);
    }
  }

  /** 기입한 값(초기 제공 숫자 제외) + 메모 전부 지우기 */
  resetBoard() {
    const changes = [];
    for (const cell of this.board.getVisibleCells()) {
      if (cell.isGiven) continue;
      if (cell.value === null && cell.candidates.size === 0) continue;
      changes.push({ row: cell.row, col: cell.col, prevValue: cell.value, prevCandidates: [...cell.candidates] });
      cell.clear();
    }
    if (changes.length) this._pushUndo(changes);
    Validator.validate(this.board);
    if (this.selectedCell) this.selectCell(this.selectedCell.row, this.selectedCell.col);
    else this._updateAll();
    if (this.onCellSelect && this.selectedCell) {
      this.onCellSelect(this.selectedCell.row, this.selectedCell.col);
    }
  }

  /**
   * 값은 그대로 두고 메모(후보 숫자)만 전부 지운다. 메모는 서버가 모르는 로컬 전용
   * 값이라 협동 모드에서도 서버에 알릴 게 없다 — 숫자 입력과 달리 되돌리기 스택에도
   * 쌓지 않는다(가벼운 정리용 동작이라 undo 대상으로 취급하지 않음).
   */
  clearAllNotes() {
    let changed = false;
    for (const cell of this.board.getVisibleCells()) {
      if (cell.candidates.size === 0) continue;
      cell.candidates.clear();
      changed = true;
    }
    if (!changed) return;
    if (this.selectedCell) this.selectCell(this.selectedCell.row, this.selectedCell.col);
    else this._updateAll();
  }

  /**
   * 정답 체크 — 현재 입력된 값이 정답과 일치하는 칸을 given처럼 고정한다. 값 자체는
   * 안 바꾸므로(원래도 정답이었으므로) 충돌 표시는 다시 계산할 필요가 없다. 턴테이블
   * 영역은 회전 때문에 칸별 정답이 고정되지 않아 대상에서 제외한다.
   * @returns {number} 새로 고정된 칸 수
   */
  lockCorrectCells(solution) {
    const turntableKeys = this.board.getTurntableCellKeys();
    const changes = [];
    for (const cell of this.board.getVisibleCells()) {
      if (cell.isGiven || cell.value === null) continue;
      const key = `${cell.row},${cell.col}`;
      if (turntableKeys.has(key) || solution.get(key) !== cell.value) continue;
      changes.push({ row: cell.row, col: cell.col, prevValue: cell.value, prevCandidates: [...cell.candidates], prevIsGiven: false });
      cell.isGiven = true;
    }
    if (!changes.length) return 0;
    this._pushUndo(changes);
    if (this.selectedCell) this.selectCell(this.selectedCell.row, this.selectedCell.col);
    else this._updateAll();
    return changes.length;
  }

  /**
   * 정답 보기 — given이 아닌 칸(턴테이블 영역 제외)을 전부 정답값으로 채운다. "체크"와
   * 달리 given으로 고정하지 않는다 — 직접 입력한 값과 똑같은 형식(초록 글씨, 계속 수정
   * 가능)으로 채워 넣는다는 요청에 따른 것으로, isGiven은 건드리지 않는다.
   * @returns {number} 새로 채운 칸 수
   */
  revealAnswers(solution) {
    const turntableKeys = this.board.getTurntableCellKeys();
    const changes = [];
    for (const cell of this.board.getVisibleCells()) {
      if (cell.isGiven) continue;
      const key = `${cell.row},${cell.col}`;
      if (turntableKeys.has(key)) continue;
      const value = solution.get(key);
      if (value === undefined) continue;
      changes.push({ row: cell.row, col: cell.col, prevValue: cell.value, prevCandidates: [...cell.candidates] });
      cell.value = value;
    }
    if (!changes.length) return 0;
    this._pushUndo(changes);
    Validator.validate(this.board);
    if (this.selectedCell) this.selectCell(this.selectedCell.row, this.selectedCell.col);
    else this._updateAll();
    if (this.board.isSolved()) {
      setTimeout(() => {
        this._celebrate();
        document.dispatchEvent(new CustomEvent('sudoku:solved'));
      }, 80);
    }
    return changes.length;
  }

  _pushUndo(changes) {
    this._undoStack.push(changes);
  }

  /** 퍼즐 교체 등으로 board 인스턴스 자체를 새로 갈아끼울 때 사용 — 처음부터 다시 그림 */
  loadBoard(newBoard) {
    this.board = newBoard;
    this.selectedCell = null;
    this._undoStack = [];
    this._strokes = [];
    this._activeStroke = null;
    this.drawMode = false;
    this.drawColor = 'var(--draw-ink)';
    this.myPlayerId = null;
    this._hiddenDrawPlayers = new Set();
    this.render();
  }

  /** board 데이터가 외부에서 통째로 교체됐을 때(불러오기 등) 다시 그림 */
  refresh() {
    this._undoStack = []; // 불러온 상태를 새 기준점으로 삼음
    Validator.validate(this.board);
    if (this.selectedCell) this.selectCell(this.selectedCell.row, this.selectedCell.col);
    else this._updateAll();
    if (this.onCellSelect && this.selectedCell) {
      this.onCellSelect(this.selectedCell.row, this.selectedCell.col);
    }
  }

  /** 실행 취소 (Ctrl+Z) — 되돌릴 수 있는 횟수는 메모리가 허용하는 한 무제한. 그리기 획도 같은
   * 스택에 쌓이므로 가장 최근 동작이 칸 입력이든 획이든 순서대로 되돌아간다. */
  undo() {
    const entry = this._undoStack.pop();
    if (!entry) return;
    if (entry.type === 'stroke') {
      const removed = this._removeStrokeById(entry.strokeId);
      if (removed && this.onStrokeRemoved) this.onStrokeRemoved(entry.strokeId);
      return;
    }
    for (const { row, col, prevValue, prevCandidates, prevIsGiven } of entry) {
      const cell = this.board.getCell(row, col);
      if (!cell) continue;
      cell.value = prevValue;
      cell.candidates = new Set(prevCandidates);
      if (prevIsGiven !== undefined) cell.isGiven = prevIsGiven; // 턴테이블 회전 되돌리기용
    }
    Validator.validate(this.board);
    if (this.selectedCell) this.selectCell(this.selectedCell.row, this.selectedCell.col);
    else this._updateAll();
    if (this.onCellSelect && this.selectedCell) {
      this.onCellSelect(this.selectedCell.row, this.selectedCell.col);
    }
  }

  moveSelection(dir) {
    if (!this.selectedCell) { this.selectFirstCell(); return; }
    const { row, col } = this.selectedCell;
    const d = { up:[-1,0], down:[1,0], left:[0,-1], right:[0,1] }[dir];
    const { minRow, maxRow, minCol, maxCol } = this.board.getBounds();
    let r = row + d[0], c = col + d[1];
    while (r >= minRow-1 && r <= maxRow+1 && c >= minCol-1 && c <= maxCol+1) {
      const next = this.board.getCell(r, c);
      if (next?.isVisible) {
        this.selectCell(r, c);
        if (this.onCellSelect) this.onCellSelect(r, c);
        return;
      }
      r += d[0]; c += d[1];
    }
  }

  selectFirstCell() {
    const cells = this.board.getVisibleCells()
      .sort((a, b) => a.row !== b.row ? a.row - b.row : a.col - b.col);
    if (cells[0]) {
      this.selectCell(cells[0].row, cells[0].col);
      if (this.onCellSelect) this.onCellSelect(cells[0].row, cells[0].col);
    }
  }

  /**
   * 확대 배율을 적용하고, wrapper(svg.parentElement)의 레이아웃 크기를
   * 실제 시각적 크기에 맞춰 동기화한다.
   * CSS transform은 자식의 레이아웃 박스 크기를 바꾸지 않으므로, 동기화하지
   * 않으면 wrapper가 축소 전 원본 크기 그대로 화면 대부분을 뒤덮는
   * 보이지 않는 히트박스로 남아 다른 패널의 클릭을 가로채게 된다.
   */
  setScale(newScale) {
    this.scale = newScale;
    this.svg.style.transform = `scale(${newScale})`;

    const wrapper = this.svg.parentElement;
    if (wrapper) {
      const naturalW = parseFloat(this.svg.getAttribute('width'))  || 0;
      const naturalH = parseFloat(this.svg.getAttribute('height')) || 0;
      wrapper.style.width  = `${naturalW * newScale}px`;
      wrapper.style.height = `${naturalH * newScale}px`;
    }
  }

  /**
   * (clientX, clientY) 화면 좌표가 현재 스케일/패널 위치 기준으로 가리키는 "논리적" 보드 좌표.
   * 휠 줌과 핀치 줌이 동일한 앵커링 계산을 공유하기 위한 헬퍼.
   */
  _logicalPoint(clientX, clientY, boardPanel) {
    const panelLeft = parseFloat(boardPanel.style.left) || 0;
    const panelTop  = parseFloat(boardPanel.style.top)  || 0;
    return {
      x: (clientX - panelLeft) / this.scale,
      y: (clientY - panelTop)  / this.scale,
    };
  }

  /**
   * (anchorLogX, anchorLogY) 논리 좌표가 화면상 (anchorClientX, anchorClientY)에 그대로
   * 남도록 newScale을 적용하고 boardPanel 위치를 재계산한다 - 휠 줌/핀치 줌 공용 수식.
   */
  _applyZoomAt(newScale, anchorClientX, anchorClientY, anchorLogX, anchorLogY, boardPanel) {
    this.setScale(newScale);

    const nx = anchorClientX - anchorLogX * newScale;
    const ny = anchorClientY - anchorLogY * newScale;
    const MIN_VIS = 56;
    const r = this.svg.getBoundingClientRect();
    const pw = r.width;
    const ph = r.height;
    boardPanel.style.left = `${Math.max(-(pw - MIN_VIS), Math.min(nx, window.innerWidth  - MIN_VIS))}px`;
    boardPanel.style.top  = `${Math.max(-(ph - MIN_VIS), Math.min(ny, window.innerHeight - MIN_VIS))}px`;
  }

  /**
   * 마우스 커서 기준 부드러운 휠 줌
   * @param {HTMLElement} boardPanel
   */
  setupWheel(boardPanel) {
    const wrapper = this.svg.parentElement;
    if (!wrapper) return;

    let targetScale  = this.scale;
    let curLogX      = 0, curLogY = 0;
    let mouseX       = 0, mouseY  = 0;
    let rafId        = null;

    const LERP = 0.18;

    const tick = () => {
      const diff = targetScale - this.scale;

      if (Math.abs(diff) < 0.0003) {
        this._applyZoomAt(targetScale, mouseX, mouseY, curLogX, curLogY, boardPanel);
        rafId = null;
        return;
      }

      const newScale = this.scale + diff * LERP;
      this._applyZoomAt(newScale, mouseX, mouseY, curLogX, curLogY, boardPanel);
      rafId = requestAnimationFrame(tick);
    };

    wrapper.addEventListener('wheel', (e) => {
      e.preventDefault();

      mouseX = e.clientX;
      mouseY = e.clientY;

      const anchor = this._logicalPoint(mouseX, mouseY, boardPanel);
      curLogX = anchor.x;
      curLogY = anchor.y;

      const delta = e.deltaY * (e.deltaMode === 1 ? 30 : e.deltaMode === 2 ? 900 : 1);
      const factor = Math.pow(0.999, delta);
      targetScale = Math.max(0.2, Math.min(6, targetScale * factor));

      if (!rafId) rafId = requestAnimationFrame(tick);
    }, { passive: false });
  }

  /**
   * 두 손가락 핀치 확대/축소. _applyZoomAt()으로 휠 줌과 동일한 앵커링 수식을 공유한다.
   *
   * 반드시 boardDrag와 같은 요소(boardPanel)에 리스너를 붙여야 한다 - wrapper(SVG의
   * 부모이자 boardPanel의 자손)처럼 하위 요소에 붙이면, boardDrag가 setPointerCapture로
   * 첫 손가락의 이후 이벤트를 boardPanel로 재타깃하는 순간 그 하위 요소는 더 이상 해당
   * 포인터의 이벤트를 받지 못하게 된다(캡처된 이벤트는 캡처 요소에서만 버블링 시작).
   *
   * boardDrag(DragPanel)가 이미 boardPanel에 pointerdown 리스너를 등록해 둔 뒤에
   * 호출해야 한다 - 같은 요소에서는 리스너가 등록 순서대로 실행되므로, 두 번째 손가락이
   * 내려왔을 때 boardDrag가 "이미 첫 손가락을 드래그 중"이라 자기 자신은 개입하지 않고
   * 넘어가 준 다음에야, 여기서 cancelDrag()로 안전하게 핸드오프할 수 있다.
   * @param {HTMLElement} boardPanel
   */
  setupPinchZoom(boardPanel) {
    const pointers = new Map(); // pointerId -> {x, y}, 터치 포인터만 추적
    let startDist  = 0;
    let startScale = 1;

    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

    boardPanel.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      if (this.drawMode) return; // 그리기 모드에서는 한 손가락이 이미 획을 그리는 용도이므로 핀치줌과 충돌하지 않게 비활성화
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size !== 2) return;

      const [a, b] = [...pointers.values()];
      startDist  = dist(a, b);
      startScale = this.scale;
      boardPanel.setPointerCapture(e.pointerId); // 방금 들어온 두 번째 손가락만 직접 캡처
      this.boardDrag?.cancelDrag(); // 진행 중이던 단일 손가락 팬을 정리하고 핀치로 넘긴다
    });

    boardPanel.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size !== 2) return;

      e.preventDefault();
      const [a, b] = [...pointers.values()];
      const newScale = Math.max(0.2, Math.min(6, startScale * (dist(a, b) / startDist)));
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      const anchor = this._logicalPoint(cx, cy, boardPanel);
      this._applyZoomAt(newScale, cx, cy, anchor.x, anchor.y, boardPanel);
    }, { passive: false });

    const release = (e) => { pointers.delete(e.pointerId); };
    boardPanel.addEventListener('pointerup', release);
    boardPanel.addEventListener('pointercancel', release);
  }

  _celebrate() {
    for (const [, { rect }] of this._els) {
      if(rect) {
        rect.classList.add('cell-win');
        setTimeout(() => rect.classList.remove('cell-win'), 1000);
      }
    }
  }

  // ── SVG 유틸 ──
  _el(tag) { return document.createElementNS('http://www.w3.org/2000/svg', tag); }
  _g(id)   { const g = this._el('g'); g.id = id; return g; }

  /** 배경색(hex) 밝기에 따라 검정/흰색 중 더 잘 읽히는 글자색을 골라준다 — 파스텔 배경엔 흰 글씨가 묻힘 */
  _readableTextColor(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? '');
    if (!m) return '#ffffff';
    const n = parseInt(m[1], 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.6 ? '#232733' : '#ffffff';
  }
  _line(x1, y1, x2, y2, w, stroke, linecap = 'square') {
    const l = this._el('line');
    l.setAttribute('x1', x1); l.setAttribute('y1', y1);
    l.setAttribute('x2', x2); l.setAttribute('y2', y2);
    l.setAttribute('stroke',       stroke);
    l.setAttribute('stroke-width', w);
    l.setAttribute('stroke-linecap', linecap);
    return l;
  }
}
