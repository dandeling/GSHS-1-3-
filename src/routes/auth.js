import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import db, { anonymizeUser } from '../db.js';
import { SCHOOL_EMAIL_REGEX } from '../constants.js';
import { issueSession, clearSession, loadUser, requireAuth, JWT_SECRET } from '../middleware.js';
import { mailEnabled, sendCodeMail } from '../mailer.js';
import { generateSecret, verifyTotp, otpauthURL } from '../totp.js';

const router = express.Router();

// 이메일 인증 사용 여부 (프론트에서 UI 분기)
router.get('/mail-status', (req, res) => res.json({ enabled: mailEnabled() }));

// ===== 자동입력 방지(캡차) — 서버가 계산 문제를 내고 정답을 서명된 토큰에 담아 무상태로 검증 =====
router.get('/captcha', (req, res) => {
  let x = Math.floor(Math.random() * 9) + 1;
  let y = Math.floor(Math.random() * 9) + 1;
  const plus = Math.random() < 0.5;
  if (!plus && x < y) { const t = x; x = y; y = t; }   // 뺄셈은 음수 방지
  const answer = plus ? x + y : x - y;
  const question = `${x} ${plus ? '+' : '−'} ${y} = ?`;
  const token = jwt.sign({ cap: answer, k: 'captcha' }, JWT_SECRET, { expiresIn: '5m' });
  res.json({ question, token });
});

function verifyCaptcha(token, answer) {
  try {
    const p = jwt.verify(String(token || ''), JWT_SECRET);
    return p.k === 'captcha' && Number(answer) === p.cap;
  } catch { return false; }
}

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
  const { email, username, realname, password, passwordConfirm, captchaToken, captchaAnswer } = req.body || {};
  if (!email || !username || !realname || !password) return res.status(400).json({ error: '모든 항목을 입력하세요.' });
  if (!verifyCaptcha(captchaToken, captchaAnswer)) return res.status(400).json({ error: '자동입력 방지 답이 올바르지 않아요. 다시 시도해주세요.' });
  const m = String(email).match(SCHOOL_EMAIL_REGEX);
  if (!m) return res.status(400).json({ error: '학교 이메일 형식만 가입 가능합니다. 예) 43gshs-1319@g.gne.go.kr' });
  if (String(password).length < 6) return res.status(400).json({ error: '비밀번호는 6자 이상이어야 합니다.' });
  if (password !== passwordConfirm) return res.status(400).json({ error: '비밀번호와 비밀번호 확인이 일치하지 않습니다.' });
  const grade = parseInt(m[1], 10);
  const studentId = m[2];

  const dupEmail = await db.prepare('SELECT id FROM users WHERE email=?').get(email);
  if (dupEmail) return res.status(409).json({ error: '이미 가입된 이메일입니다.' });
  const dupName = await db.prepare('SELECT id FROM users WHERE username=?').get(username);
  if (dupName) return res.status(409).json({ error: '이미 사용 중인 별명입니다.' });

  // 탈퇴/추방 후 1주일 재가입 제한 (관리자가 해제하면 즉시 가능)
  const block = await db.prepare("SELECT until FROM rejoin_blocks WHERE email=? AND until > datetime('now')").get(email);
  if (block) {
    const until = new Date(block.until.replace(' ', 'T') + 'Z');
    return res.status(403).json({ error: `재가입 제한 중입니다. ${until.getMonth()+1}월 ${until.getDate()}일 이후 가능하며, 급하면 관리자에게 승인 요청하세요.` });
  }

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

// 로그인 시도 제한: 5회 실패부터 잠금(5·10·15…분, 최대 60분)
const LOGIN_MAX = 5;
async function recordLoginFail(key) {
  const r = await db.prepare('SELECT fails FROM login_attempts WHERE login_key=?').get(key);
  const fails = (r?.fails || 0) + 1;
  const lockMin = fails >= LOGIN_MAX ? Math.min(60, 5 * (fails - LOGIN_MAX + 1)) : 0;
  if (lockMin > 0) {
    await db.prepare(`INSERT INTO login_attempts (login_key, fails, locked_until, updated_at)
      VALUES (?, ?, datetime('now', ?), datetime('now'))
      ON CONFLICT(login_key) DO UPDATE SET fails=excluded.fails, locked_until=excluded.locked_until, updated_at=datetime('now')`)
      .run(key, fails, `+${lockMin} minutes`);
  } else {
    await db.prepare(`INSERT INTO login_attempts (login_key, fails, locked_until, updated_at)
      VALUES (?, ?, NULL, datetime('now'))
      ON CONFLICT(login_key) DO UPDATE SET fails=excluded.fails, locked_until=NULL, updated_at=datetime('now')`)
      .run(key, fails);
  }
  return { fails, lockMin };
}

