#!/bin/sh
# ⚠️ 이 스크립트는 웹사이트/ 서브폴더 참조용입니다.
# Render/Docker 실제 배포는 저장소 루트의 start.sh를 사용합니다.
#
# 웹사이트/ 폴더에서 Node만 로컬 실행할 때:
#   npm start
#
# Node + FastAPI 전체 로컬 실행은 CoRA 루트에서:
#   ./start.sh

echo "[CoRA] Node 서버 시작 (포트 3000)..."
cd "$(dirname "$0")" && node backend/server.js
