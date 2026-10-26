"""六级刷题网站后端：FastAPI + SQLite，仅监听 127.0.0.1。

路由前缀 /api；静态前端构建产物由本服务直接托管。
"""
from __future__ import annotations

import json
import hmac
import os
import math
import mimetypes
import sqlite3
import uuid
from datetime import datetime
from pathlib import Path, PureWindowsPath
from typing import Any, Literal

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, HTMLResponse
from starlette.background import BackgroundTask
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import db

PROJECT = Path(os.environ.get("CET6_PROJECT_DIR", Path(__file__).resolve().parents[2]))
ROOT = Path(os.environ.get("CET_RESOURCE_ROOT", os.environ.get("CET6_RESOURCE_ROOT", PROJECT / "resources")))
FRONTEND_DIST = Path(os.environ.get("CET6_FRONTEND_DIST", PROJECT / "frontend" / "dist"))

app = FastAPI(title="四六级研习室", docs_url=None, redoc_url=None)


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc: RequestValidationError):
    # Non-finite numeric input must remain a 422, not break JSON error serialization.
    detail = jsonable_encoder(exc.errors(), custom_encoder={
        float: lambda value: value if math.isfinite(value) else str(value),
    })
    return JSONResponse(status_code=422, content={"detail": detail})

SECTION_CN = {
    "listening": "听力", "cloze": "选词填空", "matching": "长篇阅读",
    "reading1": "仔细阅读一", "reading2": "仔细阅读二",
    "writing": "写作", "translation": "翻译",
}
SECTION_ORDER = ["listening", "cloze", "matching", "reading1", "reading2", "writing", "translation"]
SECTION_ORDER_SQL = ("CASE section WHEN 'listening' THEN 1 WHEN 'cloze' THEN 2 "
                     "WHEN 'matching' THEN 3 WHEN 'reading1' THEN 4 WHEN 'reading2' THEN 5 "
                     "WHEN 'writing' THEN 6 WHEN 'translation' THEN 7 END")
OBJECTIVE_SECTIONS = {"listening", "cloze", "matching", "reading1", "reading2"}


def _question_or_404(conn, uid: str):
    row = conn.execute("SELECT * FROM questions WHERE uid=?", (uid,)).fetchone()
    if row is None:
        raise HTTPException(404, "题目不存在")
    return row


def _choice_keys(conn, question) -> set[str]:
    options = json.loads(question["options_json"] or "[]")
    keys = {item["key"] for item in options if isinstance(item, dict) and isinstance(item.get("key"), str)}
    if question["qtype"] == "match":
        material = conn.execute(
            "SELECT content_json FROM section_materials WHERE paper_id=? AND section=? AND group_key=?",
            (question["paper_id"], question["section"], question["group_key"] or ""),
        ).fetchone()
        if material:
            content = json.loads(material["content_json"] or "{}")
            keys.update(p["label"] for p in content.get("paragraphs", [])
                        if isinstance(p, dict) and isinstance(p.get("label"), str))
    # Missing source options do not make a valid A-Z key impossible to correct.
    return keys or set("ABCD" if question["qtype"] == "mcq" else "ABCDEFGHIJKLMNOPQRSTUVWXYZ")


def _normalize_answer(conn, question, value):
    if value is None:
        return None
    if not isinstance(value, str):
        raise HTTPException(400, "作答必须是选项字母或草稿文本")
    if question["section"] not in OBJECTIVE_SECTIONS:
        return value
    value = value.strip().upper()
    if not value:
        return None
    if value not in _choice_keys(conn, question):
        raise HTTPException(400, f"{question['uid']} 的选项无效")
    return value


def _normalize_fix(conn, question, field: str, value):
    if field == "answer":
        if question["section"] not in OBJECTIVE_SECTIONS:
            raise HTTPException(400, "仅支持校正客观题的选项答案")
        return _normalize_answer(conn, question, value)
    if field == "stem":
        if value is not None and (not isinstance(value, str) or len(value) > 8000):
            raise HTTPException(400, "题干必须为不超过 8000 字符的文本或空值")
        return value
    raise HTTPException(400, "不支持的校正字段")


# ================================================================ 试卷库
@app.get("/api/papers")
def list_papers(year: int | None = None, month: int | None = None,
                section: str | None = None, exam: Literal["cet4", "cet6"] | None = None):
    conn = db.connect()
    try:
        sql = "SELECT * FROM papers"
        cond, args = [], []
        if exam:
            cond.append("exam_type=?"); args.append(exam)
        if year:
            cond.append("year=?"); args.append(year)
        if month:
            cond.append("month=?"); args.append(month)
        if cond:
            sql += " WHERE " + " AND ".join(cond)
        sql += " ORDER BY year DESC, month DESC, set_no"
        papers = [dict(r) for r in conn.execute(sql, args).fetchall()]
        for p in papers:
            qs = conn.execute(
                "SELECT section, qtype, COUNT(*) n, SUM(answer IS NOT NULL) na "
                "FROM questions WHERE paper_id=? GROUP BY section, qtype",
                (p["id"],),
            ).fetchall()
            obj_n = obj_key = 0
            sections = {}
            for r in qs:
                sections[r["section"]] = {"n": r["n"], "answers": r["na"] or 0}
                if r["section"] in OBJECTIVE_SECTIONS:
                    obj_n += r["n"]; obj_key += r["na"] or 0
            p["question_counts"] = sections
            p["objective_total"] = obj_n
            p["objective_keyed"] = obj_key
            p["has_audio"] = bool(p["audio_path"])
            p["shared_sources"] = json.loads(p.get("shared_sources_json") or "{}")
            s = conn.execute(
                "SELECT id, started_at, updated_at, submitted_at, answers_json FROM sessions WHERE paper_id=? AND mode='full' "
                "ORDER BY id DESC", (p["id"],),
            ).fetchall()
            answered = 0
            active = None
            last_submitted = next((row["submitted_at"] for row in s if row["submitted_at"]), None)
            has_work = False
            # The newest attempt owns the current status. Older attempts remain available.
            latest = s[0] if s else None
            if latest and latest["submitted_at"] is None:
                active = latest["id"]
                try:
                    answers = json.loads(latest["answers_json"] or "{}")
                    scope = {q["uid"]: q["qtype"] for q in conn.execute(
                        "SELECT uid, qtype FROM questions WHERE paper_id=?", (p["id"],)
                    )}
                    filled = {uid: value for uid, value in answers.items()
                              if uid in scope and isinstance(value, str) and value.strip()}
                    has_work = bool(filled)
                    answered = sum(scope[uid] in ('mcq', 'blank', 'match') for uid in filled)
                except (ValueError, TypeError, AttributeError):
                    pass
            p["active_session_id"] = active
            p["active_updated_at"] = (latest["updated_at"] or latest["started_at"]) if active else None
            p["active_answered"] = answered
            p["last_submitted_at"] = last_submitted
            p["status"] = (
                ("in_progress" if has_work else "not_started") if active else
                ("done" if last_submitted else "not_started")
            )
            p["_filtered_out"] = bool(section and section not in sections)
        if section:
            papers = [p for p in papers if not p["_filtered_out"]]
        return {"papers": papers, "section_cn": SECTION_CN}
    finally:
        conn.close()


