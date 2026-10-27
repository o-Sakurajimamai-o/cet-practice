"""Restore reading paragraph boundaries from the question PDF without changing the bank.

The existing passage is left intact.  Its paragraph starts are matched to first-line
indentation in the PDF and stored as JavaScript UTF-16 offsets.  Re-run after importing
new or revised question materials; source or matching problems are printed explicitly.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
from collections import Counter
from pathlib import Path

import pymupdf

ROOT = Path(__file__).resolve().parents[1]
SOURCE_ROOT = Path(os.environ.get('CET_RESOURCE_ROOT', ROOT.parent))
DEFAULT_DB = Path(os.environ.get('CET6_DB_PATH', ROOT / 'data' / 'cet6.db'))
EXCLUDED = re.compile(r'^(Directions|Questions|\d+\.|[A-D]\))', re.I)


def paragraph_offsets(passage: str, path: Path) -> list[int]:
    normalized = []
    offsets = []
    js_offset = 0
    for ch in passage:
        if not ch.isspace():
            normalized.append(ch)
            offsets.append(js_offset)
        js_offset += len(ch.encode('utf-16-le')) // 2
    normalized = ''.join(normalized)

    pages = []
    with pymupdf.open(path) as doc:
        for page in doc:
            lines = []
            for block in page.get_text('dict')['blocks']:
                for line in block.get('lines', []):
                    value = ''.join(span['text'] for span in line['spans']).strip()
                    if value:
                        lines.append((line['bbox'][0], line['bbox'][1], value))
            pages.append(sorted(lines, key=lambda item: (item[1], item[0])))

    # Use the whole document for the left margin: a page containing only one
    # indented paragraph line otherwise has no unindented body line for reference.
    margins = [x for lines in pages for x, _, text in lines
               if len(text) > 40 and not EXCLUDED.match(text)]
    if not margins:
        return []
    margin = min(margins)
    cuts = set()
    question_started = False
    for lines in pages:
        for x, _, text in lines:
            question = re.match(r'^(\d{1,2})\.\s', text)
            if question and 35 <= int(question.group(1)) <= 60:
                question_started = True
            if question_started:
                continue
            if x - margin < 12 or len(text) < 8 or EXCLUDED.match(text):
                continue
            source = re.sub(r'\s+', '', text)
            # Start with enough context to distinguish repeated sentence prefixes.
            # Shorten only where PDF text wrapping/encoding differs from the bank.
            for length in (80, 56, 40, 28, 20, 14):
                needle = source[:length]
                if len(needle) < 14:
                    continue
                first = normalized.find(needle)
                if first >= 0 and normalized.find(needle, first + 1) < 0:
                    if first:
                        cuts.add(offsets[first])
                    break
    return sorted(cuts)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--db', type=Path, default=DEFAULT_DB)
    parser.add_argument('--output', type=Path, default=ROOT / 'frontend' / 'src' / 'readingParagraphs.json')
    args = parser.parse_args()
    if not args.db.is_file():
        parser.error(f'数据库不存在：{args.db}')
    # Read only: no schema changes, migrations, or writes to the user's database.
    conn = sqlite3.connect(args.db.resolve().as_uri() + '?mode=ro', uri=True)
    counts = Counter()
    out = {}
    try:
        rows = conn.execute("""SELECT p.paper_key, s.section, s.source_file, s.content_json
            FROM section_materials s JOIN papers p ON p.id=s.paper_id
            WHERE s.section IN ('reading1', 'reading2')""").fetchall()
        for key, section, source, raw in rows:
            name = f'{key}:{section}'
            try:
                passage = json.loads(raw or '{}').get('passage', '')
                path = SOURCE_ROOT / (source or '')
                if not passage or not path.is_file():
                    counts['missing'] += 1
                    print(f'警告：{name} 正文或源 PDF 缺失，未生成分段。')
                    continue
                cuts = paragraph_offsets(passage, path)
                if not cuts:
                    counts['unsplit'] += 1
                    print(f'警告：{name} 未能找到自然段切分，请对照源 PDF。')
                    continue
                out[name] = cuts
                counts['split'] += 1
                counts['paragraphs'] += len(cuts) + 1
            except (OSError, ValueError, TypeError, RuntimeError) as exc:
                counts['error'] += 1
                print(f'警告：{name} 分段失败：{exc}')
    finally:
        conn.close()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_suffix(args.output.suffix + '.tmp')
    temporary.write_text(json.dumps(out, ensure_ascii=False, separators=(',', ':')), encoding='utf8')
    temporary.replace(args.output)
    print(f'阅读自然段：{counts["split"]}/{len(rows)} 篇已生成，{counts["paragraphs"]} 段；'
          f'缺源 {counts["missing"]}，未切分 {counts["unsplit"]}，失败 {counts["error"]}。')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
