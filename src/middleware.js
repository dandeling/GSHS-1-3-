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
    // maxAge 미설정 → 세션 쿠키
  });
}

export function clearSession(res) {
  res.clearCookie(COOKIE_NAME);
}

// 현재 사용자 로드 (없으면 null). 정지 만료 시 자동 활동중 복구.
export function loadUser(req) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return null;
  try {
    const { uid } = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(uid);
    if (!user) return null;
    // 정지 만료 자동 해제
    if (user.status === 'suspended' && user.suspended_until) {
      if (new Date(user.suspended_until) <= new Date()) {
        db.prepare("UPDATE users SET status='active', suspended_until=NULL WHERE id=?").run(user.id);
        user.status = 'active';
        user.suspended_until = null;
      }
    }
    return user;
  } catch {
    return null;
  }
}

// 로그인 필수 + 활동중 상태 필수
export function requireAuth(req, res, next) {
  const user = loadUser(req);
  if (!user) return res.status(401).json({ error: '로그인이 필요합니다.' });
  if (user.status === 'pending') return res.status(403).json({ error: '관리자 승인 대기 중입니다.' });
  if (user.status === 'rejected') return res.status(403).json({ error: '가입이 거절된 계정입니다.' });
  if (user.status === 'kicked') return res.status(403).json({ error: '강퇴된 계정입니다.' });
  if (user.status === 'suspended') {
    return res.status(403).json({ error: `정지된 계정입니다. (해제 예정: ${user.suspended_until || '미정'})` });
  }
  req.user = user;
  next();
}

// 관리자 필수
export function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: '관리자만 접근할 수 있습니다.' });
    next();
  });
}

// 벌점 부여 및 상태 처리: 3=하루정지, 6=일주일정지, 9=강퇴
export function addDemerit(userId) {
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(userId);
  if (!user || user.role === 'admin') return user; // 관리자는 벌점 제외
  const demerit = user.demerit + 1;
  let status = user.status;
  let suspendedUntil = user.suspended_until;

  if (demerit >= 9) {
    status = 'kicked';
    suspendedUntil = null;
  } else if (demerit >= 6) {
    status = 'suspended';
    suspendedUntil = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
  } else if (demerit >= 3) {
    status = 'suspended';
    suspendedUntil = new Date(Date.now() + 1 * 24 * 3600 * 1000).toISOString();
  }
  db.prepare('UPDATE users SET demerit=?, status=?, suspended_until=? WHERE id=?')
    .run(demerit, status, suspendedUntil, userId);
  return { ...user, demerit, status, suspended_until: suspendedUntil };
}
