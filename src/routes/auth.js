import express from 'express';
import bcrypt from 'bcryptjs';
import db from '../db.js';
import { SCHOOL_EMAIL_REGEX } from '../constants.js';
import { issueSession, clearSession, loadUser, requireAuth } from '../middleware.js';
import { mailEnabled, sendCodeMail } from '../mailer.js';

const router = express.Router();

// 이메일 인증 사용 여부 (프론트에서 UI 분기)
router.get('/mail-status', (req, res) => res.json({ enabled: mailEnabled() }));

// 인증코드 발송 (purpose: register | reset)
router.post('/send-code', async (req, res) => {
  if (!mailEnabled()) return res.status(400).json({ error: '이메일 인증이 설정되지 않았습니다.' });
  const { email, purpose } = req.body || {};
  const p = purpose === 'reset' ? 'reset' : 'register';
  if (!email || !SCHOOL_EMAIL_REGEX.test(email)) return res.status(400).json({ error: '학교 이메일 형식을 확인하세요.' });

  const existing = await db.prepare('SELECT id FROM users WHERE email=?').get(email);
  if (p === 'register' && existing) return res.status(409).json({ error: '이미 가입된 이메일입니다.' });
  if (p === 'reset' && !existing) return res.status(404).json({ error: '가입되지 않은 이메일입니다.' });

  const prev = await db.prepare('SELECT created_at FROM email_codes WHERE email=? AND purpose=?').get(email, p);
  if (prev && (Date.now() - new Date(prev.created_at + 'Z').getTime()) < 60 * 1000) {
    return res.status(429).json({ error: '잠시 후 다시 시도해주세요. (1분에 한 번)' });
  }

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await db.prepare(`INSERT INTO email_codes (email, purpose, code, verified, expires_at, created_at)
    VALUES (?, ?, ?, 0, ?, datetime('now'))
    ON CONFLICT(email, purpose) DO UPDATE SET code=excluded.code, verified=0, expires_at=excluded.expires_at, created_at=datetime('now')`)
    .run(email, p, code, expires);
  try {
    await sendCodeMail(email, code, p);
    res.json({ ok: true, message: '인증코드를 이메일로 보냈어요. (10분 유효)' });
  } catch (e) {
    res.status(500).json({ error: '메일 발송에 실패했어요. 잠시 후 다시 시도해주세요.' });
  }
});

// 인증코드 확인
router.post('/verify-code', async (req, res) => {
  const { email, code, purpose } = req.body || {};
  const p = purpose === 'reset' ? 'reset' : 'register';
  const row = await db.prepare('SELECT * FROM email_codes WHERE email=? AND purpose=?').get(email, p);
  if (!row || row.code !== String(code || '').trim()) return res.status(400).json({ error: '인증코드가 올바르지 않습니다.' });
  if (new Date(row.expires_at) < new Date()) return res.status(400).json({ error: '인증코드가 만료됐어요. 다시 받아주세요.' });
  await db.prepare('UPDATE email_codes SET verified=1 WHERE email=? AND purpose=?').run(email, p);
  res.json({ ok: true });
});

async function codeVerified(email, purpose) {
  const row = await db.prepare('SELECT * FROM email_codes WHERE email=? AND purpose=?').get(email, purpose);
  return row && row.verified === 1 && new Date(row.expires_at) >= new Date();
}
async function clearCode(email, purpose) {
  await db.prepare('DELETE FROM email_codes WHERE email=? AND purpose=?').run(email, purpose);
}

