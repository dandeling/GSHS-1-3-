# 📧 이메일 인증 연결 가이드 (Gmail / Naver)

이 사이트는 **환경변수만 넣으면** 회원가입·비밀번호 재설정이 자동으로
"이메일 인증코드" 방식으로 바뀝니다. (안 넣으면 실명 본인확인 방식으로 동작)

지원: **Gmail**, **Naver** 두 가지.

> ⚠️ 핵심: 이메일 계정의 **일반 로그인 비밀번호가 아니라 "앱 비밀번호"**가 필요합니다.

---

## 방법 A. Gmail 로 연결 (추천)

### 1) 2단계 인증 켜기
- [myaccount.google.com/security](https://myaccount.google.com/security) 접속
- **2단계 인증(2-Step Verification)** 을 **사용**으로 설정
  (2단계 인증을 켜야 앱 비밀번호를 만들 수 있어요)

### 2) 앱 비밀번호 발급
- [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) 접속
- 앱 이름 아무거나 입력 (예: `1-3반 커뮤니티`) → **만들기**
- 나오는 **16자리 비밀번호**(예: `abcd efgh ijkl mnop`)를 복사
  → 띄어쓰기는 빼고 `abcdefghijklmnop` 로 사용

### 3) 환경변수 설정
```
MAIL_PROVIDER=gmail
MAIL_USER=내계정@gmail.com
MAIL_PASS=abcdefghijklmnop        # 위에서 발급한 16자리 앱 비밀번호
MAIL_FROM=1-3반 커뮤니티
```

---

## 방법 B. Naver 로 연결

### 1) 네이버 메일에서 SMTP 사용 설정
- 네이버 메일 → **환경설정** → **POP3/IMAP 설정**
- **IMAP/SMTP 사용**을 **사용함**으로 설정 후 저장

### 2) 앱 비밀번호 발급
- 네이버 **내정보 → 보안 → 2단계 인증**을 켠 뒤
- **애플리케이션 비밀번호 관리**에서 새 비밀번호 발급 → 복사

### 3) 환경변수 설정
```
MAIL_PROVIDER=naver
MAIL_USER=내아이디@naver.com
MAIL_PASS=발급받은_앱비밀번호
MAIL_FROM=1-3반 커뮤니티
```

---

## 배포 플랫폼별 환경변수 넣는 곳

| 배포 방법 | 환경변수 넣는 곳 |
|-----------|------------------|
| **Render** | 서비스 → Environment → Add Environment Variable |
| **Docker** | `docker run -e MAIL_PROVIDER=gmail -e MAIL_USER=... -e MAIL_PASS=...` |
| **Replit** | 왼쪽 **Secrets(🔒)** 메뉴에 하나씩 추가 |
| **로컬 테스트** | 프로젝트 루트에 `.env` 만들고 값 채우기 |

> 예) Render에서: `MAIL_PROVIDER` = `gmail`, `MAIL_USER` = `myid@gmail.com`,
> `MAIL_PASS` = 앱비밀번호 를 각각 추가하고 재배포하면 끝.

---

## 동작 방식

- **환경변수 있음** → 회원가입 시 이메일로 6자리 코드 발송 → 코드 입력해야 가입.
  비밀번호 재설정도 이메일 코드로 본인확인.
- **환경변수 없음** → 코드 발송 없이, 실명 본인확인 방식으로 자동 동작.

## 자주 겪는 문제

- **`Invalid login` / 인증 실패** → 일반 비번을 넣은 경우입니다. 꼭 **앱 비밀번호**를 넣으세요.
- **메일이 안 와요** → 스팸함 확인. 그래도 없으면 `MAIL_USER`/`MAIL_PASS` 오타 확인.
- **하루 발송 한도** → Gmail·Naver는 하루 약 500통. 반 단위 사용엔 충분합니다.
- **학교 이메일(@g.gne.go.kr)로 보낼 수 있나요?** → 받는 건 아무 주소나 가능해요.
  보내는 계정만 Gmail/Naver면 됩니다.
