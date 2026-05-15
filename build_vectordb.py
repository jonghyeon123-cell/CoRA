    """
CoRA RAG 파이프라인 - 데이터 전처리 + 벡터 DB 구축
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
실행 전:
  pip install anthropic chromadb voyageai --break-system-packages

사용법:
  python3 build_vectordb.py
"""

import json
import os
import re
from bs4 import BeautifulSoup
import chromadb
import voyageai
from dotenv import load_dotenv

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# ① 설정
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
load_dotenv()

VOYAGE_API_KEY = os.environ["VOYAGE_API_KEY"]

DATA_DIR = "cora_data"
VECTOR_DB_DIR = "cora_vectordb"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# ② 강의계획서 HTML에서 텍스트 추출
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
def extract_text_from_html(html_path):
    """HTML 강의계획서에서 핵심 텍스트 추출"""
    try:
        with open(html_path, "r", encoding="utf-8") as f:
            html = f.read()
        soup = BeautifulSoup(html, "html.parser")
        # 스크립트/스타일 제거
        for tag in soup(["script", "style"]):
            tag.decompose()
        text = soup.get_text(separator=" ", strip=True)
        # 연속 공백 정리
        text = re.sub(r'\s+', ' ', text).strip()
        return text[:3000]  # 너무 길면 자르기
    except:
        return ""


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# ③ 과목 문서 생성 (임베딩할 텍스트)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
def build_course_document(course, syllabus=None, html_text="", hwp_texts={}):
    """과목 데이터를 하나의 텍스트 문서로 합치기"""
    doc = f"""
과목명: {course.get('cour_nm', '')}
학수번호: {course.get('cour_cd', '')}-{course.get('cour_cls', '')}
개설학과: {course.get('department', '')}
담당교수: {course.get('prof_nm', '')}
이수구분: {course.get('isu_nm', '')}
학점: {course.get('credit', '')}
강의시간: {course.get('apply_dept', '')}
""".strip()

    # 강의계획서 주차별 내용 추가
    if syllabus and syllabus.get('weekly_plan'):
        doc += "\n\n주차별 학습내용:\n"
        for week in syllabus['weekly_plan']:
            doc += f"{week['week']}주: {week['content']}\n"

    # HTML에서 추출한 텍스트 추가 (강의요목 등)
    if html_text:
        doc += f"\n\n강의계획서 상세:\n{html_text[:1000]}"

    # HWP에서 추출한 텍스트 추가
    cour_key = f"{course.get('cour_cd')}%28{course.get('cour_cls')}%29"
    for hwp_fname, hwp_text in hwp_texts.items():
        if course.get('cour_cd', '') in hwp_fname:
            doc += f"\n\n강의계획서(파일):\n{hwp_text[:1000]}"
            break

    return doc


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# ④ 벡터 DB 구축
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
def build_vectordb():
    # 데이터 로드
    print("📂 데이터 로드 중...")
    with open(os.path.join(DATA_DIR, "courses.json"), "r", encoding="utf-8") as f:
        courses = json.load(f)

    syllabi_map = {}
    syllabi_path = os.path.join(DATA_DIR, "syllabi.json")
    if os.path.exists(syllabi_path):
        with open(syllabi_path, "r", encoding="utf-8") as f:
            syllabi_list = json.load(f)
        for s in syllabi_list:
            key = f"{s['cour_cd']}@{s['cour_cls']}"
            syllabi_map[key] = s

    hwp_texts = {}
    hwp_path = os.path.join(DATA_DIR, "hwp_texts.json")
    if os.path.exists(hwp_path):
        with open(hwp_path, "r", encoding="utf-8") as f:
            hwp_texts = json.load(f)

    print(f"✅ 과목 {len(courses)}개 로드 완료")

    # Voyage AI 클라이언트
    vo = voyageai.Client(api_key=VOYAGE_API_KEY)

    # ChromaDB 초기화
    client = chromadb.PersistentClient(path=VECTOR_DB_DIR)
    collection = client.get_or_create_collection(
        name="courses",
        metadata={"hnsw:space": "cosine"}
    )

    # 이미 처리된 항목 확인
    existing = set(collection.get()["ids"])
    print(f"📌 이미 저장된 항목: {len(existing)}개")

    # 배치 처리 (Voyage API 한 번에 128개까지)
    BATCH_SIZE = 64
    documents = []  
    metadatas = []
    ids = []

    for i, course in enumerate(courses):
        doc_id = f"{course['cour_cd']}_{course['cour_cls']}"
        if doc_id in existing:
            continue

        # HTML 텍스트 추출
        html_path = os.path.join(DATA_DIR, "syllabi", f"{course['cour_cd']}_{course['cour_cls']}.html")
        html_text = extract_text_from_html(html_path) if os.path.exists(html_path) else ""

        # 강의계획서 데이터
        syllabus = syllabi_map.get(f"{course['cour_cd']}@{course['cour_cls']}")

        # 문서 생성
        doc = build_course_document(course, syllabus, html_text, hwp_texts)

        documents.append(doc)
        metadatas.append({
            "cour_cd": course.get("cour_cd", ""),
            "cour_cls": course.get("cour_cls", ""),
            "cour_nm": course.get("cour_nm", ""),
            "department": course.get("department", ""),
            "prof_nm": course.get("prof_nm", ""),
            "isu_nm": course.get("isu_nm", ""),
            "credit": str(course.get("credit", "")),
            "col_cd": course.get("col_cd", ""),
            "dept_cd": course.get("dept_cd", ""),
        })
        ids.append(doc_id)

        # 배치가 꽉 차면 임베딩 & 저장
        if len(documents) >= BATCH_SIZE:
            print(f"  🔄 임베딩 중... ({i+1}/{len(courses)})")
            result = vo.embed(documents, model="voyage-3", input_type="document")
            embeddings = result.embeddings
            collection.add(documents=documents, embeddings=embeddings, metadatas=metadatas, ids=ids)
            documents, metadatas, ids = [], [], []

    # 나머지 처리
    if documents:
        print(f"  🔄 마지막 배치 임베딩 중...")
        result = vo.embed(documents, model="voyage-3", input_type="document")
        embeddings = result.embeddings
        collection.add(documents=documents, embeddings=embeddings, metadatas=metadatas, ids=ids)

    total = collection.count()
    print(f"\n🎉 완료! 총 {total}개 과목 벡터 DB 저장")
    print(f"📁 저장 위치: {VECTOR_DB_DIR}/")


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# ⑤ 테스트 검색
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
def test_search(query="인공지능 관련 과목 추천해줘"):
    """검색 테스트"""
    vo = voyageai.Client(api_key=VOYAGE_API_KEY)
    client = chromadb.PersistentClient(path=VECTOR_DB_DIR)
    collection = client.get_collection("courses")

    # 쿼리 임베딩
    result = vo.embed([query], model="voyage-3", input_type="query")
    query_embedding = result.embeddings[0]

    # 검색
    results = collection.query(
        query_embeddings=[query_embedding],
        n_results=5
    )

    print(f"\n🔍 검색어: '{query}'")
    print("=" * 50)
    for i, (doc, meta) in enumerate(zip(results["documents"][0], results["metadatas"][0])):
        print(f"{i+1}. {meta['cour_nm']} ({meta['cour_cd']}-{meta['cour_cls']})")
        print(f"   학과: {meta['department']} / 교수: {meta['prof_nm']}")
        print()


if __name__ == "__main__":
    print("=" * 50)
    print("  CoRA 벡터 DB 구축")
    print("=" * 50)

    # 벡터 DB 구축
    build_vectordb()

    # 검색 테스트
    print("\n검색 테스트 실행 중...")
    test_search("인공지능 관련 과목 추천해줘")
    test_search("프로그래밍 기초 배우고 싶어")