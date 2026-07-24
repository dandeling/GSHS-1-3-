import express from 'express';
import db, { logAudit, addPoint } from '../db.js';
import { requireAuth } from '../middleware.js';
import { addDemerit } from '../middleware.js';
import { countBadwords } from '../badwords.js';
import { BOARDS, SUBJECT_CODES, CATEGORY_CODES, TAG_CODES } from '../constants.js';

const router = express.Router();
const PAGE_SIZE = 20;

// 목록 조회 (페이지 나눔 + 검색 + 정렬 + 말머리)
// GET /api/posts?board=free&tag=ask&q=검색&sort=popular&subject=math1&category=exam&page=1
// board 생략 시: notice+free 통합(홈 피드). board=all 도 동일.
router.get('/', requireAuth, (req, res) => {
  const board = req.query.board;
  const feed = !board || board === 'all';
  if (!feed && !BOARDS.includes(board)) return res.status(400).json({ error: '게시판을 확인하세요.' });
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const offset = (page - 1) * PAGE_SIZE;

  const where = ['p.deleted_at IS NULL'];
  const params = [];
  if (feed) {
    where.push("p.board IN ('notice','free')");
  } else {
    where.push('p.board = ?'); params.push(board);
  }
  if (!feed && board === 'resource') {
    if (req.query.subject) {
      if (!SUBJECT_CODES.includes(req.query.subject)) return res.status(400).json({ error: '과목을 확인하세요.' });
      where.push('p.subject = ?'); params.push(req.query.subject);
    }
    if (req.query.category) {
      if (!CATEGORY_CODES.includes(req.query.category)) return res.status(400).json({ error: '분류를 확인하세요.' });
      where.push('p.category = ?'); params.push(req.query.category);
    }
  }
  // 말머리 필터 (자유게시판/피드)
  if (req.query.tag) {
    if (!TAG_CODES.includes(req.query.tag)) return res.status(400).json({ error: '말머리를 확인하세요.' });
    where.push('p.tag = ?'); params.push(req.query.tag);
  }
  // 검색 (제목·내용)
  if (req.query.q && req.query.q.trim()) {
    where.push('(p.title LIKE ? OR p.content LIKE ?)');
    const kw = `%${req.query.q.trim()}%`; params.push(kw, kw);
  }
  const whereSql = where.join(' AND ');

  // 정렬: recent(기본) | popular(좋아요+조회수+댓글)
  const sort = req.query.sort === 'popular'
    ? `(SELECT COUNT(*) FROM likes l WHERE l.post_id=p.id) * 5 + p.views + (SELECT COUNT(*) FROM comments c WHERE c.post_id=p.id AND c.deleted_at IS NULL) * 3 DESC, p.id DESC`
    : `p.board = 'notice' DESC, p.id DESC`; // 피드에서 공지 상단 고정

  const total = db.prepare(`SELECT COUNT(*) c FROM posts p WHERE ${whereSql}`).get(...params).c;
  const rows = db.prepare(`
    SELECT p.id, p.board, p.tag, p.subject, p.category, p.title, p.views, p.created_at, p.updated_at,
           u.username AS author, u.point AS author_point, u.role AS author_role,
           (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id AND c.deleted_at IS NULL) AS comment_count,
           (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count
    FROM posts p JOIN users u ON u.id = p.author_id
    WHERE ${whereSql}
    ORDER BY ${sort}
    LIMIT ? OFFSET ?
  `).all(...params, PAGE_SIZE, offset);

  res.json({ posts: rows, total, page, pageSize: PAGE_SIZE, totalPages: Math.ceil(total / PAGE_SIZE) });
});

// 단건 조회 (조회수 +1) + 댓글
router.get('/:id', requireAuth, (req, res) => {
  const post = db.prepare(`
    SELECT p.*, u.username AS author, u.point AS author_point, u.role AS author_role
    FROM posts p JOIN users u ON u.id = p.author_id
    WHERE p.id = ? AND p.deleted_at IS NULL
  `).get(req.params.id);
  if (!post) return res.status(404).json({ error: '글을 찾을 수 없습니다.' });

  db.prepare('UPDATE posts SET views = views + 1 WHERE id = ?').run(post.id);
  post.views += 1;

  const comments = db.prepare(`
    SELECT c.id, c.content, c.created_at, c.author_id, u.username AS author, u.point AS author_point, u.role AS author_role
    FROM comments c JOIN users u ON u.id = c.author_id
    WHERE c.post_id = ? AND c.deleted_at IS NULL
    ORDER BY c.id ASC
  `).all(post.id);

  post.like_count = db.prepare('SELECT COUNT(*) c FROM likes WHERE post_id=?').get(post.id).c;
  post.liked = !!db.prepare('SELECT 1 FROM likes WHERE post_id=? AND user_id=?').get(post.id, req.user.id);

  res.json({ post, comments, me: { id: req.user.id, role: req.user.role } });
});

// 좋아요 토글
router.post('/:id/like', requireAuth, (req, res) => {
  const post = db.prepare('SELECT id FROM posts WHERE id=? AND deleted_at IS NULL').get(req.params.id);
  if (!post) return res.status(404).json({ error: '글을 찾을 수 없습니다.' });
  const full = db.prepare('SELECT author_id FROM posts WHERE id=?').get(post.id);
  const liked = db.prepare('SELECT 1 FROM likes WHERE post_id=? AND user_id=?').get(post.id, req.user.id);
  if (liked) {
    db.prepare('DELETE FROM likes WHERE post_id=? AND user_id=?').run(post.id, req.user.id);
    if (full.author_id !== req.user.id) addPoint(full.author_id, -1);
  } else {
    db.prepare('INSERT INTO likes (post_id, user_id) VALUES (?, ?)').run(post.id, req.user.id);
    if (full.author_id !== req.user.id) addPoint(full.author_id, 1); // 받은 추천 +1
  }
  const count = db.prepare('SELECT COUNT(*) c FROM likes WHERE post_id=?').get(post.id).c;
  res.json({ ok: true, liked: !liked, like_count: count });
});

