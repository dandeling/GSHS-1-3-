import express from 'express';
import db from '../db.js';
import { requireAuth } from '../middleware.js';

const router = express.Router();

// 전체 랭킹: by=point|likes|attendance|posts
router.get('/ranking', requireAuth, async (req, res) => {
  const by = req.query.by || 'point';
  let rows;
  if (by === 'likes') {
    rows = await db.prepare(`SELECT u.username, u.point, u.role,
      (SELECT COUNT(*) FROM likes l JOIN posts p ON p.id=l.post_id WHERE p.author_id=u.id) AS score
      FROM users u WHERE u.role!='admin' ORDER BY score DESC, u.point DESC LIMIT 20`).all();
  } else if (by === 'attendance') {
    rows = await db.prepare(`SELECT u.username, u.point, u.role,
      (SELECT COUNT(*) FROM attendance a WHERE a.user_id=u.id) AS score
      FROM users u WHERE u.role!='admin' ORDER BY score DESC, u.point DESC LIMIT 20`).all();
  } else if (by === 'posts') {
    rows = await db.prepare(`SELECT u.username, u.point, u.role,
      (SELECT COUNT(*) FROM posts p WHERE p.author_id=u.id AND p.deleted_at IS NULL) AS score
      FROM users u WHERE u.role!='admin' ORDER BY score DESC, u.point DESC LIMIT 20`).all();
  } else {
    rows = await db.prepare(`SELECT u.username, u.point, u.role, u.point AS score
      FROM users u WHERE u.role!='admin' ORDER BY u.point DESC LIMIT 20`).all();
  }
  res.json({ by, ranking: rows });
});

// 프로필 조회 (별명 기준)
router.get('/:username/profile', requireAuth, async (req, res) => {
  const u = await db.prepare('SELECT id, username, role, point, created_at FROM users WHERE username=?').get(req.params.username);
  if (!u) return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });

  const postCount = (await db.prepare("SELECT COUNT(*) c FROM posts WHERE author_id=? AND deleted_at IS NULL").get(u.id)).c;
  const commentCount = (await db.prepare("SELECT COUNT(*) c FROM comments WHERE author_id=? AND deleted_at IS NULL").get(u.id)).c;
  const likeReceived = (await db.prepare("SELECT COUNT(*) c FROM likes l JOIN posts p ON p.id=l.post_id WHERE p.author_id=?").get(u.id)).c;
  const attendance = (await db.prepare("SELECT COUNT(*) c FROM attendance WHERE user_id=?").get(u.id)).c;

  const posts = await db.prepare(`
    SELECT p.id, p.board, p.tag, p.title, p.created_at, p.views,
      (SELECT COUNT(*) FROM comments c WHERE c.post_id=p.id AND c.deleted_at IS NULL) AS comment_count,
      (SELECT COUNT(*) FROM likes l WHERE l.post_id=p.id) AS like_count
    FROM posts p WHERE p.author_id=? AND p.deleted_at IS NULL
    ORDER BY p.id DESC LIMIT 20
  `).all(u.id);

  const isMe = u.id === req.user.id;
  const isAdmin = req.user.role === 'admin';
  const userOut = { username: u.username, role: u.role, point: u.point, created_at: u.created_at };
  if (isMe || isAdmin) {
    const full = await db.prepare('SELECT email, realname FROM users WHERE id=?').get(u.id);
    userOut.realname = full.realname;
    if (isMe) userOut.email = full.email;
  }
  res.json({ user: userOut, stats: { postCount, commentCount, likeReceived, attendance }, posts, isMe });
});

export default router;
