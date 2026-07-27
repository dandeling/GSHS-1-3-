import express from 'express';
import db from '../db.js';
import { requireAuth, requireAdmin } from '../middleware.js';

const router = express.Router();

export const SLOTS = ['8교시', '야간1차시', '야간2차시'];

// 목록 (최근 3일 전 ~ 다가오는 것). 관리자는 편집 가능
router.get('/', requireAuth, async (req, res) => {
  const rows = await db.prepare(`
    SELECT id, sched_date, slot, content FROM special_schedule
    WHERE sched_date >= date('now','localtime','-3 days')
    ORDER BY sched_date ASC, id ASC
  `).all();
  res.json({ items: rows, slots: SLOTS, isAdmin: req.user.role === 'admin', today: new Date().toISOString().slice(0, 10) });
});

// 등록 (관리자)
router.post('/', requireAdmin, async (req, res) => {
  const { sched_date, slot, content } = req.body || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sched_date || '')) return res.status(400).json({ error: '날짜(YYYY-MM-DD)를 확인하세요.' });
  if (!slot?.trim() || !content?.trim()) return res.status(400).json({ error: '구분과 내용을 입력하세요.' });
  const info = await db.prepare('INSERT INTO special_schedule (sched_date, slot, content) VALUES (?, ?, ?)')
    .run(sched_date, slot.trim().slice(0, 20), content.trim().slice(0, 100));
  res.json({ ok: true, id: info.lastInsertRowid });
});

// 삭제 (관리자)
router.delete('/:id', requireAdmin, async (req, res) => {
  await db.prepare('DELETE FROM special_schedule WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

export default router;
