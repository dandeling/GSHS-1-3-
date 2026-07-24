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

-- 오늘의 급식 (관리자 관리)
CREATE TABLE IF NOT EXISTS meals (
  meal_date   TEXT PRIMARY KEY,            -- YYYY-MM-DD
  content     TEXT NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_posts_board ON posts(board, subject, category);
CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_likes_post ON likes(post_id);
`);

// ---- 마이그레이션: posts.tag 컬럼 (기존 DB 대비) ----
const postCols = db.prepare("PRAGMA table_info(posts)").all().map((c) => c.name);
if (!postCols.includes('tag')) {
  db.exec("ALTER TABLE posts ADD COLUMN tag TEXT");
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
