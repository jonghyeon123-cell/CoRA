#!/bin/sh
# CoRA 시작 스크립트
# FastAPI(:8000) 백그라운드 → Node(:3000) 포어그라운드

set -e

PYTHON=/venv/bin/python

echo "[CoRA] FastAPI AI Engine 시작 (포트 8000)..."
cd /app && $PYTHON -m uvicorn cora_api:app --host 127.0.0.1 --port 8000 &
FASTAPI_PID=$!

# FastAPI 준비 대기 (최대 30초)
WAIT=0
until curl -sf http://127.0.0.1:8000/health > /dev/null 2>&1; do
    WAIT=$((WAIT+1))
    if [ $WAIT -ge 30 ]; then
        echo "[CoRA] ⚠️ FastAPI 시작 시간 초과. Node만 실행합니다."
        break
    fi
    sleep 1
done

echo "[CoRA] Node Gateway 시작 (포트 3000)..."
cd /app/웹사이트 && node backend/server.js
