"""考研板块的纯函数：标签、试卷标题、新题型版式、材料规整、计分与答案核验（只用标准库，不访问数据库）。

材料有两种存储结构：45 套 canonical 导入的结构，以及 2026-kaoyan-1 由旧修复脚本写入的预览结构
（chain_structure、source_image、translation_json.source_paragraph_translations）。两种都在这里规整成同一份
接口结构，数据库中的原始 content（含 source_html、远程图片地址）从不下发。
"""
from __future__ import annotations

import json
import re
from pathlib import PurePosixPath
from .kaoyan_pdf_links import PDF_LINKS

# Labels and titles must match frontend/src/exam.ts (KAOYAN_SECTION_CN, PARTB_VARIANT_CN, paperTitle).
SECTION_CN = {"cloze": "完形填空", "reading1": "阅读理解", "matching": "新题型", "translation": "翻译", "writing": "写作"}
SECTION_ORDER = ["cloze", "reading1", "matching", "translation", "writing"]
PARTB_VARIANT_CN = {"ordering": "排序", "gap": "七选五", "heading": "小标题", "opinion": "观点概括", "match": "信息匹配", "tf": "判断正误"}
TRACK_TITLE = {"one": "一", "two": "二", "historical": "统考"}
OBJECTIVE = {"cloze", "reading1", "matching"}

ANSWER_SOURCE = "懒笔记整卷答案表（非官方参考答案）"
# The answer table only points subjective items to the section pages, where the reference translations and essays are.
REFERENCE_SOURCE = "懒笔记分题型解析页（参考译文、范文，非官方）"
RESULT_NOTE = "正确率为客观题正确数 ÷ 已作答且有参考答案的题数；参考答案整理自懒笔记，非官方答案。"
SCORE_RULE = "完形每题 0.5 分，阅读理解 Part A 与新题型每题 2 分；不含翻译和写作（40 分）"
SCORE_FROM_YEAR = 2005
HALF_POINTS = {"cloze": 1, "reading1": 4, "matching": 4}  # 0.5 / 2 / 2 points, kept in halves to stay exact

PRIMARY_NAME = "懒笔记整卷答案表"
CHECK_LABEL = {"external_agree": "外部资料一致", "disputed_resolved": "有分歧·已复核", "disputed_unresolved": "有分歧·待裁定",
               "source_only": "仅来源答案", "manual": "已人工校正"}
CHECK_SUMMARY = {
    "external_agree": "参考答案与 {n} 份可定位的外部资料一致（非官方答案）",
    "disputed_resolved": "外部资料存在分歧，复核后保留参考答案（文本推理，非官方定论）",
    "disputed_unresolved": "外部资料存在分歧，尚未裁定，暂按参考答案判分",
    "source_only": "参考答案取自懒笔记，尚未找到可定位的外部资料核对",
    "manual": "本题答案已由你人工校正",
}
LEGACY_TRANSLATION_SOURCE = "懒笔记段落译文"
PDF_LABEL = {"question": "真题整卷 PDF", "analysis": "真题及解析 PDF"}

_KEY = re.compile(r"^(\d{4})-kaoyan-(1|2|historical)(?::|$)")
_BLANK = re.compile(r"__\((\d+)\)__")
_DIRECTIONS = re.compile(r"^\s*(?:\d{1,2}\s*[.．]\s*)?Directions?\s*[:：]", re.I)
_QUESTION_NO = re.compile(r"^\s*\d{1,2}\s*[.．]\s*")
# A period after an initial (G.I., U.S.) or a title (Dr., Mr.) does not end the sentence.
_SENTENCE_END = re.compile(r"(?:(?<!\b[A-Z])(?<!\b(?:Mr|Ms|Dr))(?<!\bMrs)\.|[!?])[\"”’)]*(?=\s)")
_CHART = re.compile(r"\b(?:charts?|graphs?|tables?|diagrams?)\b", re.I)
_PICTURE = re.compile(r"\b(?:pictures?|drawings?|cartoons?|photos?|photographs?)\b", re.I)


