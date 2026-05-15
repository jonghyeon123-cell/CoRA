"""
CoRA 크롤러 - 고려대학교 과목 데이터 + 강의계획서 + 첨부파일 수집
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
실행 전:  pip install requests beautifulsoup4
사용법:   python cora_crawler.py
"""

import requests
import json
import time
import os
import re
from urllib.parse import urljoin, parse_qs, urlparse
from bs4 import BeautifulSoup

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# ① 설정 - 쿠키를 브라우저에서 복사해서 붙여넣기
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

COOKIE_STR = ""

HEADERS = {
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    "Accept": "application/json, text/javascript, */*; q=0.01",
    "X-Requested-With": "XMLHttpRequest",
    "Origin": "https://sugang.korea.ac.kr",
    "Referer": "https://sugang.korea.ac.kr/core?attribute=coreMain",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Cookie": COOKIE_STR,
}

# 출력 폴더
OUTPUT_DIR = "cora_data"
SYLLABUS_DIR = os.path.join(OUTPUT_DIR, "syllabi")
FILES_DIR = os.path.join(OUTPUT_DIR, "files")

os.makedirs(OUTPUT_DIR, exist_ok=True)
os.makedirs(SYLLABUS_DIR, exist_ok=True)
os.makedirs(FILES_DIR, exist_ok=True)


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# ② 과목 목록 가져오기 (3663개)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
def fetch_all_courses():
    """전체 과목 목록을 한번에 가져옴"""
    payload = {
        "pYear": "2026", "pTerm": "1R", "pCampus": "1", "pGradCd": "0136",
        "pCourDiv": "", "pCol": "", "pDept": "",
        "pCredit": "", "pDay": "", "pStartTime": "", "pEndTime": "",
        "pProf": "", "pCourCd": "", "pCourNm": "",
        "strYear": "2026", "strTerm": "1R", "strUserType": ".....", "strChasu": "",
    }

    url = f"https://sugang.korea.ac.kr/view?attribute=lectHakbuData&fake={int(time.time()*1000)}"
    res = requests.post(url, data=payload, headers=HEADERS)
    data = res.json()
    courses = data.get("data", [])

    # JSON으로 저장
    with open(os.path.join(OUTPUT_DIR, "courses.json"), "w", encoding="utf-8") as f:
        json.dump(courses, f, ensure_ascii=False, indent=2)

    print(f"✅ 과목 목록 저장 완료: {len(courses)}개")
    return courses


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# ③ 강의계획서 크롤링
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
def build_syllabus_url(course):
    """과목 데이터에서 강의계획서 URL 생성"""
    return (
        f"https://infodepot.korea.ac.kr/lecture1/lecsubjectPlanViewNew.jsp"
        f"?year={course['year']}"
        f"&term={course['term']}"
        f"&grad_cd={course['courgrad_cd']}"
        f"&col_cd={course['col_cd']}"
        f"&dept_cd={course['dept_cd']}"
        f"&cour_cd={course['cour_cd']}"
        f"&cour_cls={course['cour_cls']}"
        f"&cour_nm="
        f"&std_id="
        f"&device=WW"
    )


def parse_syllabus(html, course):
    """강의계획서 HTML에서 주차별 학습내용 + 첨부파일 링크 추출"""
    soup = BeautifulSoup(html, "html.parser")
    result = {
        "cour_cd": course["cour_cd"],
        "cour_cls": course["cour_cls"],
        "cour_nm": course["cour_nm"],
        "department": course["department"],
        "prof_nm": course.get("prof_nm", ""),
        "weekly_plan": [],
        "attachments": [],
    }

    # ── 주차별 학습내용 파싱 ──
    tables = soup.find_all("table")
    for table in tables:
        rows = table.find_all("tr")
        for row in rows:
            cells = row.find_all(["td", "th"])
            texts = [c.get_text(strip=True) for c in cells]
            if texts and texts[0].isdigit() and 1 <= int(texts[0]) <= 16:
                week_data = {
                    "week": int(texts[0]),
                    "content": " | ".join(texts[1:])
                }
                result["weekly_plan"].append(week_data)

    # ── 첨부파일 링크 찾기 ──
    for a_tag in soup.find_all("a", href=True):
        href = a_tag["href"]
        text = a_tag.get_text(strip=True)
        if any(ext in href.lower() for ext in [".pdf", ".doc", ".docx", ".hwp", ".ppt", ".pptx"]):
            result["attachments"].append({"text": text, "url": href})
        elif "download" in href.lower() or "file" in href.lower():
            result["attachments"].append({"text": text, "url": href})

    # onclick에서 파일 다운로드 함수 호출 찾기
    for tag in soup.find_all(attrs={"onclick": True}):
        onclick = tag["onclick"]
        if "download" in onclick.lower() or "file" in onclick.lower():
            result["attachments"].append({
                "text": tag.get_text(strip=True),
                "onclick": onclick
            })

    return result


