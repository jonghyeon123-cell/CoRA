"""
CoRA 챗봇 - Claude API + 하이브리드 검색 (벡터 + 키워드)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
실행 전:
  pip install anthropic chromadb voyageai python-dotenv --break-system-packages
  cp .env.example .env  # .env에 키 입력
사용법: python3 cora_chat.py
"""

import anthropic
import chromadb
import voyageai
import json
import re
import os
from dotenv import load_dotenv
import time



# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# ① 설정
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
load_dotenv()

def _require_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(
            f"환경변수 {name}이(가) 없습니다.\n"
            f".env 파일에 {name}=... 를 추가하세요."
        )
    return value

ANTHROPIC_API_KEY = _require_env("ANTHROPIC_API_KEY")
VOYAGE_API_KEY    = _require_env("VOYAGE_API_KEY")

VECTOR_DB_DIR = "cora_vectordb"
COURSES_FILE = "cora_data/courses.json"
SYLLABI_FILE = "cora_data/syllabi.json"
SUMMARIES_FILE = "cora_data/course_summaries.json"

MAX_COURSES = 50       # 검색 결과 최대 개수
MAX_HISTORY_TURNS = 10 # 대화 히스토리 유지 턴 수

# 데이터 로드
with open(COURSES_FILE, "r", encoding="utf-8") as f:
    ALL_COURSES = json.load(f)

with open(SYLLABI_FILE, "r", encoding="utf-8") as f:
    ALL_SYLLABI = json.load(f)

# 요약본 로드
SUMMARIES = {}
if os.path.exists(SUMMARIES_FILE):
    with open(SUMMARIES_FILE, "r", encoding="utf-8") as f:
        SUMMARIES = json.load(f)
    print(f"📋 요약본 로드: {len(SUMMARIES)}개")
else:
    print("⚠️ course_summaries.json 없음. summarize_courses.py를 먼저 실행하세요.")

FILE_TEXTS = {}
if os.path.exists("cora_data/file_texts.json"):
    with open("cora_data/file_texts.json", "r", encoding="utf-8") as f:
        FILE_TEXTS = json.load(f)

HWP_TEXTS = {}
if os.path.exists("cora_data/hwp_texts.json"):
    with open("cora_data/hwp_texts.json", "r", encoding="utf-8") as f:
        HWP_TEXTS = json.load(f)

# 빠른 검색을 위한 인덱스 생성
SYLLABI_INDEX = {f"{s['cour_cd']}@{s['cour_cls']}": s for s in ALL_SYLLABI}
COURSES_INDEX = {f"{c['cour_cd']}@{c['cour_cls']}": c for c in ALL_COURSES}

# 학수번호 기반 O(1) 조회 인덱스 (분반 무시)
COURSES_BY_CODE: dict = {}
for _c in ALL_COURSES:
    _cd = _c.get("cour_cd", "")
    if _cd:
        COURSES_BY_CODE.setdefault(_cd, []).append(_c)