# ---------------------------------------------------------------- 试卷
def exam_of_key(key: str | None) -> str:
    """Exam of a paper key or uid; mirrors the orphan-mark SQL fallback in main.py."""
    key = key or ""
    return "cet4" if key.startswith("cet4-") else "kaoyan" if "-kaoyan-" in key else "cet6"


def track(paper_key: str | None, set_no: int | None = None) -> str:
    """英一 / 英二 / 统考 from the key suffix, else from set_no (1 / 2 / 0). Month is never used."""
    m = _KEY.match(paper_key or "")
    if m:
        return {"1": "one", "2": "two"}.get(m.group(2), "historical")
    return {1: "one", 2: "two"}.get(set_no, "historical")


def display_title(year: int, track_name: str) -> str:
    return f"{year} 年考研英语（{TRACK_TITLE.get(track_name, '统考')}）"


def coverage_note(year: int | None) -> str | None:
    if year and 1998 <= year <= 2001:
        return "来源未收录原卷的语法与词汇部分；题号按来源网站重新编号，与原卷不同。"
    if year and 2002 <= year <= 2004:
        return "来源未收录原卷的听力部分；题号按来源网站重新编号，与原卷不同。"
    return None


def paper_fields(paper) -> dict:
    """track and display_title of a kaoyan paper row (mapping with paper_key, year, set_no)."""
    name = track(paper["paper_key"], paper["set_no"])
    return {"track": name, "display_title": display_title(paper["year"], name)}


def section_label(section: str, variant: str | None = None) -> str:
    base = SECTION_CN.get(section, section)
    return f"{base} · {PARTB_VARIANT_CN[variant]}" if section == "matching" and variant in PARTB_VARIANT_CN else base


# ---------------------------------------------------------------- 版式
def _json(value, default):
    try:
        parsed = json.loads(value) if value else default
    except (TypeError, ValueError):
        return default
    return parsed if isinstance(parsed, type(default)) else default


def _texts(items) -> list[str]:
    return [str(item.get("text") or "") for item in items or [] if isinstance(item, dict)]


def partb_variant(directions: str | None, content: dict, option_keys) -> str:
    """Part B layout by the contract §2 rules (9 ordering, 1 tf, 11 heading, 2 opinion, 8 gap, 8 match)."""
    if content.get("given_chain") or content.get("chain_structure"):
        return "ordering"
    if set(option_keys) == {"T", "F"}:
        return "tf"
    if any(_BLANK.search(text) for text in _texts(content.get("paragraphs"))):
        if re.search(r"heading", directions or "", re.I):
            return "heading"
        if re.search(r"opinion|comment|statement|summar", directions or "", re.I):
            return "opinion"
        return "gap"
    return "match"


def _translation_paragraphs(content: dict) -> list[str]:
    """English paragraphs with the "(46)" markers kept; the Directions paragraph is not part of the text."""
    paragraphs = _texts(content.get("source_paragraphs"))
    if not paragraphs and content.get("prompt"):
        paragraphs = str(content["prompt"]).split("\n\n")
    return [text for text in paragraphs if text.strip() and not _DIRECTIONS.match(text)]


def _passage(content: dict) -> list[str]:
    passage = content.get("passage")
    return str(passage).split("\n\n") if passage else _texts(content.get("source_paragraphs"))


def paper_layout(materials, questions) -> dict:
    """Paper-wide facts, computed once per request: Part B variant, translation kind and sentences, cloze text.

    materials: section_materials rows (section, group_key, directions, content_json) of the paper's cloze,
    matching and translation sections; questions: its matching and translation rows (section, q_no, stem,
    options_json, answer). The sentence answers stay internal and are only emitted with include_refs.
    """
    mats = {row["section"]: row for row in materials}
    layout = {"matching": None, "translation": None, "sentences": [], "cloze": [], "options": []}
    if "cloze" in mats:
        layout["cloze"] = _passage(_json(mats["cloze"]["content_json"], {}))
    matching = [q for q in questions if q["section"] == "matching"]
    if matching or "matching" in mats:
        row = mats.get("matching")
        options = [_json(q["options_json"], []) for q in matching]
        keys = {o.get("key") for opts in options for o in opts if isinstance(o, dict)}
        layout["matching"] = partb_variant(row["directions"] if row else "", _json(row["content_json"], {}) if row else {}, keys)
        layout["options"] = clean_options(options[0]) if options else []
    translation = sorted((q for q in questions if q["section"] == "translation"), key=lambda q: q["q_no"] or 0)
    if translation:
        paragraphs = _translation_paragraphs(_json(mats["translation"]["content_json"], {})) if "translation" in mats else []
        sentence = any(f"({q['q_no']})" in text for q in translation for text in paragraphs)
        layout["translation"] = "translation_sentence" if sentence else "translation_passage"
        if sentence:
            layout["sentences"] = [(q["q_no"], q["stem"] or "", q["answer"]) for q in translation]
    return layout


