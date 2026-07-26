import { createClient } from '@libsql/client';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';

// 로컬(개발/Replit)에서는 파일 SQLite, 배포에서는 Turso(클라우드 SQLite).
//   DATABASE_URL 설정 시 → Turso 사용 (libsql://... + DATABASE_AUTH_TOKEN)
//   미설정 시           → DATA_DIR 아래 로컬 파일 사용
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
let url = process.env.DATABASE_URL;
if (!url) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  url = 'file:' + path.join(DATA_DIR, 'community.db');
}
const client = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN });
console.log(`[db] ${process.env.DATABASE_URL ? 'Turso(클라우드)' : '로컬 파일'} 연결`);

// better-sqlite3 유사 인터페이스(비동기). SQL 문법은 SQLite 그대로 유지.
function prepare(sql) {
  return {
    async get(...args) { const r = await client.execute({ sql, args }); return r.rows[0]; },
    async all(...args) { const r = await client.execute({ sql, args }); return r.rows; },
    async run(...args) { const r = await client.execute({ sql, args }); return { lastInsertRowid: Number(r.lastInsertRowid ?? 0), changes: r.rowsAffected }; },
  };
}
async function exec(sql) { await client.executeMultiple(sql); }
const db = { prepare, exec, client };

// ---- 스키마 ----
await exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE NOT NULL, username TEXT UNIQUE NOT NULL,
  realname TEXT NOT NULL, grade INTEGER NOT NULL, student_id TEXT NOT NULL, password TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user', status TEXT NOT NULL DEFAULT 'pending', demerit INTEGER NOT NULL DEFAULT 0,
  suspended_until TEXT, point INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, board TEXT NOT NULL, subject TEXT, category TEXT, tag TEXT,
  title TEXT NOT NULL, content TEXT NOT NULL, author_id INTEGER NOT NULL, views INTEGER NOT NULL DEFAULT 0,
  attachment TEXT, attachment_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT, deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, post_id INTEGER NOT NULL, author_id INTEGER NOT NULL, content TEXT NOT NULL,
  parent_id INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')), deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS chats (
  id INTEGER PRIMARY KEY AUTOINCREMENT, author_id INTEGER NOT NULL, content TEXT NOT NULL, room_id INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, description TEXT, event_date TEXT NOT NULL,
  author_id INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, entity_type TEXT NOT NULL, entity_id INTEGER NOT NULL, action TEXT NOT NULL,
  snapshot TEXT, user_id INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS likes (
  post_id INTEGER NOT NULL, user_id INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (post_id, user_id)
);
CREATE TABLE IF NOT EXISTS meals (
  meal_date TEXT PRIMARY KEY, content TEXT NOT NULL, source TEXT DEFAULT 'manual', updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS ddays (
  id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, target_date TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS attendance (
  user_id INTEGER NOT NULL, day TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (user_id, day)
);
CREATE TABLE IF NOT EXISTS chat_rooms (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, is_private INTEGER NOT NULL DEFAULT 0, password TEXT,
  created_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS room_members (
  room_id INTEGER NOT NULL, user_id INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (room_id, user_id)
);
CREATE TABLE IF NOT EXISTS polls (
  id INTEGER PRIMARY KEY AUTOINCREMENT, post_id INTEGER NOT NULL UNIQUE, question TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS poll_options (
  id INTEGER PRIMARY KEY AUTOINCREMENT, poll_id INTEGER NOT NULL, idx INTEGER NOT NULL, text TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS poll_votes (
  poll_id INTEGER NOT NULL, user_id INTEGER NOT NULL, option_id INTEGER NOT NULL, PRIMARY KEY (poll_id, user_id)
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, type TEXT NOT NULL, actor TEXT, post_id INTEGER,
  text TEXT, is_read INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS dm_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT, sender_id INTEGER NOT NULL, recipient_id INTEGER NOT NULL, content TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS reactions (
  post_id INTEGER NOT NULL, user_id INTEGER NOT NULL, emoji TEXT NOT NULL, PRIMARY KEY (post_id, user_id)
);
CREATE TABLE IF NOT EXISTS weekly_polls (
  id INTEGER PRIMARY KEY AUTOINCREMENT, question TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS weekly_poll_options (
  id INTEGER PRIMARY KEY AUTOINCREMENT, poll_id INTEGER NOT NULL, idx INTEGER NOT NULL, text TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS weekly_poll_votes (
  poll_id INTEGER NOT NULL, user_id INTEGER NOT NULL, option_id INTEGER NOT NULL, PRIMARY KEY (poll_id, user_id)
);
CREATE TABLE IF NOT EXISTS email_codes (
  email TEXT NOT NULL, purpose TEXT NOT NULL, code TEXT NOT NULL, verified INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (email, purpose)
);
CREATE TABLE IF NOT EXISTS inquiries (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL,
  answer TEXT, status TEXT NOT NULL DEFAULT 'open', is_secret INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), answered_at TEXT
);
CREATE TABLE IF NOT EXISTS rejoin_blocks (
  email TEXT PRIMARY KEY, until TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS timetable (
  day INTEGER NOT NULL, period INTEGER NOT NULL, subject TEXT NOT NULL DEFAULT '', PRIMARY KEY (day, period)
);
CREATE INDEX IF NOT EXISTS idx_posts_board ON posts(board, subject, category);
CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_likes_post ON likes(post_id);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_dm_pair ON dm_messages(sender_id, recipient_id);
`);

// 기본 채팅방 시딩
if (!(await db.prepare('SELECT id FROM chat_rooms LIMIT 1').get())) {
  await db.prepare("INSERT INTO chat_rooms (name, created_by) VALUES ('전체 채팅방', NULL)").run();
}

// 기본 관리자 계정 시딩
if (!(await db.prepare('SELECT id FROM users WHERE username=?').get('admin'))) {
  const pw = process.env.ADMIN_PASSWORD || 'admin1234';
  await db.prepare(`INSERT INTO users (email, username, realname, grade, student_id, password, role, status)
    VALUES (?, ?, ?, ?, ?, ?, 'admin', 'active')`)
    .run('admin@g.gne.go.kr', 'admin', '관리자', 0, '0000', bcrypt.hashSync(pw, 10));
  console.log('[db] 기본 관리자 계정 생성됨 (아이디: admin)');
}

// ---- 마이그레이션: posts 첨부 컬럼 (기존 DB 대비) ----
{
  const cols = (await db.prepare('PRAGMA table_info(posts)').all()).map((c) => c.name);
  if (!cols.includes('attachment')) await db.prepare('ALTER TABLE posts ADD COLUMN attachment TEXT').run();
  if (!cols.includes('attachment_name')) await db.prepare('ALTER TABLE posts ADD COLUMN attachment_name TEXT').run();
}

// 회원 익명화: 별명·실명·이메일 리셋(글은 '삭제된 사람' 표시), 원래 이메일은 1주일 재가입 제한
export async function anonymizeUser(id, label) {
  const u = await db.prepare('SELECT email FROM users WHERE id=?').get(id);
  if (u && u.email && !String(u.email).endsWith('@removed.local')) {
    await db.prepare("INSERT INTO rejoin_blocks (email, until) VALUES (?, datetime('now','+7 days')) ON CONFLICT(email) DO UPDATE SET until=datetime('now','+7 days')").run(u.email);
  }
  await db.prepare('UPDATE users SET username=?, realname=?, email=? WHERE id=?')
    .run(`${label}#${id}`, '(삭제됨)', `removed+${id}@removed.local`, id);
}

// 활동점수 증감 (0 미만 방지)
export async function addPoint(userId, n) {
  if (!userId) return;
  await db.prepare('UPDATE users SET point = MAX(0, point + ?) WHERE id = ?').run(n, userId);
}

// 알림 생성 (본인에게는 알림 X)
export async function notify(userId, actorId, type, postId, text) {
  if (!userId || userId === actorId) return;
  let actor = null;
  if (actorId) { const u = await db.prepare('SELECT username FROM users WHERE id=?').get(actorId); actor = u?.username || null; }
  await db.prepare('INSERT INTO notifications (user_id, type, actor, post_id, text) VALUES (?, ?, ?, ?, ?)')
    .run(userId, type, actor, postId ?? null, text ?? null);
}

// 본문 속 @별명 멘션 → 해당 사용자에게 알림
export async function notifyMentions(content, actorId, postId) {
  if (!content) return;
  const seen = new Set();
  for (const m of content.matchAll(/@([\w가-힣]{1,20})/g)) {
    const name = m[1];
    if (seen.has(name)) continue; seen.add(name);
    const u = await db.prepare('SELECT id FROM users WHERE username=?').get(name);
    if (u) await notify(u.id, actorId, 'mention', postId, `회원님을 언급했어요: "${content.slice(0, 40)}"`);
  }
}

// 흔적 3개월 정리
export async function cleanupOldTraces() {
  const cutoff = "datetime('now', '-3 months')";
  await exec(`
    DELETE FROM audit_logs WHERE created_at < ${cutoff};
    DELETE FROM posts    WHERE deleted_at IS NOT NULL AND deleted_at < ${cutoff};
    DELETE FROM comments WHERE deleted_at IS NOT NULL AND deleted_at < ${cutoff};
    DELETE FROM chats    WHERE deleted_at IS NOT NULL AND deleted_at < ${cutoff};
  `);
}

// 감사 로그 기록 헬퍼
export async function logAudit(entityType, entityId, action, snapshot, userId) {
  await db.prepare('INSERT INTO audit_logs (entity_type, entity_id, action, snapshot, user_id) VALUES (?, ?, ?, ?, ?)')
    .run(entityType, entityId, action, snapshot ?? null, userId ?? null);
}

export default db;
