"""
저장된 HTML 파일 인코딩 깨짐 수정 스크립트
사용법: python3 fix_encoding.py
"""

import os
import re

SYLLABUS_DIR = "cora_data/syllabi"

files = [f for f in os.listdir(SYLLABUS_DIR) if f.endswith(".html")]
print(f"총 {len(files)}개 파일 수정 시작...")

success = 0
fail = 0

for i, fname in enumerate(files):
    fpath = os.path.join(SYLLABUS_DIR, fname)

    with open(fpath, "rb") as f:
        raw = f.read()

    # EUC-KR → UTF-8 시도, 실패시 CP949 시도
    text = None
    for enc in ["euc-kr", "cp949", "utf-8"]:
        try:
            text = raw.decode(enc)
            break
        except:
            continue

    if text is None:
        print(f"  ⚠️ {fname} 실패: 모든 인코딩 시도 실패")
        fail += 1
        continue

    # 기존 charset 선언 교체
    text = re.sub(r'charset=["\']?[\w-]+["\']?', 'charset="utf-8"', text)

    # meta charset 없으면 추가
    if 'charset="utf-8"' not in text:
        text = text.replace('<head>', '<head>\n<meta charset="utf-8">', 1)
    if 'charset="utf-8"' not in text:
        text = '<meta charset="utf-8">\n' + text

    with open(fpath, "w", encoding="utf-8") as f:
        f.write(text)

    success += 1
    if (i+1) % 50 == 0:
        print(f"  {i+1}/{len(files)} 완료")

print(f"\n✅ 완료! 성공: {success}개, 실패: {fail}개")