def _paper_or_404(conn, paper_key: str):
    row = conn.execute("SELECT * FROM papers WHERE paper_key=?", (paper_key,)).fetchone()
    if row is None:
        raise HTTPException(404, "试卷不存在")
    return row


def _question_public(r: sqlite3.Row, with_answer: bool = False) -> dict:
    d = {
        "uid": r["uid"], "paper_key": r["paper_key"], "section": r["section"], "section_cn": SECTION_CN.get(r["section"], r["section"]),
        "q_no": r["q_no"], "q_index": r["q_index"], "qtype": r["qtype"],
        "group_key": r["group_key"], "stem": r["stem"],
        "options": json.loads(r["options_json"] or "[]"),
        "status": r["status"], "flags": json.loads(r["flags_json"] or "[]"),
        "source_file": r["source_file"], "source_page": r["source_page"],
        "has_answer": r["answer"] is not None,
        "has_analysis": bool(r["analysis_text"]),
    }
    if with_answer:
        d["answer"] = r["answer"]
        d["answer_source"] = r["answer_source"]
        d["analysis_text"] = r["analysis_text"]
        ajson = json.loads(r["analysis_json"] or "{}") if r["analysis_json"] else {}
        d["answer_word"] = ajson.get("answer_word", "")
        if r["qtype"] == "blank" and r["manual_locked"]:
            # Derive the displayed word from the corrected key without rewriting analysis.
            d["answer_word"] = next((o.get("text", "") for o in d["options"] if o.get("key") == r["answer"]), "")
    return d


@app.get("/api/papers/{paper_key}")
def paper_detail(paper_key: str):
    conn = db.connect()
    try:
        p = _paper_or_404(conn, paper_key)
        materials = [dict(r) for r in conn.execute(
            "SELECT section, kind, file_path, pages FROM materials WHERE paper_id=?",
            (p["id"],),
        ).fetchall()]
        raw_pdfs = [m["file_path"] for m in materials if m["kind"] in ("question", "analysis")]
        smats = conn.execute(
            "SELECT * FROM section_materials WHERE paper_id=?", (p["id"],),
        ).fetchall()
        sections = {}
        for r in smats:
            sections.setdefault(r["section"], {})[r["group_key"] or "main"] = {
                "directions": r["directions"],
                "content": json.loads(r["content_json"] or "{}") if r["content_json"] else {},
                "translation": json.loads(r["translation_json"] or "{}") if r["translation_json"] else {},
                "analysis_text": r["analysis_text"],
                "status": r["status"],
                "source_file": r["source_file"],
            }
        questions = [_question_public(r) for r in conn.execute(
            f"SELECT * FROM questions WHERE paper_id=? ORDER BY {SECTION_ORDER_SQL}, q_index",
            (p["id"],),
        ).fetchall()]
        return {
            "paper": dict(p), "sections": sections, "questions": questions,
            "raw_pdfs": raw_pdfs,
            "audio_url": f"/api/audio/{paper_key}" if p["audio_path"] else None,
        }
    finally:
        conn.close()


# ================================================================ 做题会话
class SaveState(BaseModel):
    answers: dict[str, str | None] | None = None
    current_uid: str | None = None
    elapsed_sec: int | None = Field(default=None, ge=0, le=2147483647)
    audio_pos: float | None = Field(default=None, ge=0, allow_inf_nan=False)
    audio_paper_key: str | None = None
    client_id: str | None = Field(default=None, min_length=1, max_length=128)
    client_revision: int | None = Field(default=None, ge=0, le=9223372036854775806)
    base_revision: int | None = Field(default=None, ge=0, le=9223372036854775806)


class RevealBody(BaseModel):
    uid: str


class RedoBody(BaseModel):
    uids: list[str] = Field(max_length=10000)
    mode: Literal["redo", "wrong_redo"] = "redo"


@app.post("/api/sessions")
def create_session(paper_key: str, mode: Literal["full", "redo", "wrong_redo"] = "full", restart: bool = False):
    conn = db.connect()
    try:
        conn.execute("BEGIN IMMEDIATE")
        p = _paper_or_404(conn, paper_key)
        if mode == "full" and not restart:
            row = conn.execute(
                "SELECT id, submitted_at FROM sessions WHERE paper_id=? AND mode='full' "
                "ORDER BY id DESC LIMIT 1", (p["id"],),
            ).fetchone()
            if row and row["submitted_at"] is None:
                return {"session_id": row["id"], "resumed": True}
        cur = conn.execute(
            "INSERT INTO sessions(paper_id, mode, session_key) VALUES(?,?,?)", (p["id"], mode, str(uuid.uuid4()))
        )
        conn.commit()
        return {"session_id": cur.lastrowid, "resumed": False}
    finally:
        conn.close()


@app.post("/api/sessions/redo")
def create_redo(body: RedoBody):
    """错题重做：跨试卷按 uid 建会话，不覆盖旧记录。"""
    if not body.uids:
        raise HTTPException(400, "uids 为空")
    conn = db.connect()
    try:
        uids = list(dict.fromkeys(body.uids))
        ph = ",".join("?" for _ in uids)
        rows = conn.execute(
            f"SELECT uid, paper_id FROM questions WHERE uid IN ({ph})", uids
        ).fetchall()
        if len(rows) != len(uids):
            raise HTTPException(404, "部分题目不存在，请刷新题目列表")
        pid = next(row["paper_id"] for row in rows if row["uid"] == uids[0])
        cur = conn.execute(
            "INSERT INTO sessions(paper_id, mode, scope_json, session_key) VALUES(?,?,?,?)",
            (pid, body.mode, json.dumps(uids), str(uuid.uuid4())),
        )
        conn.commit()
        return {"session_id": cur.lastrowid}
    finally:
        conn.close()


def _session_or_404(conn, sid: int) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM sessions WHERE id=?", (sid,)).fetchone()
    if row is None:
        raise HTTPException(404, "会话不存在")
    return row


@app.post("/api/sessions/{sid}/restart")
def restart_session(sid: int):
    """Open a blank attempt with the same scope; preserve all previous answers and results."""
    conn = db.connect()
    try:
        conn.execute("BEGIN IMMEDIATE")
        previous = _session_or_404(conn, sid)
        cur = conn.execute(
            "INSERT INTO sessions(paper_id, mode, scope_json, session_key) VALUES(?,?,?,?)",
            (previous["paper_id"], previous["mode"], previous["scope_json"] or "[]", str(uuid.uuid4())),
        )
        conn.commit()
        return {"session_id": cur.lastrowid, "resumed": False}
    finally:
        conn.close()


def _scope_uids(conn, sess: sqlite3.Row) -> list[str]:
    try:
        scope = json.loads(sess["scope_json"] or "[]")
        if not isinstance(scope, list) or any(not isinstance(uid, str) for uid in scope):
            raise ValueError("scope")
    except (ValueError, TypeError) as exc:
        raise HTTPException(400, "练习范围数据损坏，无法恢复该会话") from exc
    if scope:
        return list(dict.fromkeys(scope))
    return [r["uid"] for r in conn.execute(
        f"SELECT uid FROM questions WHERE paper_id=? ORDER BY {SECTION_ORDER_SQL}, q_index",
        (sess["paper_id"],),
    ).fetchall()]


