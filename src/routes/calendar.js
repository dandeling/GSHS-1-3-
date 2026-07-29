import express from 'express';
import db, { logAudit } from '../db.js';
import { requireAuth, requirePerm, hasPerm } from '../middleware.js';
import { holidaysInMonth } from '../holidays.js';

const router = express.Router();

const TYPES = ['event', 'birthday', 'exam', 'school', 'etc'];
const dateOk = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');

// 일정 보기 (모두). ?year=2026&month=7 로 월 필터 가능.
// 기간(end_date)이 있는 일정은 해당 월과 겹치면 포함.
router.get('/', requireAuth, async (req, res) => {
  let rows;
  if (req.query.year && req.query.month) {
    const y = String(req.query.year).padStart(4, '0');
    const m = String(req.query.month).padStart(2, '0');
    const monthStart = `${y}-${m}-01`;
    const monthEnd = `${y}-${m}-31`;
    rows = await db.prepare(`
      SELECT e.*, u.username AS author FROM events e JOIN users u ON u.id=e.author_id
      WHERE (e.event_date <= ? AND COALESCE(e.end_date, e.event_date) >= ?)
      ORDER BY e.event_date ASC, e.id ASC
    `).all(monthEnd, monthStart);
    const holidays = holidaysInMonth(parseInt(y, 10), parseInt(m, 10));
    return res.json({ events: rows, holidays, isAdmin: hasPerm(req.user, 'calendar') });
  }
  rows = await db.prepare(`
    SELECT e.*, u.username AS author FROM events e JOIN users u ON u.id=e.author_id
    ORDER BY e.event_date ASC, e.id ASC
  `).all();
  res.json({ events: rows, holidays: [], isAdmin: hasPerm(req.user, 'calendar') });
});

function parseBody(req) {
  const title = String(req.body?.title || '').trim();
  const description = String(req.body?.description || '').trim() || null;
  const event_date = req.body?.event_date;
  let end_date = req.body?.end_date || null;
  const event_type = TYPES.includes(req.body?.event_type) ? req.body.event_type : 'event';
  return { title, description, event_date, end_date, event_type };
}
function validate(b) {
  if (!b.title || !b.event_date) return '제목과 날짜를 입력하세요.';
  if (!dateOk(b.event_date)) return '날짜 형식(YYYY-MM-DD)을 확인하세요.';
  if (b.end_date) {
    if (!dateOk(b.end_date)) return '종료 날짜 형식을 확인하세요.';
    if (b.end_date < b.event_date) return '종료 날짜는 시작 날짜보다 빠를 수 없어요.';
    if (b.end_date === b.event_date) b.end_date = null;   // 하루짜리는 종료일 생략
  }
  return null;
}
const label = (b) => `${b.event_date}${b.end_date ? `~${b.end_date}` : ''} · ${b.title}`;

// 추가
router.post('/', requirePerm('calendar'), async (req, res) => {
  const b = parseBody(req);
  const err = validate(b); if (err) return res.status(400).json({ error: err });
  const info = await db.prepare('INSERT INTO events (title, description, event_date, end_date, event_type, author_id) VALUES (?, ?, ?, ?, ?, ?)')
    .run(b.title, b.description, b.event_date, b.end_date, b.event_type, req.user.id);
  await logAudit('event', info.lastInsertRowid, 'create', JSON.stringify({ label: label(b) }), req.user.id);
  res.json({ ok: true, id: info.lastInsertRowid });
});

// 수정
router.put('/:id', requirePerm('calendar'), async (req, res) => {
  const ev = await db.prepare('SELECT id FROM events WHERE id=?').get(req.params.id);
  if (!ev) return res.status(404).json({ error: '일정을 찾을 수 없습니다.' });
  const b = parseBody(req);
  const err = validate(b); if (err) return res.status(400).json({ error: err });
  await db.prepare('UPDATE events SET title=?, description=?, event_date=?, end_date=?, event_type=? WHERE id=?')
    .run(b.title, b.description, b.event_date, b.end_date, b.event_type, req.params.id);
  await logAudit('event', req.params.id, 'update', JSON.stringify({ label: label(b) }), req.user.id);
  res.json({ ok: true });
});

// 삭제
router.delete('/:id', requirePerm('calendar'), async (req, res) => {
  const ev = await db.prepare('SELECT title, event_date, end_date FROM events WHERE id=?').get(req.params.id);
  await db.prepare('DELETE FROM events WHERE id=?').run(req.params.id);
  if (ev) await logAudit('event', req.params.id, 'delete', JSON.stringify({ label: `${ev.event_date}${ev.end_date ? `~${ev.end_date}` : ''} · ${ev.title}` }), req.user.id);
  res.json({ ok: true });
});

export default router;
