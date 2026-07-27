import express from 'express';
import bcrypt from 'bcryptjs';
import db, { anonymizeUser, logAudit } from '../db.js';
import { requireAdmin, addDemerit } from '../middleware.js';

const router = express.Router();

// 전체 활동 기록 (감사 로그) — 별명·실명·동작·내용·시각
router.get('/audit', requireAdmin, async (req, res) => {
  const PAGE = 30;
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const total = (await db.prepare('SELECT COUNT(*) c FROM audit_logs').get()).c;
  const rows = await db.prepare(`
    SELECT a.id, a.entity_type, a.action, a.snapshot, a.created_at,
           a.user_id, u.username, u.realname, u.role AS actor_role, u.status AS actor_status
    FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
    ORDER BY a.id DESC LIMIT ? OFFSET ?
  `).all(PAGE, (page - 1) * PAGE);
  res.json({ logs: rows, total, page, pageSize: PAGE, totalPages: Math.ceil(total / PAGE) });
});

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
    point: u.point || 0, custom_rank: u.custom_rank || null, created_at: u.created_at,
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

const trace = (id, label, actorId) => logAudit('member', id, 'update', JSON.stringify({ label }), actorId);

// 승인
router.post('/users/:id/approve', requireAdmin, async (req, res) => {
  const t = await guard(req, res); if (!t) return;
  await setStatus(req.params.id, 'active');
  await trace(t.id, `${t.username} 회원 승인`, req.user.id);
  res.json({ ok: true });
});

// 거절 (익명화 + 목록에서 제거)
router.post('/users/:id/reject', requireAdmin, async (req, res) => {
  const t = await guard(req, res); if (!t) return;
  await setStatus(req.params.id, 'rejected');
  await trace(t.id, `${t.username} 가입 거절`, req.user.id);
  await anonymize(req.params.id, '거절회원');
  res.json({ ok: true });
});

// 정지 (기본 1일, days 지정 가능)
router.post('/users/:id/suspend', requireAdmin, async (req, res) => {
  const t = await guard(req, res); if (!t) return;
  const days = Math.max(1, parseInt(req.body?.days || '1', 10));
  const until = new Date(Date.now() + days * 24 * 3600 * 1000).toISOString();
  await setStatus(req.params.id, 'suspended', until);
  await trace(t.id, `${t.username} ${days}일 정지`, req.user.id);
  res.json({ ok: true, suspended_until: until });
});

// 정지 해제 → 활동중
router.post('/users/:id/unsuspend', requireAdmin, async (req, res) => {
  const t = await guard(req, res); if (!t) return;
  await setStatus(req.params.id, 'active');
  await trace(t.id, `${t.username} 정지 해제`, req.user.id);
  res.json({ ok: true });
});

// 강퇴 (익명화 + 목록에서 제거)
router.post('/users/:id/kick', requireAdmin, async (req, res) => {
  const t = await guard(req, res); if (!t) return;
  await setStatus(req.params.id, 'kicked');
  await trace(t.id, `${t.username} 강퇴`, req.user.id);
  await anonymize(req.params.id, '강퇴회원');
  res.json({ ok: true });
});

// 벌점 즉시 부여 (+1). 3=1일정지 / 6=1주정지 / 9=강퇴(익명화) 자동 적용
router.post('/users/:id/add-demerit', requireAdmin, async (req, res) => {
  const t = await guard(req, res); if (!t) return;
  const after = await addDemerit(t.id);
  const STATUS_KO = { active: '활동중', suspended: '정지', kicked: '강퇴' };
  await trace(t.id, `${t.username} 벌점 +1 (누적 ${after.demerit}점 · ${STATUS_KO[after.status] || after.status})`, req.user.id);
  // 9점 도달로 강퇴되면 강퇴 버튼과 동일하게 익명화 + 목록에서 제거
  if (after.status === 'kicked') await anonymize(t.id, '강퇴회원');
  res.json({ ok: true, demerit: after.demerit, status: after.status });
});

// 벌점 초기화
router.post('/users/:id/reset-demerit', requireAdmin, async (req, res) => {
  const t = await guard(req, res); if (!t) return;
  await db.prepare('UPDATE users SET demerit=0 WHERE id=?').run(req.params.id);
  await trace(t.id, `${t.username} 벌점 초기화`, req.user.id);
  res.json({ ok: true });
});

// 활동점수(랭킹) 직접 설정 — 관리자가 마음대로 조정
router.post('/users/:id/set-point', requireAdmin, async (req, res) => {
  const t = await guard(req, res); if (!t) return;
  const point = Math.max(0, Math.min(1000000, parseInt(req.body?.point, 10) || 0));
  await db.prepare('UPDATE users SET point=? WHERE id=?').run(point, t.id);
  await trace(t.id, `${t.username} 활동점수 ${point}점으로 설정`, req.user.id);
  res.json({ ok: true, point });
});

