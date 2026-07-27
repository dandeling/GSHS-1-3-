import express from 'express';
import db, { logAudit } from '../db.js';
import { requireAuth, requireAdmin } from '../middleware.js';

const router = express.Router();

// 특정 주간투표의 상세(옵션·득표·내 투표) 로드
async function loadPoll(poll, userId) {
  if (!poll) return null;
  const options = await db.prepare(`
    SELECT o.id, o.text, (SELECT COUNT(*) FROM weekly_poll_votes v WHERE v.option_id=o.id) AS votes
    FROM weekly_poll_options o WHERE o.poll_id=? ORDER BY o.idx ASC
  `).all(poll.id);
  const mine = await db.prepare('SELECT option_id FROM weekly_poll_votes WHERE poll_id=? AND user_id=?').get(poll.id, userId);
  const total = options.reduce((s, o) => s + o.votes, 0);
  return { id: poll.id, question: poll.question, active: !!poll.active, options, total, myOption: mine?.option_id || null };
}

// 현재 활성 주간투표
router.get('/', requireAuth, async (req, res) => {
  const poll = await db.prepare('SELECT * FROM weekly_polls WHERE active=1 ORDER BY id DESC LIMIT 1').get();
  res.json({ poll: await loadPoll(poll, req.user.id), isAdmin: req.user.role === 'admin' });
});

// 투표하기 (1인 1표, 변경 가능)
router.post('/vote', requireAuth, async (req, res) => {
  const poll = await db.prepare('SELECT * FROM weekly_polls WHERE active=1 ORDER BY id DESC LIMIT 1').get();
  if (!poll) return res.status(404).json({ error: '진행 중인 투표가 없어요.' });
  const opt = await db.prepare('SELECT id FROM weekly_poll_options WHERE id=? AND poll_id=?').get(req.body?.option_id, poll.id);
  if (!opt) return res.status(400).json({ error: '선택지를 확인하세요.' });
  await db.prepare(`INSERT INTO weekly_poll_votes (poll_id, user_id, option_id) VALUES (?, ?, ?)
    ON CONFLICT(poll_id, user_id) DO UPDATE SET option_id=excluded.option_id`).run(poll.id, req.user.id, req.body.option_id);
  res.json({ ok: true, poll: await loadPoll(poll, req.user.id) });
});

// 새 주간투표 시작 (관리자) — 기존 활성 투표는 자동 종료
router.post('/', requireAdmin, async (req, res) => {
  const { question, options } = req.body || {};
  if (!question?.trim()) return res.status(400).json({ error: '투표 질문을 입력하세요.' });
  const opts = Array.isArray(options) ? options.map((o) => String(o).trim()).filter(Boolean).slice(0, 8) : [];
  if (opts.length < 2) return res.status(400).json({ error: '선택지를 2개 이상 입력하세요.' });

  await db.prepare('UPDATE weekly_polls SET active=0 WHERE active=1').run();
  const info = await db.prepare('INSERT INTO weekly_polls (question, created_by) VALUES (?, ?)').run(question.trim(), req.user.id);
  for (let i = 0; i < opts.length; i++) {
    await db.prepare('INSERT INTO weekly_poll_options (poll_id, idx, text) VALUES (?, ?, ?)').run(info.lastInsertRowid, i, opts[i]);
  }
  await logAudit('weekly_poll', info.lastInsertRowid, 'create', JSON.stringify({ label: `주간투표 시작 · ${question.trim()}` }), req.user.id);
  res.json({ ok: true, id: info.lastInsertRowid });
});

// 현재 투표 종료 (관리자)
router.post('/close', requireAdmin, async (req, res) => {
  const cur = await db.prepare('SELECT id, question FROM weekly_polls WHERE active=1 ORDER BY id DESC LIMIT 1').get();
  await db.prepare('UPDATE weekly_polls SET active=0 WHERE active=1').run();
  if (cur) await logAudit('weekly_poll', cur.id, 'update', JSON.stringify({ label: `주간투표 종료 · ${cur.question}` }), req.user.id);
  res.json({ ok: true });
});

export default router;
