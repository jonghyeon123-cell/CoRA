# CORA — 학생 포털

CORA(Course Recommendation Assistant)는 대학생을 위한 학생 포털 웹 애플리케이션입니다.  
수강 이력 기반 과목 추천, 진로 트랙 로드맵, 시간표, 학점계산기, AI 챗봇을 제공합니다.

## 주요 기능

- **홈 대시보드** — 이수 학점, 트랙 달성률, 통계를 한눈에 
- **로그인/회원가입** — 이메일+비밀번호 인증, 비밀번호 재설정
- **계정별 데이터 격리** — 사용자별 독립 localStorage 네임스페이스
- **학기별 이수 현황** - 전공,교양과목을 추가하여 사용자의 데이터를 쌓음
- **진로 트랙** — 학과·희망 트랙·이수 과목 기반 추천 과목 + 로드맵
- **수강 발자취** — 유사 수강 이력 학생 기반 통계적 과목 추천
- **AI 챗봇** — `/api/chat` 연결 (CoRA Python API 프록시)
- **강의평** — 과목별 평점·리뷰 등록 및 조회

## 폴더 구조

```
.
├── backend/
│   └── server.js          # Node.js HTTP 서버 (정적 파일 + REST API)
├── css/
│   └── styles.css
├── js/
│   ├── api.js             # REST 호출 레이어
│   ├── app.js             # 이벤트 핸들러 및 뷰 라우터
│   ├── components.js      # DOM 렌더링 컴포넌트
│   └── state.js           # 전역 상태 관리
├── index.html
├── roadmap.json           # 진로 트랙 로드맵 데이터
├── package.json
├── render.yaml            # Render 배포 설정
├── Dockerfile
├── start.sh               # Docker 시작 스크립트 (FastAPI + Node)
├── .env.example           # 환경변수 예시
├── DEPLOY.md              # 배포 가이드
└── README.md
```

## 설치 및 실행

### 요구사항

- Node.js 20 이상

### 로컬 실행

```bash
# 의존성 없음 (Node.js 내장 모듈만 사용)
npm start
```

브라우저에서 `http://127.0.0.1:3000` 접속.

### 환경변수 설정 (선택)

```bash
cp .env.example .env
# .env 수정 후:
node backend/server.js
```

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `PORT` | `3000` | 서버 포트 |
| `HOST` | `127.0.0.1` | 바인딩 주소 (배포 시 `0.0.0.0`) |
| `CORA_API_URL` | `http://127.0.0.1:8000` | Python FastAPI 주소 |
| `ALLOWED_ORIGIN` | `*` | CORS 허용 오리진 |

## 기술 스택

| 영역 | 기술 |
|------|------|
| 프론트엔드 | Vanilla JS (ES Modules), CSS Custom Properties |
| 백엔드 | Node.js 20+ (내장 모듈만, 외부 의존성 없음) |
| 인증 | scrypt 해시 (Node.js crypto), 파일 기반 저장 |
| 데이터 저장 | `.data/*.json` (서버), `localStorage` (클라이언트) |
| 배포 | Render / Docker |

## API 엔드포인트

| Method | Path | 설명 |
|--------|------|------|
| POST | `/api/register` | 회원가입 |
| POST | `/api/login` | 로그인 |
| POST | `/api/reset-password` | 비밀번호 재설정 (이름+이메일 인증) |
| POST | `/api/chat` | AI 챗봇 (CoRA API 프록시) |
| GET | `/api/course-footprint` | 수강 발자취 기반 추천 |

## 배포

공개 URL 배포는 [DEPLOY.md](./DEPLOY.md) 참고.

```bash
# Docker 로컬 실행
docker build -t cora .
docker run -p 3000:3000 cora
```
