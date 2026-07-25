import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';

// DATA_DIR: 배포 환경에서 영속 볼륨을 지정 (미설정 시 ./data)
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'community.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ---- 스키마 ----
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  email       TEXT UNIQUE NOT NULL,
  username    TEXT UNIQUE NOT NULL,        -- 별명 (화면 노출)
  realname    TEXT NOT NULL,               -- 실명 (관리자만 확인)
  grade       INTEGER NOT NULL,            -- 기수
  student_id  TEXT NOT NULL,               -- 학번
  password    TEXT NOT NULL,               -- bcrypt 해시
  role        TEXT NOT NULL DEFAULT 'user',   -- user | admin
  status      TEXT NOT NULL DEFAULT 'pending',-- pending|active|suspended|rejected|kicked
  demerit     INTEGER NOT NULL DEFAULT 0,
  suspended_until TEXT,                     -- ISO 문자열, 정지 해제 시각
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS posts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  board       TEXT NOT NULL,               -- notice | free | resource
  subject     TEXT,                        -- resource 게시판 과목 코드
  category    TEXT,                        -- resource: perf(수행평가) | exam(시험)
  title       TEXT NOT NULL,
  content     TEXT NOT NULL,
  author_id   INTEGER NOT NULL,
  views       INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT,
  deleted_at  TEXT,                         -- 소프트 삭제
  FOREIGN KEY (author_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS comments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id     INTEGER NOT NULL,
  author_id   INTEGER NOT NULL,
  content     TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at  TEXT,
  FOREIGN KEY (post_id) REFERENCES posts(id),
  FOREIGN KEY (author_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS chats (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id   INTEGER NOT NULL,
  content     TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at  TEXT,
  FOREIGN KEY (author_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  description TEXT,
  event_date  TEXT NOT NULL,               -- YYYY-MM-DD
  author_id   INTEGER NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (author_id) REFERENCES users(id)
);

-- 흔적(감사 로그): 작성/수정/삭제 이력 3개월 보관
CREATE TABLE IF NOT EXISTS audit_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,               -- post | comment | chat
  entity_id   INTEGER NOT NULL,
  action      TEXT NOT NULL,               -- create | update | delete
  snapshot    TEXT,                        -- 당시 내용 스냅샷
  user_id     INTEGER,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 좋아요(추천)
CREATE TABLE IF NOT EXISTS likes (
  post_id     INTEGER NOT NULL,
  user_id     INTEGER NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (post_id, user_id),
  FOREIGN KEY (post_id) REFERENCES posts(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 오늘의 급식 (관리자 관리 + NEIS 자동연동 캐시)
CREATE TABLE IF NOT EXISTS meals (
  meal_date   TEXT PRIMARY KEY,            -- YYYY-MM-DD
  content     TEXT NOT NULL,
  source      TEXT DEFAULT 'manual',       -- manual | neis
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- D-day (관리자 관리)
CREATE TABLE IF NOT EXISTS ddays (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  target_date TEXT NOT NULL,               -- YYYY-MM-DD
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 출석체크
CREATE TABLE IF NOT EXISTS attendance (
  user_id     INTEGER NOT NULL,
  day         TEXT NOT NULL,               -- YYYY-MM-DD
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, day),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 채팅방 (공개/비밀)
CREATE TABLE IF NOT EXISTS chat_rooms (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  is_private  INTEGER NOT NULL DEFAULT 0,   -- 0 공개, 1 비밀
  password    TEXT,                          -- 비밀방 입장코드(bcrypt 해시)
  created_by  INTEGER,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 비밀방 참여자 (입장코드 확인한 사람)
CREATE TABLE IF NOT EXISTS room_members (
  room_id     INTEGER NOT NULL,
  user_id     INTEGER NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (room_id, user_id)
);

-- 투표/설문 (게시글에 부착)
CREATE TABLE IF NOT EXISTS polls (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id     INTEGER NOT NULL UNIQUE,
  question    TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (post_id) REFERENCES posts(id)
);
CREATE TABLE IF NOT EXISTS poll_options (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  poll_id     INTEGER NOT NULL,
  idx         INTEGER NOT NULL,
  text        TEXT NOT NULL,
  FOREIGN KEY (poll_id) REFERENCES polls(id)
);
CREATE TABLE IF NOT EXISTS poll_votes (
  poll_id     INTEGER NOT NULL,
  user_id     INTEGER NOT NULL,
  option_id   INTEGER NOT NULL,
  PRIMARY KEY (poll_id, user_id),
  FOREIGN KEY (poll_id) REFERENCES polls(id)
);

-- 알림
CREATE TABLE IF NOT EXISTS notifications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL,            -- 받는 사람
  type        TEXT NOT NULL,               -- comment|reply|like|mention|dm
  actor       TEXT,                        -- 행위자 별명
  post_id     INTEGER,
  text        TEXT,
  is_read     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 쪽지(DM)
CREATE TABLE IF NOT EXISTS dm_messages (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_id    INTEGER NOT NULL,
  recipient_id INTEGER NOT NULL,
  content      TEXT NOT NULL,
  is_read      INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 이모지 반응 (1인 1반응)
CREATE TABLE IF NOT EXISTS reactions (
  post_id  INTEGER NOT NULL,
  user_id  INTEGER NOT NULL,
  emoji    TEXT NOT NULL,
  PRIMARY KEY (post_id, user_id)
);

-- 주간 투표 (이주의 투표) — 관리자 운영, 홈 노출
CREATE TABLE IF NOT EXISTS weekly_polls (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  question    TEXT NOT NULL,
  active      INTEGER NOT NULL DEFAULT 1,
  created_by  INTEGER,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS weekly_poll_options (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  poll_id   INTEGER NOT NULL,
  idx       INTEGER NOT NULL,
  text      TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS weekly_poll_votes (
  poll_id   INTEGER NOT NULL,
  user_id   INTEGER NOT NULL,
  option_id INTEGER NOT NULL,
  PRIMARY KEY (poll_id, user_id)
);

-- 이메일 인증코드 (register / reset)
CREATE TABLE IF NOT EXISTS email_codes (
  email       TEXT NOT NULL,
  purpose     TEXT NOT NULL,               -- register | reset
  code        TEXT NOT NULL,
  verified    INTEGER NOT NULL DEFAULT 0,
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (email, purpose)
);

-- 문의사항 (1:1 문의 → 관리자 답변)
CREATE TABLE IF NOT EXISTS inquiries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL,
  title       TEXT NOT NULL,
  content     TEXT NOT NULL,
  answer      TEXT,
  status      TEXT NOT NULL DEFAULT 'open',  -- open(답변대기) | answered(답변완료)
  is_secret   INTEGER NOT NULL DEFAULT 1,     -- 1이면 작성자·관리자만 열람
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  answered_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_posts_board ON posts(board, subject, category);
CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_likes_post ON likes(post_id);
CREATE INDEX IF NOT EXISTS idx_chats_room ON chats(id);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_dm_pair ON dm_messages(sender_id, recipient_id);
`);

// 기본 채팅방 시딩
if (!db.prepare('SELECT id FROM chat_rooms LIMIT 1').get()) {
  db.prepare("INSERT INTO chat_rooms (name, created_by) VALUES ('전체 채팅방', NULL)").run();
}

// ---- 마이그레이션: posts.tag 컬럼 (기존 DB 대비) ----
const postCols = db.prepare("PRAGMA table_info(posts)").all().map((c) => c.name);
if (!postCols.includes('tag')) {
  db.exec("ALTER TABLE posts ADD COLUMN tag TEXT");
}
// ---- 마이그레이션: users.point (네이버 카페식 활동점수/등급) ----
const userCols = db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
if (!userCols.includes('point')) {
  db.exec("ALTER TABLE users ADD COLUMN point INTEGER NOT NULL DEFAULT 0");
}
// ---- 마이그레이션: comments.parent_id (대댓글) ----
const commentCols = db.prepare("PRAGMA table_info(comments)").all().map((c) => c.name);
if (!commentCols.includes('parent_id')) {
  db.exec("ALTER TABLE comments ADD COLUMN parent_id INTEGER");
}
// ---- 마이그레이션: chats.room_id (채팅방) ----
const chatCols = db.prepare("PRAGMA table_info(chats)").all().map((c) => c.name);
if (!chatCols.includes('room_id')) {
  db.exec("ALTER TABLE chats ADD COLUMN room_id INTEGER NOT NULL DEFAULT 1");
}
// ---- 마이그레이션: meals.source ----
const mealCols = db.prepare("PRAGMA table_info(meals)").all().map((c) => c.name);
if (!mealCols.includes('source')) {
  db.exec("ALTER TABLE meals ADD COLUMN source TEXT DEFAULT 'manual'");
}
// ---- 마이그레이션: chat_rooms 비밀방 컬럼 ----
const roomCols = db.prepare("PRAGMA table_info(chat_rooms)").all().map((c) => c.name);
if (!roomCols.includes('is_private')) db.exec("ALTER TABLE chat_rooms ADD COLUMN is_private INTEGER NOT NULL DEFAULT 0");
if (!roomCols.includes('password')) db.exec("ALTER TABLE chat_rooms ADD COLUMN password TEXT");

// 활동점수 증감 (0 미만 방지). 관리자는 등급 미적용이라 점수만 쌓아도 무방.
export function addPoint(userId, n) {
  if (!userId) return;
  db.prepare('UPDATE users SET point = MAX(0, point + ?) WHERE id = ?').run(n, userId);
}

// 알림 생성 (본인에게는 알림 X)
export function notify(userId, actorId, type, postId, text) {
  if (!userId || userId === actorId) return;
  const actor = actorId ? (db.prepare('SELECT username FROM users WHERE id=?').get(actorId)?.username || null) : null;
  db.prepare('INSERT INTO notifications (user_id, type, actor, post_id, text) VALUES (?, ?, ?, ?, ?)')
    .run(userId, type, actor, postId ?? null, text ?? null);
}

// 본문 속 @별명 멘션 → 해당 사용자에게 알림
export function notifyMentions(content, actorId, postId) {
  if (!content) return;
  const seen = new Set();
  for (const m of content.matchAll(/@([\w가-힣]{1,20})/g)) {
    const name = m[1];
    if (seen.has(name)) continue; seen.add(name);
    const u = db.prepare('SELECT id FROM users WHERE username=?').get(name);
    if (u) notify(u.id, actorId, 'mention', postId, `회원님을 언급했어요: "${content.slice(0, 40)}"`);
  }
}

// ---- 기본 관리자 계정 시딩 ----
function seedAdmin() {
  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
  if (exists) return;
  const pw = process.env.ADMIN_PASSWORD || 'admin1234';
  const hash = bcrypt.hashSync(pw, 10);
  db.prepare(`
    INSERT INTO users (email, username, realname, grade, student_id, password, role, status)
    VALUES (@email, @username, @realname, @grade, @student_id, @password, 'admin', 'active')
  `).run({
    email: 'admin@g.gne.go.kr',
    username: 'admin',
    realname: '관리자',
    grade: 0,
    student_id: '0000',
    password: hash,
  });
  console.log('[db] 기본 관리자 계정 생성됨 (아이디: admin)');
}
seedAdmin();

// ---- 흔적 3개월 정리: 3개월 지난 소프트삭제/로그 영구 제거 ----
export function cleanupOldTraces() {
  const cutoff = "datetime('now', '-3 months')";
  db.exec(`DELETE FROM audit_logs WHERE created_at < ${cutoff};`);
  db.exec(`DELETE FROM posts    WHERE deleted_at IS NOT NULL AND deleted_at < ${cutoff};`);
  db.exec(`DELETE FROM comments WHERE deleted_at IS NOT NULL AND deleted_at < ${cutoff};`);
  db.exec(`DELETE FROM chats    WHERE deleted_at IS NOT NULL AND deleted_at < ${cutoff};`);
}

// 감사 로그 기록 헬퍼
export function logAudit(entityType, entityId, action, snapshot, userId) {
  db.prepare(`
    INSERT INTO audit_logs (entity_type, entity_id, action, snapshot, user_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(entityType, entityId, action, snapshot ?? null, userId ?? null);
}

export default db;
