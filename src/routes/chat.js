import express from 'express';
import db, { logAudit } from '../db.js';
import { requireAuth, addDemerit } from '../middleware.js';
import { countBadwords } from '../badwords.js';

const router = express.Router();

// 채팅방 목록
router.get('/rooms', requireAuth, (req, res) => {
  const rooms = db.prepare(`
    SELECT r.id, r.name, r.created_by, u.username AS creator,
      (SELECT COUNT(*) FROM chats c WHERE c.room_id=r.id AND c.deleted_at IS NULL) AS msg_count
    FROM chat_rooms r LEFT JOIN users u ON u.id=r.created_by
    ORDER BY r.id ASC
  `).all();
  res.json({ rooms });
});

// 채팅방 만들기 (누구나)
router.post('/rooms', requireAuth, (req, res) => {
  const { name } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: '방 이름을 입력하세요.' });
  if (name.length > 30) return res.status(400).json({ error: '방 이름은 30자 이내로 해주세요.' });
  const info = db.prepare('INSERT INTO chat_rooms (name, created_by) VALUES (?, ?)').run(name.trim(), req.user.id);
  res.json({ ok: true, id: info.lastInsertRowid });
});

// 채팅방 삭제 (개설자 또는 관리자, 기본방 제외)
router.delete('/rooms/:id', requireAuth, (req, res) => {
  const room = db.prepare('SELECT * FROM chat_rooms WHERE id=?').get(req.params.id);
  if (!room) return res.status(404).json({ error: '방을 찾을 수 없습니다.' });
  if (room.id === 1) return res.status(400).json({ error: '기본 채팅방은 삭제할 수 없습니다.' });
  if (room.created_by !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: '삭제 권한이 없습니다.' });
  db.prepare('DELETE FROM chats WHERE room_id=?').run(room.id);
  db.prepare('DELETE FROM chat_rooms WHERE id=?').run(room.id);
  res.json({ ok: true });
});

// 메시지 조회 (방별, since 이후)
router.get('/', requireAuth, (req, res) => {
  const room = parseInt(req.query.room || '1', 10);
  const since = parseInt(req.query.since || '0', 10);
  const rows = db.prepare(`
    SELECT c.id, c.content, c.created_at, c.author_id, u.username AS author, u.point AS author_point, u.role AS author_role
    FROM chats c JOIN users u ON u.id = c.author_id
    WHERE c.deleted_at IS NULL AND c.room_id = ? AND c.id > ?
    ORDER BY c.id ASC LIMIT 200
  `).all(room, since);
  res.json({ messages: rows, me: { id: req.user.id, role: req.user.role } });
});

// 메시지 전송 (방별)
router.post('/', requireAuth, (req, res) => {
  const { content } = req.body || {};
  const room = parseInt(req.body?.room || '1', 10);
  if (!content?.trim()) return res.status(400).json({ error: '내용을 입력하세요.' });
  if (!db.prepare('SELECT 1 FROM chat_rooms WHERE id=?').get(room)) return res.status(400).json({ error: '채팅방을 확인하세요.' });

  let penalty = null;
  if (countBadwords(content) > 0) {
    const after = addDemerit(req.user.id);
    penalty = { demerit: after.demerit, status: after.status };
    if (after.status !== 'active') {
      return res.status(403).json({ error: `비속어로 벌점이 부과되어 ${after.status === 'kicked' ? '강퇴' : '정지'}되었습니다.`, penalty });
    }
  }
  const info = db.prepare('INSERT INTO chats (author_id, content, room_id) VALUES (?, ?, ?)').run(req.user.id, content.trim(), room);
  logAudit('chat', info.lastInsertRowid, 'create', content, req.user.id);
  res.json({ ok: true, id: info.lastInsertRowid, penalty });
});

// 메시지 삭제
router.delete('/:id', requireAuth, (req, res) => {
  const msg = db.prepare('SELECT * FROM chats WHERE id=? AND deleted_at IS NULL').get(req.params.id);
  if (!msg) return res.status(404).json({ error: '메시지를 찾을 수 없습니다.' });
  if (msg.author_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: '삭제 권한이 없습니다.' });
  logAudit('chat', msg.id, 'delete', msg.content, req.user.id);
  db.prepare("UPDATE chats SET deleted_at=datetime('now') WHERE id=?").run(msg.id);
  res.json({ ok: true });
});

export default router;