SYSTEM_PROMPT = """당신은 고려대학교 수강신청 도우미 CoRA(Course Registration Assistant)입니다.

역할:
- 학생들의 질문에 따라 적절한 과목을 추천합니다.
- 강의계획서 정보를 바탕으로 과목의 상세 내용을 안내합니다.
- 시간표 구성, 학점 계산 등에 도움을 줍니다.

규칙:
- <검색결과> 안에 있는 과목 데이터만 근거로 답변하세요.
- 데이터에 없는 내용은 "해당 정보는 검색되지 않았습니다"라고 솔직히 말하세요.
- 과목 언급 시 반드시 [학수번호-분반] 형태로 표기하세요.
- 답변은 친근하고 간결하게 해주세요.
- 과목 추천 시 학수번호, 담당교수, 학점, 이수구분을 함께 알려주세요.
- 검색결과에 평가방식이 있으면 반드시 포함해서 답변하세요.
- 검색결과에 수업유형(대면/원격 등)이 있으면 반드시 포함해서 답변하세요.
- 검색결과에 없는 과목명, 교수명, 학수번호는 절대 언급하지 마세요.
- 확실하지 않은 정보는 추측하지 말고 반드시 "해당 정보는 찾지 못했습니다"라고 답하세요.
- 사용자가 특정 과목 이수 후 다음 과목을 물어보면, 검색결과에서 연관성 있는 과목을 추천하고 그 이유를 설명하세요.
"""


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# ② 키워드 추출
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
def extract_keywords(query):
    """질문에서 교수명, 학과명, 학수번호, 이수구분, 기술 키워드 추출"""
    keywords = {
        "prof_nm": None,
        "department": None,
        "cour_cd": None,
        "isu_nm": None,
        "tech_keywords": [],
        "cour_nm_keyword": None,
        "cour_prefix" : None,
    }

    # 학수번호 패턴
    cour_cd_match = re.search(r'[A-Z]{2,6}\d{3,4}', query)
    if cour_cd_match:
        keywords["cour_cd"] = cour_cd_match.group()
        
    # 학수번호 prefix 패턴 (예: COSE, BUSS)
    cour_prefix_match = re.search(r'\b([A-Z]{2,6})\b', query)
    if cour_prefix_match and not keywords["cour_cd"]:
        keywords["cour_prefix"] = cour_prefix_match.group(1)

    # 이수구분
    for level in ("전공필수", "전공선택", "핵심교양", "교양"):
        if level in query:
            keywords["isu_nm"] = level
            break
        
    # 프로그래밍 언어/기술 키워드
    tech_patterns = [
        "C#", "C\\+\\+", "Python", "Java", "JavaScript", "TypeScript",
        "React", "Unity", "SQL", "R언어", "MATLAB", "Swift", "Kotlin",
        "HTML", "CSS", "Node", "Django", "Flask", "Spring", "TensorFlow",
        "PyTorch", "OpenCV", "Arduino", "ROS", "Linux"
    ]
    for tech in tech_patterns:
        pattern = tech.replace("+", "\\+").replace("#", "\\#")
        if re.search(pattern, query, re.IGNORECASE):
            keywords["tech_keywords"].append(tech.replace("\\+", "+").replace("\\#", "#"))

    # 교수명 & 학과명 매칭
    for course in ALL_COURSES:
        prof = course.get("prof_nm", "")
        for name in prof.split(","):
            name = name.strip()
            if name and len(name) >= 2 and name in query:
                keywords["prof_nm"] = name
                break
        dept = course.get("department", "")
        if dept and len(dept) >= 3 and dept in query:
            keywords["department"] = dept
        if keywords["prof_nm"] and keywords["department"]:
            break

    # 과목명 매칭 (가장 긴 매치)
    best_match = ""
    for course in ALL_COURSES:
        cour_nm = course.get("cour_nm", "")
        if cour_nm and len(cour_nm) >= 3 and cour_nm in query:
            if len(cour_nm) > len(best_match):
                best_match = cour_nm
    if best_match:
        keywords["cour_nm_keyword"] = best_match

    return keywords


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# ③ 키워드 검색
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
def keyword_search(keywords):
    """교수명, 학과명, 학수번호, 주차별 기술 키워드로 검색"""
    results = []

    # 기술 키워드 검색 (주차별 학습내용에서)
    if keywords["tech_keywords"]:
        for key, syllabus in SYLLABI_INDEX.items():
            weekly_text = " ".join([w.get("content", "") for w in syllabus.get("weekly_plan", [])])

            cour_cd = key.split("@")[0]
            for fname, ftext in {**FILE_TEXTS, **HWP_TEXTS}.items():
                if cour_cd in fname:
                    weekly_text += " " + ftext

            for tech in keywords["tech_keywords"]:
                if tech.lower() in weekly_text.lower():
                    course = COURSES_INDEX.get(key)
                    if course and course not in results:
                        results.append(course)
                    break
        return results

    # 일반 키워드 검색
    for course in ALL_COURSES:
        match = True
        if keywords["prof_nm"] and keywords["prof_nm"] not in course.get("prof_nm", ""):
            match = False
        if keywords["department"] and keywords["department"] not in course.get("department", ""):
            match = False
        if keywords["cour_cd"] and keywords["cour_cd"] != course.get("cour_cd", ""):
            match = False
        if keywords["isu_nm"] and keywords["isu_nm"] != course.get("isu_nm", ""):
            match = False
        if keywords["cour_nm_keyword"] and keywords["cour_nm_keyword"] not in course.get("cour_nm", ""):
            match = False
        if keywords.get("cour_prefix") and not keywords["cour_cd"]:
            if not course.get("cour_cd", "").startswith(keywords["cour_prefix"]):
                 match = False
        if match:
            results.append(course)

    return results


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# ④ 벡터 검색
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
def vector_search(query, n_results=5):
    """벡터 DB에서 의미 기반 검색"""
    vo = voyageai.Client(api_key=VOYAGE_API_KEY)
    client = chromadb.PersistentClient(path=VECTOR_DB_DIR)
    collection = client.get_collection("courses")

    result = vo.embed([query], model="voyage-3", input_type="query")
    query_embedding = result.embeddings[0]

    results = collection.query(
        query_embeddings=[query_embedding],
        n_results=n_results
    )
    return results


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# ⑤ 하이브리드 검색 (요약본 기반)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
def format_course(course, show_weekly = False ):
    """과목 정보를 요약본 기반으로 정리 (토큰 절약)"""
    key = f"{course.get('cour_cd')}@{course.get('cour_cls')}"
    summary = SUMMARIES.get(key)

    if summary:
        # 요약본이 있으면 요약본 사용
        method = summary.get("수업방법", {})
        extra = summary.get("특이사항", {})

        text = (
            f"과목명: {summary.get('과목명', '')}\n"
            f"학수번호: {summary.get('학수번호', '')}-{summary.get('분반', '')}\n"
            f"학과: {summary.get('학과', '')}\n"
            f"교수: {summary.get('교수', '')}\n"
            f"이수구분: {summary.get('이수구분', '')}\n"
            f"학점: {summary.get('학점', '')}\n"
        )
        if summary.get("수업목표"):
            text += f"수업목표: {summary['수업목표']}\n"
        if summary.get("평가방식"):
            text += f"평가방식: {summary['평가방식']}\n"
        if method.get("수업유형"):
            text += f"수업유형: {method['수업유형']}\n"
        if method.get("수업구성요소"):
            text += f"수업구성요소: {', '.join(method['수업구성요소'])}\n"
        if method.get("특별유형"):
            text += f"특별유형: {', '.join(method['특별유형'])}\n"
        if extra.get("선수과목"):
            text += f"선수과목: {extra['선수과목']}\n"
        if extra.get("강의언어") != "한국어":
            text += f"강의언어: {extra['강의언어']}\n"
        if extra.get("프로젝트기반"):
            text += "프로젝트 기반 수업\n"
        if show_weekly:
          syllabus = SYLLABI_INDEX.get(key)
          if syllabus and syllabus.get('weekly_plan'):
               valid_weeks = [w for w in syllabus['weekly_plan']
                      if w.get('content', '').replace('|', '').strip()
                      and len(w.get('content', '').replace('|', '').strip()) > 5
                      and '주:' not in w.get('content', '')]  # "Leçon 1" 같은 의미없는 내용 제외
               if len(valid_weeks) >= 10:  # 5주 이상 내cd용 있을 때만 표시
                  text += "주차별 학습내용:\n"
                  for w in valid_weeks:
                     content = w['content'].replace('|', '').strip()
                     text += f"  {w['week']}주: {content}\n"
               else:
                   text += "(주차별 상세 내용은 강의계획서 첨부문서를 확인해주세요)\n"

        return text
    else:
        # 요약본 없으면 기본 정보만
        return (
            f"과목명: {course.get('cour_nm', '')}\n"
            f"학수번호: {course.get('cour_cd', '')}-{course.get('cour_cls', '')}\n"
            f"학과: {course.get('department', '')}\n"
            f"교수: {course.get('prof_nm', '')}\n"
            f"이수구분: {course.get('isu_nm', '')}\n"
            f"학점: {course.get('credit', '')}\n"
        )
    