def question_variant(section: str, layout: dict | None, answer=None) -> str | None:
    layout = layout or {}
    if section == "cloze":
        return "cloze"
    if section == "reading1":
        return "reading"
    if section == "matching":
        return layout.get("matching") or "match"
    if section == "translation":
        # Sentence questions keep their reference translation as the answer; the passage question has none.
        return layout.get("translation") or ("translation_sentence" if answer else "translation_passage")
    if section == "writing":
        return "writing"
    return None


def kaoyan_order(questions, scope) -> list:
    """Display order: exam section order, then papers as first met in the scope, then q_no.

    Within one paper this is plain q_no order, because q_no already follows 完形 → 阅读 A → 新题型 → 翻译 → 写作.
    """
    first: dict[str, int] = {}
    for uid in scope:
        first.setdefault(uid.rsplit(":", 2)[0], len(first))
    rank = {s: i for i, s in enumerate(SECTION_ORDER)}
    return sorted(questions, key=lambda q: (rank.get(q["section"], len(rank)), first.get(q["paper_key"], len(first)), q["q_no"] or 0))


# ---------------------------------------------------------------- 题目
def clean_options(options) -> list[dict]:
    """Only key and text: source_html hides invisible placeholder text and must never be sent."""
    return [{"key": o.get("key"), "text": o.get("text", "")} for o in options or [] if isinstance(o, dict)]


def answer_source(section: str) -> str:
    return ANSWER_SOURCE if section in OBJECTIVE else REFERENCE_SOURCE


def answer_word(section: str, options, answer) -> str:
    if section != "cloze" or not answer:
        return ""
    return next((o.get("text", "") for o in options if isinstance(o, dict) and o.get("key") == answer), "")


def answer_check(answer, manual_locked, check=None, primary_url=None) -> dict:
    """Evidence block of an objective question from its answer_checks row (or the source-only default)."""
    if check is None:
        result = {"status": "source_only", "label": CHECK_LABEL["source_only"], "summary": CHECK_SUMMARY["source_only"],
                  "basis": None, "primary": {"name": PRIMARY_NAME, "url": primary_url}, "external": [], "ruling": None,
                  "stale": False}
    else:
        detail = _json(check["detail_json"], {})
        external = detail.get("external") if isinstance(detail.get("external"), list) else []
        status = check["status"]
        summary = check["summary"]
        if not summary:
            agree = sum(1 for item in external if isinstance(item, dict) and item.get("verdict") == "agree") or len(external)
            summary = CHECK_SUMMARY.get(status, "").format(n=agree)
        result = {"status": status, "label": CHECK_LABEL.get(status, status), "summary": summary, "basis": check["basis"],
                  "primary": detail.get("primary") if isinstance(detail.get("primary"), dict) else {"name": PRIMARY_NAME, "url": primary_url},
                  "external": external, "ruling": detail.get("ruling") if isinstance(detail.get("ruling"), dict) else None,
                  # A check made against another letter no longer vouches for the current answer.
                  "stale": check["answer"] != answer}
    if manual_locked:
        result.update(status="manual", label=CHECK_LABEL["manual"], summary=CHECK_SUMMARY["manual"])
    return result


