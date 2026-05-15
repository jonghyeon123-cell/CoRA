"""
HWP 파일에서 텍스트 추출 스크립트
사용법: python3 extract_hwp.py
"""

import os
import json
import zlib
import olefile

FILES_DIR = "cora_data/files"
OUTPUT_FILE = "cora_data/hwp_texts.json"


def extract_hwp_text(filepath):
    """HWP 파일에서 텍스트 추출"""
    try:
        with olefile.OleFileIO(filepath) as ole:
            # BodyText 섹션에서 텍스트 추출
            sections = []
            i = 0
            while True:
                stream_name = f"BodyText/Section{i}"
                if not ole.exists(stream_name):
                    break
                data = ole.openstream(stream_name).read()

                # 압축 해제 시도
                try:
                    data = zlib.decompress(data, -15)
                except:
                    pass

                # 텍스트 파싱 (HWP 레코드 구조)
                text = parse_hwp_text(data)
                sections.append(text)
                i += 1

            return "\n".join(sections)
    except Exception as e:
        return f"[추출 실패: {e}]"


def parse_hwp_text(data):
    """HWP 바이너리에서 텍스트 레코드 파싱"""
    texts = []
    i = 0
    while i < len(data) - 4:
        try:
            # 레코드 헤더 파싱
            header = int.from_bytes(data[i:i+4], "little")
            rec_type = header & 0x3FF
            rec_len = (header >> 20) & 0xFFF

            if rec_len == 0xFFF:
                # 긴 레코드
                rec_len = int.from_bytes(data[i+4:i+8], "little")
                i += 4

            i += 4
            rec_data = data[i:i+rec_len]

            # 레코드 타입 67 = 문단 텍스트
            if rec_type == 67:
                text = rec_data.decode("utf-16-le", errors="ignore")
                text = text.replace("\x00", "").strip()
                if text:
                    texts.append(text)

            i += rec_len
        except:
            i += 1

    return "\n".join(texts)


def process_all_hwp():
    """files 폴더의 모든 HWP 파일 처리"""
    hwp_files = [f for f in os.listdir(FILES_DIR) if f.lower().endswith(".hwp")]
    print(f"총 {len(hwp_files)}개 HWP 파일 처리 시작...")

    results = {}
    for i, fname in enumerate(hwp_files):
        fpath = os.path.join(FILES_DIR, fname)
        print(f"[{i+1}/{len(hwp_files)}] {fname}")

        text = extract_hwp_text(fpath)
        results[fname] = text

        if text and not text.startswith("[추출 실패"):
            preview = text[:100].replace("\n", " ")
            print(f"  ✅ 추출 성공: {preview}...")
        else:
            print(f"  ❌ {text}")

    # 결과 저장
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    success = sum(1 for v in results.values() if not v.startswith("[추출 실패"))
    print(f"\n✅ 완료! {success}/{len(hwp_files)}개 성공")
    print(f"📁 결과: {OUTPUT_FILE}")


if __name__ == "__main__":
    process_all_hwp()
