import jwt from 'jsonwebtoken';
import db from './db.js';

export const JWT_SECRET = process.env.JWT_SECRET || 'gshs-1-3-dev-secret-change-me';
export const COOKIE_NAME = 'session';

// 세션 쿠키 발급 (maxAge 없음 → 브라우저 닫으면 로그아웃, 자동 로그인 없음)
export function issueSession(res, user) {
  const token = jwt.sign({ uid: user.id }, JWT_SECRET, { expiresIn: '12h' });
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
}

export function clearSession(res) {
  res.clearCookie(COOKIE_NAME);
}

// 현재 사용자 로드 (없으면 null). 정지 만료 시 자동 활동중 복구.
export async function loadUser(req) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return null;
  let uid;
  try { ({ uid } = jwt.verify(token, JWT_SECRET)); } catch { return null; }
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(uid);
  if (!user) return null;
  if (user.status === 'suspended' && user.suspended_until && new Date(user.suspended_until) <= new Date()) {
    await db.prepare("UPDATE users SET status='active', suspended_until=NULL WHERE id=?").run(user.id);
    user.status = 'active';
    user.suspended_until = null;
  }
  return user;
}

// 로그인 필수 + 활동중 상태 필수 (async 미들웨어)
export function requireAuth(req, res, next) {
  loadUser(req).then((user) => {
    if (!user) return res.status(401).json({ error: '로그인이 필요합니다.' });
    if (user.status === 'pending') return res.status(403).json({ error: '관리자 승인 대기 중입니다.' });
    if (user.status === 'rejected') return res.status(403).json({ error: '가입이 거절된 계정입니다.' });
    if (user.status === 'kicked') return res.status(403).json({ error: '강퇴된 계정입니다.' });
    if (user.status === 'suspended') return res.status(403).json({ error: `정지된 계정입니다. (해제 예정: ${user.suspended_until || '미정'})` });
    req.user = user;
    next();
  }).catch(() => res.status(500).json({ error: '서버 오류가 발생했어요.' }));
}

// 관리자 필수
export function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: '관리자만 접근할 수 있습니다.' });
    next();
  });
}

// 벌점 부여 및 상태 처리: 3=하루정지, 6=일주일정지, 9=강퇴
export async function addDemerit(userId) {
  const user = await db.prepare('SELECT * FROM users WHERE id=?').get(userId);
  if (!user || user.role === 'admin') return user; // 관리자는 벌점 제외
  const demerit = user.demerit + 1;
  let status = user.status;
  let suspendedUntil = user.suspended_until;

  if (demerit >= 9) { status = 'kicked'; suspendedUntil = null; }
  else if (demerit >= 6) { status = 'suspended'; suspendedUntil = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(); }
  else if (demerit >= 3) { status = 'suspended'; suspendedUntil = new Date(Date.now() + 1 * 24 * 3600 * 1000).toISOString(); }

  await db.prepare('UPDATE users SET demerit=?, status=?, suspended_until=? WHERE id=?')
    .run(demerit, status, suspendedUntil, userId);

  // 로그인 시 경고창으로 1회 표시할 벌점 경고 저장
  let warn;
  if (demerit >= 9) {
    warn = `🚫 누적 벌점 ${demerit}점으로 강퇴되었습니다.`;
  } else if (status === 'suspended') {
    const u = suspendedUntil ? new Date(suspendedUntil) : null;
    const p = (n) => String(n).padStart(2, '0');
    const untilStr = u ? `${u.getMonth() + 1}월 ${u.getDate()}일 ${p(u.getHours())}:${p(u.getMinutes())}` : '';
    warn = `⚠️ 경고: 벌점이 부과되어 누적 ${demerit}점입니다.\n계정이 정지되었습니다${untilStr ? ` (해제 예정: ${untilStr})` : ''}.`;
  } else {
    warn = `⚠️ 경고: 벌점 1점이 부과되었습니다.\n현재 누적 ${demerit}점 — 3점 1일 정지 / 6점 1주 정지 / 9점 강퇴.`;
  }
  await db.prepare('INSERT INTO warnings (user_id, text) VALUES (?, ?)').run(userId, warn);

  return { ...user, demerit, status, suspended_until: suspendedUntil };
}
