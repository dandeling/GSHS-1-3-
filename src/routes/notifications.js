import express from 'express';
import db from '../db.js';
import { requireAuth, loadUser } from '../middleware.js';

const router = express.Router();

// 안읽은 개수 (배지용) — 알림 + 안읽은 쪽지
router.get('/count', requireAuth, async (req, res) => {
  const notif = (await db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id=? AND is_read=0').get(req.user.id)).c;
  const dm = (await db.prepare('SELECT COUNT(*) c FROM dm_messages WHERE recipient_id=? AND is_read=0').get(req.user.id)).c;
  res.json({ notif, dm, total: notif + dm });
});

// 안읽은 벌점 경고 조회(조회 즉시 확인 처리) — 클라이언트가 경고창으로 표시
// 정지·대기 상태여도 경고를 볼 수 있도록 loadUser 사용
router.get('/warnings', async (req, res) => {
  const user = await loadUser(req);
  if (!user) return res.json({ warnings: [] });
  const rows = await db.prepare('SELECT id, text, created_at FROM warnings WHERE user_id=? AND seen=0 ORDER BY id ASC').all(user.id);
  if (rows.length) await db.prepare('UPDATE warnings SET seen=1 WHERE user_id=? AND seen=0').run(user.id);
  res.json({ warnings: rows });
});

// 알림 목록
router.get('/', requireAuth, async (req, res) => {
  const rows = await db.prepare(`
    SELECT id, type, actor, post_id, text, is_read, created_at
    FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 50
  `).all(req.user.id);
  res.json({ notifications: rows });
});

// 모두 읽음 처리
router.post('/read', requireAuth, async (req, res) => {
  await db.prepare('UPDATE notifications SET is_read=1 WHERE user_id=? AND is_read=0').run(req.user.id);
  res.json({ ok: true });
});

// 하나 읽음 처리
router.post('/:id/read', requireAuth, async (req, res) => {
  await db.prepare('UPDATE notifications SET is_read=1 WHERE id=? AND user_id=?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

export default router;