// 글 작성
router.post('/', requireAuth, (req, res) => {
  const { board, subject, category, tag, title, content } = req.body || {};
  if (!BOARDS.includes(board)) return res.status(400).json({ error: '게시판을 확인하세요.' });
  if (board === 'notice' && req.user.role !== 'admin') {
    return res.status(403).json({ error: '공지사항은 관리자만 작성할 수 있습니다.' });
  }
  if (!title?.trim() || !content?.trim()) return res.status(400).json({ error: '제목과 내용을 입력하세요.' });

  let subj = null, cat = null, tg = null;
  if (board === 'resource') {
    if (!SUBJECT_CODES.includes(subject)) return res.status(400).json({ error: '과목을 선택하세요.' });
    if (!CATEGORY_CODES.includes(category)) return res.status(400).json({ error: '분류(수행평가/시험)를 선택하세요.' });
    subj = subject; cat = category;
  }
  if (board === 'free') {
    if (tag && !TAG_CODES.includes(tag)) return res.status(400).json({ error: '말머리를 확인하세요.' });
    tg = tag || 'talk';
  }

  const info = db.prepare(`
    INSERT INTO posts (board, subject, category, tag, title, content, author_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(board, subj, cat, tg, title.trim(), content.trim(), req.user.id);

  logAudit('post', info.lastInsertRowid, 'create', JSON.stringify({ title, content }), req.user.id);
  addPoint(req.user.id, 5); // 글 작성 +5
  res.json({ ok: true, id: info.lastInsertRowid });
});

// 글 수정 (작성자 또는 관리자)
router.put('/:id', requireAuth, (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id=? AND deleted_at IS NULL').get(req.params.id);
  if (!post) return res.status(404).json({ error: '글을 찾을 수 없습니다.' });
  if (post.author_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: '수정 권한이 없습니다.' });
  }
  const { title, content, tag } = req.body || {};
  if (!title?.trim() || !content?.trim()) return res.status(400).json({ error: '제목과 내용을 입력하세요.' });
  let tg = post.tag;
  if (post.board === 'free' && tag) {
    if (!TAG_CODES.includes(tag)) return res.status(400).json({ error: '말머리를 확인하세요.' });
    tg = tag;
  }

  // 수정 전 스냅샷을 흔적으로 남김
  logAudit('post', post.id, 'update', JSON.stringify({ title: post.title, content: post.content }), req.user.id);
  db.prepare("UPDATE posts SET title=?, content=?, tag=?, updated_at=datetime('now') WHERE id=?")
    .run(title.trim(), content.trim(), tg, post.id);
  res.json({ ok: true });
});

// 글 삭제 (소프트 삭제, 작성자/관리자)
router.delete('/:id', requireAuth, (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id=? AND deleted_at IS NULL').get(req.params.id);
  if (!post) return res.status(404).json({ error: '글을 찾을 수 없습니다.' });
  if (post.author_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: '삭제 권한이 없습니다.' });
  }
  logAudit('post', post.id, 'delete', JSON.stringify({ title: post.title, content: post.content }), req.user.id);
  db.prepare("UPDATE posts SET deleted_at=datetime('now') WHERE id=?").run(post.id);
  res.json({ ok: true });
});

// 흔적 보기 (수정·삭제 이력) — 관리자만
router.get('/:id/trace', requireAuth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: '관리자만 흔적을 볼 수 있습니다.' });
  const logs = db.prepare(`
    SELECT a.id, a.action, a.snapshot, a.created_at, u.username AS actor
    FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
    WHERE a.entity_type='post' AND a.entity_id=?
    ORDER BY a.id ASC
  `).all(req.params.id);
  res.json({ logs });
});

// ---- 댓글 ----
router.post('/:id/comments', requireAuth, (req, res) => {
  const post = db.prepare('SELECT id FROM posts WHERE id=? AND deleted_at IS NULL').get(req.params.id);
  if (!post) return res.status(404).json({ error: '글을 찾을 수 없습니다.' });
  const { content } = req.body || {};
  if (!content?.trim()) return res.status(400).json({ error: '댓글 내용을 입력하세요.' });

  // 비속어 → 벌점
  let penalty = null;
  if (countBadwords(content) > 0) {
    const after = addDemerit(req.user.id);
    penalty = { demerit: after.demerit, status: after.status };
  }

  const info = db.prepare('INSERT INTO comments (post_id, author_id, content) VALUES (?, ?, ?)')
    .run(post.id, req.user.id, content.trim());
  logAudit('comment', info.lastInsertRowid, 'create', content, req.user.id);
  addPoint(req.user.id, 2); // 댓글 작성 +2
  res.json({ ok: true, id: info.lastInsertRowid, penalty });
});

router.delete('/comments/:cid', requireAuth, (req, res) => {
  const c = db.prepare('SELECT * FROM comments WHERE id=? AND deleted_at IS NULL').get(req.params.cid);
  if (!c) return res.status(404).json({ error: '댓글을 찾을 수 없습니다.' });
  if (c.author_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: '삭제 권한이 없습니다.' });
  }
  logAudit('comment', c.id, 'delete', c.content, req.user.id);
  db.prepare("UPDATE comments SET deleted_at=datetime('now') WHERE id=?").run(c.id);
  res.json({ ok: true });
});

export default router;