@app.get("/api/sessions/{sid}")
def get_session(sid: int):
    conn = db.connect()
    try:
        conn.execute("BEGIN")
        sess = _session_or_404(conn, sid)
        uids = _scope_uids(conn, sess)
        ph = ",".join("?" for _ in uids)
        qs = [_question_public(r, with_answer=bool(sess["submitted_at"]))
              for r in conn.execute(
                  f"SELECT * FROM questions WHERE uid IN ({ph})", uids,
              ).fetchall()]
        order = {s: i for i, s in enumerate(SECTION_ORDER)}
        qs.sort(key=lambda q: (order.get(q["section"], 99), q["q_index"]))
        p = conn.execute("SELECT * FROM papers WHERE id=?", (sess["paper_id"],)).fetchone()
        paper_keys = sorted({q["paper_key"] for q in qs} | {p["paper_key"]})
        paper_ph = ",".join("?" for _ in paper_keys)
        smats = conn.execute(
            f"SELECT sm.*, p.paper_key FROM section_materials sm JOIN papers p ON p.id=sm.paper_id WHERE p.paper_key IN ({paper_ph})", paper_keys,
        ).fetchall()
        sections_by_paper = {}
        for r in smats:
            sections = sections_by_paper.setdefault(r["paper_key"], {})
            sections.setdefault(r["section"], {})[r["group_key"] or "main"] = {
                "directions": r["directions"],
                "content": json.loads(r["content_json"] or "{}") if r["content_json"] else {},
                "translation": json.loads(r["translation_json"] or "{}") if r["translation_json"] else {},
                "analysis_text": r["analysis_text"],
                "status": r["status"],
            }
        return {
            "session": {
                "id": sess["id"], "paper_id": sess["paper_id"], "mode": sess["mode"],
                "paper_key": p["paper_key"], "started_at": sess["started_at"],
                "submitted_at": sess["submitted_at"],
                "answers": json.loads(sess["answers_json"] or "{}"),
                "current_uid": sess["current_uid"],
                "elapsed_sec": sess["elapsed_sec"], "audio_pos": sess["audio_pos"],
                "audio_paper_key": sess["audio_paper_key"] or p["paper_key"],
                "state_revision": sess["state_revision"],
                "revealed": json.loads(sess["revealed_uids"] or "[]"),
                "scope": uids,
                "result": json.loads(sess["result_json"]) if sess["result_json"] else None,
            },
            "paper": dict(p), "questions": qs, "sections": sections_by_paper.get(p["paper_key"], {}),
            "sections_by_paper": sections_by_paper,
            "audio_by_paper": {row["paper_key"]: f"/api/audio/{row['paper_key']}" if row["audio_path"] else None
                               for row in conn.execute(f"SELECT paper_key, audio_path FROM papers WHERE paper_key IN ({paper_ph})", paper_keys)},
            "audio_url": f"/api/audio/{p['paper_key']}" if p["audio_path"] else None,
        }
    finally:
        conn.close()


@app.put("/api/sessions/{sid}")
@app.post("/api/sessions/{sid}")  # sendBeacon uses POST when a tab closes or reloads.
def save_state(sid: int, body: SaveState):
    conn = db.connect()
    try:
        conn.execute("BEGIN IMMEDIATE")
        sess = _session_or_404(conn, sid)
        if sess["submitted_at"]:
            raise HTTPException(400, "已交卷，不能再修改作答")
        versioned = body.client_id is not None or body.client_revision is not None or body.base_revision is not None
        if versioned:
            if body.client_id is None or body.client_revision is None or body.base_revision is None:
                raise HTTPException(400, "保存版本字段不完整")
            if body.client_id == sess["state_client_id"]:
                if body.client_revision <= sess["state_client_revision"]:
                    return {"ok": True, "ignored": True, "state_revision": sess["state_revision"]}
            elif body.base_revision != sess["state_revision"]:
                raise HTTPException(409, "另一页面已修改此练习，请保留当前作答并刷新核对")
        scope = _scope_uids(conn, sess)
        ph = ",".join("?" for _ in scope)
        questions = {row["uid"]: row for row in conn.execute(
            f"SELECT * FROM questions WHERE uid IN ({ph})", scope,
        )}
        answers = json.loads(sess["answers_json"] or "{}")
        if body.answers is not None:
            if any(uid not in questions for uid in body.answers):
                raise HTTPException(400, "作答包含本次练习范围以外的题目")
            for uid, value in body.answers.items():
                value = _normalize_answer(conn, questions[uid], value)
                if value is None or value == "":
                    answers.pop(uid, None)
                else:
                    answers[uid] = value
        cur = sess["current_uid"] if "current_uid" not in body.model_fields_set else body.current_uid
        if cur is not None and cur not in questions:
            raise HTTPException(400, "当前题目不在本次练习范围内")
        elapsed = sess["elapsed_sec"] if body.elapsed_sec is None else body.elapsed_sec
        audio = sess["audio_pos"] if body.audio_pos is None else body.audio_pos
        audio_key = body.audio_paper_key if body.audio_paper_key is not None else sess["audio_paper_key"]
        if audio_key is not None and audio_key not in {q["paper_key"] for q in questions.values()}:
            raise HTTPException(400, "音频所属试卷不在本次练习范围内")
        revision = sess["state_revision"] + 1
        conn.execute(
            "UPDATE sessions SET answers_json=?, current_uid=?, elapsed_sec=?, audio_pos=?, audio_paper_key=?, "
            "state_revision=?, state_client_id=?, state_client_revision=?, "
            "updated_at=datetime('now','localtime') WHERE id=?",
            (json.dumps(answers, ensure_ascii=False), cur, elapsed, audio, audio_key,
             revision, body.client_id, body.client_revision or 0, sid),
        )
        conn.commit()
        return {"ok": True, "saved": len(answers), "state_revision": revision}
    finally:
        conn.close()


@app.post("/api/sessions/{sid}/reveal")
def mark_revealed(sid: int, body: RevealBody):
    conn = db.connect()
    try:
        conn.execute("BEGIN IMMEDIATE")
        sess = _session_or_404(conn, sid)
        if body.uid not in _scope_uids(conn, sess):
            raise HTTPException(400, "题目不在本次练习范围内")
        if sess["submitted_at"]:
            return {"ok": True}
        rev = set(json.loads(sess["revealed_uids"] or "[]"))
        rev.add(body.uid)
        conn.execute("UPDATE sessions SET revealed_uids=? WHERE id=?",
                     (json.dumps(sorted(rev)), sid))
        conn.commit()
        return {"ok": True}
    finally:
        conn.close()