def rewrite_query(query):
    """후속 과목 질문을 검색 가능한 키워드로 변환"""
    if not any(kw in query for kw in ["다음", "이후", "연계", "심화", "이어서","다음에","다음 학기에","이후에","연계해서"]):
        return query
    
    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    response = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=100,
        messages=[{
            "role": "user",
            "content": f"""다음 질문에서 검색해야 할 후속/연관 과목 키워드만 추출해줘.
예시: "자료구조 다음에 뭐 들어야 해?" → "알고리즘 운영체제"
예시: "선형대수 이후 과목 추천해줘" → "머신러닝 딥러닝"
질문: {query}
키워드만 짧게 답해줘."""
        }]
    )
    return response.content[0].text.strip()    


def normalize_course_code(code: str) -> str:
    """COSE362@00 / COSE362-00 → COSE362"""
    return re.split(r'[@\-]', code.strip())[0].upper()


def extract_course_codes_from_query(query: str) -> list:
    """쿼리에서 학수번호 전부 추출 — 중복 제거, 순서 유지"""
    raw = re.findall(r'\b([A-Z]{2,6}\d{3,4})\b', query)
    seen: set = set()
    result = [c for c in raw if not (c in seen or seen.add(c))]
    print(f"[DEBUG][extract] raw_findall={raw} → deduped={result}")
    return result