// 회원가입
router.post('/register', async (req, res) => {
  const { email, username, realname, password } = req.body || {};
  if (!email || !username || !realname || !password) return res.status(400).json({ error: '모든 항목을 입력하세요.' });
  const m = String(email).match(SCHOOL_EMAIL_REGEX);
  if (!m) return res.status(400).json({ error: '학교 이메일 형식만 가입 가능합니다. 예) 43gshs-1319@g.gne.go.kr' });
  if (String(password).length < 6) return res.status(400).json({ error: '비밀번호는 6자 이상이어야 합니다.' });
  const grade = parseInt(m[1], 10);
  const studentId = m[2];

  const dupEmail = await db.prepare('SELECT id FROM users WHERE email=?').get(email);
  if (dupEmail) return res.status(409).json({ error: '이미 가입된 이메일입니다.' });
  const dupName = await db.prepare('SELECT id FROM users WHERE username=?').get(username);
  if (dupName) return res.status(409).json({ error: '이미 사용 중인 별명입니다.' });

  if (mailEnabled() && !(await codeVerified(email, 'register'))) {
    return res.status(400).json({ error: '이메일 인증을 먼저 완료해주세요.' });
  }

  const hash = bcrypt.hashSync(password, 10);
  await db.prepare(`INSERT INTO users (email, username, realname, grade, student_id, password, role, status)
    VALUES (?, ?, ?, ?, ?, ?, 'user', 'pending')`)
    .run(email, username, realname, grade, studentId, hash);
  await clearCode(email, 'register');
  res.json({ ok: true, message: '가입 신청 완료! 관리자 승인 후 이용할 수 있습니다.' });
});

// 로그인 (별명 또는 이메일 + 비밀번호)
router.post('/login', async (req, res) => {
  const { login, password } = req.body || {};
  if (!login || !password) return res.status(400).json({ error: '아이디와 비밀번호를 입력하세요.' });

  const user = await db.prepare('SELECT * FROM users WHERE username=? OR email=?').get(login, login);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: '아이디 또는 비밀번호가 올바르지 않습니다.' });
  }
  if (user.status === 'suspended' && user.suspended_until && new Date(user.suspended_until) <= new Date()) {
    await db.prepare("UPDATE users SET status='active', suspended_until=NULL WHERE id=?").run(user.id);
    user.status = 'active';
  }
  if (user.status === 'pending')  return res.status(403).json({ error: '관리자 승인 대기 중입니다.' });
  if (user.status === 'rejected') return res.status(403).json({ error: '가입이 거절된 계정입니다.' });
  if (user.status === 'kicked')   return res.status(403).json({ error: '강퇴된 계정입니다.' });
  if (user.status === 'suspended') return res.status(403).json({ error: `정지 중입니다. 해제 예정: ${user.suspended_until}` });

  issueSession(res, user);
  res.json({ ok: true, user: publicUser(user) });
});

// 로그아웃
router.post('/logout', (req, res) => { clearSession(res); res.json({ ok: true }); });

// 내 정보
router.get('/me', async (req, res) => {
  const user = await loadUser(req);
  if (!user) return res.json({ user: null });
  res.json({ user: publicUser(user) });
});

// 아이디(별명) 찾기: 학교 이메일 → 별명
router.post('/find-id', async (req, res) => {
  const { email } = req.body || {};
  if (!email || !SCHOOL_EMAIL_REGEX.test(email)) return res.status(400).json({ error: '학교 이메일 형식을 확인하세요.' });
  const user = await db.prepare('SELECT username, status FROM users WHERE email=?').get(email);
  if (!user) return res.status(404).json({ error: '해당 이메일로 가입된 계정이 없습니다.' });
  res.json({ ok: true, username: user.username, status: user.status });
});

// 비밀번호 재설정
router.post('/reset-password', async (req, res) => {
  const { email, realname, newPassword } = req.body || {};
  if (!email || !newPassword) return res.status(400).json({ error: '모든 항목을 입력하세요.' });
  if (String(newPassword).length < 6) return res.status(400).json({ error: '새 비밀번호는 6자 이상이어야 합니다.' });
  const user = await db.prepare('SELECT * FROM users WHERE email=?').get(email);
  if (!user) return res.status(400).json({ error: '가입되지 않은 이메일입니다.' });
  if (user.role === 'admin') return res.status(400).json({ error: '관리자 계정은 이 방법으로 재설정할 수 없습니다.' });

  if (mailEnabled()) {
    if (!(await codeVerified(email, 'reset'))) return res.status(400).json({ error: '이메일 인증을 먼저 완료해주세요.' });
  } else {
    if (!realname || user.realname !== String(realname).trim()) return res.status(400).json({ error: '이메일과 실명이 일치하지 않습니다.' });
  }
  const hash = bcrypt.hashSync(String(newPassword), 10);
  await db.prepare('UPDATE users SET password=? WHERE id=?').run(hash, user.id);
  await clearCode(email, 'reset');
  res.json({ ok: true, message: '비밀번호가 변경됐어요. 새 비밀번호로 로그인하세요.' });
});