@app.post("/api/sessions/{sid}/submit")
def submit_session(sid: int):
    """交卷：判客观题（缺标准答案的题不判分），作文/翻译不计入统计。"""
    conn = db.connect()
    try:
        conn.execute("BEGIN IMMEDIATE")
        sess = _session_or_404(conn, sid)
        if sess["submitted_at"]:
            return {"ok": True, "already": True,
                    "result": json.loads(sess["result_json"]) if sess["result_json"] else None}
        uids = _scope_uids(conn, sess)
        ph = ",".join("?" for _ in uids)
        qrows = {r["uid"]: r for r in conn.execute(
            f"SELECT * FROM questions WHERE uid IN ({ph})", uids
        ).fetchall()}
        answers = json.loads(sess["answers_json"] or "{}")
        revealed = set(json.loads(sess["revealed_uids"] or "[]"))
        detail = {}
        per_section: dict[str, dict[str, int]] = {}
        for uid in uids:
            q = qrows.get(uid)
            if q is None:
                continue
            choice = answers.get(uid)
            obj = q["section"] in OBJECTIVE_SECTIONS
            if not obj:
                detail[uid] = {"kind": "subjective", "text": choice if isinstance(choice, str) else ""}
                continue
            if not q["answer"]:
                detail[uid] = {"kind": "objective", "verdict": "no_key",
                               "choice": choice or None, "revealed": uid in revealed}
                st = per_section.setdefault(q["section"], {
                    "correct": 0, "wrong": 0, "unanswered": 0, "no_key": 0, "revealed": 0})
                st["no_key"] += 1
                st["revealed"] += int(uid in revealed)
                continue
            verdict = "unanswered" if not choice else ("correct" if choice == q["answer"] else "wrong")
            detail[uid] = {"kind": "objective", "verdict": verdict,
                           "choice": choice or None, "answer": q["answer"],
                           "revealed": uid in revealed}
            st = per_section.setdefault(q["section"], {
                "correct": 0, "wrong": 0, "unanswered": 0, "no_key": 0, "revealed": 0})
            st[verdict] += 1
            if uid in revealed:
                st["revealed"] += 1
        correct = sum(1 for d in detail.values()
                      if d.get("kind") == "objective" and d["verdict"] == "correct")
        wrong = sum(1 for d in detail.values()
                    if d.get("kind") == "objective" and d["verdict"] == "wrong")
        unanswered = sum(1 for d in detail.values()
                         if d.get("kind") == "objective" and d["verdict"] == "unanswered")
        no_key = sum(1 for d in detail.values()
                     if d.get("kind") == "objective" and d["verdict"] == "no_key")
        graded = correct + wrong
        result = {
            "submitted_at": datetime.now().isoformat(timespec="seconds"),
            "correct": correct, "wrong": wrong, "unanswered": unanswered,
            "no_key": no_key,
            "accuracy": round(correct / graded, 4) if graded else None,
            "per_section": {SECTION_CN.get(k, k): v for k, v in per_section.items()},
            "detail": detail,
            "note": "正确率为客观题正确数/已作答且有标准答案的题数，非四六级考试成绩。",
        }
        conn.execute(
            "UPDATE sessions SET submitted_at=datetime('now','localtime'), result_json=? WHERE id=?",
            (json.dumps(result, ensure_ascii=False), sid),
        )
        for uid, d in detail.items():
            if d.get("kind") == "objective" and d["verdict"] == "wrong":
                changed_at = datetime.now().isoformat(timespec="microseconds")
                conn.execute(
                    "INSERT INTO wrong_book(uid, session_id, wrong_count, last_wrong_at, updated_at) "
                    "VALUES(?,?,1,?,?) "
                    "ON CONFLICT(uid) DO UPDATE SET wrong_count=wrong_count+1, "
                    "resolved=0, session_id=excluded.session_id, "
                    "last_wrong_at=excluded.last_wrong_at, updated_at=excluded.updated_at",
                    (uid, sid, changed_at, changed_at),
                )
            elif d.get("kind") == "objective" and d["verdict"] == "correct" and not d["revealed"]:
                conn.execute("UPDATE wrong_book SET resolved=1, updated_at=? WHERE uid=?",
                             (datetime.now().isoformat(timespec="microseconds"), uid))
        conn.commit()
        return {"ok": True, "result": result}
    finally:
        conn.close()


@app.get("/api/sessions/{sid}/result")
def get_result(sid: int):
    conn = db.connect()
    try:
        sess = _session_or_404(conn, sid)
        if not sess["result_json"]:
            raise HTTPException(400, "尚未交卷")
        return json.loads(sess["result_json"])
    finally:
        conn.close()


@app.get("/api/history")
def history(limit: int = Query(100, ge=1, le=1000)):
    conn = db.connect()
    try:
        rows = conn.execute(
            "SELECT s.id, s.mode, s.started_at, s.submitted_at, s.result_json, "
            "p.paper_key, p.year, p.month, p.set_no "
            "FROM sessions s JOIN papers p ON p.id=s.paper_id "
            "WHERE s.submitted_at IS NOT NULL ORDER BY s.submitted_at DESC, s.id DESC LIMIT ?",
            (limit,),
        ).fetchall()
        out = []
        for r in rows:
            d = dict(r)
            res = json.loads(d.pop("result_json") or "{}")
            d["correct"] = res.get("correct")
            d["wrong"] = res.get("wrong")
            d["accuracy"] = res.get("accuracy")
            out.append(d)
        return {"history": out}
    finally:
        conn.close()


# ================================================================ 解析（单题）
@app.get("/api/questions/{uid}")
def question_detail(uid: str):
    conn = db.connect()
    try:
        r = conn.execute("SELECT * FROM questions WHERE uid=?", (uid,)).fetchone()
        if r is None:
            raise HTTPException(404, "题目不存在")
        q = _question_public(r, with_answer=True)
        mats = conn.execute(
            "SELECT * FROM section_materials WHERE paper_id=? AND section=?",
            (r["paper_id"], r["section"]),
        ).fetchall()
        q["materials"] = [
            {"group_key": m["group_key"], "directions": m["directions"],
             "content": json.loads(m["content_json"] or "{}") if m["content_json"] else {},
             "translation": json.loads(m["translation_json"] or "{}") if m["translation_json"] else {},
             "analysis_text": m["analysis_text"]}
            for m in mats
        ]
        note = conn.execute("SELECT text FROM notes WHERE uid=?", (uid,)).fetchone()
        fav = conn.execute("SELECT 1 FROM favorites WHERE uid=?", (uid,)).fetchone()
        q["note"] = note["text"] if note else ""
        q["favorite"] = bool(fav)
        return q
    finally:
        conn.close()


# ================================================================ 收藏 / 笔记 / 人工校正
class NoteBody(BaseModel):
    text: str = Field(max_length=10000)


class FixBody(BaseModel):
    field: str          # answer / stem
    value: Any


@app.post("/api/favorites/{uid}")
def add_favorite(uid: str):
    conn = db.connect()
    try:
        _question_or_404(conn, uid)
        conn.execute("INSERT OR IGNORE INTO favorites(uid) VALUES(?)", (uid,))
        conn.commit()
        return {"ok": True}
    finally:
        conn.close()


@app.delete("/api/favorites/{uid}")
def del_favorite(uid: str):
    conn = db.connect()
    try:
        conn.execute("DELETE FROM favorites WHERE uid=?", (uid,))
        conn.commit()
        return {"ok": True}
    finally:
        conn.close()


@app.put("/api/notes/{uid}")
def save_note(uid: str, body: NoteBody):
    conn = db.connect()
    try:
        _question_or_404(conn, uid)
        conn.execute(
            "INSERT INTO notes(uid, text, updated_at) VALUES(?,?,?) "
            "ON CONFLICT(uid) DO UPDATE SET text=excluded.text, "
            "updated_at=excluded.updated_at",
            (uid, body.text, datetime.now().isoformat(timespec="microseconds")),
        )
        conn.commit()
        return {"ok": True}
    finally:
        conn.close()


