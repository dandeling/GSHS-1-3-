import express from 'express';
import db, { logAudit, addPoint, notify, notifyMentions } from '../db.js';
import { requireAuth, addDemerit } from '../middleware.js';
import { countBadwords } from '../badwords.js';
import { BOARDS, SUBJECT_CODES, CATEGORY_CODES, TAG_CODES } from '../constants.js';

const REACTIONS = ['👍', '😂', '😮', '😢', '🔥', '👏'];
const MAX_ATTACH = 4_500_000; // data URL 문자열 최대 길이(약 3MB 파일)

const router = express.Router();
const PAGE_SIZE = 20;

// 첨부 검증: data URL(이미지/문서)만 허용, 크기 제한
function validAttachment(att) {
  if (!att) return null;
  const s = String(att);
  if (!/^data:[\w.+/-]+;base64,/.test(s)) return 'invalid';
  if (s.length > MAX_ATTACH) return 'toobig';
  return 'ok';
}

// 목록 조회 (페이지 나눔 + 검색 + 정렬 + 말머리)
router.get('/', requireAuth, async (req, res) => {
  const board = req.query.board;
  const feed = !board || board === 'all';
  if (!feed && !BOARDS.includes(board)) return res.status(400).json({ error: '게시판을 확인하세요.' });
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const offset = (page - 1) * PAGE_SIZE;

  const where = ['p.deleted_at IS NULL'];
  const params = [];
  if (feed) { where.push("p.board IN ('notice','free')"); }
  else { where.push('p.board = ?'); params.push(board); }
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
  if (req.query.tag) {
    if (!TAG_CODES.includes(req.query.tag)) return res.status(400).json({ error: '말머리를 확인하세요.' });
    where.push('p.tag = ?'); params.push(req.query.tag);
  }
  if (req.query.q && req.query.q.trim()) {
    where.push('(p.title LIKE ? OR p.content LIKE ?)');
    const kw = `%${req.query.q.trim()}%`; params.push(kw, kw);
  }
  const whereSql = where.join(' AND ');
  const sort = req.query.sort === 'popular'
    ? `(SELECT COUNT(*) FROM likes l WHERE l.post_id=p.id) * 5 + p.views + (SELECT COUNT(*) FROM comments c WHERE c.post_id=p.id AND c.deleted_at IS NULL) * 3 DESC, p.id DESC`
    : `p.board = 'notice' DESC, p.id DESC`;

  const total = (await db.prepare(`SELECT COUNT(*) c FROM posts p WHERE ${whereSql}`).get(...params)).c;
  const rows = await db.prepare(`
    SELECT p.id, p.board, p.tag, p.subject, p.category, p.title, p.views, p.created_at, p.updated_at,
           (p.attachment IS NOT NULL) AS has_attach,
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

// 단건 조회 (조회수 +1) + 댓글 + 투표 + 반응
router.get('/:id', requireAuth, async (req, res) => {
  const post = await db.prepare(`
    SELECT p.*, u.username AS author, u.point AS author_point, u.role AS author_role
    FROM posts p JOIN users u ON u.id = p.author_id
    WHERE p.id = ? AND p.deleted_at IS NULL
  `).get(req.params.id);
  if (!post) return res.status(404).json({ error: '글을 찾을 수 없습니다.' });

  await db.prepare('UPDATE posts SET views = views + 1 WHERE id = ?').run(post.id);
  post.views += 1;

  const comments = await db.prepare(`
    SELECT c.id, c.content, c.created_at, c.author_id, c.parent_id, u.username AS author, u.point AS author_point, u.role AS author_role
    FROM comments c JOIN users u ON u.id = c.author_id
    WHERE c.post_id = ? AND c.deleted_at IS NULL
    ORDER BY c.id ASC
  `).all(post.id);

  post.like_count = (await db.prepare('SELECT COUNT(*) c FROM likes WHERE post_id=?').get(post.id)).c;
  post.liked = !!(await db.prepare('SELECT 1 FROM likes WHERE post_id=? AND user_id=?').get(post.id, req.user.id));

  res.json({ post, comments, poll: await loadPoll(post.id, req.user.id), reactions: await loadReactions(post.id, req.user.id), me: { id: req.user.id, role: req.user.role } });
});

// 이모지 반응 요약
async function loadReactions(postId, userId) {
  const counts = await db.prepare('SELECT emoji, COUNT(*) c FROM reactions WHERE post_id=? GROUP BY emoji').all(postId);
  const map = {}; counts.forEach((r) => { map[r.emoji] = r.c; });
  const mine = await db.prepare('SELECT emoji FROM reactions WHERE post_id=? AND user_id=?').get(postId, userId);
  return { emojis: REACTIONS, counts: map, mine: mine?.emoji || null };
}

// 이모지 반응 (같은 이모지 누르면 취소, 다른 이모지면 변경)
router.post('/:id/react', requireAuth, async (req, res) => {
  const post = await db.prepare('SELECT id FROM posts WHERE id=? AND deleted_at IS NULL').get(req.params.id);
  if (!post) return res.status(404).json({ error: '글을 찾을 수 없습니다.' });
  const { emoji } = req.body || {};
  if (!REACTIONS.includes(emoji)) return res.status(400).json({ error: '지원하지 않는 반응입니다.' });
  const cur = await db.prepare('SELECT emoji FROM reactions WHERE post_id=? AND user_id=?').get(post.id, req.user.id);
  if (cur && cur.emoji === emoji) {
    await db.prepare('DELETE FROM reactions WHERE post_id=? AND user_id=?').run(post.id, req.user.id);
  } else {
    await db.prepare(`INSERT INTO reactions (post_id, user_id, emoji) VALUES (?, ?, ?)
      ON CONFLICT(post_id, user_id) DO UPDATE SET emoji=excluded.emoji`).run(post.id, req.user.id, emoji);
  }
  res.json({ ok: true, reactions: await loadReactions(post.id, req.user.id) });
});

// 게시글의 투표 정보 로드 (없으면 null)
async function loadPoll(postId, userId) {
  const poll = await db.prepare('SELECT * FROM polls WHERE post_id=?').get(postId);
  if (!poll) return null;
  const options = await db.prepare(`
    SELECT o.id, o.text, (SELECT COUNT(*) FROM poll_votes v WHERE v.option_id=o.id) AS votes
    FROM poll_options o WHERE o.poll_id=? ORDER BY o.idx ASC
  `).all(poll.id);
  const myVote = await db.prepare('SELECT option_id FROM poll_votes WHERE poll_id=? AND user_id=?').get(poll.id, userId);
  const total = options.reduce((s, o) => s + o.votes, 0);
  return { id: poll.id, question: poll.question, options, total, myOption: myVote?.option_id || null };
}

// 투표하기 (1인 1표, 변경 가능)
router.post('/:id/poll/vote', requireAuth, async (req, res) => {
  const poll = await db.prepare('SELECT p.* FROM polls p JOIN posts po ON po.id=p.post_id WHERE p.post_id=? AND po.deleted_at IS NULL').get(req.params.id);
  if (!poll) return res.status(404).json({ error: '투표를 찾을 수 없습니다.' });
  const { option_id } = req.body || {};
  const opt = await db.prepare('SELECT id FROM poll_options WHERE id=? AND poll_id=?').get(option_id, poll.id);
  if (!opt) return res.status(400).json({ error: '선택지를 확인하세요.' });
  await db.prepare(`INSERT INTO poll_votes (poll_id, user_id, option_id) VALUES (?, ?, ?)
    ON CONFLICT(poll_id, user_id) DO UPDATE SET option_id=excluded.option_id`).run(poll.id, req.user.id, option_id);
  res.json({ ok: true, poll: await loadPoll(poll.post_id, req.user.id) });
});

// 좋아요 토글
router.post('/:id/like', requireAuth, async (req, res) => {
  const post = await db.prepare('SELECT id, author_id FROM posts WHERE id=? AND deleted_at IS NULL').get(req.params.id);
  if (!post) return res.status(404).json({ error: '글을 찾을 수 없습니다.' });
  const liked = await db.prepare('SELECT 1 FROM likes WHERE post_id=? AND user_id=?').get(post.id, req.user.id);
  if (liked) {
    await db.prepare('DELETE FROM likes WHERE post_id=? AND user_id=?').run(post.id, req.user.id);
    if (post.author_id !== req.user.id) await addPoint(post.author_id, -1);
  } else {
    await db.prepare('INSERT INTO likes (post_id, user_id) VALUES (?, ?)').run(post.id, req.user.id);
    if (post.author_id !== req.user.id) { await addPoint(post.author_id, 1); await notify(post.author_id, req.user.id, 'like', post.id, '회원님의 글을 좋아합니다 ❤'); }
  }
  const count = (await db.prepare('SELECT COUNT(*) c FROM likes WHERE post_id=?').get(post.id)).c;
  res.json({ ok: true, liked: !liked, like_count: count });
});

// 글 작성
router.post('/', requireAuth, async (req, res) => {
  const { board, subject, category, tag, title, content, attachment, attachment_name } = req.body || {};
  if (!BOARDS.includes(board)) return res.status(400).json({ error: '게시판을 확인하세요.' });
  if (board === 'notice' && req.user.role !== 'admin') return res.status(403).json({ error: '공지사항은 관리자만 작성할 수 있습니다.' });
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

  // 첨부 검증
  let att = null, attName = null;
  const v = validAttachment(attachment);
  if (v === 'invalid') return res.status(400).json({ error: '첨부 파일 형식을 확인하세요.' });
  if (v === 'toobig') return res.status(400).json({ error: '첨부 파일이 너무 커요. (약 3MB 이하)' });
  if (v === 'ok') { att = attachment; attName = String(attachment_name || '첨부파일').slice(0, 100); }

  const info = await db.prepare(`
    INSERT INTO posts (board, subject, category, tag, title, content, author_id, attachment, attachment_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(board, subj, cat, tg, title.trim(), content.trim(), req.user.id, att, attName);

  await logAudit('post', info.lastInsertRowid, 'create', JSON.stringify({ title, content }), req.user.id);
  await addPoint(req.user.id, 5);
  await notifyMentions(content, req.user.id, info.lastInsertRowid);

  const poll = req.body?.poll;
  if (board === 'free' && poll && poll.question?.trim() && Array.isArray(poll.options)) {
    const opts = poll.options.map((o) => String(o).trim()).filter(Boolean).slice(0, 8);
    if (opts.length >= 2) {
      const pinfo = await db.prepare('INSERT INTO polls (post_id, question) VALUES (?, ?)').run(info.lastInsertRowid, poll.question.trim());
      for (let i = 0; i < opts.length; i++) await db.prepare('INSERT INTO poll_options (poll_id, idx, text) VALUES (?, ?, ?)').run(pinfo.lastInsertRowid, i, opts[i]);
    }
  }
  res.json({ ok: true, id: info.lastInsertRowid });
});

// 글 수정 (작성자 또는 관리자)
router.put('/:id', requireAuth, async (req, res) => {
  const post = await db.prepare('SELECT * FROM posts WHERE id=? AND deleted_at IS NULL').get(req.params.id);
  if (!post) return res.status(404).json({ error: '글을 찾을 수 없습니다.' });
  if (post.author_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: '수정 권한이 없습니다.' });
  const { title, content, tag } = req.body || {};
  if (!title?.trim() || !content?.trim()) return res.status(400).json({ error: '제목과 내용을 입력하세요.' });
  let tg = post.tag;
  if (post.board === 'free' && tag) {
    if (!TAG_CODES.includes(tag)) return res.status(400).json({ error: '말머리를 확인하세요.' });
    tg = tag;
  }
  await logAudit('post', post.id, 'update', JSON.stringify({ title: post.title, content: post.content }), req.user.id);
  await db.prepare("UPDATE posts SET title=?, content=?, tag=?, updated_at=datetime('now') WHERE id=?")
    .run(title.trim(), content.trim(), tg, post.id);
  res.json({ ok: true });
});

// 글 삭제 (소프트 삭제, 작성자/관리자)
router.delete('/:id', requireAuth, async (req, res) => {
  const post = await db.prepare('SELECT * FROM posts WHERE id=? AND deleted_at IS NULL').get(req.params.id);
  if (!post) return res.status(404).json({ error: '글을 찾을 수 없습니다.' });
  if (post.author_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: '삭제 권한이 없습니다.' });
  await logAudit('post', post.id, 'delete', JSON.stringify({ title: post.title, content: post.content }), req.user.id);
  await db.prepare("UPDATE posts SET deleted_at=datetime('now') WHERE id=?").run(post.id);
  res.json({ ok: true });
});

