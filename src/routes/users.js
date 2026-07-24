import express from 'express';
import db from '../db.js';
import { requireAuth } from '../middleware.js';

const router = express.Router();

// 프로필 조회 (별명 기준). 실명은 노출하지 않음.
router.get('/:username/profile', requireAuth, (req, res) => {
  const u = db.prepare('SELECT id, username, role, point, created_at FROM users WHERE username=?').get(req.params.username);
  if (!u) return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });

  const postCount = db.prepare("SELECT COUNT(*) c FROM posts WHERE author_id=? AND deleted_at IS NULL").get(u.id).c;
  const commentCount = db.prepare("SELECT COUNT(*) c FROM comments WHERE author_id=? AND deleted_at IS NULL").get(u.id).c;
  const likeReceived = db.prepare("SELECT COUNT(*) c FROM likes l JOIN posts p ON p.id=l.post_id WHERE p.author_id=?").get(u.id).c;
  const attendance = db.prepare("SELECT COUNT(*) c FROM attendance WHERE user_id=?").get(u.id).c;

  const posts = db.prepare(`
    SELECT p.id, p.board, p.tag, p.title, p.created_at, p.views,
      (SELECT COUNT(*) FROM comments c WHERE c.post_id=p.id AND c.deleted_at IS NULL) AS comment_count,
      (SELECT COUNT(*) FROM likes l WHERE l.post_id=p.id) AS like_count
    FROM posts p WHERE p.author_id=? AND p.deleted_at IS NULL
    ORDER BY p.id DESC LIMIT 20
  `).all(u.id);

  res.json({
    user: { username: u.username, role: u.role, point: u.point, created_at: u.created_at },
    stats: { postCount, commentCount, likeReceived, attendance },
    posts,
    isMe: u.id === req.user.id,
  });
});

export default router;
