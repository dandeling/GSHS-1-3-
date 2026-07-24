// 공통 유틸 · 상단바 · 사이드바 · 다크모드
export const api = {
  async req(method, url, body) {
    const opt = { method, headers: {}, credentials: 'same-origin' };
    if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
    const res = await fetch(url, opt);
    let data = {};
    try { data = await res.json(); } catch {}
    if (!res.ok) throw new Error(data.error || `요청 실패 (${res.status})`);
    return data;
  },
  get: (u) => api.req('GET', u),
  post: (u, b) => api.req('POST', u, b),
  put: (u, b) => api.req('PUT', u, b),
  del: (u) => api.req('DELETE', u),
};

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export function fmt(iso) {
  if (!iso) return '';
  const d = new Date(iso.replace(' ', 'T') + (iso.includes('Z') ? '' : 'Z'));
  const p = (n) => String(n).padStart(2, '0');
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return `${p(d.getHours())}:${p(d.getMinutes())}`;
  return `${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function qs(name) { return new URLSearchParams(location.search).get(name); }

export async function getMe() {
  try { const d = await api.get('/api/auth/me'); return d.user; } catch { return null; }
}

// 다크모드
function initTheme() {
  const saved = localStorage.getItem('theme');
  if (saved) document.documentElement.setAttribute('data-theme', saved);
}
export function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme');
  const isDark = cur === 'dark' || (!cur && matchMedia('(prefers-color-scheme: dark)').matches);
  const next = isDark ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
}
initTheme();

// 상단바 + 사이드바 렌더링
export async function renderNav(opts = {}) {
  const me = await getMe();
  if (opts.requireLogin && !me) { location.href = '/login.html'; return null; }
  if (opts.requireAdmin && (!me || me.role !== 'admin')) { location.href = '/'; return me; }

  // 상단바
  const bar = document.createElement('header');
  bar.className = 'topbar';
  bar.innerHTML = `<div class="topbar-inner">
    <button class="icon-btn" id="menuBtn" aria-label="메뉴">☰</button>
    <span class="title">큰들 <small>커뮤니티</small></span>
    <button class="icon-btn" id="themeBtn" aria-label="테마">🌙</button>
  </div>`;
  document.body.prepend(bar);

  // 사이드바
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.id = 'overlay';
  const sb = document.createElement('nav');
  sb.className = 'sidebar';
  sb.id = 'sidebar';
  const userBox = me
    ? `<div class="sb-user"><b>${esc(me.username)}</b> 님 ${me.role === 'admin' ? '<span class="badge admin">관리자</span>' : ''}
        ${me.demerit > 0 ? `<span class="badge demerit">벌점 ${me.demerit}</span>` : ''}
        <div style="margin-top:8px"><a href="#" id="logoutLink" class="muted">로그아웃</a></div></div>`
    : `<a href="/login.html" class="sb-login"><b>로그인 / 회원가입</b><span class="muted">재학생 인증 후 이용할 수 있어요</span></a>`;
  const authed = !!me;
  sb.innerHTML = `
    <div class="sb-head"><span class="sb-title">큰들 커뮤니티</span><button class="icon-btn" id="closeBtn" style="box-shadow:none">✕</button></div>
    ${userBox}
    <a class="sb-link" href="/"><span class="e">🏠</span> 홈 · 전체 글</a>
    <a class="sb-link" href="/board.html?board=free&sort=popular"><span class="e">🔥</span> 인기글</a>
    ${authed ? '<a class="sb-link" href="/write.html?board=free"><span class="e">✏️</span> 글쓰기</a>' : ''}
    <a class="sb-link" href="/board.html?board=notice"><span class="e">📢</span> 공지사항</a>
    <a class="sb-link" href="/board.html?board=resource"><span class="e">📚</span> 자료공유</a>
    <a class="sb-link" href="/chat.html"><span class="e">⚡</span> 반 채팅방</a>
    <a class="sb-link" href="/calendar.html"><span class="e">📅</span> 캘린더</a>
    ${me && me.role === 'admin' ? '<a class="sb-link" href="/admin.html"><span class="e">🛠️</span> 관리자 페이지</a>' : ''}
    <div class="sb-div"></div>
    <a class="sb-link" href="/info.html?p=about"><span class="e">🏫</span> 학교 소개</a>
    <a class="sb-link" href="/info.html?p=rules"><span class="e">📜</span> 이용 안내 · 규칙</a>
    <a class="sb-link" href="/info.html?p=privacy"><span class="e">🔒</span> 개인정보 처리방침</a>
    <div class="sb-foot">🌲 1984년 개교 · 국내 최초 과학고, 경남과학고<br>GSHS 학생 커뮤니티</div>`;
  document.body.prepend(overlay);
  document.body.prepend(sb);

  const open = () => { sb.classList.add('open'); overlay.classList.add('open'); };
  const close = () => { sb.classList.remove('open'); overlay.classList.remove('open'); };
  document.getElementById('menuBtn').addEventListener('click', open);
  document.getElementById('closeBtn').addEventListener('click', close);
  overlay.addEventListener('click', close);
  document.getElementById('themeBtn').addEventListener('click', toggleTheme);
  const lo = document.getElementById('logoutLink');
  if (lo) lo.addEventListener('click', async (e) => { e.preventDefault(); await api.post('/api/auth/logout'); location.href = '/login.html'; });

  return me;
}

export function showMsg(el, text, ok = false) {
  el.className = 'msg ' + (ok ? 'ok' : 'err');
  el.textContent = text;
  el.classList.remove('hidden');
}

// 태그 코드 → {name, emoji} 캐시
let _meta = null;
export async function getMeta() { if (!_meta) _meta = await api.get('/api/meta'); return _meta; }
