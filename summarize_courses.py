"""
CoRA - 강의계획서 통합 요약본 생성
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
소스 3가지를 합쳐서 과목별 구조화된 요약본 생성:
  1) HTML (수업유형, 특별유형, 수업구성요소, 평가방식, 수업목표, 선수과목, 강의언어)
  2) PDF/DOCX 텍스트 (수업목표 보충, 강의개요)
  3) syllabi.json (주차별 학습내용)

LLM 호출 없음 → 비용 $0, 소요시간 ~1~2분
사용법: python3 summarize_courses.py
"""

import json
import os
import re
from bs4 import BeautifulSoup


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 설정
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SYLLABI_DIR = "cora_data/syllabi"
COURSES_FILE = "cora_data/courses.json"
SYLLABI_FILE = "cora_data/syllabi.json"
FILE_TEXTS_FILE = "cora_data/file_texts.json"
HWP_TEXTS_FILE = "cora_data/hwp_texts.json"
OUTPUT_FILE = "cora_data/course_summaries.json"

def _load_eval_keywords(path="cora_data/eval_keywords.txt"):
    if not os.path.exists(path):
        print(f"⚠️ {path} 없음. 평가방식 파싱 건너뜀.")
        return set()
    with open(path, "r", encoding="utf-8") as f:
        return {line.strip() for line in f if line.strip() not in
                {"합계", "항목", "평가점수공개여부", "비공개", "공개", "-", ""}}

