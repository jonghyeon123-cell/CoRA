"""
CoRA API 서버 - FastAPI
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
실행: uvicorn cora_api:app --host 0.0.0.0 --port 8000
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import uuid

from cora_chat import hybrid_search, ask_claude, extract_recommendations_from_context, sanitize_conversation_history

app = FastAPI(title="CoRA API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# 세션별 상태: {session_id: {"history": [], "last_context": ""}}
sessions: dict[str, dict] = {}


class ChatRequest(BaseModel):
    message: str
    history: list = []
    session_id: Optional[str] = None


class RecommendationItem(BaseModel):
    courseId: str
    courseName: str
    reason: str
    percentage: Optional[float] = None
    prerequisites: list[str] = []
    trackFit: Optional[str] = None
    source: str


class ChatResponse(BaseModel):
    id: str
    reply: str
    summary: str
    source: str
    session_id: str
    recommendations: list[RecommendationItem] = []


@app.post("/api/chat", response_model=ChatResponse)
async def chat(req: ChatRequest):
    session_id = req.session_id or str(uuid.uuid4())

    # 세션 없으면 초기화. req.history는 UI 전용 필드(id, createdAt 등) 포함 가능 → 반드시 sanitize
    if session_id not in sessions:
        sessions[session_id] = {
            "history": sanitize_conversation_history(req.history),
            "last_context": ""
        }

    session = sessions[session_id]
    history = session["history"]
    last_context = session["last_context"]

    context = hybrid_search(req.message)
    reply = ask_claude(req.message, context, history, last_context=last_context)

    # 세션 상태 갱신
    session["last_context"] = context

    # 구조화 추천 추출
    recommendations = extract_recommendations_from_context(context, reply)

    return ChatResponse(
        id=str(uuid.uuid4()),
        reply=reply,
        summary=reply[:100],
        source="api",
        session_id=session_id,
        recommendations=[RecommendationItem(**r) for r in recommendations]
    )


@app.get("/health")
async def health():
    return {"status": "ok", "sessions": len(sessions)}