def direct_course_lookup(course_codes: list) -> list:
    """COURSES_BY_CODE에서 학수번호 직접 조회 (O(1) per code)"""
    results = []
    seen_key: set = set()
    for code in course_codes:
        norm = normalize_course_code(code)
        bucket = COURSES_BY_CODE.get(norm, [])
        keys_found = []
        for c in bucket:
            key = f"{c.get('cour_cd')}@{c.get('cour_cls')}"
            if key not in seen_key:
                seen_key.add(key)
                results.append(c)
                keys_found.append(key)
        status = keys_found if keys_found else "MISS"
        print(f"[DEBUG][direct] {code} → norm={norm} | bucket={len(bucket)} | selected={status}")
    return results


def prefix_course_lookup(course_codes: list) -> list:
    """직접 조회 실패 코드의 prefix 기반 폴백 (COSE → COSE* 전체)"""
    prefixes: set = set()
    for code in course_codes:
        norm = normalize_course_code(code)
        if norm not in COURSES_BY_CODE:
            pm = re.match(r'[A-Z]+', norm)
            if pm:
                prefixes.add(pm.group())
                print(f"[DEBUG][prefix] {code} → norm={norm} NOT in index → prefix={pm.group()}")
            else:
                print(f"[DEBUG][prefix] {code} → norm={norm} no alpha prefix → skip")
        else:
            print(f"[DEBUG][prefix] {code} → norm={norm} IS in index (skip)")
    if not prefixes:
        print(f"[DEBUG][prefix] no prefixes → return []")
        return []
    results, seen_cd = [], set()
    for c in ALL_COURSES:
        cd = c.get("cour_cd", "")
        if any(cd.startswith(p) for p in prefixes) and cd not in seen_cd:
            seen_cd.add(cd)
            results.append(c)
    per_prefix = {p: sum(1 for c in results if c.get("cour_cd", "").startswith(p)) for p in prefixes}
    print(f"[DEBUG][prefix] prefixes={sorted(prefixes)} | per_prefix={per_prefix} | total={len(results)} (cap={MAX_COURSES})")
    return results[:MAX_COURSES]


