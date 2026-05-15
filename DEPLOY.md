# CoRA 배포 가이드

## 구조

CoRA는 단일 Docker 컨테이너로 배포됩니다:

- **Node.js :3000** — 웹 서버 + API Gateway (정적 파일 제공 포함)
- **FastAPI :8000** — AI 엔진 (Anthropic Claude + ChromaDB 벡터 검색)

## Render 배포 (권장)

### 1. GitHub 연결

저장소 루트(`CoRA/`)를 GitHub에 올립니다.

```bash
cd /path/to/CoRA
git init
git add .
git commit -m "init"
git remote add origin https://github.com/yourname/cora.git
git push origin main
```

### 2. Render 서비스 생성

1. [Render 대시보드](https://dashboard.render.com) → **New** → **Web Service**
2. GitHub 저장소 연결
3. 설정은 `render.yaml`이 자동 감지 (`runtime: docker`)
4. **Deploy** 클릭

### 3. 필수 환경변수 입력 (중요)

Render 대시보드 → 서비스 → **Environment** 탭에서 다음 두 값을 반드시 입력:

| 변수 | 값 | 설명 |
|------|-----|------|
| `ANTHROPIC_API_KEY` | `sk-ant-...` | Claude AI API 키 |
| `VOYAGE_API_KEY` | `pa-...` | VoyageAI 임베딩 키 |

⚠️ 이 두 값이 없으면 AI 채팅 기능이 동작하지 않습니다.

### 4. 배포 확인

- 배포 완료 → `https://cora.onrender.com` 접속
- `/health` 경로에서 FastAPI 상태 확인 가능

## Docker 로컬 실행

```bash
# 루트에서 빌드
cd /path/to/CoRA
docker build -t cora .

# 실행 (API 키 필요)
docker run -p 3000:3000 \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  -e VOYAGE_API_KEY=pa-... \
  cora
```

브라우저: `http://localhost:3000`

## Node-only 로컬 실행 (AI 기능 없음)

```bash
cd 웹사이트
npm start
```

브라우저: `http://127.0.0.1:3000`  
채팅은 Mock 응답으로 동작합니다.

## 주의사항

- `cora_data/files/` 와 `cora_data/syllabi/` 는 빌드에서 자동 제외됩니다 (`.dockerignore`)
- `cora_vectordb/` (ChromaDB) 는 빌드에 포함됩니다 (런타임 필요)
- 사용자 데이터(`웹사이트/.data/`)는 배포 서버에서 빈 상태로 시작됩니다
- Render free tier는 15분 비활성 후 슬립 → 첫 요청 지연 30-60초
