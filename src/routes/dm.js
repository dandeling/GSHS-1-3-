import express from 'express';
import db, { notify } from '../db.js';
import { requireAuth } from '../middleware.js';

const router = express.Router();

// 대화 목록 (상대별 최근 메시지)
router.get('/', requireAuth, (req, res) => {
  const me = req.user.id;
  const rows = db.prepare(`
    SELECT other.id AS user_id, other.username, other.point, other.role,
      (SELECT content FROM dm_messages m WHERE (m.sender_id=? AND m.recipient_id=other.id) OR (m.sender_id=other.id AND m.recipient_id=?) ORDER BY m.id DESC LIMIT 1) AS last,
      (SELECT created_at FROM dm_messages m WHERE (m.sender_id=? AND m.recipient_id=other.id) OR (m.sender_id=other.id AND m.recipient_id=?) ORDER BY m.id DESC LIMIT 1) AS last_at,
      (SELECT COUNT(*) FROM dm_messages m WHERE m.sender_id=other.id AND m.recipient_id=? AND m.is_read=0) AS unread
    FROM users other
    WHERE other.id != ? AND EXISTS (
      SELECT 1 FROM dm_messages m WHERE (m.sender_id=? AND m.recipient_id=other.id) OR (m.sender_id=other.id AND m.recipient_id=?)
    )
    ORDER BY last_at DESC
  `).all(me, me, me, me, me, me, me, me);
  res.json({ conversations: rows });
});

// 특정 상대와의 대화 (읽음 처리)
router.get('/:username', requireAuth, (req, res) => {
  const other = db.prepare('SELECT id, username, point, role FROM users WHERE username=?').get(req.params.username);
  if (!other) return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
  if (other.id === req.user.id) return res.status(400).json({ error: '자기 자신에게는 보낼 수 없어요.' });
  const me = req.user.id;
  const msgs = db.prepare(`
    SELECT id, sender_id, recipient_id, content, created_at
    FROM dm_messages
    WHERE (sender_id=? AND recipient_id=?) OR (sender_id=? AND recipient_id=?)
    ORDER BY id ASC LIMIT 300
  `).all(me, other.id, other.id, me);
  db.prepare('UPDATE dm_messages SET is_read=1 WHERE sender_id=? AND recipient_id=? AND is_read=0').run(other.id, me);
  res.json({ other, messages: msgs, meId: me });
});

// 쪽지 보내기
router.post('/:username', requireAuth, (req, res) => {
  const other = db.prepare('SELECT id, username FROM users WHERE username=?').get(req.params.username);
  if (!other) return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
  if (other.id === req.user.id) return res.status(400).json({ error: '자기 자신에게는 보낼 수 없어요.' });
  const { content } = req.body || {};
  if (!content?.trim()) return res.status(400).json({ error: '내용을 입력하세요.' });
  const info = db.prepare('INSERT INTO dm_messages (sender_id, recipient_id, content) VALUES (?, ?, ?)')
    .run(req.user.id, other.id, content.trim());
  notify(other.id, req.user.id, 'dm', null, `쪽지: "${content.slice(0, 40)}"`);
  res.json({ ok: true, id: info.lastInsertRowid });
});

export default router;
