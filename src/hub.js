/**
 * hub.js — ProjectDaily 허브(/ProjectDaily/)와 이어 주는 연결부. (세 게임 공통, 같은 파일)
 *
 * - 허브(/ProjectDaily/)의 버튼은 `?open=<랜딩 버튼 id>`로 이 페이지를 연다 → 로드 직후 그 버튼을 대신 눌러 준다.
 * - 허브에서 들어온 탭에서는 "메인 화면" 역할을 허브가 하므로, 게임의 랜딩 메인으로 돌아가는
 *   대신 허브로 보낸다(leaveToHub). 주소로 직접 들어온 경우엔 지금까지처럼 게임 랜딩을 쓴다.
 */
// 절대 경로: 허브 안(/ProjectDaily/DailySudoku/)에서도, 예전 주소(/DailySudoku/)에서도 같은 허브로 간다
const HUB_URL = '/ProjectDaily/';
const FROM_HUB_KEY = (slug) => `daily-hub:from:${slug}`;

let hubSlug = '';
let fromHub = false;

export function goHub() {
  location.href = `${HUB_URL}#${hubSlug}`;
}

/** 허브에서 들어온 탭이면 허브로 보내고 true — 호출부는 true면 원래의 랜딩 전환을 건너뛴다 */
export function leaveToHub() {
  if (!fromHub) return false;
  goHub();
  return true;
}

/** main.js 맨 끝(이벤트 연결·첫 화면 표시가 끝난 뒤)에서 한 번 호출 */
export function initHub(slug) {
  hubSlug = slug;
  const openId = new URLSearchParams(location.search).get('open');
  try {
    if (openId) sessionStorage.setItem(FROM_HUB_KEY(slug), '1');
    fromHub = sessionStorage.getItem(FROM_HUB_KEY(slug)) === '1';
  } catch { fromHub = Boolean(openId); }

  document.querySelectorAll('[data-hub-link]').forEach((a) => { a.href = `${HUB_URL}#${slug}`; });

  if (!openId) return;
  // 새로고침해도 다시 눌리지 않게 주소창에서 지운다
  history.replaceState(null, '', location.pathname + location.hash);

  // 랜딩 메인의 버튼만 허용 (임의 id 클릭 방지)
  const btn = document.getElementById(openId);
  if (!(btn instanceof HTMLButtonElement) || !btn.closest('#landing-main')) return;
  btn.click();

  // 통계만 보러 온 경우: 통계 창을 닫으면 (게임 화면이 아니라면) 허브로 돌아간다
  if (openId === 'btn-landing-stats') {
    const modal = document.getElementById('daily-stats-modal');
    const landing = document.getElementById('landing-screen');
    if (!modal || !landing) return;
    const obs = new MutationObserver(() => {
      if (modal.classList.contains('show')) return;
      obs.disconnect();
      if (!landing.classList.contains('hidden')) goHub();
    });
    obs.observe(modal, { attributes: true, attributeFilter: ['class'] });
  }
}
