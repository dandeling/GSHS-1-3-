import express from 'express';
import db from '../db.js';
import { requireAuth, requireAdmin } from '../middleware.js';

const router = express.Router();

// 홈 대시보드: 오늘의 급식 + 지금 인기 있는 글 + 명예의 전당(이달의 인기 글쓴이)
router.get('/', requireAuth, (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const meal = db.prepare('SELECT * FROM meals WHERE meal_date=?').get(today) || null;

  // 인기 글: 최근 14일 내, 좋아요*5 + 조회 + 댓글*3 점수 상위 5
  const popular = db.prepare(`
    SELECT p.id, p.board, p.tag, p.title, u.username AS author, u.point AS author_point, u.role AS author_role, p.views,
           (SELECT COUNT(*) FROM likes l WHERE l.post_id=p.id) AS like_count,
           (SELECT COUNT(*) FROM comments c WHERE c.post_id=p.id AND c.deleted_at IS NULL) AS comment_count
    FROM posts p JOIN users u ON u.id=p.author_id
    WHERE p.deleted_at IS NULL AND p.board IN ('notice','free')
      AND p.created_at >= datetime('now','-14 days')
    ORDER BY like_count*5 + p.views + comment_count*3 DESC, p.id DESC
    LIMIT 5
  `).all();

  // 명예의 전당: 이번 달 작성 글의 (좋아요+댓글) 합이 높은 작성자 상위 3
  const hallOfFame = db.prepare(`
    SELECT u.username AS author, u.point AS author_point, u.role AS author_role,
           COUNT(DISTINCT p.id) AS post_count,
           (SELECT COUNT(*) FROM likes l JOIN posts p2 ON p2.id=l.post_id
             WHERE p2.author_id=u.id AND strftime('%Y-%m', p2.created_at)=strftime('%Y-%m','now')) AS like_count
    FROM posts p JOIN users u ON u.id=p.author_id
    WHERE p.deleted_at IS NULL AND strftime('%Y-%m', p.created_at)=strftime('%Y-%m','now')
    GROUP BY u.id
    ORDER BY like_count DESC, post_count DESC
    LIMIT 3
  `).all();

  res.json({ meal, popular, hallOfFame, isAdmin: req.user.role === 'admin', today });
});

// 오늘의 급식 등록/수정 (관리자)
router.post('/meal', requireAdmin, (req, res) => {
  const { meal_date, content } = req.body || {};
  const date = meal_date || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: '날짜 형식을 확인하세요.' });
  if (!content?.trim()) {
    db.prepare('DELETE FROM meals WHERE meal_date=?').run(date);
    return res.json({ ok: true, cleared: true });
  }
  db.prepare(`INSERT INTO meals (meal_date, content) VALUES (?, ?)
    ON CONFLICT(meal_date) DO UPDATE SET content=excluded.content, updated_at=datetime('now')`)
    .run(date, content.trim());
  res.json({ ok: true });
});

export default router;
