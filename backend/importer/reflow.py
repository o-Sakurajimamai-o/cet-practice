"""按 PDF 版面坐标合并软换行。

PDF 文字提取保留的是物理行：一句话写到栏宽尽头会被迫折到下一行，入库后网页按
pre-wrap 原样显示，就出现「描写叙事型典 / 型句式」这类断行。

判定沿用排版引擎本身的折行规则：若下一行的首个词放得进上一行末尾的剩余空间，
上一行就是真正的段尾；放不下才是被迫折行。只对「PDF 中确实相邻、且判定为折行」
的两行做合并，题号、选项标签、【答案】等短行天然保留。
"""
from __future__ import annotations

import hashlib
import json
import re
from collections import defaultdict
from pathlib import Path

import pymupdf

from .extract import _DROP_LINE

_WS = re.compile(r"\s+")
# 中日韩字符与全角标点：两侧有此类字符时直接拼接，不加空格。
_CJK = re.compile(r"[⺀-鿿　-〿＀-￯…]")
# 以这些标记开头的行永远是新起的条目，不并入上一行。
_NEW_ITEM = re.compile(r"^(【|[A-D]\)|[A-D]）|\d+\.\s|[•·●■◆▶])")


def line_key(text: str) -> str:
    return _WS.sub(" ", text).strip()


_NO_LINE_START = set("。，、；：？！）」』”’》〉…—·.,;:?!)")
_NO_LINE_END = set("（「『“‘《〈(")


def _first_token_width(chars: list[dict]) -> float:
    """下一行首个「不可拆分单位」的宽度：CJK 为单字（连同避头尾规则粘在一起的标点），
    西文为首个空格前的词。"""
    chars = [c for c in chars if c["c"].strip()]
    if not chars:
        return 0.0
    if _CJK.match(chars[0]["c"]) or chars[0]["c"] in _NO_LINE_END:
        i = 0
        while i + 1 < len(chars) and chars[i]["c"] in _NO_LINE_END:
            i += 1  # 开括号不能留在行尾，必须和后一个字一起换行
        while i + 1 < len(chars) and (chars[i + 1]["c"] in _NO_LINE_START or (chars[i + 1]["c"] in "\"'" and i + 2 < len(chars) and chars[i + 2]["c"] in _NO_LINE_START)):
            i += 1  # 句号、逗号等不能出现在行首，会把前一个字一起带到下一行（含 联"， 这类引号+标点）
        return chars[i]["bbox"][2] - chars[0]["bbox"][0]
    end = chars[0]
    start_x = chars[0]["bbox"][0]
    for c in chars:
        if c["bbox"][0] - end["bbox"][2] > 1.0:  # 字符间出现空白间距即词尾
            break
        end = c
    return end["bbox"][2] - start_x


def _page_lines(page) -> list[dict]:
    lines = []
    for block in page.get_text("rawdict")["blocks"]:
        for ln in block.get("lines", []):
            chars = [c for s in ln["spans"] for c in s["chars"]]
            text = "".join(c["c"] for c in chars)
            key = line_key(text)
            if not key or _DROP_LINE.match(text.rstrip()):
                continue
            sizes = [s["size"] for s in ln["spans"] if "".join(c["c"] for c in s["chars"]).strip()]
            lines.append({"key": key, "x0": ln["bbox"][0], "x1": ln["bbox"][2], "y0": ln["bbox"][1],
                          "y1": ln["bbox"][3], "size": max(sizes) if sizes else 0.0, "chars": chars})
    return lines


def _bucket(x0: float) -> int:
    return round(x0 / 6)


def _hanging_x(line: dict) -> float | None:
    """「【定位】正文…」这类标签行，续行对齐到标签后的正文起点。"""
    chars = [c for c in line["chars"] if c["c"].strip()]
    for i, c in enumerate(chars[:-1]):
        if c["c"] == "】":
            return chars[i + 1]["bbox"][0]
    return None


