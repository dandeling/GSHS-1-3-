import express from 'express';
import bcrypt from 'bcryptjs';
import db, { anonymizeUser } from '../db.js';
import { requireAdmin } from '../middleware.js';

const router = express.Router();

// 회원 목록 (실명·학번·이메일·벌점 포함) — 관리자만
// 강퇴·거절된 회원은 목록에서 제외(익명화 처리됨)
router.get('/users', requireAdmin, async (req, res) => {
  const status = req.query.status;
  let rows;
  const removed = ['kicked', 'rejected', 'withdrawn'];
  if (status && !removed.includes(status)) {
    rows = await db.prepare('SELECT * FROM users WHERE status=? ORDER BY id DESC').all(status);
  } else {
    rows = await db.prepare("SELECT * FROM users WHERE status NOT IN ('kicked','rejected','withdrawn') ORDER BY id DESC").all();
  }
  const users = rows.map((u) => ({
    id: u.id, email: u.email, username: u.username, realname: u.realname,
    grade: u.grade, student_id: u.student_id, role: u.role,
    status: u.status, demerit: u.demerit, suspended_until: u.suspended_until,
    point: u.point || 0, created_at: u.created_at,
  }));
  res.json({ users });
});

async function setStatus(id, status, suspendedUntil = null) {
  await db.prepare('UPDATE users SET status=?, suspended_until=? WHERE id=?').run(status, suspendedUntil, id);
}

const anonymize = anonymizeUser;

async function guard(req, res) {
  const target = await db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!target) { res.status(404).json({ error: '사용자를 찾을 수 없습니다.' }); return null; }
  if (target.role === 'admin') { res.status(400).json({ error: '관리자 계정은 변경할 수 없습니다.' }); return null; }
  return target;
}

// 승인
router.post('/users/:id/approve', requireAdmin, async (req, res) => {
  if (!(await guard(req, res))) return;
  await setStatus(req.params.id, 'active');
  res.json({ ok: true });
});

// 거절 (익명화 + 목록에서 제거)
router.post('/users/:id/reject', requireAdmin, async (req, res) => {
  if (!(await guard(req, res))) return;
  await setStatus(req.params.id, 'rejected');
  await anonymize(req.params.id, '거절회원');
  res.json({ ok: true });
});

// 정지 (기본 1일, days 지정 가능)
router.post('/users/:id/suspend', requireAdmin, async (req, res) => {
  if (!(await guard(req, res))) return;
  const days = Math.max(1, parseInt(req.body?.days || '1', 10));
  const until = new Date(Date.now() + days * 24 * 3600 * 1000).toISOString();
  await setStatus(req.params.id, 'suspended', until);
  res.json({ ok: true, suspended_until: until });
});

// 정지 해제 → 활동중
router.post('/users/:id/unsuspend', requireAdmin, async (req, res) => {
  if (!(await guard(req, res))) return;
  await setStatus(req.params.id, 'active');
  res.json({ ok: true });
});

// 강퇴 (익명화 + 목록에서 제거)
router.post('/users/:id/kick', requireAdmin, async (req, res) => {
  if (!(await guard(req, res))) return;
  await setStatus(req.params.id, 'kicked');
  await anonymize(req.params.id, '강퇴회원');
  res.json({ ok: true });
});

// 벌점 초기화
router.post('/users/:id/reset-demerit', requireAdmin, async (req, res) => {
  if (!(await guard(req, res))) return;
  await db.prepare('UPDATE users SET demerit=0 WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// 재가입 제한 목록 (1주일 제한 중인 이메일)
router.get('/rejoin-blocks', requireAdmin, async (req, res) => {
  const rows = await db.prepare("SELECT email, until, created_at FROM rejoin_blocks WHERE until > datetime('now') ORDER BY until ASC").all();
  res.json({ blocks: rows });
});

// 재가입 즉시 허용 (제한 해제) — 관리자 허락
router.post('/rejoin-allow', requireAdmin, async (req, res) => {
  const email = String(req.body?.email || '').trim();
  if (!email) return res.status(400).json({ error: '이메일을 입력하세요.' });
  await db.prepare('DELETE FROM rejoin_blocks WHERE email=?').run(email);
  res.json({ ok: true });
});

// 비밀번호 초기화 (관리자가 임시 비번 지정)
router.post('/users/:id/reset-password', requireAdmin, async (req, res) => {
  if (!(await guard(req, res))) return;
  const pw = String(req.body?.password || '').trim();
  if (pw.length < 6) return res.status(400).json({ error: '임시 비밀번호는 6자 이상으로 지정하세요.' });
  await db.prepare('UPDATE users SET password=? WHERE id=?').run(bcrypt.hashSync(pw, 10), req.params.id);
  res.json({ ok: true });
});

export default router;
