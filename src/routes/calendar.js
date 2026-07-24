import express from 'express';
import db from '../db.js';
import { requireAuth, requireAdmin } from '../middleware.js';

const router = express.Router();

// 일정 보기 (모두). ?year=2026&month=7 로 월 필터 가능
router.get('/', requireAuth, (req, res) => {
  let rows;
  if (req.query.year && req.query.month) {
    const y = String(req.query.year).padStart(4, '0');
    const m = String(req.query.month).padStart(2, '0');
    rows = db.prepare(`
      SELECT e.*, u.username AS author FROM events e JOIN users u ON u.id=e.author_id
      WHERE strftime('%Y-%m', e.event_date) = ?
      ORDER BY e.event_date ASC, e.id ASC
    `).all(`${y}-${m}`);
  } else {
    rows = db.prepare(`
      SELECT e.*, u.username AS author FROM events e JOIN users u ON u.id=e.author_id
      ORDER BY e.event_date ASC, e.id ASC
    `).all();
  }
  res.json({ events: rows, isAdmin: req.user.role === 'admin' });
});

// 추가 (관리자만)
router.post('/', requireAdmin, (req, res) => {
  const { title, description, event_date } = req.body || {};
  if (!title?.trim() || !event_date) return res.status(400).json({ error: '제목과 날짜를 입력하세요.' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(event_date)) return res.status(400).json({ error: '날짜 형식(YYYY-MM-DD)을 확인하세요.' });
  const info = db.prepare('INSERT INTO events (title, description, event_date, author_id) VALUES (?, ?, ?, ?)')
    .run(title.trim(), description?.trim() || null, event_date, req.user.id);
  res.json({ ok: true, id: info.lastInsertRowid });
});

// 수정 (관리자만)
router.put('/:id', requireAdmin, (req, res) => {
  const ev = db.prepare('SELECT id FROM events WHERE id=?').get(req.params.id);
  if (!ev) return res.status(404).json({ error: '일정을 찾을 수 없습니다.' });
  const { title, description, event_date } = req.body || {};
  if (!title?.trim() || !event_date) return res.status(400).json({ error: '제목과 날짜를 입력하세요.' });
  db.prepare('UPDATE events SET title=?, description=?, event_date=? WHERE id=?')
    .run(title.trim(), description?.trim() || null, event_date, req.params.id);
  res.json({ ok: true });
});

// 삭제 (관리자만)
router.delete('/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM events WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

export default router;