def pdf_line_pairs(path: str | Path) -> dict[tuple[str, str], set[bool]]:
    """PDF 中每对相邻行 -> 是否折行（同一对行在不同位置结论不一时两种都记）。"""
    doc = pymupdf.open(Path(path))
    pages = [_page_lines(p) for p in doc]
    # 栏宽右界按「同页、同一左缩进」的行的最远右端估计，盒子内文字与通栏文字各自成组；
    # 同组行数太少时退回全文件同缩进的右界，避免把几行短句互相当成写满一行。
    doc_right: dict[int, float] = defaultdict(float)
    page_right: list[dict[int, list[float]]] = []
    for lines in pages:
        groups: dict[int, list[float]] = defaultdict(list)
        for ln in lines:
            b = _bucket(ln["x0"])
            doc_right[b] = max(doc_right[b], ln["x1"])
            groups[b].append(ln["x1"])
        page_right.append(groups)

    def right_edge(pi: int, x0: float) -> float:
        b = _bucket(x0)
        xs = [x for k in (b - 1, b, b + 1) for x in page_right[pi].get(k, [])]
        if len(xs) >= 4:
            return max(xs)
        return max(doc_right.get(b - 1, 0.0), doc_right.get(b, 0.0), doc_right.get(b + 1, 0.0))

    pairs: dict[tuple[str, str], set[bool]] = defaultdict(set)
    flat = [(pi, ln) for pi, lines in enumerate(pages) for ln in lines]
    for (pa, a), (pb, b) in zip(flat, flat[1:]):
        wrapped = False
        hang = _hanging_x(a)
        # 续行与上一行左对齐；或回到左边（上一行是首行缩进 / 句架模板缩进）；
        # 或对齐到「【标签】」之后的正文起点（悬挂缩进）。
        aligned = (a["x0"] - 70 <= b["x0"] <= a["x0"] + 6) or (hang is not None and abs(hang - b["x0"]) <= 3)
        same_flow = abs(a["size"] - b["size"]) <= 1.2 and aligned
        if pa == pb:
            # 同页：下一行须紧接在下方（同行并排的标签、跨栏跳转都不算）。
            same_flow = same_flow and b["y0"] > a["y0"] + 0.5 * a["size"] and b["y0"] - a["y1"] < 1.0 * a["size"]
        if same_flow and not _NEW_ITEM.match(b["key"]):
            space = 0.0 if _CJK.match(b["key"][0]) or _CJK.match(a["key"][-1]) else 0.25 * a["size"]
            edge = max(right_edge(pa, a["x0"]), right_edge(pa, b["x0"])) if b["x0"] < a["x0"] - 6 else right_edge(pa, a["x0"])
            wrapped = a["x1"] + space + _first_token_width(b["chars"]) > edge - 0.6 * a["size"]
        pairs[(a["key"], b["key"])].add(wrapped)
    return pairs


def merge_pairs(target: dict, more: dict) -> None:
    for k, v in more.items():
        target.setdefault(k, set()).update(v)


def _joiner(prev: str, nxt: str) -> str:
    if _CJK.match(prev[-1]) or _CJK.match(nxt[0]):
        return ""
    if prev.endswith("-") and len(prev) > 1 and prev[-2].isalpha():
        return ""
    return " "


class WebText:
    """来源网站（PDF 页脚所印网址）的正文，去掉全部空白后保存。

    strict：除加粗、斜体等纯排版标签外，任何元素边界都记为断点（\\x01）；
    loose ：<span> 也视作行内标签，句中高亮词不会把句子切断。
    """

    def __init__(self, corpora: list[tuple[str, str]]):
        self.strict = "\x02".join(s for s, _ in corpora)
        self.loose = "\x02".join(l for _, l in corpora)

    def verdict(self, prev: str, nxt: str) -> str | None:
        """'join'：网页上两行是同一段连续文字；'maybe'：仅在忽略 span 时连续；
        'break'：两行都能在网页找到但不相连；None：网页上找不到。"""
        a_all, b_all = _WS.sub("", prev), _WS.sub("", nxt)
        a, b = a_all[-10:], b_all[:10]
        if not a or not b:
            return None
        # 短行就是整行：要求它在网页上也恰好位于元素开头/结尾，免得「动词」「名词」这类
        # 短词偶然拼出别处句子里的「动词名词」。
        lead = "\x01" if len(a_all) <= 10 else ""
        tail = "\x01" if len(b_all) <= 10 else ""
        if lead + a + b + tail in self.strict:
            return "join"
        if lead + a + b + tail in self.loose:
            return "maybe"
        if a in self.loose and b in self.loose:
            return "break"
        return None


OVERRIDES_PATH = Path(__file__).with_name("reflow_overrides.json")


def pair_hash(scope: str, prev_key: str, key: str) -> str:
    """scope 为试卷编号：同一对行在不同试卷的网页上结构可能不同，按试卷分别记录。"""
    return hashlib.sha1((scope + "\x00" + prev_key + "\n" + key).encode("utf-8")).hexdigest()[:16]


class Overrides:
    """离线导入时代替 WebText：记录来源网页推翻了坐标判定的那些相邻行（只存哈希）。"""

    def __init__(self, path: Path = OVERRIDES_PATH, scope: str = ""):
        if isinstance(path, Overrides):  # scoped() 共享已加载的集合
            self.join, self.brk = path.join, path.brk
        else:
            data = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
            self.join = set(data.get("join", []))
            self.brk = set(data.get("break", []))
        self.scope = scope

    def scoped(self, scope: str) -> "Overrides":
        return Overrides(self, scope)

    def verdict(self, prev: str, nxt: str) -> str | None:
        h = pair_hash(self.scope, prev, nxt)
        if h in self.join:
            return "join"
        if h in self.brk:
            return "break"
        return None