@app.post("/api/questions/{uid}/fix")
def manual_fix(uid: str, body: FixBody):
    """人工校正：写入题目并锁定，不再被后续导入覆盖。"""
    conn = db.connect()
    try:
        conn.execute("BEGIN IMMEDIATE")
        question = _question_or_404(conn, uid)
        value = _normalize_fix(conn, question, body.field, body.value)
        conn.execute(f"UPDATE questions SET {body.field}=?, manual_locked=1 WHERE uid=?", (value, uid))
        conn.execute(
            "INSERT INTO manual_fixes(uid, field, value, created_at) VALUES(?,?,?,?) "
            "ON CONFLICT(uid, field) DO UPDATE SET value=excluded.value, created_at=excluded.created_at",
            (uid, body.field, json.dumps(value, ensure_ascii=False), datetime.now().isoformat(timespec="microseconds")),
        )
        conn.commit()
        return {"ok": True}
    finally:
        conn.close()


# ================================================================ 复习
@app.get("/api/review/wrong")
def wrong_book():
    conn = db.connect()
    try:
        rows = conn.execute(
            "SELECT w.uid, w.wrong_count, w.first_wrong_at, w.last_wrong_at, w.resolved, "
            "q.section, q.q_no, q.stem, q.paper_key, q.options_json, q.answer, q.status, q.flags_json "
            "FROM wrong_book w JOIN questions q ON q.uid=w.uid "
            "ORDER BY w.resolved ASC, w.last_wrong_at DESC",
        ).fetchall()
        out = []
        for r in rows:
            out.append({
                "uid": r["uid"], "wrong_count": r["wrong_count"],
                "last_wrong_at": r["last_wrong_at"], "resolved": bool(r["resolved"]),
                "section": r["section"], "section_cn": SECTION_CN.get(r["section"], r["section"]),
                "q_no": r["q_no"], "stem": (r["stem"] or "")[:120],
                "paper_key": r["paper_key"],
                "options": json.loads(r["options_json"] or "[]"),
                "has_answer": r["answer"] is not None,
                "status": r["status"], "flags": json.loads(r["flags_json"] or "[]"),
            })
        return {"wrong": out}
    finally:
        conn.close()


@app.get("/api/review/favorites")
def favorites_list():
    conn = db.connect()
    try:
        rows = conn.execute(
            "SELECT f.uid, f.created_at, q.section, q.q_no, q.stem, q.paper_key, q.options_json "
            "FROM favorites f JOIN questions q ON q.uid=f.uid ORDER BY f.created_at DESC",
        ).fetchall()
        return {"favorites": [{
            "uid": r["uid"], "created_at": r["created_at"],
            "section": r["section"], "section_cn": SECTION_CN.get(r["section"], r["section"]),
            "q_no": r["q_no"], "stem": (r["stem"] or "")[:120], "paper_key": r["paper_key"],
            "options": json.loads(r["options_json"] or "[]"),
        } for r in rows]}
    finally:
        conn.close()


# ================================================================ 导入报告
@app.get("/api/report")
def import_report(exam: Literal["cet4", "cet6"] | None = None):
    report_path = PROJECT / "data" / "import-report.json"
    if not report_path.exists():
        raise HTTPException(404, "尚未生成导入报告")
    data = json.loads(report_path.read_text(encoding="utf-8"))
    conn = db.connect()
    try:
        issues = [dict(r) for r in conn.execute(
            "SELECT paper_key, section, uid, level, message FROM import_issues "
            "ORDER BY paper_key, section"
        ).fetchall()]
        stats = conn.execute(
            "SELECT COUNT(DISTINCT paper_key) papers, COUNT(*) questions, "
            "SUM(answer IS NOT NULL) answers FROM questions"
        ).fetchone()
        obj = conn.execute(
            "SELECT COUNT(*) n, SUM(answer IS NOT NULL) a FROM questions "
            "WHERE qtype IN ('mcq','blank','match')"
        ).fetchone()
        subj = conn.execute(
            "SELECT COUNT(*) n FROM questions WHERE qtype IN ('essay','translation')"
        ).fetchone()
        essays = conn.execute(
            "SELECT COUNT(*) c FROM section_materials WHERE section='writing' "
            "AND content_json LIKE '%model_essay%'"
        ).fetchone()
        trans = conn.execute(
            "SELECT COUNT(*) c FROM section_materials WHERE section='translation' "
            "AND content_json LIKE '%reference_translation%'"
        ).fetchone()
        if exam:
            keys = {r[0] for r in conn.execute("SELECT paper_key FROM papers WHERE exam_type=?", (exam,))}
            issues = [r for r in issues if r["paper_key"] in keys]
            data["papers"] = [r for r in data.get("papers", []) if r["paper_key"] in keys]
            stats = conn.execute("SELECT COUNT(DISTINCT q.paper_key) papers, COUNT(*) questions, SUM(q.answer IS NOT NULL) answers FROM questions q JOIN papers p ON q.paper_id=p.id WHERE p.exam_type=?", (exam,)).fetchone()
            obj = conn.execute("SELECT COUNT(*) n, SUM(q.answer IS NOT NULL) a FROM questions q JOIN papers p ON q.paper_id=p.id WHERE p.exam_type=? AND q.qtype IN ('mcq','blank','match')", (exam,)).fetchone()
            subj = conn.execute("SELECT COUNT(*) n FROM questions q JOIN papers p ON q.paper_id=p.id WHERE p.exam_type=? AND q.qtype IN ('essay','translation')", (exam,)).fetchone()
            essays = conn.execute("SELECT COUNT(*) c FROM section_materials s JOIN papers p ON s.paper_id=p.id WHERE p.exam_type=? AND s.section='writing' AND s.content_json LIKE '%model_essay%'", (exam,)).fetchone()
            trans = conn.execute("SELECT COUNT(*) c FROM section_materials s JOIN papers p ON s.paper_id=p.id WHERE p.exam_type=? AND s.section='translation' AND s.content_json LIKE '%reference_translation%'", (exam,)).fetchone()
        return {
            "summary": {
                "papers": stats["papers"], "questions": stats["questions"],
                "objective": {"questions": obj["n"], "with_answers": obj["a"]},
                "subjective": subj["n"],
                "writing_with_model_essay": essays["c"],
                "translation_with_reference": trans["c"],
                "generated_at": data.get("generated_at"),
            },
            "papers": data.get("papers", []),
            "issues": issues,
        }
    finally:
        conn.close()


# ================================================================ 备份/恢复
@app.get("/api/backup/export")
def backup_export():
    """导出个人数据：作答会话、错题本、收藏、笔记、人工校正。不含题库本体。"""
    conn = db.connect()
    try:
        conn.execute("BEGIN")
        data = {
            "format": "cet6-backup", "version": 1,
            "exported_at": datetime.now().isoformat(timespec="seconds"),
            "sessions": [dict(r) for r in conn.execute(
                "SELECT s.*, p.paper_key FROM sessions s JOIN papers p ON p.id=s.paper_id ORDER BY s.id"
            ).fetchall()],
            "wrong_book": [dict(r) for r in conn.execute("SELECT * FROM wrong_book").fetchall()],
            "favorites": [dict(r) for r in conn.execute("SELECT * FROM favorites").fetchall()],
            "notes": [dict(r) for r in conn.execute("SELECT * FROM notes").fetchall()],
            "manual_fixes": [dict(r) for r in conn.execute("SELECT * FROM manual_fixes").fetchall()],
        }
        fname = f"cet6-backup-{datetime.now().strftime('%Y%m%d-%H%M%S')}.json"
        return JSONResponse(
            content=data,
            headers={"Content-Disposition": f'attachment; filename="{fname}"'},
        )
    finally:
        conn.close()


