import express from 'express';
import db, { notify } from '../db.js';
import { requireAuth, requireAdmin } from '../middleware.js';

const router = express.Router();

// 내 문의 목록 (관리자는 전체)
router.get('/', requireAuth, async (req, res) => {
  const isAdmin = req.user.role === 'admin';
  const rows = isAdmin
    ? await db.prepare(`SELECT i.*, u.username FROM inquiries i JOIN users u ON u.id=i.user_id ORDER BY
        CASE i.status WHEN 'open' THEN 0 ELSE 1 END, i.id DESC`).all()
    : await db.prepare('SELECT * FROM inquiries WHERE user_id=? ORDER BY id DESC').all(req.user.id);
  res.json({ inquiries: rows, isAdmin });
});

// 안읽은(미답변) 문의 개수 — 관리자 배지용
router.get('/pending-count', requireAdmin, async (req, res) => {
  const c = (await db.prepare("SELECT COUNT(*) c FROM inquiries WHERE status='open'").get()).c;
  res.json({ count: c });
});

// 문의 작성
router.post('/', requireAuth, async (req, res) => {
  const { title, content } = req.body || {};
  if (!title?.trim() || !content?.trim()) return res.status(400).json({ error: '제목과 내용을 입력하세요.' });
  const info = await db.prepare('INSERT INTO inquiries (user_id, title, content) VALUES (?, ?, ?)')
    .run(req.user.id, title.trim(), content.trim());
  res.json({ ok: true, id: info.lastInsertRowid });
});

// 문의 삭제 (작성자 또는 관리자)
router.delete('/:id', requireAuth, async (req, res) => {
  const inq = await db.prepare('SELECT * FROM inquiries WHERE id=?').get(req.params.id);
  if (!inq) return res.status(404).json({ error: '문의를 찾을 수 없습니다.' });
  if (inq.user_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: '삭제 권한이 없습니다.' });
  await db.prepare('DELETE FROM inquiries WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// 답변 (관리자) → 작성자에게 알림
router.post('/:id/answer', requireAdmin, async (req, res) => {
  const inq = await db.prepare('SELECT * FROM inquiries WHERE id=?').get(req.params.id);
  if (!inq) return res.status(404).json({ error: '문의를 찾을 수 없습니다.' });
  const { answer } = req.body || {};
  if (!answer?.trim()) return res.status(400).json({ error: '답변 내용을 입력하세요.' });
  await db.prepare("UPDATE inquiries SET answer=?, status='answered', answered_at=datetime('now') WHERE id=?")
    .run(answer.trim(), inq.id);
  await notify(inq.user_id, req.user.id, 'inquiry', null, `문의 "${inq.title.slice(0, 20)}"에 답변이 등록됐어요.`);
  res.json({ ok: true });
});

export default router;