EVAL_KEYWORDS = _load_eval_keywords()
    
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# ① HTML 파싱 (수업방법, 평가방식, 수업목표 등)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
def parse_html(html_path):
    """강의계획서 HTML에서 구조화된 정보 추출"""
    try:
        with open(html_path, "r", encoding="utf-8") as f:
            html = f.read()
    except Exception:
        return {}

    soup = BeautifulSoup(html, "html.parser")
    result = {}

    # ── 수업유형 (radio: 하나만 선택) ──
    class_types = ["대면", "병행", "혼합", "원격(녹화)", "원격(실시간)"]
    for inp in soup.find_all("input", {"type": "radio"}):
        if not inp.has_attr("checked"):
            continue
        parent_text = inp.parent.get_text(strip=True) if inp.parent else ""
        for ct in class_types:
            if ct in parent_text:
                result["수업유형"] = ct
                break

    # ── 특별유형 (checkbox: 복수 선택 가능) ──
    special_types = [
        "MOOC", "Flipped Class(거꾸로수업)", "외국어(영어)", "팀티칭",
        "실험실습실기", "현장실습", "캡스톤디자인", "유연학기(집중수업)",
        "튜토리얼", "네모클래스"
    ]
    checked_special = []

    # ── 수업구성요소 (checkbox: 복수 선택 가능) ──
    components = [
        "이론강의", "발표", "토론", "실험", "실습", "협동학습",
        "개별지도", "집단지도", "퀴즈", "Q&A", "프로젝트",
        "상시상담", "체험", "특강", "포럼"
    ]
    checked_components = []

    # 한 번 순회로 특별유형 + 수업구성요소 둘 다 체크
    for inp in soup.find_all("input", {"type": "checkbox"}):
        if not inp.has_attr("checked"):
            continue
        parent_text = inp.parent.get_text(strip=True) if inp.parent else ""

        for st in special_types:
            if st in parent_text:
                checked_special.append(st)
                break
        for comp in components:
            if parent_text == comp:
                checked_components.append(comp)
                break

    result["특별유형"] = checked_special
    result["수업구성요소"] = checked_components

    # ── 평가방식 (표에서 추출) ──
    eval_items = {}
    for table in soup.find_all("table"):
        rows = table.find_all("tr")
        for row in rows:
            cells = [c.get_text(strip=True) for c in row.find_all(["td", "th"])]
            i = 0
            while i < len(cells) - 1:
                name = cells[i].strip()
                value = cells[i + 1].strip().replace(" ", "")
                if name in EVAL_KEYWORDS and "%" in value:
                    eval_items[name] = value
                i += 2
        if eval_items:
            break
    if eval_items:
        result["평가방식"] = ", ".join(f"{k} {v}" for k, v in eval_items.items())

    # ── 수업목표 (텍스트) ──
    full_text = soup.get_text(separator="\n", strip=True)

    # 수업목표 일반
    m = re.search(r'수업목표\s*일반\s*\n(.+?)(?:\n세부목표|\n교재)', full_text, re.DOTALL)
    if m:
        goal = m.group(1).strip()
        if len(goal) > 10:
            result["수업목표"] = goal[:500]

    # 강의개요
    m = re.search(r'개요\s*\n(.+?)(?:\n수강\(권장\)|\n수업운영)', full_text, re.DOTALL)
    if m:
        overview = m.group(1).strip()
        if len(overview) > 10:
            result["강의개요"] = overview[:500]

    # 선이수과목
    m = re.search(r'선이수과목\(권장\)\s*\n(.+?)(?:\n선이수과목\(권장\)\(영문\)|\n수업운영)', full_text, re.DOTALL)
    if m:
        prereq = m.group(1).strip()
        if prereq and prereq not in ("없음", "None.", "None") and "영문" not in prereq and len(prereq) > 1:
            result["선수과목"] = prereq
        else:
            result["선수과목"] = None

    # 강의언어 판별
    if "외국어(영어)" in checked_special:
        result["강의언어"] = "영어"
    elif re.search(r'(영어로\s*진행|English\s*only|taught\s*in\s*English)', full_text, re.IGNORECASE):
        result["강의언어"] = "영어"
    elif re.search(r'(한국어로\s*진행|100%\s*한국어)', full_text):
        result["강의언어"] = "한국어"
    else:
        result["강의언어"] = "한국어"  # 기본값

    # 프로젝트 기반 여부
    result["프로젝트기반"] = "프로젝트" in checked_components or "캡스톤디자인" in checked_special

    return result


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# ② PDF/DOCX/HWP 텍스트에서 보충 정보 추출
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
def extract_from_file_text(text):
    """PDF/DOCX 텍스트에서 수업목표, 강의개요 추출"""
    if not text or text.startswith("[추출 실패"):
        return {}

    result = {}

    # 수업목표
    m = re.search(r'수업목표\s*[:\n](.+?)(?:\n평가|교재|\n주차)', text, re.DOTALL)
    if m:
        goal = m.group(1).strip()[:500]
        if len(goal) > 10:
            result["수업목표"] = goal

    # 강의개요
    m = re.search(r'(?:강의개요|강의요목|Course\s*Description)\s*[:\n](.+?)(?:\n수업목표|\n평가|\n교재)', text, re.DOTALL | re.IGNORECASE)
    if m:
        overview = m.group(1).strip()[:500]
        if len(overview) > 10:
            result["강의개요"] = overview

    # 선수과목
    m = re.search(r'선수과목\s*[:\n](.+?)(?:\n|$)', text)
    if m:
        prereq = m.group(1).strip()
        if prereq and prereq != "없음" and len(prereq) > 1:
            result["선수과목"] = prereq

    return result


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# ③ 파일명 → 학수번호 매핑
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
def get_cour_cd_from_filename(fname):
    """BUSS305%2800%29.pdf → ('BUSS305', '00')"""
    match = re.match(r'([A-Z]+\d+)%28(\w+)%29', fname)
    if match:
        return match.group(1), match.group(2)
    return None, None


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# ④ 메인: 전체 과목 통합 요약 생성
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
def main():
    print("=" * 50)
    print("  CoRA - 강의계획서 통합 요약본 생성")
    print("=" * 50)

    # 데이터 로드
    print("\n📂 데이터 로드 중...")

    with open(COURSES_FILE, "r", encoding="utf-8") as f:
        courses = json.load(f)
    print(f"  과목: {len(courses)}개")

    with open(SYLLABI_FILE, "r", encoding="utf-8") as f:
        syllabi_list = json.load(f)
    syllabi_index = {f"{s['cour_cd']}@{s['cour_cls']}": s for s in syllabi_list}
    print(f"  강의계획서(syllabi): {len(syllabi_list)}개")

    file_texts = {}
    if os.path.exists(FILE_TEXTS_FILE):
        with open(FILE_TEXTS_FILE, "r", encoding="utf-8") as f:
            file_texts = json.load(f)
        print(f"  파일 텍스트(PDF/DOCX): {len(file_texts)}개")

    hwp_texts = {}
    if os.path.exists(HWP_TEXTS_FILE):
        with open(HWP_TEXTS_FILE, "r", encoding="utf-8") as f:
            hwp_texts = json.load(f)
        print(f"  HWP 텍스트: {len(hwp_texts)}개")

    # 파일명 → 학수번호 인덱스 구축
    file_text_index = {}  # key: "COUR_CD@COUR_CLS" → text
    for fname, text in {**file_texts, **hwp_texts}.items():
        if text.startswith("[추출 실패"):
            continue
        cour_cd, cour_cls = get_cour_cd_from_filename(fname)
        if cour_cd:
            key = f"{cour_cd}@{cour_cls}"
            # 이미 있으면 DOCX > PDF > HWP 우선순위
            if key not in file_text_index or fname.lower().endswith(".docx"):
                file_text_index[key] = text
    print(f"  파일 텍스트 매핑 성공: {len(file_text_index)}개")

    # HTML 파일 목록
    html_files = set()
    if os.path.exists(SYLLABI_DIR):
        html_files = {f.replace(".html", "") for f in os.listdir(SYLLABI_DIR) if f.endswith(".html")}
    print(f"  HTML 강의계획서: {len(html_files)}개")

    # ━━━━ 전체 과목 순회 ━━━━
    print(f"\n🔄 {len(courses)}개 과목 처리 중...")
    results = {}
    stats = {"html": 0, "file": 0, "syllabi_only": 0, "minimal": 0}

    for i, course in enumerate(courses):
        cour_cd = course.get("cour_cd", "")
        cour_cls = course.get("cour_cls", "")
        key = f"{cour_cd}@{cour_cls}"
        html_key = f"{cour_cd}_{cour_cls}"

        # 기본 정보 (courses.json에서)
        summary = {
            "학수번호": cour_cd,
            "분반": cour_cls,
            "과목명": course.get("cour_nm", ""),
            "이수구분": course.get("isu_nm", ""),
            "학과": course.get("department", ""),
            "교수": course.get("prof_nm", ""),
            "학점": course.get("credit", ""),
            "강의시간": course.get("time_room", ""),
            "수업목표": None,
            "강의개요": None,
            "평가방식": None,
            "수업방법": {
                "수업유형": None,
                "특별유형": [],
                "수업구성요소": [],
            },
            "특이사항": {
                "선수과목": None,
                "강의언어": "한국어",
                "프로젝트기반": False,
            },
        }

        # ── 소스 1: HTML 파싱 ──
        html_path = os.path.join(SYLLABI_DIR, f"{html_key}.html")
        if os.path.exists(html_path):
            html_data = parse_html(html_path)
            if html_data:
                stats["html"] += 1
                # 단순 필드
                for field in ("평가방식", "수업목표", "강의개요"):
                    if html_data.get(field):
                        summary[field] = html_data[field]
                # 수업방법
                for field in ("수업유형", "특별유형", "수업구성요소"):
                    if html_data.get(field):
                        summary["수업방법"][field] = html_data[field]
                # 특이사항
                for field in ("강의언어", "프로젝트기반"):
                    if html_data.get(field):
                        summary["특이사항"][field] = html_data[field]
                if html_data.get("선수과목") is not None:
                    summary["특이사항"]["선수과목"] = html_data["선수과목"]

        # 과목명에 (영강) 포함되면 영어 강의
        if "(영강)" in summary["과목명"]:
            summary["특이사항"]["강의언어"] = "영어"

        # ── 소스 2: PDF/DOCX/HWP 텍스트 (보충) ──
        if key in file_text_index:
            file_data = extract_from_file_text(file_text_index[key])
            if file_data:
                stats["file"] += 1
                # HTML에서 못 뽑은 것만 보충
                if not summary["수업목표"] and file_data.get("수업목표"):
                    summary["수업목표"] = file_data["수업목표"]
                if not summary["강의개요"] and file_data.get("강의개요"):
                    summary["강의개요"] = file_data["강의개요"]
                if not summary["특이사항"]["선수과목"] and file_data.get("선수과목"):
                    summary["특이사항"]["선수과목"] = file_data["선수과목"]

        # ── 소스 3: syllabi.json (주차별 내용 → 키워드 추출) ──
        syllabus = syllabi_index.get(key)
        if syllabus and syllabus.get("weekly_plan"):
            weekly = syllabus["weekly_plan"]
            weekly_texts = [w.get("content", "") for w in weekly if w.get("content")]
            if weekly_texts:
                # 수업목표가 아직 없으면 주차별 내용에서 유추
                if not summary["수업목표"]:
                    # 첫 2주 내용을 간략히 사용
                    first_weeks = " / ".join(weekly_texts[:3])[:300]
                    if len(first_weeks) > 10:
                        summary["수업목표"] = f"주차별 내용 기반: {first_weeks}"
                    stats["syllabi_only"] += 1
                    
        else:
            if not summary["수업목표"]:
                stats["minimal"] += 1

        results[key] = summary

        # 진행 표시
        if (i + 1) % 500 == 0:
            print(f"  {i+1}/{len(courses)} 처리 완료")

    # ━━━━ 저장 ━━━━
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    print(f"\n🎉 완료!")
    print(f"  총 과목: {len(results)}개")
    print(f"  HTML 파싱 성공: {stats['html']}개")
    print(f"  PDF/DOCX 보충: {stats['file']}개")
    print(f"  syllabi만 사용: {stats['syllabi_only']}개")
    print(f"  최소 정보만: {stats['minimal']}개")
    print(f"\n📁 저장: {OUTPUT_FILE}")

    # 샘플 출력
    print("\n=== 샘플 (첫 2개) ===")
    for i, (key, val) in enumerate(results.items()):
        if i >= 2:
            break
        print(json.dumps(val, ensure_ascii=False, indent=2))
        print()


if __name__ == "__main__":
    main()