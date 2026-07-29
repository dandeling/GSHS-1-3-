import express from 'express';
import bcrypt from 'bcryptjs';
import db, { logAudit } from '../db.js';
import { requireAuth, addDemerit, hasPerm } from '../middleware.js';
import { countBadwords } from '../badwords.js';

const router = express.Router();

// 비밀방 접근 권한: 공개방이거나, 개설자/관리자이거나, 멤버면 true
async function canAccess(room, user) {
  if (!room.is_private) return true;
  if (hasPerm(user, 'moderate') || room.created_by === user.id) return true;
  return !!(await db.prepare('SELECT 1 FROM room_members WHERE room_id=? AND user_id=?').get(room.id, user.id));
}

// 채팅방 목록
router.get('/rooms', requireAuth, async (req, res) => {
  const rows = await db.prepare(`
    SELECT r.id, r.name, r.is_private, r.created_by, u.username AS creator,
      (SELECT COUNT(*) FROM chats c WHERE c.room_id=r.id AND c.deleted_at IS NULL) AS msg_count
    FROM chat_rooms r LEFT JOIN users u ON u.id=r.created_by
    ORDER BY r.id ASC
  `).all();
  const rooms = [];
  for (const r of rows) {
    rooms.push({
      id: r.id, name: r.name, is_private: !!r.is_private, creator: r.creator, msg_count: r.msg_count,
      joined: await canAccess({ id: r.id, is_private: r.is_private, created_by: r.created_by }, req.user),
    });
  }
  res.json({ rooms });
});

// 채팅방 만들기 (공개/비밀). 비밀이면 password 필요
router.post('/rooms', requireAuth, async (req, res) => {
  const { name, is_private, password } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: '방 이름을 입력하세요.' });
  if (name.length > 30) return res.status(400).json({ error: '방 이름은 30자 이내로 해주세요.' });
  const priv = is_private ? 1 : 0;
  let hash = null;
  if (priv) {
    if (!password || String(password).length < 2) return res.status(400).json({ error: '비밀방 입장코드를 2자 이상 입력하세요.' });
    hash = bcrypt.hashSync(String(password), 10);
  }
  const info = await db.prepare('INSERT INTO chat_rooms (name, is_private, password, created_by) VALUES (?, ?, ?, ?)')
    .run(name.trim(), priv, hash, req.user.id);
  if (priv) await db.prepare('INSERT OR IGNORE INTO room_members (room_id, user_id) VALUES (?, ?)').run(info.lastInsertRowid, req.user.id);
  res.json({ ok: true, id: info.lastInsertRowid });
});

// 비밀방 입장 (입장코드 확인 → 멤버 등록)
router.post('/rooms/:id/join', requireAuth, async (req, res) => {
  const room = await db.prepare('SELECT * FROM chat_rooms WHERE id=?').get(req.params.id);
  if (!room) return res.status(404).json({ error: '방을 찾을 수 없습니다.' });
  if (!room.is_private) return res.json({ ok: true });
  if (await canAccess(room, req.user)) return res.json({ ok: true });
  const { password } = req.body || {};
  if (!password || !bcrypt.compareSync(String(password), room.password || '')) {
    return res.status(403).json({ error: '입장코드가 올바르지 않습니다.' });
  }
  await db.prepare('INSERT OR IGNORE INTO room_members (room_id, user_id) VALUES (?, ?)').run(room.id, req.user.id);
  res.json({ ok: true });
});

// 채팅방 삭제 (개설자/관리자, 기본방 제외)
router.delete('/rooms/:id', requireAuth, async (req, res) => {
  const room = await db.prepare('SELECT * FROM chat_rooms WHERE id=?').get(req.params.id);
  if (!room) return res.status(404).json({ error: '방을 찾을 수 없습니다.' });
  if (room.id === 1) return res.status(400).json({ error: '기본 채팅방은 삭제할 수 없습니다.' });
  if (room.created_by !== req.user.id && !hasPerm(req.user, 'moderate')) return res.status(403).json({ error: '삭제 권한이 없습니다.' });
  await db.prepare('DELETE FROM chats WHERE room_id=?').run(room.id);
  await db.prepare('DELETE FROM room_members WHERE room_id=?').run(room.id);
  await db.prepare('DELETE FROM chat_rooms WHERE id=?').run(room.id);
  res.json({ ok: true });
});

// 메시지 조회 (방별, 접근권한 확인)
router.get('/', requireAuth, async (req, res) => {
  const roomId = parseInt(req.query.room || '1', 10);
  const room = await db.prepare('SELECT * FROM chat_rooms WHERE id=?').get(roomId);
  if (!room) return res.status(404).json({ error: '방을 찾을 수 없습니다.' });
  if (!(await canAccess(room, req.user))) return res.status(403).json({ error: '비밀방입니다. 입장코드가 필요해요.', locked: true });
  const since = parseInt(req.query.since || '0', 10);
  const rows = await db.prepare(`
    SELECT c.id, c.content, c.created_at, c.author_id,
           CASE WHEN u.status IN ('kicked','rejected','withdrawn') THEN '삭제된 사람' ELSE u.username END AS author,
           u.point AS author_point, u.role AS author_role, u.custom_rank AS author_rank
    FROM chats c JOIN users u ON u.id = c.author_id
    WHERE c.deleted_at IS NULL AND c.room_id = ? AND c.id > ?
    ORDER BY c.id ASC LIMIT 200
  `).all(roomId, since);
  res.json({ messages: rows, me: { id: req.user.id, role: req.user.role } });
});

// 메시지 전송 (방별, 접근권한 확인)
router.post('/', requireAuth, async (req, res) => {
  const { content } = req.body || {};
  const roomId = parseInt(req.body?.room || '1', 10);
  if (!content?.trim()) return res.status(400).json({ error: '내용을 입력하세요.' });
  const room = await db.prepare('SELECT * FROM chat_rooms WHERE id=?').get(roomId);
  if (!room) return res.status(400).json({ error: '채팅방을 확인하세요.' });
  if (!(await canAccess(room, req.user))) return res.status(403).json({ error: '비밀방 입장코드가 필요해요.', locked: true });

  let penalty = null;
  if (countBadwords(content) > 0) {
    const after = await addDemerit(req.user.id);
    penalty = { demerit: after.demerit, status: after.status };
    if (after.status !== 'active') {
      return res.status(403).json({ error: `비속어로 벌점이 부과되어 ${after.status === 'kicked' ? '강퇴' : '정지'}되었습니다.`, penalty });
    }
  }
  const info = await db.prepare('INSERT INTO chats (author_id, content, room_id) VALUES (?, ?, ?)').run(req.user.id, content.trim(), roomId);
  await logAudit('chat', info.lastInsertRowid, 'create', content, req.user.id);
  res.json({ ok: true, id: info.lastInsertRowid, penalty });
});

// 메시지 삭제
router.delete('/:id', requireAuth, async (req, res) => {
  const msg = await db.prepare('SELECT * FROM chats WHERE id=? AND deleted_at IS NULL').get(req.params.id);
  if (!msg) return res.status(404).json({ error: '메시지를 찾을 수 없습니다.' });
  if (msg.author_id !== req.user.id && !hasPerm(req.user, 'moderate')) return res.status(403).json({ error: '삭제 권한이 없습니다.' });
  await logAudit('chat', msg.id, 'delete', msg.content, req.user.id);
  await db.prepare("UPDATE chats SET deleted_at=datetime('now') WHERE id=?").run(msg.id);
  res.json({ ok: true });
});

export default router;
