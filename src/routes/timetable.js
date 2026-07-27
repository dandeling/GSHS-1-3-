import express from 'express';
import db, { logAudit } from '../db.js';
import { requireAuth, requireAdmin } from '../middleware.js';

const router = express.Router();

export const DAYS = ['월', '화', '수', '목', '금'];
export const PERIODS = 7;

// 시간표 조회 (모두)
router.get('/', requireAuth, async (req, res) => {
  const rows = await db.prepare('SELECT day, period, subject FROM timetable').all();
  const grid = {};
  rows.forEach((r) => { grid[`${r.day}_${r.period}`] = r.subject; });
  res.json({ days: DAYS, periods: PERIODS, grid, isAdmin: req.user.role === 'admin' });
});

// 시간표 저장 (관리자) — 전체 그리드 upsert
router.post('/', requireAdmin, async (req, res) => {
  const cells = Array.isArray(req.body?.cells) ? req.body.cells : [];
  for (const c of cells) {
    const day = parseInt(c.day, 10), period = parseInt(c.period, 10);
    if (day < 0 || day >= DAYS.length || period < 1 || period > PERIODS) continue;
    const subject = String(c.subject || '').trim().slice(0, 30);
    if (subject) {
      await db.prepare(`INSERT INTO timetable (day, period, subject) VALUES (?, ?, ?)
        ON CONFLICT(day, period) DO UPDATE SET subject=excluded.subject`).run(day, period, subject);
    } else {
      await db.prepare('DELETE FROM timetable WHERE day=? AND period=?').run(day, period);
    }
  }
  await logAudit('timetable', 0, 'update', JSON.stringify({ label: '시간표 저장' }), req.user.id);
  res.json({ ok: true });
});

export default router;