_OVERRIDES: Overrides | None = None


def default_overrides() -> Overrides:
    global _OVERRIDES
    if _OVERRIDES is None:
        _OVERRIDES = Overrides()
    return _OVERRIDES


_SENTENCE_END_LATIN = re.compile(r"[.!?][\"'”’)]*$")
_LABEL_ONLY = re.compile(r"^【[^】]{1,8}】\S{0,4}$")
_BULLET_ONLY = re.compile(r"^[·•●■◆▶]$")


def _geometry_guard(prev: str, nxt: str) -> bool:
    """坐标判定的兜底保护：英文句子结束后另起中文（原句 → 译文）、只有标签的短行，都不是折行。"""
    if _SENTENCE_END_LATIN.search(prev) and _CJK.match(nxt[0]):
        return False
    return not _LABEL_ONLY.match(prev)


def reflow_text(text: str, pairs: dict[tuple[str, str], set[bool]], web: WebText | None = None) -> str:
    """合并 text 中被 PDF 排版折断的行，其余换行、空行原样保留。

    优先以来源网页的段落结构为准；网页上找不到的行，再用 PDF 坐标判定（见 pdf_line_pairs）。
    网页上只有忽略 <span> 才连续的两行（多为「替换对照 + 批注」）一律保留换行。
    """
    if not text or "\n" not in text:
        return text
    lines = text.split("\n")
    out = [lines[0]]
    prev_key = line_key(lines[0])
    for line in lines[1:]:
        key = line_key(line)
        join = False
        if prev_key and key:
            verdict = web.verdict(prev_key, key) if web is not None else None
            if _BULLET_ONLY.match(prev_key):
                join = True  # 项目符号单独成行，属于下一行的开头
            elif verdict == "join":
                join = True
            elif verdict is None:
                join = pairs.get((prev_key, key)) == {True} and _geometry_guard(prev_key, key)
        if join:
            out[-1] = out[-1].rstrip() + _joiner(out[-1].rstrip(), line.lstrip()) + line.lstrip()
        else:
            out.append(line)
        prev_key = key
    return "\n".join(out)


def tidy_insight(text: str) -> str:
    """句子精讲页按版面提取，带有行首缩进和成串空行；收拢为单个空行分段。"""
    lines = [line.strip() for line in text.split("\n")]
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip("\n")


REFLOW_CONTENT_KEYS = ("passage", "paragraph_notes", "sentence_notes")


def reflow_section(conn, paper_id: int, section: str, pdfs: list[Path], web=None) -> int:
    """导入后整理一个题型分区：题干、解析、逐段/逐句解析、句子精讲。返回改动记录数。

    web 缺省时使用随导入器提供的网页核对结果（reflow_overrides.json）。
    """
    if web is None:
        paper = conn.execute("SELECT paper_key FROM papers WHERE id=?", (paper_id,)).fetchone()
        web = default_overrides().scoped(paper[0] if paper else "")
    pairs: dict = {}
    for p in pdfs:
        if p is not None:
            merge_pairs(pairs, pdf_line_pairs(p))
    changed = 0
    rows = conn.execute("SELECT id, stem, analysis_text FROM questions WHERE paper_id=? AND section=? AND manual_locked=0",
                        (paper_id, section)).fetchall()
    for r in rows:
        stem, analysis = reflow_text(r["stem"], pairs, web), reflow_text(r["analysis_text"], pairs, web)
        if (stem, analysis) != (r["stem"], r["analysis_text"]):
            conn.execute("UPDATE questions SET stem=?, analysis_text=? WHERE id=?", (stem, analysis, r["id"]))
            changed += 1
    for r in conn.execute("SELECT id, content_json FROM section_materials WHERE paper_id=? AND section=?", (paper_id, section)).fetchall():
        if not r["content_json"]:
            continue
        content = json.loads(r["content_json"])
        before = json.dumps(content, ensure_ascii=False)
        for k in REFLOW_CONTENT_KEYS:
            if isinstance(content.get(k), str):
                content[k] = reflow_text(content[k], pairs, web)
        for page in content.get("sentence_insights") or []:
            page["text"] = tidy_insight(reflow_text(page["text"], pairs, web))
        after = json.dumps(content, ensure_ascii=False)
        if after != before:
            conn.execute("UPDATE section_materials SET content_json=? WHERE id=?", (after, r["id"]))
            changed += 1
    return changed