class BackupImport(BaseModel):
    data: dict


def _backup_json(value, expected, label):
    try:
        parsed = json.loads(value)
    except (ValueError, TypeError) as exc:
        raise HTTPException(400, f"{label} 不是有效的 JSON，未修改任何数据") from exc
    if not isinstance(parsed, expected):
        raise HTTPException(400, f"{label} 类型不正确，未修改任何数据")
    return parsed


def _backup_int(value, label, minimum=0):
    if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= 9223372036854775806:
        raise HTTPException(400, f"{label} 必须是有效的整数，未修改任何数据")
    return value


def _backup_time(value, label):
    if value is None:
        return None
    try:
        if not isinstance(value, str):
            raise ValueError(label)
        datetime.fromisoformat(value)
    except ValueError as exc:
        raise HTTPException(400, f"{label} 时间无效，未修改任何数据") from exc
    return value


def _time_number(value):
    if not value:
        return float("-inf")
    try:
        return datetime.fromisoformat(value).timestamp()
    except (TypeError, ValueError, OSError, OverflowError):
        return float("-inf")


def _backup_result(value, scope):
    result = _backup_json(value, dict, "交卷结果")
    detail = result.get("detail")
    if not isinstance(detail, dict) or set(detail) != set(scope):
        raise HTTPException(400, "交卷结果的题目范围无效，未修改任何数据")
    counts = dict.fromkeys(("correct", "wrong", "unanswered", "no_key"), 0)
    for item in detail.values():
        if not isinstance(item, dict) or item.get("kind") not in ("objective", "subjective"):
            raise HTTPException(400, "交卷结果的题目判定无效，未修改任何数据")
        if item["kind"] == "objective":
            if item.get("verdict") not in counts:
                raise HTTPException(400, "交卷结果的题目判定无效，未修改任何数据")
            counts[item["verdict"]] += 1
    for key, count in counts.items():
        if _backup_int(result.get(key), f"交卷结果 {key}") != count:
            raise HTTPException(400, "交卷结果统计与明细不一致，未修改任何数据")
    accuracy = result.get("accuracy")
    graded = counts["correct"] + counts["wrong"]
    expected = round(counts["correct"] / graded, 4) if graded else None
    if accuracy != expected or isinstance(accuracy, bool):
        raise HTTPException(400, "交卷结果正确率无效，未修改任何数据")
    sections = result.get("per_section")
    if not isinstance(sections, dict):
        raise HTTPException(400, "交卷结果分题型统计无效，未修改任何数据")
    for section in sections.values():
        if not isinstance(section, dict):
            raise HTTPException(400, "交卷结果分题型统计无效，未修改任何数据")
        for key in (*counts, "revealed"):
            _backup_int(section.get(key, 0), f"分题型统计 {key}")
    return result


def _prepare_backup(conn, data):
    """Validate the entire payload before deleting or applying any record."""
    if data.get("format") != "cet6-backup" or type(data.get("version")) is not int or data["version"] != 1:
        raise HTTPException(400, "文件格式或备份版本不正确")
    required = {"sessions": ("id", "paper_id"), "wrong_book": ("uid",),
                "favorites": ("uid",), "notes": ("uid",), "manual_fixes": ("uid", "field")}
    prepared = {}
    for table, fields in required.items():
        if not isinstance(data.get(table), list):
            raise HTTPException(400, f"文件缺少 {table} 列表，未修改任何数据")
        prepared[table] = []
        seen = set()
        for row in data[table]:
            if not isinstance(row, dict) or any(row.get(field) is None for field in fields):
                raise HTTPException(400, f"{table} 记录格式无效，未修改任何数据")
            key = (row.get("uid"), row.get("field")) if table == "manual_fixes" else row.get("id" if table == "sessions" else "uid")
            if isinstance(key, (list, dict)) or (isinstance(key, tuple) and any(not isinstance(v, str) for v in key)):
                raise HTTPException(400, f"{table} 记录标识无效，未修改任何数据")
            if key in seen:
                raise HTTPException(400, f"{table} 含重复记录，未修改任何数据")
            seen.add(key)
            prepared[table].append(dict(row))
    papers = {row["paper_key"]: row["id"] for row in conn.execute("SELECT id, paper_key FROM papers")}
    paper_ids = {pid: key for key, pid in papers.items()}
    questions = {row["uid"]: row for row in conn.execute(
        "SELECT uid, paper_id, paper_key, section, qtype, options_json, group_key FROM questions"
    )}

    def require_uids(uids, label):
        if any(not isinstance(uid, str) or uid not in questions for uid in uids):
            raise HTTPException(400, f"{label} 包含题库中不存在的题目，未修改任何数据")

    for session in prepared["sessions"]:
        _backup_int(session["id"], "会话编号", 1)
        _backup_int(session["paper_id"], "试卷编号", 1)
        session_key = session.get("session_key")
        if session_key is not None:
            try:
                if not isinstance(session_key, str):
                    raise ValueError("session_key")
                session["session_key"] = str(uuid.UUID(session_key))
            except (ValueError, AttributeError) as exc:
                raise HTTPException(400, "练习记录标识无效，未修改任何数据") from exc
        mode = session.get("mode", "full")
        if mode not in ("full", "redo", "wrong_redo"):
            raise HTTPException(400, "会话模式无效，未修改任何数据")
        session["mode"] = mode
        scope = _backup_json(session.get("scope_json", "[]"), list, "练习范围")
        answers = _backup_json(session.get("answers_json", "{}"), dict, "作答内容")
        revealed = _backup_json(session.get("revealed_uids", "[]"), list, "查看解析记录")
        require_uids(scope, "练习范围")
        require_uids(answers, "作答内容")
        require_uids(revealed, "查看解析记录")
        scope = list(dict.fromkeys(scope))
        # v1 backups from older builds can often recover their stable key from question UIDs.
        key = session.get("paper_key")
        if key is None:
            candidate_uids = scope or list(answers) or ([session["current_uid"]] if session.get("current_uid") else [])
            require_uids(candidate_uids, "当前题目")
            candidate_keys = {questions[uid]["paper_key"] for uid in candidate_uids}
            key = (questions[scope[0]]["paper_key"] if scope else next(iter(candidate_keys))) if candidate_keys else paper_ids.get(session["paper_id"])
            if not scope and len(candidate_keys) > 1:
                raise HTTPException(400, "旧备份无法确定试卷归属，未修改任何数据")
        if not isinstance(key, str) or key not in papers:
            raise HTTPException(400, "备份所需的试卷尚未导入，未修改任何数据")
        session["paper_id"] = papers[key]
        effective_scope = scope or [uid for uid, q in questions.items() if q["paper_key"] == key]
        allowed = set(effective_scope)
        if not set(answers).issubset(allowed) or not set(revealed).issubset(allowed):
            raise HTTPException(400, "作答或查看解析记录超出练习范围，未修改任何数据")
        current = session.get("current_uid")
        if current is not None and (not isinstance(current, str) or current not in allowed):
            raise HTTPException(400, "当前题目不在练习范围内，未修改任何数据")
        cleaned = {}
        for uid, answer in answers.items():
            normalized = _normalize_answer(conn, questions[uid], answer)
            if normalized is not None and normalized != "":
                cleaned[uid] = normalized
        session["answers_json"] = json.dumps(cleaned, ensure_ascii=False)
        session["scope_json"] = json.dumps(scope)
        session["revealed_uids"] = json.dumps(list(dict.fromkeys(revealed)))
        session["elapsed_sec"] = _backup_int(session.get("elapsed_sec", 0), "练习用时")
        audio = session.get("audio_pos", 0)
        if isinstance(audio, bool) or not isinstance(audio, (int, float)) or not math.isfinite(audio) or audio < 0:
            raise HTTPException(400, "音频播放位置无效，未修改任何数据")
        session["audio_pos"] = audio
        audio_key = session.get("audio_paper_key")
        if audio_key is not None and (not isinstance(audio_key, str) or audio_key not in {questions[uid]["paper_key"] for uid in allowed}):
            raise HTTPException(400, "音频所属试卷不在练习范围内，未修改任何数据")
        for field in ("started_at", "updated_at", "submitted_at"):
            _backup_time(session.get(field), f"会话 {field}")
        session["state_revision"] = _backup_int(session.get("state_revision", 0), "保存版本")
        result = session.get("result_json")
        if bool(session.get("submitted_at")) != (result is not None):
            raise HTTPException(400, "交卷时间和结果不一致，未修改任何数据")
        if result is not None:
            _backup_result(result, effective_scope)
        session["_scope"] = allowed
    session_keys = [s["session_key"] for s in prepared["sessions"] if s.get("session_key")]
    if len(session_keys) != len(set(session_keys)):
        raise HTTPException(400, "备份含重复的练习记录标识，未修改任何数据")
    for table in ("wrong_book", "favorites", "notes", "manual_fixes"):
        for row in prepared[table]:
            require_uids([row["uid"]], table)
    for row in prepared["wrong_book"]:
        row["wrong_count"] = _backup_int(row.get("wrong_count", 1), "答错次数", 1)
        if type(row.get("resolved", 0)) not in (int, bool) or row.get("resolved", 0) not in (0, 1):
            raise HTTPException(400, "错题掌握状态无效，未修改任何数据")
        if row.get("session_id") is not None:
            _backup_int(row["session_id"], "错题会话编号", 1)
        for field in ("first_wrong_at", "last_wrong_at", "updated_at"):
            _backup_time(row.get(field), f"错题 {field}")
    for row in prepared["favorites"]:
        _backup_time(row.get("created_at"), "收藏创建时间")
    for row in prepared["notes"]:
        if not isinstance(row.get("text", ""), str) or len(row.get("text", "")) > 10000:
            raise HTTPException(400, "笔记文本无效或超过 10000 字符，未修改任何数据")
        _backup_time(row.get("updated_at"), "笔记更新时间")
    for row in prepared["manual_fixes"]:
        raw = row.get("value")
        value = raw
        if isinstance(raw, str):
            try:
                value = json.loads(raw)
            except ValueError:
                pass  # Also accept old hand-edited v1 files with an unquoted string.
        row["_value"] = _normalize_fix(conn, questions[row["uid"]], row["field"], value)
        row["value"] = json.dumps(row["_value"], ensure_ascii=False)
        _backup_time(row.get("created_at"), "人工校正更新时间")
    return prepared