def hybrid_search(query):
    """키워드 + 벡터 검색 결합 (direct lookup 우선)"""

    # ── 1. direct lookup: 학수번호가 명시된 경우 즉시 조회 ──────────────
    direct_codes = extract_course_codes_from_query(query)
    if direct_codes:
        direct_results = direct_course_lookup(direct_codes)
        found_codes = [c.get("cour_cd") for c in direct_results]
        missing = [c for c in direct_codes if not COURSES_BY_CODE.get(normalize_course_code(c))]
        print(f"[DEBUG][hybrid] requested={direct_codes} | found={sorted(set(found_codes))} | missing={missing}")
        if missing:
            direct_results += prefix_course_lookup(missing)
        if direct_results:
            show_weekly_d = any(kw in query for kw in [
                "주차", "커리큘럼", "강의계획", "수업계획", "weekly", "주차별", "계획",
                "어떤 내용", "내용", "수업 내용", "강의 계획", "수업 계획",
                "스케쥴", "schedule", "뭘 배워", "무엇을 배워", "학습계획", "학습 계획",
            ])
            capped = direct_results[:MAX_COURSES]
            print(f"[DEBUG][hybrid] RETURN direct: {len(direct_codes)} codes → {len(capped)} courses (missing={missing})")
            context = f"[직접 조회 결과: {len(direct_codes)}개 학수번호 → {len(capped)}개 분반]\n"
            for i, course in enumerate(capped):
                context += f"\n--- 과목 {i+1} ---\n"
                context += format_course(course, show_weekly=show_weekly_d)
            return context
        else:
            print(f"[DEBUG][hybrid] direct_results empty after prefix fallback → fall through to hybrid")
    else:
        print(f"[DEBUG][hybrid] no course codes in query → hybrid search")

    # ── 2. 기존 hybrid 검색 (direct hit 없을 때) ────────────────────────
    query = rewrite_query(query)
    keywords = extract_keywords(query)
    has_keywords = any([
        keywords["prof_nm"],
        keywords["department"],
        keywords["cour_cd"],
        keywords["isu_nm"],
        keywords["tech_keywords"],
        keywords["cour_nm_keyword"],
        keywords["cour_prefix"],
    ])

    #print(f"DEBUG keywords: {keywords}")
    #print(f"DEBUG has_keywords: {has_keywords}")

    context = ""
    show_weekly = any(kw in query for kw in ["주차", "커리큘럼", "강의계획", "수업계획", "weekly","주차별","계획","시간표","어떤 내용","내용","수업 내용","강의 계획","수업 계획","스케쥴","schedule","뭘 배워","무엇을 배워","무엇을 배워?","뭘 배워?","어떻게 진행","어떤식으로 진행 돼?","학습계획","학습 계획","주차별 학습계획"])

    # 키워드 검색 (한 번만 호출)
    kw_results = keyword_search(keywords) if has_keywords else []
    #print(f"DEBUG kw_results: {len(kw_results)}개")
    if kw_results:
        total = len(kw_results)
        kw_results = kw_results[:MAX_COURSES]
        context += f"[키워드 검색 결과: {total}개 중 상위 {len(kw_results)}개]\n"
        for i, course in enumerate(kw_results):
            context += f"\n--- 과목 {i+1} ---\n"
            context += format_course(course, show_weekly = show_weekly)

    # 키워드 없거나 결과 부족하면 벡터 검색 보완
    # 단, 학수번호나 과목명이 명시된 경우엔 벡터 검색 안 함
    next_course_query = any(kw in query for kw in [
        "다음", "이후", "연계", "심화", "관련", "연관", "이어서","다음에","다음 학기에"
    ])

    use_vector = ((not has_keywords or len(kw_results) < 3) and \
                not keywords["cour_cd"] and \
                 not keywords["cour_nm_keyword"]) or next_course_query

    if use_vector:
        vec_results = vector_search(query, n_results=5)
        context += f"\n[의미 기반 검색 결과]\n"
        for i, (doc, meta) in enumerate(zip(vec_results["documents"][0], vec_results["metadatas"][0])):
            # 벡터 검색 결과도 요약본 사용
            vec_key = f"{meta.get('cour_cd', '')}@{meta.get('cour_cls', '')}"
            vec_summary = SUMMARIES.get(vec_key)

            context += f"\n--- 과목 {i+1} ---\n"
            if vec_summary:
                # 요약본에서 과목 정보를 dict로 만들어서 format_course에 전달
                fake_course = {
                    "cour_cd": meta.get("cour_cd", ""),
                    "cour_cls": meta.get("cour_cls", ""),
                }
                context += format_course(fake_course, show_weekly=show_weekly)
            else:
                context += (
                    f"과목명: {meta.get('cour_nm', '')}\n"
                    f"학수번호: {meta.get('cour_cd', '')}-{meta.get('cour_cls', '')}\n"
                    f"학과: {meta.get('department', '')}\n"
                    f"교수: {meta.get('prof_nm', '')}\n"
                    f"이수구분: {meta.get('isu_nm', '')}\n"
                    f"학점: {meta.get('credit', '')}\n"
                )

    return context


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# ⑥ Claude에게 질문
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
LAST_CONTEXT = {"value": ""}

