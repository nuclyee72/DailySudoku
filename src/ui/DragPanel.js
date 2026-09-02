import { isMobile } from './layoutMode.js';

/**
 * DragPanel.js — 드래그 이동 패널
 *
 * Pointer Events 기반이라 마우스/터치/펜을 같은 코드 경로로 처리한다(그리기 기능과 동일한 패턴).
 *
 * opts.allowSVG    = true  → SVG rect/text 위에서도 드래그 시작 가능
 * opts.noZBoost    = true  → 클릭 시 z-index 변경 안 함
 * opts.desktopOnly = true  → 모바일 레이아웃(layoutMode.js)에서는 드래그 자체를 비활성화
 *                            (모바일에서는 CSS가 위치를 전담하는 패널에 사용)
 * opts.clamp     = 'full'    → 패널 전체가 화면 안에 있어야 함 (기본)
 *                  'partial' → 최소 minVisible px 만큼만 화면 안에 있으면 됨
 *                  'none'    → 이동 범위 제한 없음
 * opts.minVisible = px  → 'partial' 모드에서 최소로 보여야 하는 크기 (기본 56)
 */
export class DragPanel {
  /**
   * @param {HTMLElement} panelEl
   * @param {HTMLElement} handleEl
   * @param {object}  [opts]
   * @param {boolean} [opts.allowSVG=false]
   * @param {boolean} [opts.noZBoost=false]
   * @param {boolean} [opts.desktopOnly=false]
   * @param {'full'|'partial'|'none'} [opts.clamp='full']
   * @param {number}  [opts.minVisible=56]
   * @param {HTMLElement|SVGElement} [opts.contentEl]  - 실제 크기를 측정할 요소 (스케일 적용된 내부 요소)
   */
  constructor(panelEl, handleEl, opts = {}) {
    this.panel       = panelEl;
    this.handle      = handleEl;
    this.allowSVG    = opts.allowSVG    ?? false;
    this.noZBoost    = opts.noZBoost    ?? false;
    this.desktopOnly = opts.desktopOnly ?? false;
    this.clamp       = opts.clamp       ?? 'full';
    this.minVisible  = opts.minVisible  ?? 56;
    this.contentEl   = opts.contentEl   || panelEl;

    this._isDrag          = false;
    this._startX          = 0;
    this._startY          = 0;
    this._offsetX         = 0;
    this._offsetY         = 0;
    this._dragEndedAt     = 0;
    this._activePointerId = null;

    // 이동 중에는 left/top(레이아웃 유발, 비합성) 대신 transform으로 옮기고,
    // 제스처가 끝나면 최종 위치를 left/top으로 커밋한다. 그 사이 "정답 위치"는 계속 left/top.
    this._gBounds = null;
    this._gBaseL = 0; this._gBaseT = 0;
    this._gCurL  = 0; this._gCurT  = 0;

    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp   = this._onPointerUp.bind(this);

    this.handle.addEventListener('pointerdown', this._onPointerDown);
  }

  /** 이동 가능 범위 계산 */
  _bounds() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const r  = this.contentEl.getBoundingClientRect();
    const pw = r.width;
    const ph = r.height;

    if (this.clamp === 'none') {
      return { minX: -Infinity, maxX: Infinity, minY: -Infinity, maxY: Infinity };
    }

    if (this.clamp === 'partial') {
      const mv = this.minVisible;
      return {
        minX: -(pw - mv),  // 왼쪽으로 최대 (panelWidth - mv) px 나갈 수 있음
        maxX: vw - mv,     // 오른쪽으로 최대 (vw - mv) px 위치까지
        minY: -(ph - mv),
        maxY: vh - mv,
      };
    }

