// 이메일 발송 (Gmail / Naver 전용)
// 환경변수:
//   MAIL_PROVIDER : 'gmail' 또는 'naver'
//   MAIL_USER     : 보내는 계정 (예: myid@gmail.com / myid@naver.com)
//   MAIL_PASS     : 앱 비밀번호 (일반 로그인 비번 아님!)
//   MAIL_FROM     : (선택) 표시용 보낸사람 이름
import nodemailer from 'nodemailer';

const PROVIDER = (process.env.MAIL_PROVIDER || '').toLowerCase();
const USER = process.env.MAIL_USER || '';
const PASS = process.env.MAIL_PASS || '';

const PRESETS = {
  gmail: { host: 'smtp.gmail.com', port: 587, secure: false },
  naver: { host: 'smtp.naver.com', port: 587, secure: false },
};

let transporter = null;
if (PRESETS[PROVIDER] && USER && PASS) {
  transporter = nodemailer.createTransport({ ...PRESETS[PROVIDER], auth: { user: USER, pass: PASS } });
  console.log(`[mailer] 이메일 발송 준비됨 (${PROVIDER}: ${USER})`);
} else {
  console.log('[mailer] 이메일 미설정 — 실명 본인확인 방식으로 동작합니다.');
}

// 메일 발송 가능 여부
export function mailEnabled() { return !!transporter; }

// 메일 발송
export async function sendMail(to, subject, text) {
  if (!transporter) throw new Error('이메일이 설정되지 않았습니다.');
  const from = process.env.MAIL_FROM ? `"${process.env.MAIL_FROM}" <${USER}>` : `"1-3반 커뮤니티" <${USER}>`;
  await transporter.sendMail({ from, to, subject, text });
}

// 인증코드 메일
export async function sendCodeMail(to, code, purpose) {
  const label = purpose === 'reset' ? '비밀번호 재설정' : '회원가입';
  await sendMail(to, `[1-3반 커뮤니티] ${label} 인증코드`,
    `${label} 인증코드는 [ ${code} ] 입니다.\n\n10분 안에 입력해주세요.\n본인이 요청하지 않았다면 무시하세요.`);
}