_ALLOWED_ROLES = {"user", "assistant"}


def sanitize_conversation_history(history: list) -> list:
    """Claude API 허용 형식(role/content)만 남기고 UI 전용 필드(id, timestamp 등) 제거"""
    result = []
    for msg in history:
        if not isinstance(msg, dict):
            continue
        role = msg.get("role", "")
        content = msg.get("content", "")
        if role not in _ALLOWED_ROLES:
            continue
        if not content or not str(content).strip():
            continue
        result.append({"role": role, "content": str(content)})
    return result


def ask_claude(user_query, context, conversation_history, last_context=""):
    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

    if not context.strip() or context.strip() == "(관련 과목을 찾지 못했습니다)":
        return "관련 과목을 찾지 못했어요. 학수번호, 교수명, 학과명으로 다시 검색해보시겠어요? 😊"

    # last_context 파라미터 우선, 없으면 글로벌 폴백 (CLI 호환)
    effective_last = last_context if last_context else LAST_CONTEXT["value"]

    # 직전 검색결과를 함께 포함 (후속 질문 대응)
    combined_context = context if context.strip() else "(관련 과목을 찾지 못했습니다)"
    if effective_last and effective_last != context:
        combined_context = (
            f"=== 이번 검색결과 ===\n{combined_context}\n\n"
            f"=== 직전 턴 검색결과 (참고용) ===\n{effective_last}"
        )

    turn_message = f"""<검색결과>
{combined_context}
</검색결과>

학생 질문: {user_query}

위 <검색결과>에 있는 과목 데이터만 근거로 답변하세요.
검색결과에 없는 정보는 "해당 정보는 찾지 못했습니다"라고 답하세요."""

    clean_history = sanitize_conversation_history(conversation_history)

    # 개발 디버깅: 원본과 정제 결과 비교 (민감 정보 제외)
    if conversation_history:
        raw_fields = sorted({k for m in conversation_history if isinstance(m, dict) for k in m})
        print(f"[DEBUG] raw_history_fields={raw_fields}, raw_count={len(conversation_history)}, sanitized_count={len(clean_history)}")

    messages_for_api = clean_history + [
        {"role": "user", "content": turn_message}
    ]

    for attempt in range(2):
        try:
            response = client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=2048,
                system=SYSTEM_PROMPT,
                messages=messages_for_api
            )
            break
        except anthropic.RateLimitError:
            if attempt < 2:
                print(f"⚠️ Rate Limit. {(attempt+1)*5}초 후 재시도...")
                time.sleep((attempt+1) * 5)
            else:
                return "죄송해요, 잠시 후 다시 시도해주세요. 🙏"
        except Exception as e:
            return f"오류가 발생했습니다: {str(e)}"

    assistant_message = response.content[0].text

    # 히스토리에는 순수 질문 + 답변만 (검색결과 제외)
    conversation_history.append({"role": "user", "content": user_query})
    conversation_history.append({"role": "assistant", "content": assistant_message})

    if len(conversation_history) > MAX_HISTORY_TURNS * 2:
        del conversation_history[:-MAX_HISTORY_TURNS * 2]

    LAST_CONTEXT["value"] = context

    return assistant_message


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# ⑦ 구조화 추천 추출 (reply + context → recommendations[])
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
def extract_recommendations_from_context(context: str, reply: str) -> list:
    """context에서 Claude가 reply에 언급한 과목을 구조화된 추천 리스트로 반환"""
    # context에서 등장한 학수번호 (순서 보존)
    context_codes_raw = re.findall(r'학수번호:\s*([A-Z]{2,6}\d{3,4})', context)
    # 중복 제거 (순서 유지)
    seen_ctx = set()
    context_codes = [c for c in context_codes_raw if not (c in seen_ctx or seen_ctx.add(c))]

    # reply에서 언급된 학수번호
    reply_codes = set(re.findall(r'\b([A-Z]{2,6}\d{3,4})\b', reply))

    # reply에 명시된 것만 추천. 없으면 context 상위 5개 그대로 사용
    active_codes = [c for c in context_codes if c in reply_codes] if reply_codes else context_codes[:5]

    # 검색 소스 판별 (vector 영역에 포함된 학수번호 = "vector")
    vector_section = context.split("[의미 기반 검색 결과]")[-1] if "[의미 기반 검색 결과]" in context else ""

    recommendations = []
    seen_rec = set()
    for code in active_codes:
        if code in seen_rec:
            continue
        seen_rec.add(code)

        # SUMMARIES 에서 상세 정보 조회
        summary = next((s for k, s in SUMMARIES.items() if k.startswith(code + "@")), None)
        course = next((c for c in ALL_COURSES if c.get("cour_cd") == code), None) if not summary else None

        name = (summary.get("과목명", "") if summary else None) or (course.get("cour_nm", "") if course else None) or code
        if not name:
            continue

        prereqs_raw = (summary or {}).get("특이사항", {}).get("선수과목", "") or ""
        # 쉼표/슬래시로만 분리하여 과목명 단위 보존
        prereqs = [p.strip() for p in re.split(r'[,/]', prereqs_raw) if 2 <= len(p.strip()) <= 20] if prereqs_raw else []

        objective = (summary.get("수업목표", "") or "") if summary else ""
        reason = objective[:60] if objective else f"{name} 관련 추천 과목"

        source = "vector" if (code in vector_section) else "keyword"

        recommendations.append({
            "courseId": code,
            "courseName": name,
            "reason": reason,
            "percentage": None,
            "prerequisites": prereqs,
            "trackFit": None,
            "source": source
        })

        if len(recommendations) >= 6:
            break

    return recommendations


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# ⑧ 대화 루프
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
def main():
    print("=" * 50)
    print("  🎓 CoRA - 고려대학교 수강신청 도우미")
    print("=" * 50)
    print("무엇이든 물어보세요! (종료: q)")
    print()

    conversation_history = []

    while True:
        user_input = input("👤 나: ").strip()
        if not user_input:
            continue
        if user_input.lower() == "q":
            print("👋 CoRA를 종료합니다!")
            break

        context = hybrid_search(user_input)
        answer = ask_claude(user_input, context, conversation_history)
        print(f"\n CoRA: {answer}\n")


if __name__ == "__main__":
    main()