import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';

import { cleanupOldTraces } from './src/db.js';
import { SUBJECTS, CATEGORIES, TAGS } from './src/constants.js';
import authRouter from './src/routes/auth.js';
import postsRouter from './src/routes/posts.js';
import chatRouter from './src/routes/chat.js';
import calendarRouter from './src/routes/calendar.js';
import adminRouter from './src/routes/admin.js';
import homeRouter from './src/routes/home.js';
import usersRouter from './src/routes/users.js';
import notificationsRouter from './src/routes/notifications.js';
import dmRouter from './src/routes/dm.js';
import inquiriesRouter from './src/routes/inquiries.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// 메타 정보 (과목/분류/말머리 목록) — 프론트에서 사용
app.get('/api/meta', (req, res) => {
  res.json({ subjects: SUBJECTS, categories: CATEGORIES, tags: TAGS });
});

// API 라우트
app.use('/api/auth', authRouter);
app.use('/api/home', homeRouter);
app.use('/api/posts', postsRouter);
app.use('/api/users', usersRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/dm', dmRouter);
app.use('/api/inquiries', inquiriesRouter);
app.use('/api/chat', chatRouter);
app.use('/api/calendar', calendarRouter);
app.use('/api/admin', adminRouter);

// 정적 파일
app.use(express.static(path.join(__dirname, 'public')));

// 헬스체크
app.get('/healthz', (req, res) => res.json({ ok: true }));

// 흔적 3개월 정리: 시작 시 1회 + 하루 1회
cleanupOldTraces();
setInterval(cleanupOldTraces, 24 * 3600 * 1000);

app.listen(PORT, () => {
  console.log(`[server] GSHS 1-3 커뮤니티 실행 중 → http://localhost:${PORT}`);
});
