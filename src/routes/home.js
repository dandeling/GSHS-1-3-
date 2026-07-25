import express from 'express';
import db, { addPoint } from '../db.js';
import { requireAuth, requireAdmin } from '../middleware.js';
import { fetchMeal } from '../neis.js';

const router = express.Router();

function todayStr() { return new Date().toISOString().slice(0, 10); }

// 오늘 급식: DB 캐시 우선, 없으면 NEIS 자동조회 후 캐시
async function getTodayMeal() {
  const today = todayStr();
  let meal = db.prepare('SELECT * FROM meals WHERE meal_date=?').get(today);
  if (meal) return meal;
  try {
    const content = await fetchMeal(today);
    if (content) {
      db.prepare(`INSERT INTO meals (meal_date, content, source) VALUES (?, ?, 'neis')
        ON CONFLICT(meal_date) DO UPDATE SET content=excluded.content, source='neis', updated_at=datetime('now')`)
        .run(today, content);
      return db.prepare('SELECT * FROM meals WHERE meal_date=?').get(today);
    }
  } catch { /* NEIS 실패 시 조용히 무시(관리자 수동입력 대체) */ }
  return null;
}

// 홈 대시보드
router.get('/', requireAuth, async (req, res) => {
  const today = todayStr();
  const meal = await getTodayMeal();

  // D-day (다가오는 것 우선, 지난 것 제외)
  const ddays = db.prepare(`
    SELECT id, title, target_date, CAST(julianday(target_date) - julianday('now','localtime','start of day') AS INTEGER) AS dleft
    FROM ddays WHERE julianday(target_date) >= julianday('now','localtime','start of day')
    ORDER BY target_date ASC LIMIT 5
  `).all();

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

  const hallOfFame = db.prepare(`
    SELECT u.username AS author, u.point AS author_point, u.role AS author_role,
           COUNT(DISTINCT p.id) AS post_count,
           (SELECT COUNT(*) FROM likes l JOIN posts p2 ON p2.id=l.post_id
             WHERE p2.author_id=u.id AND strftime('%Y-%m', p2.created_at)=strftime('%Y-%m','now')) AS like_count
    FROM posts p JOIN users u ON u.id=p.author_id
    WHERE p.deleted_at IS NULL AND strftime('%Y-%m', p.created_at)=strftime('%Y-%m','now')
    GROUP BY u.id ORDER BY like_count DESC, post_count DESC LIMIT 3
  `).all();

  // 출석
  const checkedToday = !!db.prepare('SELECT 1 FROM attendance WHERE user_id=? AND day=?').get(req.user.id, today);
  const attendCount = db.prepare('SELECT COUNT(*) c FROM attendance WHERE user_id=?').get(req.user.id).c;

  res.json({ meal, ddays, popular, hallOfFame, isAdmin: req.user.role === 'admin', today,
    attendance: { checkedToday, total: attendCount } });
});

// 출석체크 (하루 1회, +2점)
router.post('/attendance', requireAuth, (req, res) => {
  const today = todayStr();
  const exists = db.prepare('SELECT 1 FROM attendance WHERE user_id=? AND day=?').get(req.user.id, today);
  if (exists) return res.json({ ok: true, already: true });
  db.prepare('INSERT INTO attendance (user_id, day) VALUES (?, ?)').run(req.user.id, today);
  addPoint(req.user.id, 2); // 출석 +2
  const total = db.prepare('SELECT COUNT(*) c FROM attendance WHERE user_id=?').get(req.user.id).c;
  res.json({ ok: true, total });
});

// 오늘의 급식 수동 등록/수정 (관리자)
router.post('/meal', requireAdmin, (req, res) => {
  const { meal_date, content } = req.body || {};
  const date = meal_date || todayStr();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: '날짜 형식을 확인하세요.' });
  if (!content?.trim()) {
    db.prepare('DELETE FROM meals WHERE meal_date=?').run(date);
    return res.json({ ok: true, cleared: true });
  }
  db.prepare(`INSERT INTO meals (meal_date, content, source) VALUES (?, ?, 'manual')
    ON CONFLICT(meal_date) DO UPDATE SET content=excluded.content, source='manual', updated_at=datetime('now')`)
    .run(date, content.trim());
  res.json({ ok: true });
});

// D-day 목록(전체) / 추가 / 삭제
router.get('/ddays', requireAuth, (req, res) => {
  const rows = db.prepare(`SELECT id, title, target_date,
    CAST(julianday(target_date) - julianday('now','localtime','start of day') AS INTEGER) AS dleft
    FROM ddays ORDER BY target_date ASC`).all();
  res.json({ ddays: rows });
});
router.post('/ddays', requireAdmin, (req, res) => {
  const { title, target_date } = req.body || {};
  if (!title?.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(target_date || '')) return res.status(400).json({ error: '제목과 날짜(YYYY-MM-DD)를 확인하세요.' });
  const info = db.prepare('INSERT INTO ddays (title, target_date) VALUES (?, ?)').run(title.trim(), target_date);
  res.json({ ok: true, id: info.lastInsertRowid });
});
router.delete('/ddays/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM ddays WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

export default router;
