FROM node:22-slim

# Python 설치 (Debian slim 기반)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Node 의존성
COPY package*.json ./
RUN npm install --omit=dev

# Python 의존성 (CoRA 루트의 requirements 없으므로 직접 명시)
RUN python3 -m venv /venv
RUN /venv/bin/pip install --no-cache-dir \
    fastapi uvicorn anthropic chromadb voyageai python-dotenv pydantic

# 전체 복사 (웹사이트 폴더 + 상위 Python 파일)
COPY . .

ENV NODE_ENV=production
ENV HOST=0.0.0.0
EXPOSE 3000

# 시작 스크립트: FastAPI(:8000) 백그라운드 → Node(:3000) 포어그라운드
COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh
CMD ["/app/start.sh"]