// 별명(로그인 아이디) 변경
router.post('/change-username', requireAuth, async (req, res) => {
  const username = String(req.body?.username || '').trim();
  if (username.length < 1 || username.length > 20) return res.status(400).json({ error: '별명은 1~20자로 입력하세요.' });
  if (username === req.user.username) return res.status(400).json({ error: '현재 별명과 동일합니다.' });
  const dup = await db.prepare('SELECT id FROM users WHERE username=? AND id!=?').get(username, req.user.id);
  if (dup) return res.status(409).json({ error: '이미 사용 중인 별명입니다.' });
  await db.prepare('UPDATE users SET username=? WHERE id=?').run(username, req.user.id);
  res.json({ ok: true, username });
});

// 실명 변경
router.post('/change-realname', requireAuth, async (req, res) => {
  const realname = String(req.body?.realname || '').trim();
  if (realname.length < 1 || realname.length > 20) return res.status(400).json({ error: '실명은 1~20자로 입력하세요.' });
  await db.prepare('UPDATE users SET realname=? WHERE id=?').run(realname, req.user.id);
  res.json({ ok: true, realname });
});

// 이메일 변경
router.post('/change-email', requireAuth, async (req, res) => {
  const email = String(req.body?.email || '').trim();
  if (!email) return res.status(400).json({ error: '이메일을 입력하세요.' });
  const dup = await db.prepare('SELECT id FROM users WHERE email=? AND id!=?').get(email, req.user.id);
  if (dup) return res.status(409).json({ error: '이미 사용 중인 이메일입니다.' });

  const m = email.match(SCHOOL_EMAIL_REGEX);
  if (req.user.role === 'admin') {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: '올바른 이메일 형식이 아닙니다.' });
    if (m) await db.prepare('UPDATE users SET email=?, grade=?, student_id=? WHERE id=?').run(email, parseInt(m[1], 10), m[2], req.user.id);
    else await db.prepare('UPDATE users SET email=? WHERE id=?').run(email, req.user.id);
  } else {
    if (!m) return res.status(400).json({ error: '학교 이메일 형식만 사용할 수 있어요. 예) 43gshs-1319@g.gne.go.kr' });
    await db.prepare('UPDATE users SET email=?, grade=?, student_id=? WHERE id=?').run(email, parseInt(m[1], 10), m[2], req.user.id);
  }
  res.json({ ok: true, email });
});

// 비밀번호 변경 (현재 비번 확인)
router.post('/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) return res.status(400).json({ error: '현재/새 비밀번호를 입력하세요.' });
  if (String(newPassword).length < 6) return res.status(400).json({ error: '새 비밀번호는 6자 이상이어야 합니다.' });
  const user = await db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!bcrypt.compareSync(currentPassword, user.password)) return res.status(400).json({ error: '현재 비밀번호가 올바르지 않습니다.' });
  const hash = bcrypt.hashSync(String(newPassword), 10);
  await db.prepare('UPDATE users SET password=? WHERE id=?').run(hash, user.id);
  res.json({ ok: true, message: '비밀번호가 변경됐어요.' });
});

// 화면 노출용 사용자 정보 (실명 제외)
export function publicUser(u) {
  return { id: u.id, username: u.username, role: u.role, status: u.status, demerit: u.demerit, grade: u.grade, point: u.point || 0 };
}

export default router;