def check_counts(statuses) -> dict:
    counts: dict[str, int] = {}
    for status in statuses:
        counts[status] = counts.get(status, 0) + 1
    order = list(CHECK_LABEL)
    return {s: counts[s] for s in sorted(counts, key=lambda s: (order.index(s) if s in order else len(order), s))}


def _points(halves: int):
    return halves // 2 if halves % 2 == 0 else halves / 2


def score(items) -> dict:
    """Objective reference score from (section, verdict) pairs; totals follow the counts (60 for 2005+ papers)."""
    earned: dict[str, int] = {}
    total: dict[str, int] = {}
    for section, verdict in items:
        if section in HALF_POINTS:
            total[section] = total.get(section, 0) + HALF_POINTS[section]
            earned[section] = earned.get(section, 0) + (HALF_POINTS[section] if verdict == "correct" else 0)
    return {
        "earned": _points(sum(earned.values())), "total": _points(sum(total.values())),
        "by_section": {SECTION_CN[s]: {"earned": _points(earned[s]), "total": _points(total[s])} for s in SECTION_ORDER if s in total},
        "rule": SCORE_RULE,
    }


def _clip(text: str, limit: int = 120, anchor: int | None = None) -> str:
    """Shorten to at most `limit` chars; a long cloze sentence keeps its "____" (at `anchor`) in view."""
    if len(text) <= limit:
        return text
    if anchor is None or anchor + 4 < limit:
        return text[:limit - 1] + "…"
    end = min(len(text), anchor + 4 + (limit - 6) // 2)
    if end == len(text):
        return "…" + text[end - (limit - 1):]
    return "…" + text[end - (limit - 2):end] + "…"


def _sentence_at(text: str, start: int, end: int) -> str:
    left, right = 0, len(text)
    for m in _SENTENCE_END.finditer(text):
        if m.end() <= start:
            left = m.end()
        elif m.start() >= end:
            right = m.end()
            break
    return text[left:right].strip()


def writing_prompt(text: str | None) -> str:
    """Directions as the prompt: keep line breaks, drop the leading "51. " and NBSP double spacing."""
    # str.split() also splits on NBSP and ideographic spaces, so each line is re-spaced with single spaces.
    lines = [" ".join(line.split()) for line in _QUESTION_NO.sub("", text or "", count=1).splitlines()]
    return "\n".join(lines).strip()


def preview(section: str, q_no, stem: str | None, layout: dict | None) -> str:
    """One-line hint (≤120 chars) for the wrong book and favorites; kaoyan stems are often placeholders."""
    layout = layout or {}
    stem = " ".join((stem or "").split())
    if section == "cloze":
        marker = f"__({q_no})__"
        for text in layout.get("cloze") or []:
            pos = text.find(marker)
            if pos >= 0:
                sentence = " ".join(_sentence_at(text, pos, pos + len(marker)).split())
                sentence = _BLANK.sub(lambda m: "____" if m.group(0) == marker else f"({m.group(1)})", sentence)
                return _clip(sentence, anchor=sentence.find("____"))
    if section == "matching" and not stem:
        variant = layout.get("matching")
        return f"{PARTB_VARIANT_CN.get(variant, SECTION_CN['matching'])}第 {q_no} {'题' if variant == 'ordering' else '空'}"
    if section == "translation" and layout.get("translation") == "translation_passage":
        return "英译汉（整篇）"
    if section == "writing":
        prompt = " ".join(writing_prompt(stem).split())
        return prompt if len(prompt) <= 100 else prompt[:100] + "…"
    return _clip(stem)


# ---------------------------------------------------------------- 材料
def _u16(text: str, index: int) -> int:
    """UTF-16 offset, the unit of JS String.slice (identical to the Python index for BMP-only text)."""
    return index + sum(1 for ch in text[:index] if ord(ch) > 0xFFFF)


def underlines(paragraphs: list[str], sentences) -> tuple[list[dict], list[int]]:
    """Each underlined sentence starts right after its "(N)" marker (with or without a space).

    Returns the located spans and the q_no of any sentence that is not found verbatim.
    """
    found, missing = [], []
    for q_no, stem, *_ in sentences:
        target, marker, hit = (stem or "").strip(), f"({q_no})", None
        for i, text in enumerate(paragraphs):
            pos = text.find(marker) if target else -1
            while pos >= 0 and hit is None:
                start = pos + len(marker)
                while start < len(text) and text[start].isspace():
                    start += 1
                if text.startswith(target, start):
                    hit = {"q_no": q_no, "paragraph": i, "marker_start": _u16(text, pos), "marker_end": _u16(text, pos + len(marker)),
                           "start": _u16(text, start), "end": _u16(text, start + len(target))}
                pos = text.find(marker, pos + 1)
            if hit:
                break
        if hit:
            found.append(hit)
        else:
            missing.append(q_no)
    return found, missing


def split_reference(text: str | None) -> tuple[list[str], str | None]:
    """英二整篇参考译文 → P1..Pn paragraphs plus the commentary that starts at the first「【」."""
    text = text or ""
    cut = text.find("【")
    body, notes = (text[:cut], text[cut:].strip() or None) if cut >= 0 else (text, None)
    paragraphs: list[list[str]] = []
    loose: list[str] = []
    for line in body.splitlines():
        line = line.strip()
        # Lazynote's heading and its "复盘资产" remark describe the page, not the translation.
        if not line or line == "参考译文" or "复盘资产" in line:
            continue
        if re.fullmatch(r"P\d+", line):
            paragraphs.append([])
        elif paragraphs:
            paragraphs[-1].append(line)
        else:
            loose.append(line)
    if not paragraphs and loose:
        paragraphs = [loose]
    return ["\n".join(p) for p in paragraphs if p], notes


def _images(content: dict, prompt: str) -> list[dict]:
    """Offline copies only: download.file is served as /kaoyan-assets/<name>; the remote url is never used."""
    alt = "作文图表" if _CHART.search(prompt) and not _PICTURE.search(prompt) else "作文图画"
    sources = []
    for image in content.get("source_images") or []:
        download = image.get("download") if isinstance(image, dict) else None
        if isinstance(download, dict) and download.get("status") == 200 and download.get("file"):
            sources.append("/kaoyan-assets/" + PurePosixPath(str(download["file"]).replace("\\", "/")).name)
    legacy = content.get("source_image")  # 2026-1 preview structure: a site-relative path such as /previews/…/chart.jpg
    if isinstance(legacy, str) and legacy.startswith("/") and not legacy.startswith("//"):
        sources.append(legacy)
    return [{"src": src, "alt": alt} for src in sources]


def _chain(content: dict) -> list[dict]:
    """Ordering slots from given_chain [{given}|{question}] or the legacy chain_structure ["F", 41, …]."""
    slots = []
    for slot in content.get("given_chain") or []:
        if isinstance(slot, dict) and slot.get("given"):
            slots.append({"given": str(slot["given"])})
        elif isinstance(slot, dict) and slot.get("question") is not None:
            slots.append({"q_no": int(slot["question"])})
    if not slots:
        for slot in content.get("chain_structure") or []:
            slots.append({"q_no": int(slot)} if isinstance(slot, int) or str(slot).isdigit() else {"given": str(slot)})
    return slots


def _paragraph_translation(section: str, raw, count: int, include_refs: bool) -> dict:
    # Translation and writing sections never get paragraph translations: they would give the answers away.
    if not include_refs or section not in OBJECTIVE or not count:
        return {}
    data = _json(raw, {})
    paragraphs = data.get("paragraphs") if isinstance(data.get("paragraphs"), list) else data.get("source_paragraph_translations")
    if not isinstance(paragraphs, list) or len(paragraphs) != count or not all(isinstance(p, str) for p in paragraphs):
        return {}  # Misaligned translations are worse than none.
    return {"paragraphs": paragraphs, "source": data.get("source") or LEGACY_TRANSLATION_SOURCE}


def _material(section: str, row, section_directions: str, group_count: int, layout: dict, include_refs: bool) -> dict:
    content = _json(row["content_json"], {})
    group = row["group_key"] or "main"
    status = row["status"]
    aligned = 0
    if section == "cloze":
        body = {"variant": "cloze", "paragraphs": _passage(content)}
        aligned = len(body["paragraphs"])
    elif section == "reading1":
        number = group.split("_")[-1]
        body = {"variant": "reading", "title": content.get("title") or f"Text {number}", "paragraphs": _passage(content)}
        aligned = len(body["paragraphs"])
    elif section == "matching":
        variant = layout.get("matching") or partb_variant(row["directions"], content, ())
        paragraphs = [p for p in content.get("paragraphs") or [] if isinstance(p, dict)]
        if variant == "ordering":
            chain = _chain(content)
            body = {"variant": variant, "paragraphs": [],
                    "labeled_paragraphs": [{"label": str(p.get("label") or ""), "text": str(p.get("text") or "")} for p in paragraphs],
                    "chain": chain, "given": sorted(slot["given"] for slot in chain if "given" in slot), "options": []}
        else:
            shared = clean_options(content.get("shared_options")) or layout.get("options") or []
            body = {"variant": variant, "paragraphs": _texts(paragraphs), "options": [] if variant == "tf" else shared}
        aligned = len(paragraphs)
    elif section == "translation":
        paragraphs = _translation_paragraphs(content)
        variant = layout.get("translation") or "translation_passage"
        body = {"variant": variant, "paragraphs": paragraphs}
        if variant == "translation_sentence":
            body["underlines"], missing = underlines(paragraphs, layout.get("sentences") or [])
            if missing:
                status = "needs_review"  # Never guess an underline; the sentence still shows in its card.
            if include_refs:
                body["reference_sentences"] = [{"q_no": q_no, "text": answer} for q_no, _, answer in layout.get("sentences") or [] if answer]
        elif include_refs:
            body["reference_paragraphs"], body["reference_notes"] = split_reference(content.get("reference_translation"))
    elif section == "writing":
        prompt = writing_prompt(row["directions"] or content.get("prompt"))
        title = "大作文 · Part B" if group == "part_b" else "小作文 · Part A" if group == "part_a" and group_count > 1 else "作文"
        body = {"variant": "writing", "title": title, "prompt": prompt, "images": _images(content, prompt)}
        if include_refs:
            body["model_essay"] = content.get("model_essay") or None
            body["model_essay_cn"] = re.sub(r"^\s*【参考译文】\s*", "", content.get("model_essay_cn") or "") or None
    else:
        body = {"variant": None, "paragraphs": []}
    return {
        "group_key": group, "directions": row["directions"] or "", "section_directions": section_directions,
        "status": status, "content": body,
        "translation": _paragraph_translation(section, row["translation_json"], aligned, include_refs),
        "analysis_text": None,
    }


def materials(rows, layout: dict | None, include_refs: bool = False) -> dict[str, dict[str, dict]]:
    """Contract §5.4 payload of one paper: {section: {group_key: material}} in row order (section, group_key)."""
    grouped: dict[str, list] = {}
    for row in rows:
        grouped.setdefault(row["section"], []).append(row)
    out: dict[str, dict[str, dict]] = {}
    for section, group_rows in grouped.items():
        directions = next((r["directions"] for r in group_rows if (r["directions"] or "").strip()), "")
        out[section] = {(r["group_key"] or "main"): _material(section, r, directions, len(group_rows), layout or {}, include_refs)
                        for r in group_rows}
    return out


_GROUP_REFERENCES = ("model_essay", "model_essay_cn", "reference_paragraphs", "reference_notes", "reference_sentences")


def own_references(section_materials: dict[str, dict], question) -> dict[str, dict]:
    """Reveal before submission: keep only the revealed question's own references.

    One passage translation answers every blank or question of its text, and the five
    sentence references answer each other, so neither may reach the page early.
    """
    group = question["group_key"] or "main"
    out = {}
    for key, material in section_materials.items():
        content = dict(material["content"])
        if key != group:
            for field in _GROUP_REFERENCES:
                content.pop(field, None)
        elif "reference_sentences" in content:
            content["reference_sentences"] = [s for s in content["reference_sentences"] if s["q_no"] == question["q_no"]]
        out[key] = {**material, "content": content, "translation": {}}
    return out
