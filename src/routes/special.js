import express from 'express';
import db, { logAudit } from '../db.js';
import { requireAuth, requirePerm, hasPerm } from '../middleware.js';

const router = express.Router();

export const SLOTS = ['8교시', '야간1차시', '야간2차시'];

// 목록 (최근 3일 전 ~ 다가오는 것). 관리자는 편집 가능
router.get('/', requireAuth, async (req, res) => {
  const rows = await db.prepare(`
    SELECT id, sched_date, slot, content FROM special_schedule
    WHERE sched_date >= date('now','localtime','-3 days')
    ORDER BY sched_date ASC, id ASC
  `).all();
  res.json({ items: rows, slots: SLOTS, isAdmin: hasPerm(req.user, 'special'), today: new Date().toISOString().slice(0, 10) });
});

// 등록 (관리자)
router.post('/', requirePerm('special'), async (req, res) => {
  const { sched_date, slot, content } = req.body || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sched_date || '')) return res.status(400).json({ error: '날짜(YYYY-MM-DD)를 확인하세요.' });
  if (!slot?.trim() || !content?.trim()) return res.status(400).json({ error: '구분과 내용을 입력하세요.' });
  const info = await db.prepare('INSERT INTO special_schedule (sched_date, slot, content) VALUES (?, ?, ?)')
    .run(sched_date, slot.trim().slice(0, 20), content.trim().slice(0, 100));
  await logAudit('special', info.lastInsertRowid, 'create', JSON.stringify({ label: `${sched_date} ${slot.trim()} · ${content.trim()}` }), req.user.id);
  res.json({ ok: true, id: info.lastInsertRowid });
});

// 삭제 (관리자)
router.delete('/:id', requirePerm('special'), async (req, res) => {
  const s = await db.prepare('SELECT sched_date, slot, content FROM special_schedule WHERE id=?').get(req.params.id);
  await db.prepare('DELETE FROM special_schedule WHERE id=?').run(req.params.id);
  if (s) await logAudit('special', req.params.id, 'delete', JSON.stringify({ label: `${s.sched_date} ${s.slot} · ${s.content}` }), req.user.id);
  res.json({ ok: true });
});

export default router;
