"""真题 PDF 结构化解析：听力 / 选词填空 / 长篇阅读 / 仔细阅读 / 写作 / 翻译。

解析原则：
- 只按材料中实际出现的结构切分，不强套固定题数模板；
- 解析不出/不完整时记 flags 交给导入器标记，不编造内容。
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from .extract import PdfDoc, norm_space

_OPT = re.compile(r"^\s*([A-O])\)\s*(.*)$")
_Q_HEAD = re.compile(r"^\s*(\d{1,2})\.\s+(.*)$")
_PARA_HEAD = re.compile(r"^\s*([A-Z])\)\s*(.*)$")
_QGRP = re.compile(r"Questions\s+(\d+)\s+to\s+(\d+)\s+are\s+based\s+on")
_PASSAGE_HEAD = re.compile(r"^\s*Passage\s+(One|Two|Three)\b", re.IGNORECASE)
_DIR_HEAD = re.compile(r"^\s*Directions\s*:", re.IGNORECASE)
_SECTION_HEAD = re.compile(r"^\s*Section\s+([A-C])\s*$", re.IGNORECASE)
_PART_HEAD = re.compile(r"^\s*Part\s+(I|II|III|IV|V)\b")


@dataclass
class Q:
    q_no: int
    q_index: int
    qtype: str                     # mcq / blank / match / essay / translation
    group_key: str = ""
    stem: str | None = None
    options: list[dict] = field(default_factory=list)
    context: str = ""              # 选词填空空位所在句
    source_page: int = 1
    flags: list[str] = field(default_factory=list)


@dataclass
class SectionParse:
    directions: str = ""
    questions: list[Q] = field(default_factory=list)
    # 共享材料（key 见各题型）：
    word_bank: list[dict] = field(default_factory=list)      # cloze
    passage: str = ""                                         # cloze/matching/reading 文章
    passage2: str = ""                                        # reading 第二篇
    paragraphs: list[dict] = field(default_factory=list)     # matching: [{label, text}]
    transcript_groups: list[dict] = field(default_factory=list)  # listening: [{key, from,to,text}]
    prompt_text: str = ""                                     # writing/translation 题面
    title: str = ""                                           # matching 文章标题
    blank_nos: list[int] = field(default_factory=list)        # cloze 空号
    blank_pages: dict[int, int] = field(default_factory=dict)
    flags: list[str] = field(default_factory=list)


# ---------------------------------------------------------------- 听力
def parse_listening(doc: PdfDoc) -> SectionParse:
    sp = SectionParse()
    lines = doc.text.splitlines()
    # Directions 区（取第一个 Directions 块的原文，通常各 Section Directions 相同主题）
    dir_lines: list[str] = []
    groups: list[dict] = []
    cur_group: dict | None = None
    cur_q: Q | None = None
    q_started = False

    for ln in lines:
        s = ln.rstrip()
        m_grp = _QGRP.search(s)
        if m_grp and not q_started:
            pass  # 首个 Questions 头之前可能是 Directions
        if _DIR_HEAD.match(s):
            if not q_started:
                dir_lines.append(s)
            else:
                cur_q = None
            continue
        if m_grp:
            cur_group = {
                "key": f"g{len(groups)+1}",
                "from": int(m_grp.group(1)),
                "to": int(m_grp.group(2)),
                "text": "",
            }
            groups.append(cur_group)
            cur_q = None
            q_started = True
            continue
        if _SECTION_HEAD.match(s) or _PART_HEAD.match(s):
            continue
        mq = _Q_HEAD.match(s)
        mo = _OPT.match(s)
        if mq and mo is None and q_started:
            n = int(mq.group(1))
            rest = mq.group(2).strip()
            cur_q = Q(q_no=n, q_index=n, qtype="mcq", group_key=cur_group["key"] if cur_group else "g?")
            # 听力题干不印在卷面：rest 若是选项则直接是 A) 内容
            m2 = _OPT.match(rest)
            if m2:
                cur_q.options.append({"key": m2.group(1), "text": m2.group(2).strip()})
            elif rest:
                # 少见：题干与题号同行的印刷题
                cur_q.stem = rest
            sp.questions.append(cur_q)
            continue
        if mo and cur_q is not None:
            cur_q.options.append({"key": mo.group(1), "text": mo.group(2).strip()})
            continue
        if cur_q is not None and cur_q.options and s.strip() and not re.fullmatch(r"\s*\d+\s*", s):
            cur_q.options[-1]["text"] += " " + s.strip()
    sp.directions = " ".join(x.strip() for x in dir_lines[:6])
    sp.questions.sort(key=lambda q: q.q_no)
    for i, q in enumerate(sp.questions):
        q.q_index = i
        for option in q.options:
            # One source prints "22. A) A) ...". Do not show a second label
            # inside the already-labelled option; its wording stays verbatim.
            option["text"] = re.sub(rf"^(?:{re.escape(option['key'])}\)\s*)+", "", option["text"])
        for page_no, page in enumerate(doc.pages, 1):
            if re.search(rf"(?m)^\s*{q.q_no}\.\s+", page):
                q.source_page = page_no
                break
        if len(q.options) < 2:
            q.flags.append("选项数异常")
        if not q.group_key or q.group_key == "g?":
            q.flags.append("未归入听力篇目")
    sp.transcript_groups = groups
    return sp


# ---------------------------------------------------------------- 选词填空
def parse_cloze(doc: PdfDoc) -> SectionParse:
    sp = SectionParse()
    lines = doc.text.splitlines()
    bank_started = False
    passage_lines: list[str] = []
    dir_lines: list[str] = []
    blank_nos: list[int] = []   # 卷末答题卡式空号（如单独成行的 26..35）
    # 词库区以独立成行的 "A)" / "A) word" 开始（A)–O) 连续；字母与单词可能分行）
    i = 0
    n = len(lines)
    # Some source banks print bare letters on separate lines, without ')'.
    bank_option = re.compile(r"^\s*([A-O])(?:\)|(?=\s*$))\s*(.*)$")
    while i < n:
        s = lines[i].rstrip()
        m = bank_option.match(s)
        if not bank_started and m and m.group(1) == "A":
            bank_started = True
        if _DIR_HEAD.match(s) and not passage_lines and not bank_started:
            dir_lines.append(s)
            i += 1
            continue
        if bank_started:
            # 词库之后的答题卡式空号行（" 26 "）
            if re.match(r"^\s*\d{1,3}\s*$", s):
                v = int(s.strip())
                if 9 <= v <= 60:
                    blank_nos.append(v)
                i += 1
                continue
            if m and len(m.group(1)) == 1:
                word = m.group(2).strip()
                if not word and i + 1 < n:
                    # 分行格式：A) 换行 affirmed
                    nxt = lines[i + 1].strip()
                    if nxt and not bank_option.match(nxt):
                        word = nxt
                        i += 1
                if word:
                    sp.word_bank.append({"key": m.group(1), "text": word})
            i += 1
            continue
        # 卷面正文中出现的独立数字行（页码等）不进原文
        if re.match(r"^\s*\d{1,3}\s*$", s) and passage_lines:
            i += 1
            continue
        passage_lines.append(s)
        i += 1
    sp.directions = " ".join(x.strip() for x in dir_lines[:6])
    sp.passage = _join_passage(passage_lines)
    sp.blank_nos = blank_nos
    if doc.layout_pages:
        # The original PDFs position blank numbers as floating spans. Reading in
        # visual order puts them back in the exact sentence, without fuzzy insertion.
        layout_text = "\n\n".join(doc.layout_pages)
        layout_text = re.sub(r"(?<!\d)(\d{1,2})\u2003", lambda m: f"__({m.group(1)})__ ", layout_text)
        direction = re.search(r"Directions\s*:", layout_text, re.I)
        if direction:
            end = re.search(r"\n\s*\n", layout_text[direction.start():])
            if end:
                offset = direction.start() + end.end()
                sp.directions = norm_space(layout_text[direction.start():direction.start() + end.start()])
                layout_text = layout_text[offset:]
        bank = re.search(r"(?m)^\s*A\)\s", layout_text)
        if not bank and sp.word_bank:
            # Match the extracted first bank word, not an article "A ..." at
            # the beginning of a passage paragraph.
            bank = re.search(rf"(?m)^\s*A\s+{re.escape(sp.word_bank[0]['text'])}(?=\s|$)", layout_text)
        if bank:
            layout_text = layout_text[:bank.start()]
        sp.passage = '\n\n'.join(norm_space(paragraph) for paragraph in _join_passage(layout_text.splitlines()).split('\n') if paragraph.strip())
        sp.blank_nos = [int(n) for n in re.findall(r"__\((\d+)\)__", sp.passage)]
        for page_no, page_text in enumerate(doc.layout_pages, 1):
            for number in re.findall(r"__\((\d+)\)__", page_text):
                sp.blank_pages[int(number)] = page_no
    return sp


def _join_passage(lines: list[str]) -> str:
    """把 PDF 断行拼回段落：空行分段，句号后接行保持空格。"""
    out: list[str] = []
    buf = ""
    for ln in lines:
        if not ln.strip():
            if buf:
                out.append(buf.strip())
                buf = ""
            continue
        t = ln.strip()
        if buf:
            buf += (" " if not buf.endswith("-") and not t.startswith(" ") else "") + t
        else:
            buf = t
    if buf:
        out.append(buf.strip())
    return "\n".join(out)


# ---------------------------------------------------------------- 长篇阅读（信息匹配）
def parse_matching(doc: PdfDoc) -> SectionParse:
    sp = SectionParse()
    lines = doc.text.splitlines()
    para_started = False
    stmt_started = False
    cur_para: dict | None = None
    dir_lines: list[str] = []
    body: list[str] = []

    for ln in lines:
        s = ln.rstrip()
        if _DIR_HEAD.match(s) and not para_started:
            dir_lines.append(s)
            continue
        body.append(s)
    sp.directions = " ".join(x.strip() for x in dir_lines[:6])

    for s in body:
        if re.match(r"^\s*(Part\s+[IVX]+|Section\s+[A-C])\s*$", s, re.IGNORECASE):
            continue
        m = _PARA_HEAD.match(s)
        mq = _Q_HEAD.match(s)
        if not para_started and m and m.group(1) == "A":
            para_started = True
        if para_started and not stmt_started and mq and 9 <= int(mq.group(1)) <= 60:
            n = int(mq.group(1))
            # 首个陈述题号：通常 36-45（以材料为准：必须已有段落且行内容非空）
            if sp.paragraphs and re.search(r"[A-Za-z]", mq.group(2)):
                stmt_started = True
        if stmt_started:
            if mq:
                sp.questions.append(
                    Q(q_no=int(mq.group(1)), q_index=0, qtype="match", stem=mq.group(2).strip())
                )
            elif sp.questions and s.strip():
                last = sp.questions[-1]
                last.stem = (last.stem + " " + s.strip()).strip()
            continue
        if para_started and m and len(m.group(1)) == 1 and m.group(2).strip():
            cur_para = {"label": m.group(1), "text": m.group(2).strip()}
            sp.paragraphs.append(cur_para)
            continue
        if cur_para is not None and s.strip():
            cur_para["text"] += " " + s.strip()
        elif not para_started and s.strip() and not sp.title:
            sp.title = s.strip()
    # 只保留最长的连续题号串（剔除正文中数字行误判，如 "15." 开头的行）
    runs: list[list[int]] = []
    for idx, q in enumerate(sp.questions):
        if runs and q.q_no == sp.questions[idx - 1].q_no + 1:
            runs[-1].append(idx)
        else:
            runs.append([idx])
    if runs:
        best = max(runs, key=len)
        dropped = [sp.questions[i].q_no for i in range(len(sp.questions)) if i not in set(best)]
        sp.questions = [sp.questions[i] for i in best]
        if dropped:
            sp.flags.append(f"剔除疑似非陈述句行: {dropped}")
    for i, q in enumerate(sp.questions):
        q.q_index = i
        if not q.stem:
            q.flags.append("陈述句为空")
        for page_no, page in enumerate(doc.pages, 1):
            if re.search(rf"(?m)^\s*{q.q_no}\.\s+", page):
                q.source_page = page_no
                break
    first_para = re.search(r"(?m)^\s*A\)\s", doc.text)
    if first_para:
        before = [line.strip() for line in doc.text[:first_para.start()].splitlines() if line.strip()]
        if before and not re.match(r"^(Part|Section|Directions)", before[-1]):
            sp.title = before[-1]
    return sp


# ---------------------------------------------------------------- 仔细阅读
def parse_reading(doc: PdfDoc) -> SectionParse:
    sp = SectionParse()
    lines = doc.text.splitlines()
    # 分篇
    parts: list[tuple[str, list[str]]] = []
    cur_name, cur_lines = "", []
    for ln in lines:
        m = _PASSAGE_HEAD.match(ln)
        if m:
            if cur_name or cur_lines:
                parts.append((cur_name, cur_lines))
            cur_name, cur_lines = m.group(1), []
            continue
        cur_lines.append(ln.rstrip())
    if cur_name or cur_lines:
        parts.append((cur_name, cur_lines))

    dir_lines: list[str] = []
    passages: list[str] = []
    qparts: list[list[str]] = []
    for name, pls in parts:
        # 每篇内部：Directions(第一篇)/正文 vs 题目（首个 题号. 行起）
        sub_passage: list[str] = []
        sub_q: list[str] = []
        q_begin = None
        for i, s in enumerate(pls):
            if _Q_HEAD.match(s) and re.match(r"^\s*\d{1,2}\.\s", s):
                q_begin = i
                break
        if q_begin is None:
            sub_passage = pls
        else:
            sub_passage = pls[:q_begin]
            sub_q = pls[q_begin:]
        if name == "" and not sub_q:
            # 文件头（Directions 等公共部分）
            for s in sub_passage:
                if _DIR_HEAD.match(s):
                    dir_lines.append(s)
            continue
        passages.append(_join_passage([x for x in sub_passage if x.strip()]))
        qparts.append(sub_q)

    sp.directions = " ".join(x.strip() for x in dir_lines[:6])
    q_no_seq = 0
    for pi, sub_q in enumerate(qparts):
        cur_q: Q | None = None
        for s in sub_q:
            mq = _Q_HEAD.match(s)
            mo = _OPT.match(s)
            if mq and not mo:
                cur_q = Q(
                    q_no=int(mq.group(1)),
                    q_index=0,
                    qtype="mcq",
                    group_key=f"passage{pi+1}",
                    stem=mq.group(2).strip(),
                )
                sp.questions.append(cur_q)
                continue
            if mo and cur_q is not None:
                cur_q.options.append({"key": mo.group(1), "text": mo.group(2).strip()})
            elif cur_q is not None and s.strip():
                if re.fullmatch(r"\s*\d+\s*", s) or _PART_HEAD.match(s) or _DIR_HEAD.match(s):
                    continue
                if cur_q.options:
                    cur_q.options[-1]["text"] += " " + s.strip()
                else:
                    cur_q.stem = (cur_q.stem + " " + s.strip()).strip()
    sp.questions.sort(key=lambda q: q.q_no)
    for i, q in enumerate(sp.questions):
        q.q_index = i
        if len(q.options) != 4:
            q.flags.append(f"选项数={len(q.options)}")
        for page_no, page in enumerate(doc.pages, 1):
            if re.search(rf"(?m)^\s*{q.q_no}\.\s+", page):
                q.source_page = page_no
                break
    sp.passage = passages[0] if len(passages) > 0 else ""
    sp.passage2 = passages[1] if len(passages) > 1 else ""
    if not passages:
        sp.flags.append("未找到 Passage 正文")
    return sp


# ---------------------------------------------------------------- 写作 / 翻译
def parse_writing(doc: PdfDoc) -> SectionParse:
    sp = SectionParse()
    lines = [ln.strip() for ln in doc.text.splitlines() if ln.strip()]
    body = []
    for ln in lines:
        if _PART_HEAD.match(ln) or ln == "Part I":
            continue
        body.append(ln)
    sp.prompt_text = "\n".join(body)
    sp.questions = [Q(q_no=1, q_index=0, qtype="essay", stem=sp.prompt_text)]
    return sp


def parse_translation(doc: PdfDoc) -> SectionParse:
    sp = SectionParse()
    lines = [ln.strip() for ln in doc.text.splitlines() if ln.strip()]
    body = []
    for ln in lines:
        if _PART_HEAD.match(ln) or ln == "Part IV":
            continue
        body.append(ln)
    sp.prompt_text = "\n".join(body)
    sp.questions = [Q(q_no=1, q_index=0, qtype="translation", stem=sp.prompt_text)]
    return sp
