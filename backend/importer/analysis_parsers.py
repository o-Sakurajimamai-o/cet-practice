"""解析 PDF（答案与讲解）结构化：提取逐题答案、解析文本、范文/参考译文。

各题型锚定规则（依据懒笔记解析 PDF 的实际排版）：
- 听力：每题以【题目】开始成块，块内含【答案】；锚定打印题 `N. A)`。
- 仔细阅读/长篇阅读：中文题干+【答案】位于打印题号锚点之前；块 = (上一锚点, 本锚点]，
  锚点后的标签段落（如最后一题的【选项】）并入本题。
- 选词填空：锚点行内含 __(N)__ 空格号，其后紧跟【答案】。
- 写作/翻译：整篇解析（范文、参考译文、逐段/逐句讲解）作为题型级材料。
答案一律记录来源文件与页码；数量与题数不符时记 flags，不猜测配对。
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from .extract import PdfDoc, norm_space

ANSWER_RE = re.compile(r"【答案】\s*([A-Z])(?:\)\s*(\S+))?")
LABEL_RE = re.compile(r"【([^【】]{1,12})】")
ANCHOR_RE = re.compile(r"(?m)^(\d{1,2})\.\s+(.*)$")
TOPIC_ANSWER = re.compile(r"【答案】\s*([A-Z])\s*段")


@dataclass
class QAnalysis:
    q_no: int
    answer: str | None = None
    answer_word: str = ""            # 选词填空的单词 / 听力答案句
    analysis_text: str = ""
    page: int = 1
    flags: list[str] = field(default_factory=list)


@dataclass
class AnalysisParse:
    per_q: dict[int, QAnalysis] = field(default_factory=dict)
    passage_translation: str = ""    # 阅读文章逐段中译（含 P1..Pn 标号原文）
    model_essay: str = ""            # 写作参考范文
    model_essay_cn: str = ""         # 范文中译
    essay_paragraph_notes: str = ""  # 逐段写作解析
    reference_translation: str = ""  # 翻译参考英译
    sentence_notes: str = ""         # 翻译逐句解析
    full_text: str = ""
    flags: list[str] = field(default_factory=list)


def _clean(s: str) -> str:
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()


def _find_anchors(text: str) -> list[tuple[int, int, str]]:
    """打印题号锚点 [(pos, q_no, line)]，按位置排序。"""
    out = []
    for m in ANCHOR_RE.finditer(text):
        line = m.group(2)
        # 打印题行后应跟随 A) 选项（阅读/听力），或是含空格号的选词填空句
        out.append((m.start(), int(m.group(1)), line.strip()))
    return out


# ---------------------------------------------------------------- 听力
def parse_listening_analysis(doc: PdfDoc) -> AnalysisParse:
    ap = AnalysisParse(full_text=doc.text)
    text = doc.text
    starts = [m.start() for m in re.finditer(r"【题目】", text)]
    numbers = [int(m.group(1)) for m in re.finditer(r"(?m)^\s*(\d{1,2})\.\s+[A-D]\)", text)]
    blocks = [(pos, starts[i + 1] if i + 1 < len(starts) else len(text)) for i, pos in enumerate(starts)]
    # Printed question numbers can float into the following analysis block. Use
    # source order only after three independent counts and the printed run agree.
    if (not blocks or numbers != sorted(set(numbers))
            or len(numbers) != len(blocks) or len(ANSWER_RE.findall(text)) != len(blocks)):
        ap.flags.append('题号、题目块与答案数量不一致，禁止猜测配对')
        return ap
    for number, (start, end) in zip(numbers, blocks):
        block = text[start:end]
        answer = ANSWER_RE.search(block)
        qa = QAnalysis(q_no=number)
        if not answer:
            qa.flags.append('块内无【答案】')
        else:
            qa.answer = answer.group(1)
            qa.answer_word = (answer.group(2) or '').strip()
            qa.page = doc.page_of_offset(start + answer.start())
        # Exclude subsequent listening scripts and floating printed options.
        cut = re.search(r'(?m)^(?:Questions\s+\d+\s+to\s+\d+|Section\s+[A-C]\b|1\s+(?:[MW]:|[A-Z][a-z]))', block)
        if cut:
            block = block[:cut.start()]
        block = re.sub(r'(?m)^\d{1,2}\.\s+[A-D]\).*$', '', block)
        # Printed English choices can float into this block. Chinese A)-D)
        # lines are the question's option translations and must stay visible.
        block = re.sub(r'(?m)^[A-D]\)[ \t]+\S.*$',
                       lambda m: m.group() if re.search(r'[\u3400-\u9fff]', m.group()) else '', block)
        qa.analysis_text = _clean(block)
        ap.per_q[number] = qa
    return ap


def extract_transcripts(doc: PdfDoc) -> list[dict]:
    """提取听力录音文字稿，按篇目分组。

    对话篇目为带序号的 `N M:/W: 行`；短文/讲座为带序号的 `N 正文行`；
    每条英文后跟随中文译文（可能折行）。序号回落处即新篇目。
    """
    if doc.transcript_text:
        entries = []
        current = None
        token = re.compile(r'^\s*@@TRANSCRIPT:(\d+)@@\s*(.*)$')
        boundary = re.compile(r'^\s*(?:【题目】|【翻译】|\d{1,2}\.\s+[A-D]\)|[A-D]\)\s)')
        decoration = re.compile(r'^\s*(?:Questions\s+\d+\s+to\s+\d+|Section\s+[A-C]\b|Directions\s*:|录音原文|听力原文)')
        for line in doc.transcript_text.splitlines():
            marker = token.match(line)
            if marker:
                if current:
                    entries.append(current)
                current = {'no': int(marker.group(1)), 'raw': [marker.group(2)]}
            elif boundary.match(line):
                if current:
                    entries.append(current)
                    current = None
            elif current and line.strip() and not decoration.match(line):
                current['raw'].append(line.strip())
        if current:
            entries.append(current)
        groups = []
        for entry in entries:
            english, chinese = [], []
            in_chinese = False
            for line in entry['raw']:
                if sum('\u4e00' <= ch <= '\u9fff' for ch in line) / max(1, len(line)) > .2:
                    in_chinese = True
                (chinese if in_chinese else english).append(line)
            en = norm_space(' '.join(english))
            speaker = re.match(r'^([MW]):\s*', en)
            item = {'no': entry['no'], 'speaker': speaker.group(1) if speaker else '',
                    'en': en[speaker.end():] if speaker else en, 'cn': ''.join(chinese)}
            if not groups or item['no'] == 1:
                groups.append({'key': f'g{len(groups) + 1}', 'lines': []})
            groups[-1]['lines'].append(item)
        return groups

    text = doc.text
    lines = text.splitlines()
    entries: list[dict] = []
    in_analysis = False
    i = 0
    n = len(lines)
    num_line = re.compile(r"^\s*(\d{1,2})\s+(?:([MW]):\s*)?(.+?)\s*$")
    marker = re.compile(
        r"^\s*(Questions\s+\d+\s+to\s+\d+|Section\s+[A-C]\b|Directions\s*:|【)"
    )

    def cjk_ratio(s: str) -> float:
        if not s:
            return 0.0
        cjk = sum(
            1
            for c in s
            if "\u4e00" <= c <= "\u9fff"
            or "\u3000" <= c <= "\u303f"
            or "\uff00" <= c <= "\uffef"
        )
        return cjk / len(s)

    while i < n:
        ln = lines[i]
        if ln.strip().startswith("【题目】"):
            in_analysis = True
        m = num_line.match(ln)
        if m:
            in_analysis = False  # 编号文字稿行：退出解析块状态并处理本行
        if m and not marker.match(ln):
            no, speaker, body = int(m.group(1)), m.group(2) or "", m.group(3)
            # 正文行不能是纯数字/选项
            if body and not re.match(r"^[A-O]\)\s", body):
                j = i + 1
                en_extra: list[str] = []
                cn: list[str] = []
                # 先收英文折行，直到出现中文行或下一个编号/标记
                while j < n:
                    t = lines[j].strip()
                    if not t:
                        j += 1
                        continue
                    if num_line.match(lines[j]) or marker.match(t):
                        break
                    if cjk_ratio(t) > 0.25:
                        while j < n and cjk_ratio(lines[j].strip() or "中") > 0.25 and not num_line.match(lines[j]) and not marker.match(lines[j].strip()):
                            cn.append(lines[j].strip())
                            j += 1
                        break
                    en_extra.append(t)
                    j += 1
                entries.append(
                    {
                        "no": no,
                        "speaker": speaker,
                        "en": (body + " " + " ".join(en_extra)).strip(),
                        "cn": "".join(cn),
                    }
                )
                i = j
                continue
        i += 1

    groups: list[list[dict]] = []
    for e in entries:
        if not groups or e["no"] <= groups[-1][-1]["no"]:
            groups.append([])
        groups[-1].append(e)
    # 只保留从 1 开始的连续递增序列，剔除正文中数字行误匹配
    cleaned: list[list[dict]] = []
    for g in groups:
        keep: list[dict] = []
        expect = 1
        for e in g:
            if e["no"] == expect:
                keep.append(e)
                expect += 1
        if keep:
            cleaned.append(keep)
    return [
        {"key": f"g{gi+1}", "lines": g} for gi, g in enumerate(cleaned) if g
    ]


# ------------------------------------------------- 阅读（仔细阅读/长篇阅读）
def parse_reading_analysis(doc: PdfDoc, matching: bool = False,
                           question_numbers: set[int] | None = None) -> AnalysisParse:
    ap = AnalysisParse(full_text=doc.text)
    text = doc.text
    anchors = _find_anchors(text)
    if question_numbers is not None:
        # Numbered rules inside an explanation (e.g. Asimov's "1. ...") are
        # prose, not questions. Only accept numbers printed on the question PDF.
        anchors = [anchor for anchor in anchors if anchor[1] in question_numbers]
    if not anchors:
        ap.flags.append("未找到打印题号锚点")
        return ap
    # 文章逐段中译（P1..Pn 标号到首个中文题块/陈述句解析之前）
    if not matching:
        p1 = text.find("P1")
        head_end = anchors[0][0] if anchors else len(text)
        if p1 != -1 and p1 < head_end:
            ap.passage_translation = _clean(text[p1:head_end])
    # 解析文本仍按锚点窗口切分（用于展示）
    for idx, (pos, q_no, _line) in enumerate(anchors):
        prev_end = 0 if idx == 0 else _skip_option_lines(text, anchors[idx - 1][0])
        anchor_line_end = text.find("\n", pos)
        anchor_line_end = len(text) if anchor_line_end == -1 else anchor_line_end
        block = text[prev_end:anchor_line_end]
        post_start = anchor_line_end + 1
        nxt = anchors[idx + 1][0] if idx + 1 < len(anchors) else len(text)
        post_labels = _post_anchor_labels(text[post_start:nxt])
        qa = QAnalysis(q_no=q_no, page=doc.page_of_offset(pos))
        qa.analysis_text = _clean(block + "\n" + post_labels if post_labels else block)
        if q_no in ap.per_q:
            qa.flags.append("题号重复")
        ap.per_q[q_no] = qa
    # 答案配对：解析按题序书写。答案数与锚点数一致时按序配对（新旧排版均适用）；
    # 不一致时退回窗口就近配对并标记待核对。
    ans_re = TOPIC_ANSWER if matching else ANSWER_RE
    answer_matches = list(ans_re.finditer(text))
    all_answers = ans_re.findall(text)
    if len(all_answers) == len(anchors):
        for (_pos, q_no, _line), ans in zip(anchors, all_answers):
            ap.per_q[q_no].answer = ans[0] if isinstance(ans, tuple) else ans
        if matching:
            for i, ((_pos, q_no, _line), match) in enumerate(zip(anchors, answer_matches)):
                end = answer_matches[i + 1].start() if i + 1 < len(answer_matches) else len(text)
                block = text[match.start():end]
                # Printed statements may float between explanatory labels. They
                # must not turn a neighbouring question's explanation into ours.
                block = re.sub(r"(?ms)^\d{1,2}\.\s+.*?(?=^【|\Z)", "", block)
                labels = list(LABEL_RE.finditer(block))
                fields = []
                for j, label in enumerate(labels[:-1]):
                    fields.append(block[label.start():labels[j + 1].start()].strip())
                if fields:
                    ap.per_q[q_no].analysis_text = _clean("\n".join(fields))
                ap.per_q[q_no].page = doc.page_of_offset(match.start())
        else:
            for i, ((_pos, q_no, _line), match) in enumerate(zip(anchors, answer_matches)):
                end = answer_matches[i + 1].start() if i + 1 < len(answer_matches) else len(text)
                block = text[match.start():end]
                # A translated stem + four translated choices belongs to the next
                # answer, whereas an English printed question may float anywhere.
                next_options = list(re.finditer(r"(?m)^A\)\s*[\u3400-\u9fff]", block))
                for option in reversed(next_options):
                    tail = block[option.start():]
                    if '【' not in tail and all(re.search(rf'(?m)^{letter}\)', tail) for letter in 'BCD'):
                        prefix = block[:option.start()].rstrip()
                        block = prefix[:prefix.rfind('\n')]
                        break
                block = re.sub(r"(?ms)^\d{1,2}\.\s+.*?(?=^【|\Z)", "", block)
                chapter = re.search(r"(?m)^[A-Z](?:\s+[A-Z]){4,}.*[·•]", block)
                if chapter:
                    block = block[:chapter.start()]
                ap.per_q[q_no].analysis_text = _clean(block)
                ap.per_q[q_no].page = doc.page_of_offset(match.start())
    else:
        for (_pos, q_no, _line) in anchors:
            qa = ap.per_q[q_no]
            m = ans_re.search(qa.analysis_text or "")
            if m and not matching:
                qa.answer = m.group(1)
                qa.flags.append("答案数量与题数不一致，按就近配对")
            else:
                qa.flags.append("答案数量与题数不一致，禁止猜测配对" if matching else "块内无【答案】")
    return ap


def _skip_option_lines(text: str, pos: int) -> int:
    """跳过锚点行与其后的 A)/B)/C)/D) 打印选项行。"""
    eol = text.find("\n", pos)
    e = eol + 1 if eol != -1 else len(text)
    for _ in range(6):
        m = re.compile(r"(?m)^([A-O])\)\s").match(text, e)
        if not m:
            break
        nl = text.find("\n", e)
        e = nl + 1 if nl != -1 else len(text)
    return e


def _post_anchor_labels(post: str) -> str:
    """锚点打印选项之后的【标签】段落（并到本题解析）。"""
    # 丢弃开头的连续打印选项行，保留之后的标签段落
    kept: list[str] = []
    lines = post.splitlines()
    i = 0
    while i < len(lines) and re.match(r"^\s*[A-O]\)\s", lines[i]):
        i += 1
    while i < len(lines):
        kept.append(lines[i])
        i += 1
    s = "\n".join(kept).strip()
    if not s or "【" not in s:
        return ""
    return s


# ---------------------------------------------------------------- 选词填空
def parse_cloze_analysis(doc: PdfDoc) -> AnalysisParse:
    ap = AnalysisParse(full_text=doc.text)
    text = doc.text
    candidates = list(re.finditer(r'(?m)^(\d{1,2})\.\s+', text))
    anchors = []
    for i, candidate in enumerate(candidates):
        end = candidates[i + 1].start() if i + 1 < len(candidates) else len(text)
        block = text[candidate.start():end]
        answer = ANSWER_RE.search(block)
        number = int(candidate.group(1))
        if answer and f'__({number})__' in block[:answer.start()]:
            anchors.append((candidate.start(), number))
    seen = set()
    anchors = [(pos, number) for pos, number in anchors if not (number in seen or seen.add(number))]
    if not anchors:
        ap.flags.append("未找到空格锚点")
        return ap
    for idx, (pos, q_no) in enumerate(anchors):
        e = anchors[idx + 1][0] if idx + 1 < len(anchors) else len(text)
        block = text[pos:e]
        qa = QAnalysis(q_no=q_no, page=doc.page_of_offset(pos))
        m = ANSWER_RE.search(block)
        if m:
            qa.answer = m.group(1)
            qa.answer_word = (m.group(2) or "").strip()
        else:
            qa.flags.append("块内无【答案】")
        qa.analysis_text = _clean(block)
        ap.per_q[q_no] = qa
    return ap


# ---------------------------------------------------------------- 写作
def parse_writing_analysis(doc: PdfDoc) -> AnalysisParse:
    ap = AnalysisParse(full_text=doc.text)
    text = doc.text
    m = re.search(r"【参考范文[^】]*】\s*\n(.*?)(?=【参考译文】)", text, re.S)
    if m:
        body = m.group(1)
        # 丢掉头部中文说明行（如“写作无唯一标准答案…”），保留英文范文正文
        lines = body.splitlines()
        keep_from = 0
        for li, t in enumerate(lines):
            if re.match(r"^[A-Za-z\"']", t.strip()):
                keep_from = li
                break
        ap.model_essay = _clean("\n".join(lines[keep_from:]))
    m = re.search(r"【参考译文】\s*\n(.*?)(?=【第\s*\d+\s*段】)", text, re.S)
    if m:
        ap.model_essay_cn = _clean(m.group(1))
    paras = re.findall(r"【第\s*\d+\s*段】(.*?)(?=【第\s*\d+\s*段】|$)", text, re.S)
    ap.essay_paragraph_notes = _clean("\n\n".join(_clean(p) for p in paras if p.strip()))
    if not ap.model_essay:
        ap.flags.append("未找到【参考范文】")
    return ap


# ---------------------------------------------------------------- 翻译
def parse_translation_analysis(doc: PdfDoc) -> AnalysisParse:
    ap = AnalysisParse(full_text=doc.text)
    text = doc.text
    m = re.search(r"参考译文\s*\n.*?\n(.*?)(?=【衔接】|逐句解析)", text, re.S)
    if m:
        body = m.group(1)
        # 丢掉头部残留的中文说明折行，保留首个英文句子起的内容
        lines = body.splitlines()
        keep_from = 0
        for li, t in enumerate(lines):
            if re.match(r"^[A-Za-z]", t.strip()):
                keep_from = li
                break
        ap.reference_translation = _clean("\n".join(lines[keep_from:]))
    i = text.find("逐句解析")
    if i != -1:
        ap.sentence_notes = _clean(text[i:])
    else:
        # 逐句解析可能在【衔接】等标签开始
        i = text.find("【衔接】")
        if i != -1:
            ap.sentence_notes = _clean(text[i:])
    if not ap.reference_translation:
        ap.flags.append("未找到参考译文")
    return ap
