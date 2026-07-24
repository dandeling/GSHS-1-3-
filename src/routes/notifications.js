import express from 'express';
import db from '../db.js';
import { requireAuth } from '../middleware.js';

const router = express.Router();

// 안읽은 개수 (배지용) — 알림 + 안읽은 쪽지
router.get('/count', requireAuth, (req, res) => {
  const notif = db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id=? AND is_read=0').get(req.user.id).c;
  const dm = db.prepare('SELECT COUNT(*) c FROM dm_messages WHERE recipient_id=? AND is_read=0').get(req.user.id).c;
  res.json({ notif, dm, total: notif + dm });
});

// 알림 목록
router.get('/', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT id, type, actor, post_id, text, is_read, created_at
    FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 50
  `).all(req.user.id);
  res.json({ notifications: rows });
});

// 모두 읽음 처리
router.post('/read', requireAuth, (req, res) => {
  db.prepare('UPDATE notifications SET is_read=1 WHERE user_id=? AND is_read=0').run(req.user.id);
  res.json({ ok: true });
});

// 하나 읽음 처리
router.post('/:id/read', requireAuth, (req, res) => {
  db.prepare('UPDATE notifications SET is_read=1 WHERE id=? AND user_id=?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

export default router;