// 로그인 (별명 또는 이메일 + 비밀번호 + 캡차 + (설정 시) 2단계 인증)
router.post('/login', async (req, res) => {
  const { login, password, captchaToken, captchaAnswer, totpCode } = req.body || {};
  if (!login || !password) return res.status(400).json({ error: '아이디와 비밀번호를 입력하세요.' });
  if (!verifyCaptcha(captchaToken, captchaAnswer)) return res.status(400).json({ error: '자동입력 방지 답이 올바르지 않아요. 다시 시도해주세요.' });

  // 잠금 여부 확인 (식별자 기준)
  const key = String(login).trim().toLowerCase().slice(0, 120);
  const att = await db.prepare('SELECT locked_until FROM login_attempts WHERE login_key=?').get(key);
  if (att?.locked_until) {
    const until = new Date(att.locked_until.replace(' ', 'T') + 'Z');
    if (until > new Date()) {
      const mins = Math.max(1, Math.ceil((until - Date.now()) / 60000));
      return res.status(429).json({ error: `비밀번호를 여러 번 틀려 로그인이 잠겼어요. 약 ${mins}분 후 다시 시도하세요.` });
    }
  }

  const user = await db.prepare('SELECT * FROM users WHERE username=? OR email=?').get(login, login);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    const info = await recordLoginFail(key);
    if (info.lockMin > 0) return res.status(429).json({ error: `비밀번호를 여러 번 틀려 약 ${info.lockMin}분간 로그인이 잠겼어요.` });
    const left = LOGIN_MAX - info.fails;
    return res.status(401).json({ error: `아이디 또는 비밀번호가 올바르지 않습니다.${left > 0 ? ` (${left}회 더 틀리면 잠김)` : ''}` });
  }
  // 비밀번호 정답 → 실패 기록 초기화
  await db.prepare('DELETE FROM login_attempts WHERE login_key=?').run(key);
  if (user.status === 'suspended' && user.suspended_until && new Date(user.suspended_until) <= new Date()) {
    await db.prepare("UPDATE users SET status='active', suspended_until=NULL WHERE id=?").run(user.id);
    user.status = 'active';
  }
  if (user.status === 'pending')  return res.status(403).json({ error: '관리자 승인 대기 중입니다.' });
  if (user.status === 'rejected') return res.status(403).json({ error: '가입이 거절된 계정입니다.' });
  if (user.status === 'kicked')   return res.status(403).json({ error: '강퇴된 계정입니다.' });
  if (user.status === 'suspended') return res.status(403).json({ error: `정지 중입니다. 해제 예정: ${user.suspended_until}` });

  // 2단계 인증(설정된 계정): 비밀번호 확인 후 인증앱 코드 요구
  if (user.totp_enabled) {
    if (!totpCode) return res.status(401).json({ twoFactorRequired: true, error: '인증 앱의 6자리 코드를 입력하세요.' });
    if (!verifyTotp(user.totp_secret, totpCode)) return res.status(401).json({ twoFactorRequired: true, error: '인증 앱 코드가 올바르지 않습니다.' });
  }

  issueSession(res, user);
  res.json({ ok: true, user: publicUser(user) });
});

// ===== 2단계 인증(TOTP) 관리 =====
// 상태 조회
router.get('/2fa/status', requireAuth, (req, res) => res.json({ enabled: !!req.user.totp_enabled }));

// 설정 시작: 새 시크릿 발급(아직 미활성). 인증앱 등록용 키·URI 반환
router.post('/2fa/setup', requireAuth, async (req, res) => {
  if (req.user.totp_enabled) return res.status(400).json({ error: '이미 2단계 인증이 켜져 있어요.' });
  const secret = generateSecret();
  await db.prepare('UPDATE users SET totp_secret=?, totp_enabled=0 WHERE id=?').run(secret, req.user.id);
  res.json({ ok: true, secret, otpauth: otpauthURL(secret, req.user.username) });
});

// 활성화: 인증앱 코드가 맞으면 켜기
router.post('/2fa/enable', requireAuth, async (req, res) => {
  const code = String(req.body?.code || '').trim();
  const u = await db.prepare('SELECT totp_secret FROM users WHERE id=?').get(req.user.id);
  if (!u.totp_secret) return res.status(400).json({ error: '먼저 2단계 인증 설정을 시작하세요.' });
  if (!verifyTotp(u.totp_secret, code)) return res.status(400).json({ error: '코드가 올바르지 않아요. 앱의 6자리 숫자를 정확히 입력하세요.' });
  await db.prepare('UPDATE users SET totp_enabled=1 WHERE id=?').run(req.user.id);
  res.json({ ok: true, message: '2단계 인증이 켜졌어요.' });
});

// 해제: 비밀번호 확인 후 끄기
router.post('/2fa/disable', requireAuth, async (req, res) => {
  const password = String(req.body?.password || '');
  const u = await db.prepare('SELECT password FROM users WHERE id=?').get(req.user.id);
  if (!bcrypt.compareSync(password, u.password)) return res.status(400).json({ error: '비밀번호가 올바르지 않습니다.' });
  await db.prepare('UPDATE users SET totp_enabled=0, totp_secret=NULL WHERE id=?').run(req.user.id);
  res.json({ ok: true, message: '2단계 인증을 껐어요.' });
});

// 로그아웃
router.post('/logout', (req, res) => { clearSession(res); res.json({ ok: true }); });

// 회원 탈퇴 (본인) — 익명화 + 1주일 재가입 제한, 글은 '삭제된 사람'으로 보존
router.post('/withdraw', requireAuth, async (req, res) => {
  if (req.user.role === 'admin') return res.status(400).json({ error: '관리자 계정은 탈퇴할 수 없어요.' });
  await db.prepare("UPDATE users SET status='withdrawn' WHERE id=?").run(req.user.id);
  await anonymizeUser(req.user.id, '탈퇴회원');
  clearSession(res);
  res.json({ ok: true, message: '탈퇴가 완료됐어요. 그동안 이용해주셔서 감사합니다.' });
});

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
  return { id: u.id, username: u.username, role: u.role, status: u.status, demerit: u.demerit, grade: u.grade, point: u.point || 0, rank: u.custom_rank || null };
}

export default router;