def _session_backup_identity(session):
    """Content identity for v1 backups produced before stable session keys existed."""
    fields = ("paper_id", "mode", "started_at", "updated_at", "submitted_at", "current_uid",
              "elapsed_sec", "audio_pos", "audio_paper_key")
    values = [session.get(field) for field in fields]
    for field, default in (("answers_json", "{}"), ("scope_json", "[]"),
                           ("revealed_uids", "[]"), ("result_json", "null")):
        values.append(json.loads(session.get(field) or default))
    return json.dumps(values, ensure_ascii=False, sort_keys=True, allow_nan=False)


@app.post("/api/backup/import")
def backup_import(body: BackupImport, merge: bool = Query(True)):
    """原子恢复学习记录；保留较新的题目校正，避免丢失无法还原的校正台账。"""
    conn = db.connect()
    try:
        conn.execute("BEGIN IMMEDIATE")
        d = _prepare_backup(conn, body.data)
        counts = dict.fromkeys(d, 0)
        existing = {row["id"]: dict(row) for row in conn.execute("SELECT * FROM sessions")} if merge else {}
        by_key = {row["session_key"]: row["id"] for row in existing.values() if row["session_key"]}
        legacy_identities = {_session_backup_identity(row): row["id"] for row in existing.values()}
        used_ids = set(existing)
        next_id = max([*used_ids, *(s["id"] for s in d["sessions"]), 0]) + 1
        session_ids = {}
        imports = []
        for session in d["sessions"]:
            old_id = session["id"]
            session_key = session.get("session_key")
            duplicate = by_key.get(session_key) if session_key else legacy_identities.get(_session_backup_identity(session))
            if duplicate is not None:
                session_ids[old_id] = duplicate
                continue
            new_id = old_id
            if new_id in used_ids:
                new_id = next_id
                next_id += 1
            session_ids[old_id] = new_id
            session["id"] = new_id
            session["session_key"] = session_key or str(uuid.uuid4())
            used_ids.add(new_id)
            imports.append(session)
        # References follow the incoming record, even when its numeric ID collided.
        surviving_scopes = {sid: set(_scope_uids(conn, row)) for sid, row in existing.items()}
        surviving_scopes.update({s["id"]: s["_scope"] for s in imports})
        for row in d["wrong_book"]:
            sid = row.get("session_id")
            if sid is not None:
                sid = session_ids.get(sid, sid)
                row["session_id"] = sid
            if sid is not None and row["uid"] not in surviving_scopes.get(sid, set()):
                raise HTTPException(400, "错题的会话引用无效或与本地编号冲突，未修改任何数据")
        previous_revisions = {row["id"]: row["state_revision"] for row in conn.execute("SELECT id, state_revision FROM sessions")}
        if not merge:
            for session in d["sessions"]:
                if session["id"] in previous_revisions:
                    # A queued save from a page opened before replacement must conflict.
                    session["state_revision"] = _backup_int(
                        max(session["state_revision"], previous_revisions[session["id"]]) + 1, "恢复后的保存版本",
                    )
        if not merge:
            conn.execute("DELETE FROM wrong_book")
            conn.execute("DELETE FROM sessions")
            conn.execute("DELETE FROM favorites")
            conn.execute("DELETE FROM notes")
        for s in imports:
            conn.execute(
                "INSERT INTO sessions(id, paper_id, mode, started_at, updated_at, submitted_at, "
                "answers_json, current_uid, elapsed_sec, audio_pos, revealed_uids, result_json, scope_json, "
                "audio_paper_key, state_revision, session_key) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (s["id"], s["paper_id"], s.get("mode", "full"),
                 s.get("started_at"), s.get("updated_at"), s.get("submitted_at"),
                 s["answers_json"], s.get("current_uid"), s["elapsed_sec"], s["audio_pos"],
                 s["revealed_uids"], s.get("result_json"), s["scope_json"],
                 s.get("audio_paper_key"), s["state_revision"], s["session_key"]),
            )
            counts["sessions"] += 1
        for row in d["wrong_book"]:
            current = conn.execute("SELECT * FROM wrong_book WHERE uid=?", (row["uid"],)).fetchone()
            incoming_time = row.get("updated_at") or row.get("last_wrong_at")
            if current is None:
                conn.execute(
                    "INSERT INTO wrong_book(uid, session_id, wrong_count, first_wrong_at, last_wrong_at, resolved, updated_at) "
                    "VALUES(?,?,?,?,?,?,?)",
                    (row["uid"], row.get("session_id"), row["wrong_count"], row.get("first_wrong_at"),
                     row.get("last_wrong_at"), int(row.get("resolved", 0)), incoming_time),
                )
                counts["wrong_book"] += 1
            else:
                values = dict(current)
                values["wrong_count"] = max(current["wrong_count"], row["wrong_count"])
                if _time_number(row.get("last_wrong_at")) > _time_number(current["last_wrong_at"]):
                    values.update(last_wrong_at=row.get("last_wrong_at"), session_id=row.get("session_id"))
                if row.get("first_wrong_at") and (not current["first_wrong_at"] or _time_number(row["first_wrong_at"]) < _time_number(current["first_wrong_at"])):
                    values["first_wrong_at"] = row["first_wrong_at"]
                if _time_number(incoming_time) > _time_number(current["updated_at"] or current["last_wrong_at"]):
                    values.update(resolved=int(row.get("resolved", 0)), updated_at=incoming_time)
                if values != dict(current):
                    conn.execute(
                        "UPDATE wrong_book SET session_id=:session_id, wrong_count=:wrong_count, first_wrong_at=:first_wrong_at, "
                        "last_wrong_at=:last_wrong_at, resolved=:resolved, updated_at=:updated_at WHERE uid=:uid", values,
                    )
                    counts["wrong_book"] += 1
        for row in d["favorites"]:
            counts["favorites"] += conn.execute(
                "INSERT OR IGNORE INTO favorites(uid, created_at) VALUES(?,?)",
                (row["uid"], row.get("created_at")),
            ).rowcount
        for row in d["notes"]:
            current = conn.execute("SELECT updated_at FROM notes WHERE uid=?", (row["uid"],)).fetchone()
            if current is not None and _time_number(row.get("updated_at")) <= _time_number(current["updated_at"]):
                continue
            conn.execute(
                "INSERT INTO notes(uid, text, updated_at) VALUES(?,?,?) "
                "ON CONFLICT(uid) DO UPDATE SET text=excluded.text, updated_at=excluded.updated_at",
                (row["uid"], row.get("text", ""), row.get("updated_at")),
            )
            counts["notes"] += 1
        retained_fixes = {(row["uid"], row["field"]) for row in conn.execute("SELECT uid, field FROM manual_fixes")}
        for fx in d["manual_fixes"]:
            current = conn.execute("SELECT created_at FROM manual_fixes WHERE uid=? AND field=?",
                                   (fx["uid"], fx["field"])).fetchone()
            if current is not None and _time_number(fx.get("created_at")) <= _time_number(current["created_at"]):
                continue
            conn.execute(
                "INSERT INTO manual_fixes(uid, field, value, created_at) VALUES(?,?,?,?) "
                "ON CONFLICT(uid, field) DO UPDATE SET value=excluded.value, created_at=excluded.created_at",
                (fx["uid"], fx["field"], fx["value"], fx.get("created_at")),
            )
            conn.execute(f"UPDATE questions SET {fx['field']}=?, manual_locked=1 WHERE uid=?", (fx["_value"], fx["uid"]))
            retained_fixes.discard((fx["uid"], fx["field"]))
            counts["manual_fixes"] += 1
        conn.commit()
        return {"ok": True, "imported": counts, "retained_manual_fixes": len(retained_fixes)}
    except HTTPException:
        conn.rollback()
        raise
    except (KeyError, TypeError, ValueError, OverflowError, sqlite3.IntegrityError) as exc:
        conn.rollback()
        raise HTTPException(400, "备份记录无效，已回滚本次导入") from exc
    finally:
        conn.close()


