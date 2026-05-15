#!/bin/sh
# CoRA 시작 스크립트
# 기동 순서:
#   ① Node :3000 백그라운드 → Render health check 즉시 통과
#   ② 첫 배포 시 벡터DB 자동 생성 (~3-5분, VOYAGE_API_KEY 필요)
#   ③ FastAPI :8000 백그라운드 시작
#   ④ wait — 컨테이너 생존 유지

PYTHON=/venv/bin/python

# ─────────────────────────────────────────────
# ① Node 먼저 시작 (Render health check 통과용)
# ─────────────────────────────────────────────
echo "[CoRA] Node Gateway 시작 (포트 3000)..."
cd /app/웹사이트 && node backend/server.js &

# ─────────────────────────────────────────────
# ② 벡터DB 없으면 자동 생성
# ─────────────────────────────────────────────
VECTORDB_PATH=/app/cora_vectordb/chroma.sqlite3

if [ ! -f "$VECTORDB_PATH" ]; then
    if [ -z "$VOYAGE_API_KEY" ]; then
        echo "[CoRA] ⚠️  VOYAGE_API_KEY 없음 — 벡터DB 생성 건너뜀"
        echo "[CoRA]     의미 검색(vector search) 비활성. 키워드 검색만 동작합니다."
    else
        echo "[CoRA] 첫 배포 감지 — 벡터DB 생성 시작 (약 3-5분 소요)..."
        echo "[CoRA] 챗봇은 완료 후 완전 동작합니다."
        cd /app && $PYTHON build_vectordb.py \
            && echo "[CoRA] 벡터DB 생성 완료" \
            || echo "[CoRA] ⚠️  벡터DB 생성 실패 — 키워드 검색 모드로 계속 실행"
    fi
else
    COUNT=$(cd /app && $PYTHON -c \
        "import chromadb; c=chromadb.PersistentClient(path='cora_vectordb'); print(c.get_collection('courses').count())" \
        2>/dev/null || echo "?")
    echo "[CoRA] 기존 벡터DB 사용 (${COUNT}개 과목)"
fi

# ─────────────────────────────────────────────
# ③ FastAPI AI Engine 시작
# ─────────────────────────────────────────────
echo "[CoRA] FastAPI AI Engine 시작 (포트 8000)..."
cd /app && $PYTHON -m uvicorn cora_api:app --host 127.0.0.1 --port 8000 &

# FastAPI 준비 대기 (최대 60초)
WAIT=0
until curl -sf http://127.0.0.1:8000/health > /dev/null 2>&1; do
    WAIT=$((WAIT+1))
    if [ $WAIT -ge 60 ]; then
        echo "[CoRA] ⚠️  FastAPI 준비 타임아웃 — Render 로그를 확인하세요"
        break
    fi
    sleep 1
done

echo "[CoRA] 전체 서비스 준비 완료"

# ─────────────────────────────────────────────
# ④ 컨테이너 생존 (모든 백그라운드 프로세스 대기)
# ─────────────────────────────────────────────
wait