// 흔적 보기 (수정·삭제 이력) — 관리자만
router.get('/:id/trace', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: '관리자만 흔적을 볼 수 있습니다.' });
  const logs = await db.prepare(`
    SELECT a.id, a.action, a.snapshot, a.created_at, u.username AS actor
    FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
    WHERE a.entity_type='post' AND a.entity_id=?
    ORDER BY a.id ASC
  `).all(req.params.id);
  res.json({ logs });
});

// ---- 댓글 ----
router.post('/:id/comments', requireAuth, async (req, res) => {
  const post = await db.prepare('SELECT id FROM posts WHERE id=? AND deleted_at IS NULL').get(req.params.id);
  if (!post) return res.status(404).json({ error: '글을 찾을 수 없습니다.' });
  const { content, parent_id } = req.body || {};
  if (!content?.trim()) return res.status(400).json({ error: '댓글 내용을 입력하세요.' });

  let parent = null;
  if (parent_id) {
    const pc = await db.prepare('SELECT id, post_id, parent_id FROM comments WHERE id=? AND deleted_at IS NULL').get(parent_id);
    if (!pc || pc.post_id !== post.id) return res.status(400).json({ error: '원 댓글을 찾을 수 없습니다.' });
    parent = pc.parent_id || pc.id;
  }

  let penalty = null;
  if (countBadwords(content) > 0) {
    const after = await addDemerit(req.user.id);
    penalty = { demerit: after.demerit, status: after.status };
  }

  const info = await db.prepare('INSERT INTO comments (post_id, author_id, content, parent_id) VALUES (?, ?, ?, ?)')
    .run(post.id, req.user.id, content.trim(), parent);
  await logAudit('comment', info.lastInsertRowid, 'create', content, req.user.id);
  await addPoint(req.user.id, 2);

  const postRow = await db.prepare('SELECT author_id, title FROM posts WHERE id=?').get(post.id);
  await notify(postRow.author_id, req.user.id, 'comment', post.id, `내 글에 댓글: "${content.slice(0, 40)}"`);
  if (parent) {
    const pc = await db.prepare('SELECT author_id FROM comments WHERE id=?').get(parent);
    if (pc) await notify(pc.author_id, req.user.id, 'reply', post.id, `내 댓글에 답글: "${content.slice(0, 40)}"`);
  }
  await notifyMentions(content, req.user.id, post.id);
  res.json({ ok: true, id: info.lastInsertRowid, penalty });
});

router.delete('/comments/:cid', requireAuth, async (req, res) => {
  const c = await db.prepare('SELECT * FROM comments WHERE id=? AND deleted_at IS NULL').get(req.params.cid);
  if (!c) return res.status(404).json({ error: '댓글을 찾을 수 없습니다.' });
  if (c.author_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: '삭제 권한이 없습니다.' });
  await logAudit('comment', c.id, 'delete', c.content, req.user.id);
  await db.prepare("UPDATE comments SET deleted_at=datetime('now') WHERE id=?").run(c.id);
  res.json({ ok: true });
});

export default router;
