// 공통 유틸 & 네비게이션
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
  // SQLite datetime은 UTC. 로컬로 표시
  const d = new Date(iso.replace(' ', 'T') + (iso.includes('Z') ? '' : 'Z'));
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function qs(name) { return new URLSearchParams(location.search).get(name); }

// 현재 로그인 사용자 로드
export async function getMe() {
  try { const d = await api.get('/api/auth/me'); return d.user; } catch { return null; }
}

// 상단 네비게이션 렌더링. requireLogin=true면 미로그인 시 로그인 페이지로 이동
export async function renderNav(opts = {}) {
  const me = await getMe();
  if (opts.requireLogin && !me) { location.href = '/login.html'; return null; }
  if (opts.requireAdmin && (!me || me.role !== 'admin')) { location.href = '/'; return me; }

  const header = document.createElement('header');
  header.className = 'nav';
  const links = `
    <a href="/">홈</a>
    <a href="/board.html?board=notice">공지</a>
    <a href="/board.html?board=free">자유게시판</a>
    <a href="/board.html?board=resource">자료공유</a>
    <a href="/chat.html">반 채팅방</a>
    <a href="/calendar.html">캘린더</a>
    ${me && me.role === 'admin' ? '<a href="/admin.html">관리자</a>' : ''}
  `;
  let right;
  if (me) {
    right = `
      <span class="nav-user">
        <b>${esc(me.username)}</b>
        ${me.role === 'admin' ? '<span class="badge admin">관리자</span>' : ''}
        ${me.demerit > 0 ? `<span class="badge demerit">벌점 ${me.demerit}</span>` : ''}
        <a href="#" id="logoutBtn">로그아웃</a>
      </span>`;
  } else {
    right = `<span class="nav-user"><a href="/login.html">로그인</a> <a href="/register.html">회원가입</a></span>`;
  }
  header.innerHTML = `<div class="nav-inner"><span class="brand">GSHS 1-3 커뮤니티</span>
    <span class="nav-links">${me ? links : ''}</span>${right}</div>`;
  document.body.prepend(header);

  const lo = document.getElementById('logoutBtn');
  if (lo) lo.addEventListener('click', async (e) => {
    e.preventDefault();
    await api.post('/api/auth/logout');
    location.href = '/login.html';
  });
  return me;
}

// 알림 표시
export function showMsg(el, text, ok = false) {
  el.className = 'msg ' + (ok ? 'ok' : 'err');
  el.textContent = text;
  el.classList.remove('hidden');
}
