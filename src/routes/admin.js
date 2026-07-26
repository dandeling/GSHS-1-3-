import express from 'express';
import bcrypt from 'bcryptjs';
import db from '../db.js';
import { requireAdmin } from '../middleware.js';

const router = express.Router();

// 회원 목록 (실명·학번·이메일·벌점 포함) — 관리자만
// 강퇴·거절된 회원은 목록에서 제외(익명화 처리됨)
router.get('/users', requireAdmin, async (req, res) => {
  const status = req.query.status;
  let rows;
  if (status && status !== 'kicked' && status !== 'rejected') {
    rows = await db.prepare('SELECT * FROM users WHERE status=? ORDER BY id DESC').all(status);
  } else {
    rows = await db.prepare("SELECT * FROM users WHERE status NOT IN ('kicked','rejected') ORDER BY id DESC").all();
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

// 익명화: 별명·실명·이메일을 리셋해 원래 값을 다시 쓸 수 있게 함
// (글·댓글은 익명 이름으로 보존, 원래 이메일/별명은 재가입에 재사용 가능)
async function anonymize(id, label) {
  await db.prepare('UPDATE users SET username=?, realname=?, email=? WHERE id=?')
    .run(`${label}#${id}`, '(삭제됨)', `removed+${id}@removed.local`, id);
}

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

// 비밀번호 초기화 (관리자가 임시 비번 지정)
router.post('/users/:id/reset-password', requireAdmin, async (req, res) => {
  if (!(await guard(req, res))) return;
  const pw = String(req.body?.password || '').trim();
  if (pw.length < 6) return res.status(400).json({ error: '임시 비밀번호는 6자 이상으로 지정하세요.' });
  await db.prepare('UPDATE users SET password=? WHERE id=?').run(bcrypt.hashSync(pw, 10), req.params.id);
  res.json({ ok: true });
});

export default router;