    // 'full' — 패널 전체가 화면 안
    return { minX: 0, maxX: vw - pw, minY: 0, maxY: vh - ph };
  }

  _applyPos(x, y) {
    const b = this._bounds();
    this.panel.style.left = `${Math.max(b.minX, Math.min(x, b.maxX))}px`;
    this.panel.style.top  = `${Math.max(b.minY, Math.min(y, b.maxY))}px`;
  }

  // ── transform 기반 이동 (드래그 / WASD 팬 공용) ──
  _beginGesture() {
    const r = this.panel.getBoundingClientRect();
    this._gBaseL = this._gCurL = r.left;
    this._gBaseT = this._gCurT = r.top;
    this._gBounds = this._bounds(); // 제스처 동안 크기는 안 변하므로 한 번만 읽는다
    this.panel.style.willChange = 'transform';
  }

  _moveGesture(x, y) {
    const b = this._gBounds;
    this._gCurL = Math.max(b.minX, Math.min(x, b.maxX));
    this._gCurT = Math.max(b.minY, Math.min(y, b.maxY));
    this.panel.style.transform =
      `translate3d(${this._gCurL - this._gBaseL}px, ${this._gCurT - this._gBaseT}px, 0)`;
  }

  _endGesture() {
    if (!this._gBounds) return;
    this.panel.style.transform = '';
    this.panel.style.willChange = '';
    this.panel.style.left = `${Math.round(this._gCurL)}px`;
    this.panel.style.top  = `${Math.round(this._gCurT)}px`;
    this._gBounds = null;
  }

  /** 키보드 팬(WASD): 연속 호출 중엔 transform, 멈추면 settle()이 커밋 */
  panBy(dx, dy) {
    if (this._activePointerId !== null) return; // 마우스/터치 드래그 중이면 양보
    if (!this._gBounds) this._beginGesture();
    this._moveGesture(this._gCurL + dx, this._gCurT + dy);
  }

  settle() {
    if (this._gBounds && this._activePointerId === null) this._endGesture();
  }

  /** 드래그가 50ms 이내에 끝났으면 true */
  wasDragging() {
    return Date.now() - this._dragEndedAt < 50;
  }

  _onPointerDown(e) {
    if (this._activePointerId !== null) return; // 이미 드래그 중 - 두 번째 포인터(핀치 등)는 무시
    if (e.button !== 0) return;
    if (e.target.closest('button')) return;
    if (this.desktopOnly && isMobile()) return;

    const isSVGEl = ['rect', 'text', 'line', 'g'].includes(e.target.tagName);
    if (!this.allowSVG && isSVGEl) return;

    this._isDrag = false;
    this._startX = e.clientX;
    this._startY = e.clientY;

    const r = this.panel.getBoundingClientRect();
    this._offsetX = e.clientX - r.left;
    this._offsetY = e.clientY - r.top;

    // 지금은 capture하지 않는다 - allowSVG:true인 핸들(보드)은 아래에 클릭으로 선택되는
    // 칸(rect)들을 그대로 두고 있는데, 여기서 곧장 setPointerCapture를 부르면 브라우저가
    // 합성하는 click 이벤트까지 capture한 요소로 재타깃되어 칸의 click 리스너가 아예
    // 발화하지 않게 된다(순수 클릭까지 "드래그"로 잡아채는 셈). 그래서 실제로 5px 넘게
    // 움직여 "드래그로 확정"되는 순간(_onPointerMove)에만 capture한다 - 그 전까지는 평범한
    // pointerup/click으로 끝날 수 있게 놔둔다.
    this._activePointerId = e.pointerId;
    this.handle.addEventListener('pointermove',   this._onPointerMove);
    this.handle.addEventListener('pointerup',     this._onPointerUp);
    this.handle.addEventListener('pointercancel', this._onPointerUp);

    if (!this.noZBoost) {
      window._zTop = (window._zTop || 200) + 1;
      this.panel.style.zIndex = window._zTop;
    }
  }

  _onPointerMove(e) {
    if (e.pointerId !== this._activePointerId) return;

    const dx = e.clientX - this._startX;
    const dy = e.clientY - this._startY;

    if (!this._isDrag && Math.hypot(dx, dy) > 5) {
      this._isDrag = true;
      this.panel.style.cursor = 'grabbing';
      // setPointerCapture 실패 시(비정상적인 포인터 상태 등) 여기서 던지지만, 이미
      // _activePointerId가 세팅된 뒤라 다음 시도를 막지는 않는다 - pointerup/cancel이
      // 정상적으로 붙어있으므로 이번 제스처는 그대로 정리된다.
      this.handle.setPointerCapture(e.pointerId);
      this._endGesture();     // 혹시 남아있던 WASD 팬 커밋
      this._beginGesture();
    }

    if (!this._isDrag) return;

    this._moveGesture(e.clientX - this._offsetX, e.clientY - this._offsetY);
  }

  _onPointerUp(e) {
    if (e.pointerId !== this._activePointerId) return;

    if (this._isDrag) {
      this._endGesture();
      this._dragEndedAt = Date.now();
      this.panel.style.cursor = '';
    }
    this._isDrag = false;
    this._activePointerId = null;
    this.handle.removeEventListener('pointermove',   this._onPointerMove);
    this.handle.removeEventListener('pointerup',     this._onPointerUp);
    this.handle.removeEventListener('pointercancel', this._onPointerUp);
  }

  /** 핀치 줌 등 다른 제스처가 시작될 때 진행 중이던 드래그를 즉시 중단 */
  cancelDrag() {
    if (this._activePointerId === null) return;
    try { this.handle.releasePointerCapture(this._activePointerId); } catch {}
    this._onPointerUp({ pointerId: this._activePointerId });
  }

  setPosition(x, y) {
    this._applyPos(x, y);
  }

  moveBy(dx, dy) {
    const r = this.panel.getBoundingClientRect();
    this._applyPos(r.left + dx, r.top + dy);
  }
}
