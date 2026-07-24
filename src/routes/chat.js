import express from 'express';
import db, { logAudit } from '../db.js';
import { requireAuth, addDemerit } from '../middleware.js';
import { countBadwords } from '../badwords.js';

const router = express.Router();

// 메시지 조회 (since 이후 것만 → 3초 폴링)
router.get('/', requireAuth, (req, res) => {
  const since = parseInt(req.query.since || '0', 10);
  const rows = db.prepare(`
    SELECT c.id, c.content, c.created_at, c.author_id, u.username AS author
    FROM chats c JOIN users u ON u.id = c.author_id
    WHERE c.deleted_at IS NULL AND c.id > ?
    ORDER BY c.id ASC
    LIMIT 200
  `).all(since);
  res.json({ messages: rows, me: { id: req.user.id, role: req.user.role } });
});

// 메시지 전송
router.post('/', requireAuth, (req, res) => {
  const { content } = req.body || {};
  if (!content?.trim()) return res.status(400).json({ error: '내용을 입력하세요.' });

  let penalty = null;
  if (countBadwords(content) > 0) {
    const after = addDemerit(req.user.id);
    penalty = { demerit: after.demerit, status: after.status };
    // 벌점으로 정지/강퇴되면 메시지 전송 차단
    if (after.status !== 'active') {
      return res.status(403).json({ error: `비속어로 벌점이 부과되어 ${after.status === 'kicked' ? '강퇴' : '정지'}되었습니다.`, penalty });
    }
  }

  const info = db.prepare('INSERT INTO chats (author_id, content) VALUES (?, ?)')
    .run(req.user.id, content.trim());
  logAudit('chat', info.lastInsertRowid, 'create', content, req.user.id);
  res.json({ ok: true, id: info.lastInsertRowid, penalty });
});

// 메시지 삭제 (작성자/관리자)
router.delete('/:id', requireAuth, (req, res) => {
  const msg = db.prepare('SELECT * FROM chats WHERE id=? AND deleted_at IS NULL').get(req.params.id);
  if (!msg) return res.status(404).json({ error: '메시지를 찾을 수 없습니다.' });
  if (msg.author_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: '삭제 권한이 없습니다.' });
  }
  logAudit('chat', msg.id, 'delete', msg.content, req.user.id);
  db.prepare("UPDATE chats SET deleted_at=datetime('now') WHERE id=?").run(msg.id);
  res.json({ ok: true });
});

export default router;