// 커스텀 등급(랭킹 이름) 설정 — 자유 입력. 비우면 자동 등급으로 복귀
router.post('/users/:id/set-rank', requireAdmin, async (req, res) => {
  const t = await guard(req, res); if (!t) return;
  const rank = String(req.body?.rank || '').trim().slice(0, 20);
  await db.prepare('UPDATE users SET custom_rank=? WHERE id=?').run(rank || null, t.id);
  await trace(t.id, rank ? `${t.username} 등급을 "${rank}"(으)로 지정` : `${t.username} 커스텀 등급 해제`, req.user.id);
  res.json({ ok: true, rank: rank || null });
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
  await logAudit('member', 0, 'update', JSON.stringify({ label: `${email} 재가입 즉시 허용` }), req.user.id);
  res.json({ ok: true });
});

// 2단계 인증 해제 (분실·잠김 복구용)
router.post('/users/:id/reset-2fa', requireAdmin, async (req, res) => {
  const t = await guard(req, res); if (!t) return;
  await db.prepare('UPDATE users SET totp_enabled=0, totp_secret=NULL WHERE id=?').run(t.id);
  await trace(t.id, `${t.username} 2단계 인증 해제`, req.user.id);
  res.json({ ok: true });
});

// 비밀번호 초기화 (관리자가 임시 비번 지정)
router.post('/users/:id/reset-password', requireAdmin, async (req, res) => {
  const t = await guard(req, res); if (!t) return;
  const pw = String(req.body?.password || '').trim();
  if (pw.length < 6) return res.status(400).json({ error: '임시 비밀번호는 6자 이상으로 지정하세요.' });
  await db.prepare('UPDATE users SET password=? WHERE id=?').run(bcrypt.hashSync(pw, 10), req.params.id);
  await trace(t.id, `${t.username} 비밀번호 초기화`, req.user.id);
  res.json({ ok: true });
});

// ===== 신고함 =====
// 미처리 신고 개수 (사이드바 배지용)
router.get('/reports/count', requireAdmin, async (req, res) => {
  const c = (await db.prepare("SELECT COUNT(*) c FROM reports WHERE status='open'").get()).c;
  res.json({ count: c });
});

// 신고 목록 (기본 미처리). 대상 글/댓글의 내용·작성자까지 함께
router.get('/reports', requireAdmin, async (req, res) => {
  const status = req.query.status === 'all' ? null : (req.query.status || 'open');
  const rows = status
    ? await db.prepare('SELECT * FROM reports WHERE status=? ORDER BY id DESC LIMIT 100').all(status)
    : await db.prepare('SELECT * FROM reports ORDER BY id DESC LIMIT 100').all();

  const out = [];
  for (const r of rows) {
    const reporter = await db.prepare('SELECT username, realname FROM users WHERE id=?').get(r.reporter_id);
    let target = null;
    if (r.target_type === 'post') {
      const p = await db.prepare('SELECT p.id, p.title, p.content, p.author_id, p.deleted_at, u.username AS author FROM posts p JOIN users u ON u.id=p.author_id WHERE p.id=?').get(r.target_id);
      if (p) target = { kind: '글', id: p.id, author: p.author, author_id: p.author_id, title: p.title, snippet: (p.content || '').slice(0, 120), deleted: !!p.deleted_at, link: `/post.html?id=${p.id}` };
    } else {
      const c = await db.prepare('SELECT c.id, c.content, c.post_id, c.author_id, c.deleted_at, u.username AS author FROM comments c JOIN users u ON u.id=c.author_id WHERE c.id=?').get(r.target_id);
      if (c) target = { kind: '댓글', id: c.id, author: c.author, author_id: c.author_id, title: '', snippet: (c.content || '').slice(0, 120), deleted: !!c.deleted_at, link: `/post.html?id=${c.post_id}` };
    }
    out.push({
      id: r.id, target_type: r.target_type, target_id: r.target_id, reason: r.reason,
      status: r.status, created_at: r.created_at,
      reporter: reporter ? reporter.username : '(삭제됨)', reporter_real: reporter ? reporter.realname : '',
      target,
    });
  }
  res.json({ reports: out });
});

// 신고 처리(완료/무시) — 상태만 종료로 변경
router.post('/reports/:id/resolve', requireAdmin, async (req, res) => {
  const r = await db.prepare('SELECT id FROM reports WHERE id=?').get(req.params.id);
  if (!r) return res.status(404).json({ error: '신고를 찾을 수 없습니다.' });
  await db.prepare("UPDATE reports SET status='resolved', handled_at=datetime('now'), handler_id=? WHERE id=?").run(req.user.id, req.params.id);
  res.json({ ok: true });
});

export default router;
