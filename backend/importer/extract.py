"""PDF 文本提取与清理：去水印页眉页脚、保留段落结构、记录页码。"""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from pathlib import Path

import pymupdf

# 逐行匹配即可整行丢弃的页眉/页脚/水印
_DROP_LINE = re.compile(
    r"^\s*(懒笔记\s*·|在线使用效果更好|真题卷第\d+套\(\d{4}-\d{2}\)\s*[•·]\s*(?:英语)?[四六]级\s*$)\s*"
)
# 听力真题开头的在线收听引导块
_LISTENING_PROMO = re.compile(
    r"▶?\s*在线收听本套听力音频[\s\S]*?listening/\?f=p\s*", re.MULTILINE
)
# 纯页码行（如 " 26 "）
_PAGE_NO = re.compile(r"^\s*\d{1,3}\s*$")


def file_checksum(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _clean_page_text(text: str, is_first_page: bool) -> str:
    if is_first_page:
        text = _LISTENING_PROMO.sub("", text)
    lines = []
    for raw in text.splitlines():
        line = raw.rstrip()
        if _DROP_LINE.match(line):
            continue
        lines.append(line)
    return "\n".join(lines)


@dataclass
class PdfDoc:
    """提取后的 PDF：按页文本 + 全文；blank 页码定位用。"""

    pages: list[str] = field(default_factory=list)
    text: str = ""
    layout_pages: list[str] = field(default_factory=list)
    transcript_text: str = ""
    appendix_pages: list[dict] = field(default_factory=list)

    def page_of_offset(self, offset: int) -> int:
        """全文 offset 所在页码（1 起）。"""
        acc = 0
        for i, p in enumerate(self.pages):
            acc += len(p) + 1
            if offset < acc:
                return i + 1
        return len(self.pages)


def extract_pdf(path: str | Path, *, layout: bool = False, transcript: bool = False) -> PdfDoc:
    p = Path(path)
    doc = pymupdf.open(p)
    pages: list[str] = []
    layout_pages: list[str] = []
    transcript_pages: list[str] = []
    appendix_pages: list[dict] = []
    appendix_started = False
    for i, page in enumerate(doc):
        # PDF text insertion order can place the appendix heading before the
        # remaining real question explanation. Crop by its visible coordinates,
        # then keep blank page slots so original source page numbers stay valid.
        if appendix_started:
            appendix_pages.append({"page": i + 1, "text": _clean_page_text(page.get_text("text"), False)})
            pages.append("")
            if layout: layout_pages.append("")
            if transcript: transcript_pages.append("")
            continue
        clip = page.rect
        headings = [block for block in page.get_text("blocks")
                    if len(block) > 4 and isinstance(block[4], str)
                    and "SENTENCEINSIGHTS" in re.sub(r"\s+", "", block[4]).upper()
                    and "句子精讲" in block[4]]
        if headings:
            cutoff = min(block[1] for block in headings)
            clip = pymupdf.Rect(0, 0, page.rect.width, max(0, cutoff - 1))
            appendix_started = True
            appendix_pages.append({"page": i + 1, "text": _clean_page_text(page.get_text("text", clip=pymupdf.Rect(0, cutoff - 1, page.rect.width, page.rect.height)), False)})
        t = page.get_text("text", clip=clip)
        t = _clean_page_text(t, is_first_page=(i == 0))
        pages.append(t)
        if layout:
            positioned = page.get_text("text", sort=True, clip=clip)
            # Mark before rstrip: an em space at the right margin belongs to the
            # blank-number span and would otherwise be lost during page cleaning.
            positioned = re.sub(r"(?<!\d)(\d{1,2})\u2003", lambda m: f"__({m.group(1)})__ ", positioned)
            layout_pages.append(_clean_page_text(positioned, i == 0))
        if transcript:
            marked_lines = []
            for block in page.get_text("dict", clip=clip)["blocks"]:
                for line in block.get("lines", []):
                    spans = []
                    for span in line["spans"]:
                        value = span["text"]
                        # Transcript ordinals are separate small, bold monospace spans.
                        # A body line beginning with "1 percent ..." is not an ordinal.
                        if (re.fullmatch(r"\s*\d{1,2}\s*", value)
                                and "Consolas" in span["font"] and "Bold" in span["font"]
                                and span["size"] < 10):
                            value = f"@@TRANSCRIPT:{int(value.strip())}@@ "
                        spans.append(value)
                    marked_lines.append("".join(spans))
            transcript_pages.append(_clean_page_text("\n".join(marked_lines), i == 0))
    doc.close()
    return PdfDoc(pages=pages, text="\n".join(pages), layout_pages=layout_pages,
                  transcript_text="\n".join(transcript_pages), appendix_pages=appendix_pages)


def norm_space(s: str) -> str:
    """压缩空白用于匹配比较。"""
    return re.sub(r"\s+", " ", s).strip()