def download_file(url, course, session):
    """첨부파일 다운로드"""
    try:
        if url.startswith("/"):
            url = "https://infodepot.korea.ac.kr" + url
        elif not url.startswith("http"):
            url = "https://infodepot.korea.ac.kr/lecture1/" + url

        res = session.get(url, timeout=30)
        if res.status_code == 200 and len(res.content) > 100:
            cd = res.headers.get("Content-Disposition", "")
            if "filename" in cd:
                fname = re.findall(r'filename[^;=\n]*=([\"\']?)(.+?)\1(;|$)', cd)
                fname = fname[0][1] if fname else f"{course['cour_cd']}_{course['cour_cls']}"
            else:
                fname = os.path.basename(urlparse(url).path) or f"{course['cour_cd']}_{course['cour_cls']}"

            filepath = os.path.join(FILES_DIR, fname)
            with open(filepath, "wb") as f:
                f.write(res.content)
            print(f"    📎 다운로드: {fname} ({len(res.content)//1024}KB)")
            return filepath
    except Exception as e:
        print(f"    ⚠️ 다운로드 실패: {e}")
    return None


def crawl_syllabi(courses):
    """전체 과목의 강의계획서를 크롤링"""
    session = requests.Session()
    session.headers.update({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    })

    all_syllabi = []
    total = len(courses)

    # 이미 처리한 과목 건너뛰기 (중단 후 재시작용)
    done_file = os.path.join(OUTPUT_DIR, "syllabi_progress.json")
    done_set = set()
    if os.path.exists(done_file):
        with open(done_file, "r") as f:
            done_set = set(json.load(f))
        print(f"📌 이전 진행 이어서 시작 ({len(done_set)}개 완료)")

    # 기존 결과 불러오기
    syllabi_file = os.path.join(OUTPUT_DIR, "syllabi.json")
    if os.path.exists(syllabi_file) and done_set:
        with open(syllabi_file, "r", encoding="utf-8") as f:
            all_syllabi = json.load(f)

    for i, course in enumerate(courses):
        key = f"{course['cour_cd']}@{course['cour_cls']}"

        if key in done_set:
            continue

        print(f"[{i+1}/{total}] {course['cour_nm']} ({course['cour_cd']}-{course['cour_cls']})")

        try:
            url = build_syllabus_url(course)
            res = session.get(url, timeout=30)
            res.encoding = res.apparent_encoding

            if res.status_code == 200:
                syllabus = parse_syllabus(res.text, course)

                # 첨부파일 다운로드
                for att in syllabus.get("attachments", []):
                    if "url" in att:
                        filepath = download_file(att["url"], course, session)
                        if filepath:
                            att["local_path"] = filepath

                # 강의계획서 HTML 원본 저장
                html_path = os.path.join(SYLLABUS_DIR, f"{course['cour_cd']}_{course['cour_cls']}.html")
                with open(html_path, "w", encoding="utf-8") as f:
                    f.write(res.text)

                all_syllabi.append(syllabus)
                done_set.add(key)

                # 50개마다 중간 저장
                if len(done_set) % 50 == 0:
                    with open(done_file, "w") as f:
                        json.dump(list(done_set), f)
                    with open(syllabi_file, "w", encoding="utf-8") as f:
                        json.dump(all_syllabi, f, ensure_ascii=False, indent=2)
                    print(f"  💾 중간 저장 ({len(done_set)}/{total} 완료)")

        except Exception as e:
            print(f"  ❌ 에러: {e}")

        # 서버 부하 방지 딜레이
        time.sleep(1)

    # 최종 저장
    with open(done_file, "w") as f:
        json.dump(list(done_set), f)
    with open(syllabi_file, "w", encoding="utf-8") as f:
        json.dump(all_syllabi, f, ensure_ascii=False, indent=2)

    print(f"\n🎉 완료! 총 {len(all_syllabi)}개 강의계획서 수집")
    return all_syllabi


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# ④ 실행
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
if __name__ == "__main__":
    print("=" * 50)
    print("  CoRA 크롤러")
    print("=" * 50)

    # STEP 1: 과목 목록
    print("\n📚 STEP 1: 전체 과목 목록 가져오기...")
    courses = fetch_all_courses()

    # STEP 2: 강의계획서 + 파일
    minutes = len(courses) // 60
    print(f"\n📝 STEP 2: 강의계획서 크롤링")
    print(f"   {len(courses)}개 과목, 약 {minutes}분 소요 예상")
    print(f"   (중간에 Ctrl+C로 중단해도 이어서 재시작 가능)")
    input("\n   Enter 키를 누르면 시작... ")

    crawl_syllabi(courses)

    print("\n" + "=" * 50)
    print("📁 결과 파일:")
    print(f"  courses.json   - 전체 과목 목록")
    print(f"  syllabi.json   - 강의계획서 데이터")
    print(f"  syllabi/       - 강의계획서 HTML 원본")
    print(f"  files/         - 다운로드된 첨부파일")
    print("=" * 50)

