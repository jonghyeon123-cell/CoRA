"""
CoRA - PDF/DOCX 텍스트 추출 후 벡터 DB에 추가
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
실행 전: pip install pymupdf python-docx --break-system-packages
사용법: python3 extract_pdf_word.py
"""

import os
import json
import re
import fitz  # pymupdf
import docx
import chromadb
import voyageai
from dotenv import load_dotenv


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# ① 설정
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
load_dotenv()
VOYAGE_API_KEY = os.environ["VOYAGE_API_KEY"]
FILES_DIR = "cora_data/files"
VECTOR_DB_DIR = "cora_vectordb"
OUTPUT_FILE = "cora_data/file_texts.json"


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# ② 텍스트 추출
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
def extract_pdf(filepath):
    """PDF에서 텍스트 추출"""
    try:
        doc = fitz.open(filepath)
        text = ""
        for page in doc:
            text += page.get_text()
        doc.close()
        return text.strip()
    except Exception as e:
        return f"[추출 실패: {e}]"


def extract_docx(filepath):
    """DOCX에서 텍스트 추출"""
    try:
        doc = docx.Document(filepath)
        
        # 일반 텍스트
        text = "\n".join([para.text for para in doc.paragraphs if para.text.strip()])
        
        # 표 데이터 추출
        for table in doc.tables:
            for row in table.rows:
                row_text = [cell.text.strip() for cell in row.cells if cell.text.strip()]
                if row_text:  
                    text += "\n" + " | ".join(row_text)
        
        return text.strip()
    except Exception as e:
        return f"[추출 실패: {e}]"


def get_cour_cd_from_filename(fname):
    """파일명에서 학수번호 추출 (예: BUSS305%2800%29.pdf → BUSS305, 00)"""
    # URL 디코딩된 파일명 패턴: XXXX000%28XX%29.ext
    match = re.match(r'([A-Z]+\d+)%28(\w+)%29', fname)
    if match:
        return match.group(1), match.group(2)
    return None, None


def extract_all_files():
    """files 폴더의 모든 PDF/DOCX 텍스트 추출"""
    files = os.listdir(FILES_DIR)
    pdf_files = [f for f in files if f.lower().endswith(".pdf")]
    docx_files = [f for f in files if f.lower().endswith(".docx") or f.lower().endswith(".doc")]

    print(f"PDF: {len(pdf_files)}개, DOCX: {len(docx_files)}개")

    results = {}

    for i, fname in enumerate(pdf_files + docx_files):
        fpath = os.path.join(FILES_DIR, fname)
        ext = os.path.splitext(fname)[1].lower()

        if ext == ".pdf":
            text = extract_pdf(fpath)
        else:
            text = extract_docx(fpath)

        results[fname] = text

        if text and not text.startswith("[추출 실패"):
            print(f"  ✅ [{i+1}] {fname} ({len(text)}자)")
        else:
            print(f"  ❌ [{i+1}] {fname}: {text}")

    # 결과 저장
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    success = sum(1 for v in results.values() if not v.startswith("[추출 실패"))
    print(f"\n✅ 추출 완료! {success}/{len(results)}개 성공")
    return results


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# ③ 벡터 DB에 추가
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
def add_to_vectordb(file_texts):
    """추출된 텍스트를 벡터 DB에 추가"""
    vo = voyageai.Client(api_key=VOYAGE_API_KEY)
    client = chromadb.PersistentClient(path=VECTOR_DB_DIR)
    collection = client.get_or_create_collection(
        name="courses",
        metadata={"hnsw:space": "cosine"}
    )

    # 이미 저장된 항목 확인
    existing = set(collection.get()["ids"])

    BATCH_SIZE = 64
    documents = []
    metadatas = []
    ids = []
    added = 0

    for fname, text in file_texts.items():
        if not text or text.startswith("[추출 실패"):
            continue

        cour_cd, cour_cls = get_cour_cd_from_filename(fname)
        if not cour_cd:
            continue

        doc_id = f"file_{fname}"
        if doc_id in existing:
            continue

        # 텍스트 정리 및 자르기
        clean_text = re.sub(r'\s+', ' ', text).strip()[:3000]
        clean_text = clean_text.encode('utf-8', errors='ignore').decode('utf-8')
        doc = f"[강의계획서 파일]\n학수번호: {cour_cd}-{cour_cls}\n\n{clean_text}"
        doc = doc.encode('latin-1', errors='ignore').decode('latin-1')

        documents.append(doc)
        metadatas.append({
            "cour_cd": cour_cd,
            "cour_cls": cour_cls,
            "cour_nm": "",
            "department": "",
            "prof_nm": "",
            "isu_nm": "",
            "credit": "",
            "source": fname,
        })
        ids.append(doc_id)

        if len(documents) >= BATCH_SIZE:
            print(f"  🔄 임베딩 중... ({added + len(documents)}개)")
            result = vo.embed(documents, model="voyage-3", input_type="document")
            collection.add(documents=documents, embeddings=result.embeddings, metadatas=metadatas, ids=ids)
            added += len(documents)
            documents, metadatas, ids = [], [], []

    if documents:
        print(f"  🔄 마지막 배치 임베딩 중...")
        result = vo.embed(documents, model="voyage-3", input_type="document")
        collection.add(documents=documents, embeddings=result.embeddings, metadatas=metadatas, ids=ids)
        added += len(documents)

    print(f"\n🎉 완료! {added}개 파일 텍스트 벡터 DB에 추가")
    print(f"📊 총 벡터 DB 항목 수: {collection.count()}개")


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# ④ 실행
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
if __name__ == "__main__":
    print("=" * 50)
    print("  CoRA - PDF/DOCX 텍스트 추출 + 벡터 DB 추가")
    print("=" * 50)

    # 이미 추출한 결과가 있으면 재사용
    if os.path.exists(OUTPUT_FILE):
        print(f"📂 기존 추출 결과 로드: {OUTPUT_FILE}")
        with open(OUTPUT_FILE, "r", encoding="utf-8") as f:
            file_texts = json.load(f)
    else:
        print("\n📄 STEP 1: 텍스트 추출 중...")
        file_texts = extract_all_files()

    print("\n🗄️ STEP 2: 벡터 DB에 추가 중...")
    add_to_vectordb(file_texts)