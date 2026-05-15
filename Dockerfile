################################
# CoRA — 단일 컨테이너 배포
# Node :3000 (웹/API Gateway) + FastAPI :8000 (AI Engine)
# 빌드: docker build -t cora .
# 실행: docker run -p 3000:3000 --env-file .env cora
################################

FROM node:22-slim

# Python 환경 설치
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv \
    && rm -rf /var/lib/apt/lists/*

# Python 가상환경 + 의존성
RUN python3 -m venv /venv
COPY requirements.txt /tmp/requirements.txt
RUN /venv/bin/pip install --no-cache-dir -r /tmp/requirements.txt

# 작업 디렉토리
WORKDIR /app

# Node 의존성 (웹사이트/package.json)
COPY 웹사이트/package*.json ./웹사이트/
RUN cd 웹사이트 && npm install --omit=dev

# 소스 전체 복사
COPY . .

ENV NODE_ENV=production
ENV HOST=0.0.0.0
EXPOSE 3000

CMD ["/app/start.sh"]
