"""题库导入主流程：扫描源材料 → 结构化 → 关联答案与解析 → 幂等入库 → 输出报告。

用法：
    python -m importer.import_all                 # 全量导入（未变更的套次自动跳过）
    python -m importer.import_all --paper 2023-06-1
    python -m importer.import_all --force         # 忽略缓存校验和重导
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path

from . import analysis_parsers as A
from . import parsers as P
from .extract import extract_pdf, file_checksum, norm_space
from .reflow import reflow_section

ROOT = Path(os.environ.get("CET_RESOURCE_ROOT", os.environ.get("CET6_RESOURCE_ROOT", Path(__file__).resolve().parents[2] / "resources")))
PROJECT = Path(__file__).resolve().parents[2]
EXAM = os.environ.get("CET_EXAM", "cet6")
sys.path.insert(0, str(PROJECT / "backend"))
from app import db  # noqa: E402

SECTION_FILES = {
    # section -> (真题文件名, 解析文件名, 题型中文名)
    "listening": ("听力真题.pdf", "听力解析.pdf", "听力"),
    "cloze": ("完形填空（选词填空）真题.pdf", "完形填空（选词填空）解析.pdf", "选词填空"),
    "matching": ("长篇阅读（信息匹配）真题.pdf", "长篇阅读（信息匹配）解析.pdf", "长篇阅读"),
    "reading1": ("阅读理解（四选一）第1篇真题.pdf", "阅读理解（四选一）第1篇解析.pdf", "仔细阅读一"),
    "reading2": ("阅读理解（四选一）第2篇真题.pdf", "阅读理解（四选一）第2篇解析.pdf", "仔细阅读二"),
    "writing": ("写作真题.pdf", "写作解析.pdf", "写作"),
    "translation": ("汉译英（段落翻译）真题.pdf", "汉译英（段落翻译）解析.pdf", "翻译"),
}
SECTION_ORDER = {s: i for i, s in enumerate(
    ["listening", "cloze", "matching", "reading1", "reading2", "writing", "translation"]
)}
SECTION_CN = {s: cn for s, (_, _, cn) in SECTION_FILES.items()}
# 常规题量（仅用于报告预警，旧年份以实际材料为准）
EXPECTED = {"listening": 25, "cloze": 10, "matching": 10, "reading1": 5, "reading2": 5}
PARSER_VERSION = 'source-layout-audit-v6-clean-all-explanations-and-reviewed-fixes'
CORRECTIONS_PATH = Path(__file__).with_name('reviewed_corrections.json')

def load_corrections():
    path = Path(__file__).with_name('reviewed_corrections_cet4.json') if EXAM == 'cet4' else CORRECTIONS_PATH
    return json.loads(path.read_text(encoding='utf-8'))['corrections']


def reviewed_analysis(uid, answer, text):
    corrections = load_corrections()
    fix = corrections.get(uid)
    if not fix:
        return text
    if answer != fix['expected_answer']:
        raise ValueError(f'{uid}: 已复核修正与当前答案不符，中止导入')
    for label, value in fix.get('labels', {}).items():
        pattern = rf'【{re.escape(label)}】.*?(?=【|\Z)'
        text, count = re.subn(pattern, lambda _m: f'【{label}】{value}\n', text or '', count=1, flags=re.S)
        if count != 1:
            if '【选项】' in (text or ''):
                text = (text or '').replace('【选项】', f'【{label}】{value}\n【选项】', 1)
            else:
                raise ValueError(f'{uid}: 原解析缺少待修正标签 {label}')
    for replacement in fix.get('replacements', []):
        old, new = replacement['old'], replacement['new']
        if old not in (text or ''):
            raise ValueError(f'{uid}: 原解析缺少待修正文字 {old}')
        text = text.replace(old, new)
    location = fix.get('evidence_location', f"录音原文：第{fix.get('evidence_page', 1)}页")
    return f"【复核说明】{fix['note']}（{location}）\n\n{text}"


def scan_root() -> list[dict]:
    """扫描题库根目录，产出套次材料清单。"""
    papers = []
    source_root = ROOT / "cet4" if EXAM == "cet4" else ROOT
    for date_dir in sorted(d for d in source_root.iterdir() if d.is_dir() and re.match(r"\d{4}-\d{2}", d.name)):
        year, month = (int(x) for x in date_dir.name.split("-"))
        for set_dir in sorted(d for d in date_dir.iterdir() if d.is_dir() and d.name.startswith("第")):
            m = re.search(r"(\d+)", set_dir.name)
            set_no = int(m.group(1)) if m else 0
            entry = {
                "paper_key": ("cet4-" if EXAM == "cet4" else "") + f"{date_dir.name}-{set_no}",
                "year": year, "month": month, "set_no": set_no,
                "dir": set_dir, "sections": {}, "audio": None,
                "raw_pdfs": [],
            }
            pdf_dir = set_dir / "PDF"
            ana_dir = set_dir / "解析PDF"
            for sec, (qname, aname, _) in SECTION_FILES.items():
                qf, af = pdf_dir / qname, ana_dir / aname
                if qf.exists() or af.exists():
                    entry["sections"][sec] = (qf if qf.exists() else None,
                                              af if af.exists() else None)
            # 整卷与全部 PDF 纳入材料索引（提供原 PDF 入口，不重复解析）
            for f in sorted(set_dir.rglob("*.pdf")):
                entry["raw_pdfs"].append(f)
            for f in sorted(set_dir.rglob("*.m4a")) + sorted(set_dir.rglob("*.mp3")):
                entry["audio"] = f
                break
            papers.append(entry)
    if EXAM == 'cet4':
        mapping_path = ROOT / 'cet4' / 'shared-mapping.json'
        mappings = json.loads(mapping_path.read_text(encoding='utf8')).get('papers', {}) if mapping_path.exists() else {}
        indexed = {p['paper_key']: p for p in papers}
        def resolve_shared(entry, seen):
            if entry['paper_key'] in seen:
                raise ValueError('Cyclic shared material mapping: '+entry['paper_key'])
            seen = seen | {entry['paper_key']}
            sources = mappings.get(entry['paper_key'], {})
            entry['shared_sources'] = sources
            for section, evidence in sources.items():
                target_key = 'cet4-'+evidence['source_slug']
                if target_key not in indexed:
                    raise ValueError('Shared source missing: '+target_key)
                target = indexed[target_key]
                resolve_shared(target, seen)
                if section not in entry['sections'] and section in target['sections']:
                    entry['sections'][section] = target['sections'][section]
                    for path in target['sections'][section]:
                        if path and path not in entry['raw_pdfs']: entry['raw_pdfs'].append(path)
                if section == 'listening' and not entry['audio']:
                    entry['audio'] = target['audio']
        for entry in papers:
            resolve_shared(entry, set())
    return papers


def rel(p: Path | None) -> str | None:
    return str(p.relative_to(ROOT)).replace("\\", "/") if p else None


class Importer:
    def __init__(self, conn, version: str, force: bool):
        self.conn = conn
        self.version = version
        self.force = force
        self.issues: list[dict] = []

    def issue(self, paper_key, section, uid, level, message):
        self.issues.append({
            "paper_key": paper_key, "section": section, "uid": uid,
            "level": level, "message": message,
        })

    # -------------------------------------------------- 主入口
    def import_paper(self, entry: dict) -> dict:
        pk = entry["paper_key"]
        row = self.conn.execute("SELECT * FROM papers WHERE paper_key=?", (pk,)).fetchone()
        if row is None:
            self.conn.execute(
                "INSERT INTO papers(paper_key, year, month, set_no, audio_path, import_version) "
                "VALUES(?,?,?,?,?,?)",
                (pk, entry["year"], entry["month"], entry["set_no"], rel(entry["audio"]), self.version),
            )
            paper_id = self.conn.execute(
                "SELECT id FROM papers WHERE paper_key=?", (pk,)
            ).fetchone()["id"]
        else:
            paper_id = row["id"]
            self.conn.execute(
                "UPDATE papers SET audio_path=?, import_version=? WHERE id=?",
                (rel(entry["audio"]), self.version, paper_id),
            )
        self.conn.execute("UPDATE papers SET exam_type=?, shared_sources_json=? WHERE id=?", (EXAM, json.dumps(entry.get("shared_sources", {}), ensure_ascii=False), paper_id))
        # 材料索引（全部 PDF，含整卷）
        for f in entry["raw_pdfs"]:
            kind = "analysis" if "解析PDF" in str(f) else "question"
            sec = "full" if f.stem.startswith("整卷") else "file"
            try:
                self.conn.execute(
                    "INSERT OR IGNORE INTO materials(paper_id, section, kind, file_path, pages, checksum, file_mtime) "
                    "VALUES(?,?,?,?,?,?,?)",
                    (paper_id, sec, kind, rel(f), None,
                     file_checksum(f)[:16], f.stat().st_mtime),
                )
            except OSError as e:
                self.issue(pk, "file", None, "warn", f"材料读取失败 {rel(f)}: {e}")
        report = {"paper_key": pk, "sections": {}, "status": "imported", "shared_sources": entry.get("shared_sources", {})}
        sec_flags_map = {}
        for sec in SECTION_FILES:
            if sec not in entry["sections"]:
                continue
            qf, af = entry["sections"][sec]
            if qf is None:
                self.issue(pk, sec, None, "warn", "缺少真题 PDF")
                continue
            r = self._import_section(paper_id, pk, sec, qf, af)
            report["sections"][sec] = r
            sec_flags_map[sec] = 1 if r else 0
        flags = {
            "has_listening": sec_flags_map.get("listening", 0),
            "has_cloze": sec_flags_map.get("cloze", 0),
            "has_matching": sec_flags_map.get("matching", 0),
            "has_reading1": sec_flags_map.get("reading1", 0),
            "has_reading2": sec_flags_map.get("reading2", 0),
            "has_writing": sec_flags_map.get("writing", 0),
            "has_translation": sec_flags_map.get("translation", 0),
        }
        self.conn.execute(
            f"UPDATE papers SET {', '.join(f'{k}=?' for k in flags)} WHERE id=?",
            (*flags.values(), paper_id),
        )
        if entry["audio"] and "listening" not in entry["sections"]:
            self.issue(pk, "listening", None, "warn", "有音频但无听力真题材料")
        if "listening" in entry["sections"] and not entry["audio"]:
            self.issue(pk, "listening", None, "warn", "有听力材料但缺音频文件")
        listening = report.get('sections', {}).get('listening', {})
        if entry['year'] == 2015 and listening.get('status') != 'unchanged' and 'listening' in entry['sections']:
            self.issue(pk, 'listening', None, 'warn',
                       '材料边界：本地2015年听力为后期25题结构的重排/改编材料，与当年旧制听力结构不同；仅按现有文件练习，未恢复完整历史原卷。')
        if pk == '2026-06-2' and listening.get('status') != 'unchanged':
            self.issue(pk, 'listening', f'{pk}:listening:24', 'warn',
                       '语义待核对：第24题保留参考答案D；C与D有近义重合，现有解析对C的排除不足以证明选项唯一，未擅自改答案或选项。')
        return report

    # -------------------------------------------------- 单题型
    def _import_section(self, paper_id, pk, sec, qf: Path, af: Path | None) -> dict:
        # 幂等：真题文件未变且已有题目 → 跳过
        cs = ':'.join((PARSER_VERSION, file_checksum(qf)[:16], file_checksum(af)[:16] if af else '-', file_checksum(CORRECTIONS_PATH)[:16]))
        if not self.force:
            row = self.conn.execute(
                "SELECT checksum FROM materials WHERE paper_id=? AND section=? AND kind='parsed'",
                (paper_id, sec),
            ).fetchone()
            nq = self.conn.execute(
                "SELECT COUNT(*) c FROM questions WHERE paper_id=? AND section=?", (paper_id, sec)
            ).fetchone()["c"]
            if row and row["checksum"] == cs and nq > 0:
                na = self.conn.execute(
                    "SELECT COUNT(*) c FROM questions WHERE paper_id=? AND section=? AND answer IS NOT NULL",
                    (paper_id, sec),
                ).fetchone()["c"]
                return {"status": "unchanged", "questions": nq, "answers": na}

        qdoc = extract_pdf(qf, layout=(sec == "cloze"))
        adoc = extract_pdf(af, transcript=(sec == "listening")) if af else None
        self.conn.execute(
            "INSERT OR REPLACE INTO materials(paper_id, section, kind, file_path, checksum, file_mtime) "
            "VALUES(?,?,?,?,?,?)",
            (paper_id, sec, "parsed", rel(qf), cs, qf.stat().st_mtime),
        )
        rep: dict = {"status": "ok", "questions": 0, "answers": 0, "issues": []}

        if sec == "listening":
            self._do_listening(paper_id, pk, qdoc, adoc, qf, af, rep)
        elif sec == "cloze":
            self._do_cloze(paper_id, pk, qdoc, adoc, qf, af, rep)
        elif sec == "matching":
            self._do_matching(paper_id, pk, qdoc, adoc, qf, af, rep)
        elif sec in ("reading1", "reading2"):
            self._do_reading(paper_id, pk, sec, qdoc, adoc, qf, af, rep)
        elif sec == "writing":
            self._do_writing(paper_id, pk, qdoc, adoc, qf, af, rep)
        elif sec == "translation":
            self._do_translation(paper_id, pk, qdoc, adoc, qf, af, rep)
        if adoc and adoc.appendix_pages:
            material = self.conn.execute("SELECT id, content_json FROM section_materials WHERE paper_id=? AND section=? ORDER BY id LIMIT 1", (paper_id, sec)).fetchone()
            if material:
                content = json.loads(material['content_json'] or '{}')
                content['sentence_insights'] = adoc.appendix_pages
                content['sentence_insights_source'] = rel(af)
                self.conn.execute("UPDATE section_materials SET content_json=? WHERE id=?", (json.dumps(content, ensure_ascii=False), material['id']))
            rep['sentence_insights_pages'] = len(adoc.appendix_pages)
        # PDF 物理行入库后会在网页上断成半句，按版面坐标合并软换行。
        rep['reflowed'] = reflow_section(self.conn, paper_id, sec, [qf, af])
        return rep

    # -------------------------------------------------- 各题型入库
    def _upsert_question(self, paper_id, pk, sec, q, answer=None, answer_source=None,
                         analysis_json=None, analysis_text=None, afile=None, apage=None):
        uid = f"{pk}:{sec}:{q.q_no}"
        flags = list(q.flags)
        row = self.conn.execute(
            "SELECT manual_locked, answer, analysis_json, analysis_text FROM questions WHERE uid=?", (uid,)
        ).fetchone()
        if row and row["manual_locked"]:
            return uid  # 人工校正锁定，不覆盖
        # Subjective sections (essay/translation) preserve existing reference notes;
        # objective questions always use freshly segmented analysis_text unless empty.
        preserve_analysis = bool(row and (q.qtype in ("essay", "translation") or
                                          (not (analysis_text or '').strip()
                                           and (row["analysis_text"] or '').strip())))
        stored_analysis_json = (row["analysis_json"] if preserve_analysis else
                                json.dumps(analysis_json, ensure_ascii=False) if analysis_json else None)
        if preserve_analysis:
            analysis_text = row["analysis_text"]
        self.conn.execute(
            "INSERT INTO questions(uid, paper_id, paper_key, section, section_order, q_no, q_index, "
            "qtype, group_key, stem, options_json, answer, answer_source, analysis_json, analysis_text, "
            "source_file, source_page, status, flags_json, import_version, manual_locked) "
            "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0) "
            "ON CONFLICT(uid) DO UPDATE SET "
            "q_index=excluded.q_index, qtype=excluded.qtype, group_key=excluded.group_key, "
            "stem=excluded.stem, options_json=excluded.options_json, answer=excluded.answer, "
            "answer_source=excluded.answer_source, analysis_json=excluded.analysis_json, "
            "analysis_text=excluded.analysis_text, source_file=excluded.source_file, "
            "source_page=excluded.source_page, status=excluded.status, flags_json=excluded.flags_json, "
            "import_version=excluded.import_version",
            (uid, paper_id, pk, sec, SECTION_ORDER[sec], q.q_no, q.q_index, q.qtype,
             q.group_key, q.stem, json.dumps(q.options, ensure_ascii=False),
             answer, answer_source,
             stored_analysis_json,
             analysis_text, rel(Path(q.source_file)) if q.source_file else None,
             q.source_page,
             "needs_review" if flags else "ok",
             json.dumps(flags, ensure_ascii=False), self.version),
        )
        return uid

    def _set_material(self, paper_id, sec, group_key, directions=None, content=None,
                      translation=None, analysis_text=None, source_file=None, page=None,
                      status="ok"):
        existing = self.conn.execute(
            "SELECT * FROM section_materials WHERE paper_id=? AND section=? AND group_key=?",
            (paper_id, sec, group_key),
        ).fetchone()
        if existing and sec in ("writing", "translation"):
            return  # Preserve the existing reference essays/translations verbatim.
        if existing and sec in ("reading1", "reading2"):
            translation = json.loads(existing["translation_json"]) if existing["translation_json"] else None
        self.conn.execute(
            "INSERT INTO section_materials(paper_id, section, group_key, directions, content_json, "
            "translation_json, analysis_text, source_file, source_page, status) "
            "VALUES(?,?,?,?,?,?,?,?,?,?) "
            "ON CONFLICT(paper_id, section, group_key) DO UPDATE SET "
            "directions=excluded.directions, content_json=excluded.content_json, "
            "translation_json=excluded.translation_json, analysis_text=excluded.analysis_text, "
            "source_file=excluded.source_file, source_page=excluded.source_page, status=excluded.status "
            "WHERE section_materials.manual_locked=0",
            (paper_id, sec, group_key, directions,
             json.dumps(content, ensure_ascii=False) if content else None,
             json.dumps(translation, ensure_ascii=False) if translation else None,
             analysis_text, source_file, page, status),
        )

    def _attach_answers(self, paper_id, pk, sec, questions, ana, af, rep):
        """把解析答案挂到题目上，核对数量与合法性。"""
        if questions:
            uids = [f"{pk}:{sec}:{q.q_no}" for q in questions]
            placeholders = ','.join('?' for _ in uids)
            # Upsert alone leaves obsolete decimal-as-question rows in the bank.
            # Personal records are deliberately never touched by a source import.
            self.conn.execute(
                f"DELETE FROM questions WHERE paper_id=? AND section=? AND manual_locked=0 AND uid NOT IN ({placeholders})",
                (paper_id, sec, *uids),
            )
        n_ans = 0
        for q in questions:
            qa = ana.per_q.get(q.q_no) if ana else None
            answer = qa.answer if qa else None
            uid = f'{pk}:{sec}:{q.q_no}'
            fix = load_corrections().get(uid, {})
            if fix.get('disputed'):
                self.issue(pk, sec, uid, 'warn', fix['note'])
                if '来源有分歧，详见复核说明' not in q.flags:
                    q.flags.append('来源有分歧，详见复核说明')
            if 'source_answer' in fix:
                if answer != fix['source_answer']:
                    raise ValueError(f'{uid}: 源答案已改变，需重新复核，禁止静默套用修正')
                answer = fix['expected_answer']
            if 'options' in fix:
                if 'source_options' in fix and q.options != fix['source_options']:
                    raise ValueError(f'{uid}: 源选项已改变，需重新复核，禁止静默套用修正')
                q.options = fix['options']
            if qa:
                for f in qa.flags:
                    if f not in q.flags:
                        q.flags.append(f)
                if qa.analysis_text and not q.flags:
                    pass
            if answer:
                n_ans += 1
            elif "未找到可靠答案" not in q.flags:
                q.flags.append("未找到可靠答案")
            self._upsert_question(
                paper_id, pk, sec, q,
                answer=answer,
                answer_source=(fix.get('answer_source') or f"{af.name} 第{qa.page}页" if (qa and answer and af) else None),
                analysis_json=({"answer_word": qa.answer_word} if qa else None),
                analysis_text=reviewed_analysis(f'{pk}:{sec}:{q.q_no}', answer, qa.analysis_text if qa else None),
            )
            if q.flags:
                rep["issues"].append(f"题{q.q_no}: {'; '.join(q.flags)}")
        rep["questions"] = len(questions)
        rep["answers"] = n_ans
        if questions and n_ans < len(questions):
            self.issue(pk, sec, None, "warn",
                       f"答案覆盖 {n_ans}/{len(questions)}，缺答案题目可练习但不判分")
        exp = EXPECTED.get(sec)
        if exp and len(questions) != exp:
            self.issue(pk, sec, None, "warn",
                       f"题数 {len(questions)} 与常规 {exp} 不同（以材料为准）")

    # 听力
    def _do_listening(self, paper_id, pk, qdoc, adoc, qf, af, rep):
        sp = P.parse_listening(qdoc)
        ana = A.parse_listening_analysis(adoc) if adoc else None
        for q in sp.questions:
            q.source_file = str(qf)
        # 篇目分组与文字稿
        groups = []
        transcripts = []
        if adoc is not None:
            transcripts = A.extract_transcripts(adoc)
        markers = re.findall(r"Questions\s+(\d+)\s+(?:to|and)\s+(\d+)\s+are\s+based\s+on", qdoc.text)
        if len(transcripts) == len(markers) and transcripts:
            self.conn.execute("DELETE FROM section_materials WHERE paper_id=? AND section='listening' AND group_key='raw_transcript' AND manual_locked=0", (paper_id,))
            for gi, mk in enumerate(markers):
                g = {"key": f"g{gi+1}", "from": int(mk[0]), "to": int(mk[1])}
                tg = transcripts[gi]
                g["lines"] = [{"speaker": l["speaker"], "en": l["en"], "cn": l["cn"]} for l in tg["lines"]]
                groups.append(g)
        else:
            self.issue(pk, "listening", None, "warn",
                       f"文字稿分组 {len(transcripts)} 与篇目 {len(markers)} 不一致，文字稿整体保存")
            groups = [{"key": f"g{i+1}", "from": int(m[0]), "to": int(m[1]),
                       "lines": []} for i, m in enumerate(markers)]
            if transcripts:
                self._set_material(
                    paper_id, "listening", "raw_transcript",
                    content={"transcript_all": transcripts},
                    source_file=rel(af), status="needs_review",
                )
        material_fixes = json.loads(CORRECTIONS_PATH.read_text(encoding='utf-8')).get('material_corrections', {}).get(pk, {})
        for fix in material_fixes.get('listening_group_ranges', []):
            group = next((g for g in groups if g['key'] == fix['group_key']), None)
            if not group or [group['from'], group['to']] != fix['source_range']:
                raise ValueError(f'{pk}: 源篇目范围已改变，需重新复核，禁止静默套用修正')
            group['from'], group['to'] = fix['verified_range']
            self.issue(pk, 'listening', fix.get('uid'), 'warn', fix['note'])
        gmap = {}
        for g in groups:
            for n in range(g["from"], g["to"] + 1):
                gmap[n] = g["key"]
        for q in sp.questions:
            if q.q_no in gmap:
                q.group_key = gmap[q.q_no]
            elif not q.flags or "未归入听力篇目" not in q.flags:
                q.flags.append("未归入听力篇目")
        self._set_material(
            paper_id, "listening", "",
            directions=sp.directions,
            content={"groups": groups},
            source_file=rel(qf),
        )
        # 答案核对：答案字母必须是该题选项之一
        if ana:
            for q in sp.questions:
                qa = ana.per_q.get(q.q_no)
                if qa and qa.answer:
                    keys = {o["key"] for o in q.options}
                    if keys and qa.answer not in keys:
                        qa.answer = None
                        qa.flags.append("答案字母不在选项中")
        self._attach_answers(paper_id, pk, "listening", sp.questions, ana, af, rep)

    # 选词填空
    def _do_cloze(self, paper_id, pk, qdoc, adoc, qf, af, rep):
        sp = P.parse_cloze(qdoc)
        ana = A.parse_cloze_analysis(adoc) if adoc else None
        bank = {w["key"]: w["text"] for w in sp.word_bank}
        # 用解析中的空格句在原文标记空位
        contexts: dict[int, str] = {}
        if ana:
            for no, qa in ana.per_q.items():
                m = re.search(r"(?s)^\d{1,2}\.\s*(.*?)(?=【答案】)", qa.analysis_text or "")
                if m:
                    ctx = norm_space(m.group(1))
                    contexts[no] = ctx
        source_blanks = [int(no) for no in re.findall(r"__\((\d+)\)__", sp.passage)]
        if source_blanks:
            marked, mark_flags = sp.passage, []
            if len(source_blanks) != len(set(source_blanks)):
                mark_flags.append("原卷空号重复，需核对版面")
            for no in source_blanks:
                token = f"__({no})__"
                position = marked.index(token)
                left = max(marked.rfind('.', 0, position), marked.rfind('?', 0, position), marked.rfind('!', 0, position)) + 1
                tail = re.search(r"[.!?](?=\s|$)", marked[position + len(token):])
                right = position + len(token) + tail.end() if tail else len(marked)
                contexts[no] = norm_space(marked[left:right])
        else:
            marked, mark_flags = self._mark_cloze_blanks(sp.passage, contexts)
        questions = []
        q_nos = sorted(set(source_blanks or sp.blank_nos or contexts.keys()))
        for qi, no in enumerate(q_nos):
            q = P.Q(q_no=no, q_index=qi, qtype="blank", group_key="bank",
                    stem=contexts.get(no, ""), source_page=sp.blank_pages.get(no, 1))
            q.options = list(sp.word_bank)  # 词库即选项（点击字母作答）
            q.source_file = str(qf)
            if no not in contexts:
                q.flags.append("无空格上下文")
            questions.append(q)
        if len(questions) != 10:
            rep["issues"].append(f"空格数 {len(questions)}（常规 10，以材料为准）")
        self._set_material(
            paper_id, "cloze", "bank",
            directions=sp.directions,
            content={"passage": marked or sp.passage, "word_bank": sp.word_bank},
            source_file=rel(qf),
            status="needs_review" if mark_flags else "ok",
        )
        for f in mark_flags:
            self.issue(pk, "cloze", None, "warn", f)
        # 答案核对：答案词须与词库一致
        if ana:
            for q in questions:
                qa = ana.per_q.get(q.q_no)
                if qa and qa.answer and bank:
                    w = bank.get(qa.answer)
                    if w and qa.answer_word and norm_space(qa.answer_word).strip(").") not in w and w not in qa.answer_word:
                        qa.flags.append(f"答案词({qa.answer_word})与词库 {qa.answer})({w}) 不一致")
        self._attach_answers(paper_id, pk, "cloze", questions, ana, af, rep)

    def _mark_cloze_blanks(self, passage: str, contexts: dict[int, str]):
        """把 __(N)__ 标记回填到原文空位。"""
        flags = []
        if not contexts:
            return passage, ["解析中未找到空格上下文，原文空位未标号"]
        text = norm_space(passage)
        marks: list[tuple[int, int, int]] = []  # (start, end, no)
        for no, ctx in sorted(contexts.items()):
            mm = re.search(r"__\((\d+)\)__", ctx)
            if not mm:
                continue
            left = norm_space(ctx[: mm.start()])
            right = norm_space(ctx[mm.end():])
            ltail = left[-28:] if len(left) >= 28 else left
            rhead = right[:28] if len(right) >= 28 else right
            s = e = None
            if ltail and rhead:
                pat = re.compile(re.escape(ltail) + r"\s+" + re.escape(rhead))
                fm = pat.search(text)
                if fm:
                    s = fm.start() + len(ltail)
                    e = fm.end() - len(rhead)
            elif ltail:
                # 空格在上下文末尾：插在左侧尾部之后
                fm = re.compile(re.escape(ltail)).search(text)
                if fm:
                    s = e = fm.end()
            elif rhead:
                fm = re.compile(re.escape(rhead)).search(text)
                if fm:
                    s = e = fm.start()
            if s is None:
                flags.append(f"空{no} 上下文未能在原文定位")
            else:
                marks.append((s, e, no))
        out = []
        last = 0
        for s, e, no in sorted(marks):
            out.append(text[last:s])
            out.append(f" __({no})__ ")
            last = e
        out.append(text[last:])
        return re.sub(r" {2,}", " ", "".join(out)), flags

    # 长篇阅读
    def _do_matching(self, paper_id, pk, qdoc, adoc, qf, af, rep):
        sp = P.parse_matching(qdoc)
        ana = A.parse_reading_analysis(adoc, matching=True, question_numbers={q.q_no for q in sp.questions}) if adoc else None
        labels = {p["label"] for p in sp.paragraphs}
        if ana:
            # 锚点窗口缺答案时按顺序补配（解析按陈述句顺序逐条书写）
            ans_list = re.findall(r"【答案】\s*([A-Z])\s*段", adoc.text)
            q_nos = sorted(ana.per_q.keys())
            if len(ans_list) == len(q_nos):
                for idx, no in enumerate(q_nos):
                    qa = ana.per_q[no]
                    if not qa.answer:
                        qa.answer = ans_list[idx]
                        qa.flags.append("答案按解析顺序配对")
            for q in sp.questions:
                qa = ana.per_q.get(q.q_no)
                if qa and qa.answer and labels and qa.answer not in labels:
                    qa.answer = None
                    qa.flags.append("答案段落字母不在原文段落中")
                if qa and qa.answer and "【定位】" not in (qa.analysis_text or ""):
                    paragraph = next((p["text"] for p in sp.paragraphs if p["label"] == qa.answer), '')
                    if paragraph:
                        qa.analysis_text = f"【答案】{qa.answer} 段\n【定位】{paragraph}\n" + (qa.analysis_text or '')
        for q in sp.questions:
            q.source_file = str(qf)
        # 首段标题去 Part/Section 行
        title = sp.title if not re.match(r"^\s*(Part|Section)", sp.title, re.I) else ""
        self._set_material(
            paper_id, "matching", "passage",
            directions=sp.directions,
            content={"title": title, "paragraphs": sp.paragraphs},
            source_file=rel(qf),
        )
        self._attach_answers(paper_id, pk, "matching", sp.questions, ana, af, rep)

    # 仔细阅读
    def _do_reading(self, paper_id, pk, sec, qdoc, adoc, qf, af, rep):
        sp = P.parse_reading(qdoc)
        ana = A.parse_reading_analysis(adoc, question_numbers={q.q_no for q in sp.questions}) if adoc else None
        if ana:
            for q in sp.questions:
                qa = ana.per_q.get(q.q_no)
                if qa and qa.answer:
                    keys = {o["key"] for o in q.options}
                    if keys and qa.answer not in keys:
                        qa.answer = None
                        qa.flags.append("答案字母不在选项中")
        for q in sp.questions:
            q.source_file = str(qf)
        self._set_material(
            paper_id, sec, "passage", directions=sp.directions,
            content={"passage": sp.passage, "passage2": sp.passage2},
            translation={"passage_translation": ana.passage_translation} if ana and ana.passage_translation else None,
            source_file=rel(qf),
        )
        self._attach_answers(paper_id, pk, sec, sp.questions, ana, af, rep)

    # 写作
    def _do_writing(self, paper_id, pk, qdoc, adoc, qf, af, rep):
        sp = P.parse_writing(qdoc)
        ana = A.parse_writing_analysis(adoc) if adoc else None
        q = sp.questions[0]
        q.source_file = str(qf)
        content = {"prompt": sp.prompt_text}
        analysis_text = None
        if ana:
            content["model_essay"] = ana.model_essay
            content["model_essay_cn"] = ana.model_essay_cn
            content["paragraph_notes"] = ana.essay_paragraph_notes
            analysis_text = adoc.text
        else:
            self.issue(pk, "writing", None, "warn", "无解析材料：缺参考范文")
        self._set_material(
            paper_id, "writing", "prompt", directions=None, content=content,
            analysis_text=analysis_text, source_file=rel(af) or rel(qf),
            status="ok" if ana and ana.model_essay else "needs_review",
        )
        self._upsert_question(
            paper_id, pk, "writing", q, analysis_text=ana.essay_paragraph_notes if ana else None,
            answer_source=rel(af) if ana else None,
        )
        rep.update(questions=1, answers=0)
        rep["essay"] = bool(ana and ana.model_essay)

    # 翻译
    def _do_translation(self, paper_id, pk, qdoc, adoc, qf, af, rep):
        sp = P.parse_translation(qdoc)
        ana = A.parse_translation_analysis(adoc) if adoc else None
        q = sp.questions[0]
        q.source_file = str(qf)
        content = {"prompt": sp.prompt_text}
        if ana:
            content["reference_translation"] = ana.reference_translation
            content["sentence_notes"] = ana.sentence_notes
        else:
            self.issue(pk, "translation", None, "warn", "无解析材料：缺参考译文")
        self._set_material(
            paper_id, "translation", "prompt", directions=None, content=content,
            analysis_text=adoc.text if adoc else None,
            source_file=rel(af) or rel(qf),
            status="ok" if ana and ana.reference_translation else "needs_review",
        )
        self._upsert_question(
            paper_id, pk, "translation", q,
            analysis_text=ana.sentence_notes if ana else None,
            answer_source=rel(af) if ana else None,
        )
        rep.update(questions=1, answers=0)
        rep["reference_translation"] = bool(ana and ana.reference_translation)


def run(papers_filter: list[str] | None = None, force: bool = False, exam: str | None = None):
    global EXAM
    EXAM = exam or EXAM
    if EXAM not in ("cet4", "cet6"):
        raise ValueError("exam must be cet4 or cet6")
    db.init_db()
    version = datetime.now().strftime("%Y%m%d-%H%M%S")
    conn = db.connect()
    try:
        entries = scan_root()
        if papers_filter:
            entries = [e for e in entries if e["paper_key"] in papers_filter]
        imp = Importer(conn, version, force)
        reports = []
        for e in entries:
            r = imp.import_paper(e)
            reports.append(r)
            conn.commit()
        # 汇总报告
        summary = {
            "generated_at": datetime.now().isoformat(),
            "import_version": version,
            "root": str(ROOT),
            "papers": reports,
            "issues": imp.issues,
        }
        # A test/recovery database must never overwrite the live bank's report.
        out = db.DB_PATH.parent / "import-report.json"
        if out.exists():
            previous = json.loads(out.read_text(encoding="utf8"))
            merged = {p["paper_key"]: p for p in previous.get("papers", [])}
            merged.update({p["paper_key"]: p for p in reports})
            summary["papers"] = sorted(merged.values(), key=lambda p: p["paper_key"])
        # 问题入库：只清理本次实际重导的套次，未变更套次的历史问题保留
        for report in reports:
            for section, result in report['sections'].items():
                if isinstance(result, dict) and result.get('status') != 'unchanged':
                    conn.execute('DELETE FROM import_issues WHERE paper_key=? AND section=?', (report['paper_key'], section))
        for it in imp.issues:
            conn.execute(
                "INSERT INTO import_issues(paper_key, section, uid, level, message) VALUES(?,?,?,?,?)",
                (it["paper_key"], it["section"], it["uid"], it["level"], it["message"]),
            )
        conn.commit()
        # 报告的问题清单以库内当前数据为准（含未变更套次的历史问题）
        summary["issues"] = [
            dict(r) for r in conn.execute(
                "SELECT paper_key, section, uid, level, message FROM import_issues ORDER BY paper_key, section"
            ).fetchall()
        ]
        out.write_text(json.dumps(summary, ensure_ascii=False, indent=1), encoding="utf-8")
        _print_summary(reports, imp.issues, out)
    finally:
        conn.close()


def _print_summary(reports, issues, out_path):
    total_q = 0
    total_a = 0
    print(f"导入完成：{len(reports)} 套")
    for r in reports:
        secs = []
        for sec, rr in r["sections"].items():
            if isinstance(rr, dict) and rr.get("questions"):
                secs.append(f"{SECTION_CN[sec]}{rr['questions']}题/答案{rr.get('answers', 0)}")
                total_q += rr["questions"] if sec in EXPECTED else 0
                total_a += rr.get("answers", 0) or 0
        print(f"  {r['paper_key']}: " + (", ".join(secs) if secs else "无可导入客观题"))
    print(f"客观题合计 {total_q} 题，含可靠答案 {total_a} 题")
    print(f"问题 {len(issues)} 条（详见 import_issues 表与 import-report.json）")
    print(f"报告: {out_path}")


if __name__ == "__main__":
    ap_ = argparse.ArgumentParser()
    ap_.add_argument("--paper", action="append", help="仅导入指定套次，如 2023-06-1")
    ap_.add_argument("--force", action="store_true", help="忽略校验和缓存强制重导")
    ap_.add_argument("--exam", choices=["cet4", "cet6"], default="cet6")
    args = ap_.parse_args()
    run(papers_filter=args.paper, force=args.force, exam=args.exam)
