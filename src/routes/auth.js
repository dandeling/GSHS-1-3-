import express from 'express';
import bcrypt from 'bcryptjs';
import db from '../db.js';
import { SCHOOL_EMAIL_REGEX } from '../constants.js';
import { issueSession, clearSession, loadUser, requireAuth } from '../middleware.js';

const router = express.Router();

// 회원가입
router.post('/register', (req, res) => {
  const { email, username, realname, password } = req.body || {};
  if (!email || !username || !realname || !password) {
    return res.status(400).json({ error: '모든 항목을 입력하세요.' });
  }
  const m = String(email).match(SCHOOL_EMAIL_REGEX);
  if (!m) {
    return res.status(400).json({ error: '학교 이메일 형식만 가입 가능합니다. 예) 43gshs-1319@g.gne.go.kr' });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ error: '비밀번호는 6자 이상이어야 합니다.' });
  }
  const grade = parseInt(m[1], 10);
  const studentId = m[2];

  const dupEmail = db.prepare('SELECT id FROM users WHERE email=?').get(email);
  if (dupEmail) return res.status(409).json({ error: '이미 가입된 이메일입니다.' });
  const dupName = db.prepare('SELECT id FROM users WHERE username=?').get(username);
  if (dupName) return res.status(409).json({ error: '이미 사용 중인 별명입니다.' });

  const hash = bcrypt.hashSync(password, 10);
  db.prepare(`
    INSERT INTO users (email, username, realname, grade, student_id, password, role, status)
    VALUES (?, ?, ?, ?, ?, ?, 'user', 'pending')
  `).run(email, username, realname, grade, studentId, hash);

  res.json({ ok: true, message: '가입 신청 완료! 관리자 승인 후 이용할 수 있습니다.' });
});

// 로그인 (별명 또는 이메일 + 비밀번호)
router.post('/login', (req, res) => {
  const { login, password } = req.body || {};
  if (!login || !password) return res.status(400).json({ error: '아이디와 비밀번호를 입력하세요.' });

  const user = db.prepare('SELECT * FROM users WHERE username=? OR email=?').get(login, login);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: '아이디 또는 비밀번호가 올바르지 않습니다.' });
  }

  // 정지 만료 자동 해제
  if (user.status === 'suspended' && user.suspended_until && new Date(user.suspended_until) <= new Date()) {
    db.prepare("UPDATE users SET status='active', suspended_until=NULL WHERE id=?").run(user.id);
    user.status = 'active';
  }

  if (user.status === 'pending')  return res.status(403).json({ error: '관리자 승인 대기 중입니다.' });
  if (user.status === 'rejected') return res.status(403).json({ error: '가입이 거절된 계정입니다.' });
  if (user.status === 'kicked')   return res.status(403).json({ error: '강퇴된 계정입니다.' });
  if (user.status === 'suspended') {
    return res.status(403).json({ error: `정지 중입니다. 해제 예정: ${user.suspended_until}` });
  }

  issueSession(res, user);
  res.json({ ok: true, user: publicUser(user) });
});

// 로그아웃
router.post('/logout', (req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

// 내 정보
router.get('/me', (req, res) => {
  const user = loadUser(req);
  if (!user) return res.json({ user: null });
  res.json({ user: publicUser(user) });
});

// 아이디(별명) 찾기: 학교 이메일 → 별명
router.post('/find-id', (req, res) => {
  const { email } = req.body || {};
  if (!email || !SCHOOL_EMAIL_REGEX.test(email)) return res.status(400).json({ error: '학교 이메일 형식을 확인하세요.' });
  const user = db.prepare('SELECT username, status FROM users WHERE email=?').get(email);
  if (!user) return res.status(404).json({ error: '해당 이메일로 가입된 계정이 없습니다.' });
  res.json({ ok: true, username: user.username, status: user.status });
});

// 비밀번호 재설정: 이메일 + 실명 본인확인 → 새 비밀번호
router.post('/reset-password', (req, res) => {
  const { email, realname, newPassword } = req.body || {};
  if (!email || !realname || !newPassword) return res.status(400).json({ error: '모든 항목을 입력하세요.' });
  if (String(newPassword).length < 6) return res.status(400).json({ error: '새 비밀번호는 6자 이상이어야 합니다.' });
  const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  // 정보 노출 방지: 이메일/실명 어느 쪽이 틀려도 동일 메시지
  if (!user || user.realname !== String(realname).trim()) {
    return res.status(400).json({ error: '이메일과 실명이 일치하지 않습니다.' });
  }
  if (user.role === 'admin') return res.status(400).json({ error: '관리자 계정은 이 방법으로 재설정할 수 없습니다.' });
  const hash = bcrypt.hashSync(String(newPassword), 10);
  db.prepare('UPDATE users SET password=? WHERE id=?').run(hash, user.id);
  res.json({ ok: true, message: '비밀번호가 변경됐어요. 새 비밀번호로 로그인하세요.' });
});

// 비밀번호 변경 (로그인 상태, 현재 비번 확인)
router.post('/change-password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) return res.status(400).json({ error: '현재/새 비밀번호를 입력하세요.' });
  if (String(newPassword).length < 6) return res.status(400).json({ error: '새 비밀번호는 6자 이상이어야 합니다.' });
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!bcrypt.compareSync(currentPassword, user.password)) return res.status(400).json({ error: '현재 비밀번호가 올바르지 않습니다.' });
  const hash = bcrypt.hashSync(String(newPassword), 10);
  db.prepare('UPDATE users SET password=? WHERE id=?').run(hash, user.id);
  res.json({ ok: true, message: '비밀번호가 변경됐어요.' });
});

// 화면 노출용 사용자 정보 (실명 제외)
export function publicUser(u) {
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    status: u.status,
    demerit: u.demerit,
    grade: u.grade,
    point: u.point || 0,
  };
}

export default router;