# ================================================================ 媒体（音频 / 原PDF）
def _safe_source_path(rel_path: str) -> Path:
    """只允许访问题库根目录内的文件，防目录穿越。"""
    rel_path = rel_path.replace("\\", "/")
    if ".." in rel_path.split("/") or rel_path.startswith("/") or PureWindowsPath(rel_path).drive or "\x00" in rel_path:
        raise HTTPException(403, "非法路径")
    try:
        p = (ROOT / rel_path).resolve()
    except (OSError, ValueError) as exc:
        raise HTTPException(403, "非法路径") from exc
    if not p.is_relative_to(ROOT.resolve()):
        raise HTTPException(403, "非法路径")
    return p


@app.get("/api/audio/{paper_key}")
def audio_file(paper_key: str, request: Request):
    conn = db.connect()
    try:
        p = _paper_or_404(conn, paper_key)
        relp = p["audio_path"]
    finally:
        conn.close()
    if not relp:
        raise HTTPException(404, "该套次无听力音频")
    path = _safe_source_path(relp)
    if not path.is_file():
        raise HTTPException(404, "音频文件不存在")
    media_type = mimetypes.guess_type(path.name)[0] or "audio/mp4"
    # Starlette handles suffix/open ranges, If-Range, and 416 responses consistently.
    return FileResponse(path, media_type=media_type, headers={"Accept-Ranges": "bytes"})


@app.get("/api/pdf")
def pdf_file(path: str = Query(...)):
    p = _safe_source_path(path)
    if p.suffix.lower() != ".pdf" or not p.is_file():
        return HTMLResponse('<!doctype html><meta charset="utf-8"><title>可选原卷资源</title><main style="max-width:620px;margin:60px auto;padding:24px;font:18px/1.8 system-ui"><h1>尚未安装这份原 PDF</h1><p>正常刷题、答案解析、句子精讲和听力不受影响。</p><p>下载同版本 Optional-PDF 补充包，将 resources 合并到程序目录即可。</p></main>', status_code=404)
    return FileResponse(p, media_type="application/pdf", filename=p.name)


# ================================================================ 启动
@app.on_event("startup")
def startup():
    db.init_db()


@app.get("/api/health")
def local_health():
    return {"ok": True, "instance_id": getattr(app.state, "instance_id", "source"), "version": "1.1.0"}

@app.post("/api/local/shutdown")
def local_shutdown(request: Request):
    token = os.environ.get("CET6_INSTANCE_TOKEN", "")
    if not token or not hmac.compare_digest(request.headers.get("X-CET6-Instance", ""), token):
        raise HTTPException(403, "仅允许本机启动器停止此实例")
    server = getattr(app.state, "local_server", None)
    if server is None: raise HTTPException(503, "未由便携启动器启动")
    return JSONResponse({"stopping": True}, background=BackgroundTask(setattr, server, "should_exit", True))

if FRONTEND_DIST.exists():
    app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="static")
