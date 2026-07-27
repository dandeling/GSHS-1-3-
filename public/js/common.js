// 공통 유틸 · 상단바 · 사이드바 · 다크모드
export const api = {
  async req(method, url, body) {
    const opt = { method, headers: {}, credentials: 'same-origin' };
    if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
    const res = await fetch(url, opt);
    let data = {};
    try { data = await res.json(); } catch {}
    if (!res.ok) { const e = new Error(data.error || `요청 실패 (${res.status})`); e.data = data; e.status = res.status; throw e; }
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
    <span class="title">1-3반 <small>커뮤니티</small></span>
    ${me ? `<a class="icon-btn" id="bellBtn" href="/notifications.html" aria-label="알림" style="position:relative">🔔<span class="notif-dot hidden" id="notifDot"></span></a>` : ''}
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
  const ni = me ? nextLevelInfo(me.point) : null;
  const userBox = me
    ? `<div class="sb-user">
        <div class="row" style="gap:6px"><b>${esc(me.username)}</b> ${levelBadge(me.point, me.role, me.rank)}
          ${me.demerit > 0 ? `<span class="badge demerit">벌점 ${me.demerit}</span>` : ''}</div>
        ${me.role !== 'admin' ? `<div class="lv-bar"><div class="lv-bar-in" style="width:${ni.next ? Math.min(100, Math.round((me.point-ni.cur.min)/(ni.next.min-ni.cur.min)*100)) : 100}%"></div></div>
          <div class="muted" style="font-size:11px;margin-top:3px">활동점수 ${me.point}점 ${ni.next ? `· 다음 등급(${ni.next.emoji}${ni.next.name})까지 ${ni.remain}점` : '· 최고 등급!'}</div>` : ''}
        <div style="margin-top:8px"><a href="#" id="logoutLink" class="muted">로그아웃</a></div></div>`
    : `<a href="/login.html" class="sb-login"><b>로그인 / 회원가입</b><span class="muted">재학생 인증 후 이용할 수 있어요</span></a>`;
  const authed = !!me;
  sb.innerHTML = `
    <div class="sb-head"><span class="sb-title">1-3반 커뮤니티</span><button class="icon-btn" id="closeBtn" style="box-shadow:none">✕</button></div>
    ${userBox}
    <a class="sb-link" href="/"><span class="e">🏠</span> 홈 · 전체 글</a>
    <a class="sb-link" href="/board.html?board=free&sort=popular"><span class="e">🔥</span> 인기글</a>
    ${authed ? '<a class="sb-link" href="/write.html?board=free"><span class="e">✏️</span> 글쓰기</a>' : ''}
    ${authed ? '<a class="sb-link" href="/profile.html"><span class="e">👤</span> 내 프로필</a>' : ''}
    ${authed ? '<a class="sb-link" href="/notifications.html"><span class="e">🔔</span> 알림</a>' : ''}
    ${authed ? '<a class="sb-link" href="/dm.html"><span class="e">✉️</span> 쪽지</a>' : ''}
    ${authed ? '<a class="sb-link" href="/ranking.html"><span class="e">🏆</span> 랭킹</a>' : ''}
    ${authed ? '<a class="sb-link" href="/inquiries.html"><span class="e">💌</span> 문의사항</a>' : ''}
    <a class="sb-link" href="/board.html?board=notice"><span class="e">📢</span> 공지사항</a>
    <a class="sb-link" href="/board.html?board=resource"><span class="e">📚</span> 자료공유</a>
    <a class="sb-link" href="/chat.html"><span class="e">⚡</span> 반 채팅방</a>
    <a class="sb-link" href="/calendar.html"><span class="e">📅</span> 캘린더</a>
    <a class="sb-link" href="/timetable.html"><span class="e">🕐</span> 시간표</a>
    <a class="sb-link" href="/special.html"><span class="e">🌙</span> 8교시·야간</a>
    ${me && me.role === 'admin' ? '<a class="sb-link" href="/admin.html"><span class="e">🛠️</span> 관리자 페이지</a>' : ''}
    ${me && me.role === 'admin' ? '<a class="sb-link" href="/audit.html"><span class="e">📋</span> 전체 기록</a>' : ''}
    ${me && me.role === 'admin' ? '<a class="sb-link" href="/reports.html"><span class="e">🚨</span> 신고함 <span class="badge demerit hidden" id="reportBadge" style="margin-left:4px"></span></a>' : ''}
    <div class="sb-div"></div>
    <a class="sb-link" href="/info.html?p=about"><span class="e">🏫</span> 학교 소개</a>
    <a class="sb-link" href="/info.html?p=rules"><span class="e">📜</span> 이용 안내 · 규칙</a>
    <a class="sb-link" href="/info.html?p=privacy"><span class="e">🔒</span> 개인정보 처리방침</a>
    <div class="sb-foot">🌲 1984년 개교 · 국내 최초 과학고, 경남과학고<br>GSHS 학생 커뮤니티</div>`;
  document.body.prepend(overlay);
  document.body.prepend(sb);

  // 데스크탑 왼쪽 카페 메뉴 (넓은 화면 전용)
  if (me) {
    const aside = document.createElement('aside');
    aside.className = 'cafe-menu';
    aside.innerHTML = `
      <div class="cm-box">
        <div class="cm-title">📋 게시판</div>
        <a class="cm-link" href="/">🏠 전체 글</a>
        <a class="cm-link" href="/board.html?board=free&sort=popular">🔥 인기글</a>
        <a class="cm-link" href="/board.html?board=notice">📢 공지사항</a>
        <a class="cm-link" href="/board.html?board=free">💬 자유게시판</a>
        <a class="cm-link" href="/board.html?board=resource">📚 자료공유</a>
        <div class="cm-title" style="margin-top:12px">🏫 소통</div>
        <a class="cm-link" href="/chat.html">⚡ 반 채팅방</a>
        <a class="cm-link" href="/calendar.html">📅 캘린더</a>
        <a class="cm-link" href="/timetable.html">🕐 시간표</a>
        <a class="cm-link" href="/special.html">🌙 8교시·야간</a>
        ${me.role === 'admin' ? '<a class="cm-link" href="/admin.html">🛠️ 관리자</a>' : ''}
        ${me.role === 'admin' ? '<a class="cm-link" href="/audit.html">📋 전체 기록</a>' : ''}
        ${me.role === 'admin' ? '<a class="cm-link" href="/reports.html">🚨 신고함</a>' : ''}
      </div>
      <div class="cm-box">
        <div class="cm-title">${esc(me.username)} 님</div>
        <div style="margin:4px 0">${levelBadge(me.point, me.role, me.rank)}</div>
        ${me.role !== 'admin' ? `<div class="muted" style="font-size:11px">활동점수 ${me.point}점</div>` : ''}
        <a class="cm-link" href="/info.html?p=levels" style="margin-top:6px">🌱 등급 안내</a>
      </div>`;
    document.body.appendChild(aside);
  }

  const open = () => { sb.classList.add('open'); overlay.classList.add('open'); };
  const close = () => { sb.classList.remove('open'); overlay.classList.remove('open'); };
  document.getElementById('menuBtn').addEventListener('click', open);
  document.getElementById('closeBtn').addEventListener('click', close);
  overlay.addEventListener('click', close);
  document.getElementById('themeBtn').addEventListener('click', toggleTheme);
  const lo = document.getElementById('logoutLink');
  if (lo) lo.addEventListener('click', async (e) => { e.preventDefault(); await api.post('/api/auth/logout'); location.href = '/login.html'; });

  // 안읽은 알림/쪽지 배지
  if (me) {
    const refreshBadge = async () => {
      try {
        const c = await api.get('/api/notifications/count');
        const dot = document.getElementById('notifDot');
        if (dot) dot.classList.toggle('hidden', (c.total || 0) === 0);
        if (dot && c.total > 0) dot.textContent = c.total > 9 ? '9+' : c.total;
      } catch {}
      // 관리자: 미처리 신고 배지
      if (me.role === 'admin') {
        try {
          const r = await api.get('/api/admin/reports/count');
          const rb = document.getElementById('reportBadge');
          if (rb) { rb.classList.toggle('hidden', (r.count || 0) === 0); if (r.count > 0) rb.textContent = r.count; }
        } catch {}
      }
    };
    refreshBadge();
    setInterval(refreshBadge, 30000);
  }

  return me;
}

export function showMsg(el, text, ok = false) {
  el.className = 'msg ' + (ok ? 'ok' : 'err');
  el.textContent = text;
  el.classList.remove('hidden');
}

// 자동입력 방지(캡차) 위젯. box 안에 문제·입력칸·새로고침을 그리고 토큰/정답 게터를 반환.
export function captchaWidget(box) {
  let token = '';
  async function refresh() {
    box.innerHTML = '<span class="muted" style="font-size:12px">자동입력 방지 불러오는 중…</span>';
    try {
      const d = await api.get('/api/auth/captcha');
      token = d.token;
      box.innerHTML = `<label>자동입력 방지 — 아래 계산의 답을 적어주세요</label>
        <div class="row" style="align-items:center;gap:8px">
          <span style="font-weight:700;font-size:18px;letter-spacing:1px;padding:6px 12px;background:var(--hover,rgba(0,0,0,0.05));border-radius:8px;white-space:nowrap">${esc(d.question)}</span>
          <input class="cap-ans grow" inputmode="numeric" autocomplete="off" placeholder="정답" style="max-width:110px" />
          <button type="button" class="btn-sm btn-ghost cap-refresh" title="새 문제">🔄</button>
        </div>`;
      box.querySelector('.cap-refresh').addEventListener('click', refresh);
    } catch { box.innerHTML = '<span class="muted">자동입력 방지를 불러오지 못했어요. 새로고침 해주세요.</span>'; }
  }
  refresh();
  return {
    token: () => token,
    answer: () => (box.querySelector('.cap-ans')?.value || '').trim(),
    clear: () => { const i = box.querySelector('.cap-ans'); if (i) i.value = ''; },
    refresh,
  };
}

// 태그 코드 → {name, emoji} 캐시
let _meta = null;
export async function getMeta() { if (!_meta) _meta = await api.get('/api/meta'); return _meta; }

// ===== 네이버 카페식 회원 등급(등업) =====
const LEVELS = [
  { min: 200, emoji: '👑', name: '정회원' },
  { min: 100, emoji: '🍎', name: '열매' },
  { min: 50,  emoji: '🌸', name: '꽃' },
  { min: 20,  emoji: '🍃', name: '잎새' },
  { min: 5,   emoji: '🌿', name: '새싹' },
  { min: 0,   emoji: '🌱', name: '씨앗' },
];
export function levelOf(point) { return LEVELS.find((l) => (point || 0) >= l.min) || LEVELS[LEVELS.length - 1]; }
// 등급 뱃지 HTML. 커스텀 등급(관리자 지정) > 운영자 > 자동 등급 순.
export function levelBadge(point, role, rank) {
  if (rank) return `<span class="lv lv-custom" title="관리자 지정 등급">⭐ ${esc(rank)}</span>`;
  if (role === 'admin') return `<span class="lv lv-admin" title="운영자">👑 운영자</span>`;
  const l = levelOf(point);
  return `<span class="lv" title="활동점수 ${point||0}점">${l.emoji} ${l.name}</span>`;
}
// 다음 등급까지 안내
export function nextLevelInfo(point) {
  point = point || 0;
  const asc = [...LEVELS].reverse();
  const cur = levelOf(point);
  const next = asc.find((l) => l.min > point);
  return { cur, next, remain: next ? next.min - point : 0 };
}

// 디시인사이드 스타일 게시판 표 렌더링
// subjName(code) 를 넘기면 자료게시판 과목명을 말머리로 표시
// startNo: 첫 행에 매길 번호(내림차순). 넘기면 삭제로 인한 번호 공백 없이 순서대로 표시.
export function renderDcTable(posts, tagName, subjName, startNo) {
  if (!posts.length) return `<div class="empty">글이 없어요. 첫 글을 남겨보세요!</div>`;
  let seq = (typeof startNo === 'number') ? startNo : null;
  const rows = posts.map((p) => {
    let head = '';
    if (p.board === 'notice') head = '';
    else if (p.board === 'resource' && p.subject && subjName) head = `<span class="tag-chip">${esc(subjName(p.subject))}${p.category==='exam'?'·시험':'·수행'}</span> `;
    else if (p.tag && tagName) { const n = tagName(p.tag); if (n) head = `<span class="tag-chip">${esc(n)}</span> `; }
    const noCell = p.board === 'notice'
      ? `<span class="notice-badge">공지</span>`
      : (seq !== null ? seq-- : p.id);
    const cmt = p.comment_count > 0 ? `<span class="cmt">[${p.comment_count}]</span>` : '';
    const lv = levelOf(p.author_point);
    const lvIcon = p.author_rank ? '⭐' : (p.author_role === 'admin' ? '👑' : lv.emoji);
    const lvName = p.author_rank ? p.author_rank : (p.author_role === 'admin' ? '운영자' : lv.name);
    return `<tr class="${p.board==='notice'?'is-notice':''}" onclick="location.href='/post.html?id=${p.id}'">
      <td class="c-no">${noCell}</td>
      <td class="c-subj">${head}<span class="subj-title">${esc(p.title)}</span>${p.has_attach ? ' <span title="첨부파일">📎</span>' : ''}${cmt}</td>
      <td class="c-user"><span class="lv-dot" title="${esc(lvName)}">${lvIcon}</span><span class="clickable-user" onclick="event.stopPropagation();location.href='/profile.html?u=${encodeURIComponent(p.author).replace(/'/g, '%27')}'">${esc(p.author)}</span></td>
      <td class="c-date">${fmt(p.created_at)}</td>
      <td class="c-num c-views">${p.views}</td>
      <td class="c-num c-reco"><span class="reco">${p.like_count}</span></td>
    </tr>`;
  }).join('');
  return `<div class="tbl-scroll"><table class="dctable">
    <thead><tr><th class="c-no">번호</th><th class="c-subj" style="text-align:left">제목</th>
      <th class="c-user">글쓴이</th><th class="c-date">날짜</th>
      <th class="c-num c-views">조회</th><th class="c-num c-reco">추천</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}
