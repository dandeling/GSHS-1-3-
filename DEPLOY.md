# 배포 가이드 (DEPLOY.md)

우리 반 커뮤니티 사이트를 실제로 인터넷에 올리는 방법입니다.

---

## 1. 로컬에서 실행 (내 컴퓨터에서 먼저 테스트)

```bash
npm install
npm start
# 브라우저에서 http://localhost:3000 접속
```

- 기본 관리자: 아이디 `admin` / 비밀번호 `admin1234` (환경변수 `ADMIN_PASSWORD`로 변경 가능)
- 데이터는 `./data/community.db`(SQLite)에 저장됩니다.

---

## 2. Render.com 으로 배포 (추천 · 무료, 자동 업데이트)

1. 이 저장소를 GitHub에 올립니다.
2. [Render.com](https://render.com) 로그인 → **New +** → **Blueprint** 선택.
3. GitHub 저장소를 연결하면 `render.yaml`을 자동으로 읽어 설정합니다.
4. 배포 중 **환경변수** 입력:
   - `ADMIN_PASSWORD`: 관리자 비밀번호 (원하는 값)
   - `JWT_SECRET`: 자동 생성됨 (건드리지 않아도 됨)
5. **Deploy** 클릭 → 몇 분 뒤 `https://gshs-1-3-community.onrender.com` 형태 주소로 접속.

> ✅ **자동 업데이트**: `render.yaml`의 `autoDeploy: true` 덕분에, 이후 GitHub에
> `git push` 하면 사이트가 **자동으로 다시 배포**됩니다.

> ✅ **데이터 유지**: `disk`(영속 볼륨)를 `/var/data`에 마운트하고 `DATA_DIR`을
> 같은 경로로 지정하므로, 재배포해도 회원·게시글 데이터가 사라지지 않습니다.

---

## 3. Docker 로 배포 (어디서든)

```bash
# 이미지 빌드
docker build -t gshs-community .

# 실행 (데이터를 호스트의 ./data 에 영속 저장)
docker run -d -p 3000:3000 \
  -e ADMIN_PASSWORD=원하는비밀번호 \
  -e JWT_SECRET=긴임의문자열 \
  -v $(pwd)/data:/data \
  gshs-community
```

- `-v $(pwd)/data:/data`: 컨테이너를 지워도 데이터가 남습니다. (`DATA_DIR=/data`)

---

## 4. 도메인 연결 (DNS)

직접 산 도메인(예: `우리반.com`)을 연결하려면:

1. 배포 플랫폼(Render 등)에서 **Custom Domain** 메뉴에 도메인을 추가합니다.
2. 플랫폼이 알려주는 값을 도메인 등록업체(가비아·Cloudflare 등)의 DNS에 등록:
   - **CNAME** 레코드: `www` → 플랫폼이 준 주소(예: `xxxx.onrender.com`)
   - 루트 도메인은 플랫폼 안내에 따라 **A 레코드** 또는 **ALIAS/ANAME** 사용
3. DNS 전파(최대 몇 시간) 후 HTTPS 인증서가 자동 발급됩니다.

---

## 5. 환경변수 요약

| 변수 | 설명 | 기본값 |
|------|------|--------|
| `PORT` | 서버 포트 | `3000` |
| `DATA_DIR` | 데이터(SQLite) 저장 경로 | `./data` |
| `ADMIN_PASSWORD` | 기본 관리자 비밀번호 | `admin1234` |
| `JWT_SECRET` | 세션 토큰 서명 키 (**꼭 변경**) | 개발용 기본값 |
| `NODE_ENV` | `production` 시 secure 쿠키 사용 | — |

> ⚠️ 실제 배포 시 `ADMIN_PASSWORD`와 `JWT_SECRET`은 반드시 바꾸세요.
