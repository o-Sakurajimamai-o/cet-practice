"""Backend regressions. All writes target temporary SQLite copies, never data/cet6.db.

Run: backend/venv/Scripts/python.exe -X utf8 review/test_backend_regressions.py
Use --baseline to run the same checks against review/before-backend/*.py.
No HTTP client package, running service, or live database mutation is needed.
"""
from __future__ import annotations

import asyncio
import copy
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
import threading
import types
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from urllib.parse import urlsplit


PROJECT = Path(__file__).resolve().parents[1]
SOURCE_DB = PROJECT / "seed" / "cet6.db"
BASELINE = "--baseline" in sys.argv
if BASELINE:
    sys.argv.remove("--baseline")
CODE = PROJECT / "review" / "before-backend" if BASELINE else PROJECT / "backend" / "app"
WORK = tempfile.TemporaryDirectory(prefix="cet6-backend-review-")
WORK_PATH = Path(WORK.name)
os.environ["CET6_DB_PATH"] = str(WORK_PATH / "unopened.sqlite3")
pkg = types.ModuleType("review_backend")
pkg.__path__ = [str(CODE)]
sys.modules[pkg.__name__] = pkg
for name in ("db", "main"):
    spec = importlib.util.spec_from_file_location(f"review_backend.{name}", CODE / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    setattr(pkg, name, module)
    spec.loader.exec_module(module)
db, api = pkg.db, pkg.main
api.PROJECT = PROJECT
api.ROOT = PROJECT.parent


async def asgi_request(method, target, body=None, headers=None):
    target = urlsplit(target)
    content = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else b""
    raw_headers = [(b"host", b"localhost")]
    if body is not None:
        raw_headers.append((b"content-type", b"application/json"))
    raw_headers += [(k.lower().encode(), v.encode()) for k, v in (headers or {}).items()]
    scope = {
        "type": "http", "asgi": {"version": "3.0", "spec_version": "2.4"},
        "http_version": "1.1", "method": method, "scheme": "http", "path": target.path,
        "raw_path": target.path.encode(), "query_string": target.query.encode(),
        "root_path": "", "headers": raw_headers, "client": ("127.0.0.1", 12345),
        "server": ("127.0.0.1", 8766),
    }
    messages = []

    async def receive():
        return {"type": "http.request", "body": content, "more_body": False}

    async def send(message):
        messages.append(message)

    await api.app(scope, receive, send)
    start = next(m for m in messages if m["type"] == "http.response.start")
    response_body = b"".join(m.get("body", b"") for m in messages if m["type"] == "http.response.body")
    return start["status"], {k.decode(): v.decode() for k, v in start["headers"]}, response_body


class BackendRegressions(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.snapshot = WORK_PATH / "source.sqlite3"
        with closing(sqlite3.connect(SOURCE_DB.resolve().as_uri() + "?mode=ro", uri=True)) as src:
            with closing(sqlite3.connect(cls.snapshot)) as dst:
                src.backup(dst)

    def setUp(self):
        self.case_dir = tempfile.TemporaryDirectory(prefix="case-", dir=WORK_PATH)
        self.addCleanup(self.case_dir.cleanup)
        db.DB_PATH = Path(self.case_dir.name) / "case.sqlite3"
        self.assertNotEqual(db.DB_PATH.resolve(), SOURCE_DB.resolve())
        with closing(sqlite3.connect(self.snapshot)) as src:
            with closing(sqlite3.connect(db.DB_PATH)) as dst:
                src.backup(dst)
        db.init_db()
        self.conn = db.connect()
        self.addCleanup(self.conn.close)
        for table in ("sessions", "wrong_book", "favorites", "notes", "manual_fixes"):
            self.conn.execute(f"DELETE FROM {table}")
        self.conn.commit()
        self.qs = [dict(r) for r in self.conn.execute(
            "SELECT * FROM questions WHERE qtype='mcq' AND answer IS NOT NULL ORDER BY id LIMIT 3"
        )]
        self.q = self.qs[0]
        self.uid = self.q["uid"]
        self.wrong = next(o["key"] for o in json.loads(self.q["options_json"]) if o["key"] != self.q["answer"])

    def request(self, method, target, body=None, headers=None):
        status, hdr, data = asyncio.run(asgi_request(method, target, body, headers))
        if "application/json" in hdr.get("content-type", ""):
            data = json.loads(data)
        return status, hdr, data

    def ok(self, method, target, body=None):
        status, _, data = self.request(method, target, body)
        self.assertEqual(status, 200, data)
        return data

    def redo(self, uids=None):
        return self.ok("POST", "/api/sessions/redo", {"uids": uids or [self.uid]})["session_id"]

    def save(self, sid, answers=None, **extra):
        body = {**extra}
        if answers is not None:
            body["answers"] = answers
        return self.ok("PUT", f"/api/sessions/{sid}", body)

    def export(self):
        return self.ok("GET", "/api/backup/export")

    def restore(self, data, merge=False):
        return self.ok("POST", f"/api/backup/import?merge={str(merge).lower()}", {"data": data})

    def test_duplicate_redo_uids_do_not_double_count(self):
        sid = self.redo([self.uid, self.uid])
        self.save(sid, {self.uid: self.q["answer"]})
        result = self.ok("POST", f"/api/sessions/{sid}/submit")["result"]
        self.assertEqual(len(self.ok("GET", f"/api/sessions/{sid}")["session"]["scope"]), 1)
        self.assertEqual(sum(s["correct"] for s in result["per_section"].values()), result["correct"])

    def test_wrong_book_requires_unassisted_correct_answer(self):
        first = self.redo()
        self.save(first, {self.uid: self.wrong})
        self.ok("POST", f"/api/sessions/{first}/submit")
        second = self.redo()
        self.ok("POST", f"/api/sessions/{second}/reveal", {"uid": self.uid})
        self.save(second, {self.uid: self.q["answer"]})
        self.ok("POST", f"/api/sessions/{second}/submit")
        self.assertFalse(self.ok("GET", "/api/review/wrong")["wrong"][0]["resolved"])
        third = self.redo()
        self.save(third, {self.uid: self.q["answer"]})
        self.ok("POST", f"/api/sessions/{third}/submit")
        self.assertTrue(self.ok("GET", "/api/review/wrong")["wrong"][0]["resolved"])

    def test_late_snapshot_does_not_overwrite_newer_beacon(self):
        sid = self.redo()
        newer = dict(answers={self.uid: self.q["answer"]}, elapsed_sec=20,
                     client_id="tab-a", client_revision=2, base_revision=0)
        self.ok("POST", f"/api/sessions/{sid}", newer)
        response = self.save(sid, {self.uid: self.wrong}, elapsed_sec=10,
                             client_id="tab-a", client_revision=1, base_revision=0)
        session = self.ok("GET", f"/api/sessions/{sid}")["session"]
        self.assertEqual(session["answers"][self.uid], self.q["answer"])
        self.assertEqual(session["elapsed_sec"], 20)
        self.assertTrue(response.get("ignored"))
        status, _, _ = self.request("PUT", f"/api/sessions/{sid}", {
            "answers": {self.uid: self.wrong}, "client_id": "tab-b",
            "client_revision": 10, "base_revision": 0,
        })
        self.assertEqual(status, 409)

    def test_progress_restart_and_submission_are_consistent(self):
        sid = self.ok("POST", f"/api/sessions?paper_key={self.q['paper_key']}")["session_id"]
        self.save(sid, {self.uid: self.q["answer"]}, current_uid=self.uid, elapsed_sec=123, audio_pos=42.5)
        self.assertEqual(self.ok("POST", f"/api/sessions?paper_key={self.q['paper_key']}")["session_id"], sid)
        state = self.ok("GET", f"/api/sessions/{sid}")["session"]
        self.assertEqual((state["elapsed_sec"], state["audio_pos"]), (123, 42.5))
        new_sid = self.ok("POST", f"/api/sessions/{sid}/restart")["session_id"]
        self.assertNotEqual(sid, new_sid)
        self.assertEqual(self.ok("GET", f"/api/sessions/{new_sid}")["session"]["answers"], {})
        self.assertEqual(self.ok("GET", f"/api/sessions/{sid}")["session"]["answers"][self.uid], self.q["answer"])
        first = self.ok("POST", f"/api/sessions/{sid}/submit")
        second = self.ok("POST", f"/api/sessions/{sid}/submit")
        self.assertEqual(first["result"], second.get("result"))
        self.assertEqual(self.request("PUT", f"/api/sessions/{sid}", {"answers": {self.uid: self.wrong}})[0], 400)

    def test_invalid_inputs_cannot_create_hidden_or_broken_records(self):
        sid = self.redo()
        for method, target, body in (
            ("POST", "/api/sessions/redo", {"uids": [self.uid, "missing:question"]}),
            ("POST", "/api/favorites/missing:question", None),
            ("PUT", "/api/notes/missing:question", {"text": "hidden note"}),
            ("PUT", f"/api/sessions/{sid}", {"answers": {self.uid: {"choice": "A"}}}),
            ("PUT", f"/api/sessions/{sid}", {"answers": {self.uid: "Z"}}),
            ("PUT", f"/api/sessions/{sid}", {"current_uid": self.qs[1]["uid"]}),
            ("POST", f"/api/sessions/{sid}/reveal", {"uid": self.qs[1]["uid"]}),
            ("PUT", f"/api/sessions/{sid}", {"audio_pos": "Infinity"}),
            ("PUT", f"/api/sessions/{sid}", {"audio_pos": float("inf")}),
            ("PUT", f"/api/sessions/{sid}", {"audio_pos": float("nan")}),
        ):
            with self.subTest(target=target, body=body):
                self.assertIn(self.request(method, target, body)[0], (400, 404, 422))

    def test_manual_fix_backup_preserves_quotes_newlines_and_null(self):
        text = 'Line one "quoted".\nSecond line \\ slash.'
        self.ok("POST", f"/api/questions/{self.uid}/fix", {"field": "stem", "value": text})
        self.ok("POST", f"/api/questions/{self.uid}/fix", {"field": "answer", "value": None})
        backup = self.export()
        # A freshly rebuilt bank has no correction ledger; exercise actual import application.
        self.conn.execute("DELETE FROM manual_fixes")
        self.conn.execute("UPDATE questions SET stem=?, answer=?, manual_locked=0 WHERE uid=?",
                          (self.q["stem"], self.q["answer"], self.uid))
        self.conn.commit()
        self.restore(backup)
        restored = self.ok("GET", f"/api/questions/{self.uid}")
        self.assertEqual(restored["stem"], text)
        self.assertIsNone(restored["answer"])
        self.assertEqual(restored["analysis_text"], self.q["analysis_text"])

    def test_replace_preserves_existing_correction_ledger(self):
        empty_backup = self.export()
        self.ok("POST", f"/api/questions/{self.uid}/fix", {"field": "answer", "value": self.wrong})
        result = self.restore(empty_backup)
        self.assertEqual(result.get("retained_manual_fixes"), 1)
        self.assertEqual(self.export()["manual_fixes"][0]["value"], json.dumps(self.wrong))
        self.assertEqual(self.ok("GET", f"/api/questions/{self.uid}")["answer"], self.wrong)

    def test_corrected_blank_displays_matching_word_without_editing_analysis(self):
        question = dict(self.conn.execute("SELECT * FROM questions WHERE qtype='blank' AND answer IS NOT NULL LIMIT 1").fetchone())
        replacement = next(option for option in json.loads(question["options_json"]) if option["key"] != question["answer"])
        uid = question["uid"]
        self.ok("POST", f"/api/questions/{uid}/fix", {"field": "answer", "value": replacement["key"]})
        detail = self.ok("GET", f"/api/questions/{uid}")
        self.assertEqual(detail["answer_word"], replacement["text"])
        row = self.conn.execute("SELECT analysis_json, analysis_text FROM questions WHERE uid=?", (uid,)).fetchone()
        self.assertEqual(row["analysis_json"], question["analysis_json"])
        self.assertEqual(row["analysis_text"], question["analysis_text"])

    def test_all_question_types_grade_and_round_trip(self):
        blank = dict(self.conn.execute("SELECT * FROM questions WHERE qtype='blank' AND answer IS NOT NULL LIMIT 1").fetchone())
        matching = dict(self.conn.execute("SELECT * FROM questions WHERE qtype='match' AND answer IS NOT NULL LIMIT 1").fetchone())
        essay = dict(self.conn.execute("SELECT * FROM questions WHERE qtype='essay' LIMIT 1").fetchone())
        # Construct the no-key case in this test's temporary database. A fully
        # corrected production question bank must not remove this coverage.
        no_key = dict(self.conn.execute(
            "SELECT * FROM questions WHERE qtype='mcq' AND id>? ORDER BY id LIMIT 1",
            (self.qs[-1]["id"],),
        ).fetchone())
        self.conn.execute("UPDATE questions SET answer=NULL WHERE uid=?", (no_key["uid"],))
        self.conn.commit()
        wrong_q = self.qs[1]
        wrong_choice = next(o["key"] for o in json.loads(wrong_q["options_json"]) if o["key"] != wrong_q["answer"])
        uids = [q["uid"] for q in (self.q, wrong_q, self.qs[2], blank, matching, essay, no_key)]
        sid = self.redo(uids)
        answers = {self.uid: self.q["answer"].lower(), wrong_q["uid"]: wrong_choice,
                   blank["uid"]: blank["answer"], matching["uid"]: matching["answer"],
                   essay["uid"]: 'A draft with "quotes".\nSecond paragraph.'}
        self.save(sid, answers, audio_paper_key=self.q["paper_key"], audio_pos=16.25)
        self.ok("POST", f"/api/sessions/{sid}/reveal", {"uid": no_key["uid"]})
        result = self.ok("POST", f"/api/sessions/{sid}/submit")["result"]
        self.assertEqual([result[k] for k in ("correct", "wrong", "unanswered", "no_key", "accuracy")], [3, 1, 1, 1, 0.75])
        self.assertEqual(sum(x["revealed"] for x in result["per_section"].values()), 1)
        self.assertEqual(result["detail"][essay["uid"]]["kind"], "subjective")
        self.ok("POST", f"/api/favorites/{self.uid}")
        self.ok("PUT", f"/api/notes/{self.uid}", {"text": "保留完整笔记\n第二行"})
        exported = self.export()
        self.restore(exported)
        restored = self.ok("GET", f"/api/sessions/{sid}")
        self.assertEqual(restored["session"]["result"], result)
        self.assertEqual(restored["session"]["audio_paper_key"], self.q["paper_key"])
        self.assertEqual(self.ok("GET", f"/api/questions/{self.uid}")["note"], "保留完整笔记\n第二行")
        merged = self.restore(exported, merge=True)
        self.assertTrue(all(n == 0 for n in merged["imported"].values()), merged)

    def test_older_backup_does_not_replace_newer_notes_or_corrections(self):
        self.ok("PUT", f"/api/notes/{self.uid}", {"text": "old"})
        self.ok("POST", f"/api/questions/{self.uid}/fix", {"field": "answer", "value": self.wrong})
        old = self.export()
        self.ok("PUT", f"/api/notes/{self.uid}", {"text": "new"})
        self.ok("POST", f"/api/questions/{self.uid}/fix", {"field": "answer", "value": self.q["answer"]})
        self.restore(old, merge=True)
        question = self.ok("GET", f"/api/questions/{self.uid}")
        self.assertEqual(question["note"], "new")
        self.assertEqual(question["answer"], self.q["answer"])

    def test_backup_remaps_paper_by_stable_key(self):
        sid = self.redo()
        self.save(sid, {self.uid: self.q["answer"]})
        backup = self.export()
        backup["sessions"][0]["paper_key"] = self.q["paper_key"]
        wrong_paper = self.conn.execute("SELECT id FROM papers WHERE id!=? LIMIT 1", (self.q["paper_id"],)).fetchone()[0]
        backup["sessions"][0]["paper_id"] = wrong_paper
        self.restore(backup)
        self.assertEqual(self.ok("GET", f"/api/sessions/{sid}")["session"]["paper_key"], self.q["paper_key"])

    def test_merge_session_id_collision_keeps_both_and_is_idempotent(self):
        sid = self.redo()
        self.save(sid, {self.uid: self.q["answer"]})
        incoming = self.export()
        incoming["sessions"][0]["session_key"] = str(uuid.uuid4())
        incoming["sessions"][0]["answers_json"] = json.dumps({self.uid: self.wrong})
        first = self.restore(incoming, merge=True)
        self.assertEqual(first["imported"]["sessions"], 1)
        sessions = self.export()["sessions"]
        self.assertEqual(len(sessions), 2)
        imported = next(row for row in sessions if row["id"] != sid)
        self.assertEqual(json.loads(imported["answers_json"])[self.uid], self.wrong)
        self.assertEqual(self.ok("GET", f"/api/sessions/{sid}")["session"]["answers"][self.uid], self.q["answer"])
        second = self.restore(incoming, merge=True)
        self.assertEqual(second["imported"]["sessions"], 0)
        self.assertEqual(len(self.export()["sessions"]), 2)

    def test_merge_legacy_session_collision_is_idempotent(self):
        sid = self.redo()
        self.save(sid, {self.uid: self.q["answer"]})
        incoming = self.export()
        incoming["sessions"][0].pop("session_key", None)
        incoming["sessions"][0]["answers_json"] = json.dumps({self.uid: self.wrong})
        incoming["sessions"][0]["started_at"] = "2026-01-01T00:00:00"
        self.assertEqual(self.restore(incoming, merge=True)["imported"]["sessions"], 1)
        self.assertEqual(self.restore(incoming, merge=True)["imported"]["sessions"], 0)
        self.assertEqual(len(self.export()["sessions"]), 2)

    def test_merge_remaps_wrong_book_to_imported_session(self):
        sid = self.redo()
        self.save(sid, {self.uid: self.wrong})
        self.ok("POST", f"/api/sessions/{sid}/submit")
        incoming = self.export()
        incoming["sessions"][0]["session_key"] = str(uuid.uuid4())
        self.conn.execute("DELETE FROM wrong_book")
        self.conn.commit()
        result = self.restore(incoming, merge=True)
        self.assertEqual(result["imported"]["sessions"], 1)
        wrong = self.export()["wrong_book"][0]
        self.assertNotEqual(wrong["session_id"], sid)
        session = self.ok("GET", f"/api/sessions/{wrong['session_id']}")["session"]
        self.assertEqual(session["result"]["detail"][self.uid]["verdict"], "wrong")

    def test_restore_invalidates_saves_from_pre_restore_page(self):
        sid = self.redo()
        self.save(sid, {self.uid: self.q["answer"]}, client_id="old-page", client_revision=1, base_revision=0)
        backup = self.export()
        self.restore(backup)
        status, _, _ = self.request("POST", f"/api/sessions/{sid}", {
            "answers": {self.uid: self.wrong}, "client_id": "old-page",
            "client_revision": 2, "base_revision": 1,
        })
        self.assertEqual(status, 409)
        self.assertEqual(self.ok("GET", f"/api/sessions/{sid}")["session"]["answers"][self.uid], self.q["answer"])

    def test_backup_rejects_invalid_result_atomically(self):
        sid = self.redo()
        self.save(sid, {self.uid: self.q["answer"]})
        backup = self.export()
        broken = copy.deepcopy(backup)
        broken["sessions"][0]["result_json"] = "not json"
        broken["sessions"][0]["submitted_at"] = "2026-10-24T12:00:00"
        status, _, _ = self.request("POST", "/api/backup/import?merge=false", {"data": broken})
        self.assertEqual(status, 400)
        self.assertEqual(self.ok("GET", f"/api/sessions/{sid}")["session"]["answers"][self.uid], self.q["answer"])

    def test_merge_older_wrong_state_cannot_undo_new_mastery(self):
        sid = self.redo()
        self.save(sid, {self.uid: self.wrong})
        self.ok("POST", f"/api/sessions/{sid}/submit")
        older = self.export()
        sid2 = self.redo()
        self.save(sid2, {self.uid: self.q["answer"]})
        self.ok("POST", f"/api/sessions/{sid2}/submit")
        self.restore(older, merge=True)
        self.assertTrue(self.ok("GET", "/api/review/wrong")["wrong"][0]["resolved"])

    def test_double_submission_updates_wrong_count_once(self):
        sid = self.redo()
        self.save(sid, {self.uid: self.wrong})
        start = threading.Barrier(4)

        def submit():
            start.wait()
            return self.request("POST", f"/api/sessions/{sid}/submit")[0]

        with ThreadPoolExecutor(max_workers=4) as workers:
            statuses = list(workers.map(lambda _: submit(), range(4)))
        self.assertEqual(statuses, [200] * 4)
        self.assertEqual(self.ok("GET", "/api/review/wrong")["wrong"][0]["wrong_count"], 1)

    def test_audio_ranges_and_path_boundaries(self):
        original_root = api.ROOT
        self.addCleanup(setattr, api, "ROOT", original_root)
        api.ROOT = Path(self.case_dir.name) / "sources"
        api.ROOT.mkdir()
        audio = api.ROOT / "fixture.m4a"
        audio.write_bytes(b"0123456789")
        self.conn.execute("UPDATE papers SET audio_path=? WHERE id=?", (audio.name, self.q["paper_id"]))
        self.conn.commit()
        target = f"/api/audio/{self.q['paper_key']}"
        for range_value, expected in (("bytes=0-0", b"0"), ("bytes=2-4", b"234"), ("bytes=-3", b"789"), ("bytes=7-", b"789")):
            with self.subTest(range=range_value):
                status, hdr, body = self.request("GET", target, headers={"Range": range_value})
                self.assertEqual(status, 206)
                self.assertEqual(body, expected)
                self.assertEqual(int(hdr["content-length"]), len(expected))
        status, hdr, _ = self.request("GET", target, headers={"Range": "bytes=20-"})
        self.assertEqual(status, 416)
        self.assertEqual(hdr.get("content-range"), "bytes */10")

    def test_all_marks_join_papers_filter_exam_and_keep_orphans(self):
        self.conn.execute("DELETE FROM text_marks")
        self.conn.commit()
        cet6 = dict(self.conn.execute("SELECT * FROM papers WHERE exam_type='cet6' ORDER BY id LIMIT 1").fetchone())
        cet4 = dict(self.conn.execute("SELECT * FROM papers WHERE exam_type='cet4' ORDER BY id LIMIT 1").fetchone())
        def mark(paper_key, section, text, created_at):
            return {"id": str(uuid.uuid4()), "paper_key": paper_key, "section": section, "passage_index": 0,
                    "start_offset": 0, "end_offset": len(text), "text": text, "created_at": created_at}
        old6 = self.ok("POST", "/api/marks", mark(cet6["paper_key"], "reading1", "probably", "2026-10-01T08:00:00.000Z"))
        new6 = self.ok("POST", "/api/marks", mark(cet6["paper_key"], "translation", "economy", "2026-10-03T08:00:00.000Z"))
        only4 = self.ok("POST", "/api/marks", mark(cet4["paper_key"], "listening", "campus", "2026-10-02T08:00:00.000Z"))
        # Orphans cannot be created through the API; they appear when a paper leaves the library.
        orphan6 = mark("2099-06-9", "cloze", "orphan", "2026-10-04T08:00:00.000Z")
        orphan4 = mark("cet4-2099-06-9", "cloze", "orphan4", "2026-09-30T08:00:00.000Z")
        for row in (orphan6, orphan4):
            self.conn.execute("INSERT INTO text_marks(id,paper_key,section,passage_index,start_offset,end_offset,text,created_at) VALUES(:id,:paper_key,:section,:passage_index,:start_offset,:end_offset,:text,:created_at)", row)
        self.conn.commit()

        rows = self.ok("GET", "/api/marks/all")["marks"]
        self.assertEqual([r["id"] for r in rows], [orphan6["id"], new6["id"], only4["id"], old6["id"], orphan4["id"]])
        first6 = next(r for r in rows if r["id"] == old6["id"])
        for column in ("paper_key", "section", "passage_index", "start_offset", "end_offset", "text", "created_at"):
            self.assertEqual(first6[column], old6[column])
        self.assertEqual((first6["exam_type"], first6["year"], first6["month"], first6["set_no"]),
                         ("cet6", cet6["year"], cet6["month"], cet6["set_no"]))
        self.assertEqual((first6["section_cn"], first6["paper_missing"]), ("仔细阅读一", False))
        lost = next(r for r in rows if r["id"] == orphan6["id"])
        self.assertEqual((lost["year"], lost["month"], lost["set_no"], lost["paper_missing"], lost["exam_type"], lost["section_cn"]),
                         (None, None, None, True, "cet6", "选词填空"))

        self.assertEqual([r["id"] for r in self.ok("GET", "/api/marks/all?exam=cet6")["marks"]], [orphan6["id"], new6["id"], old6["id"]])
        self.assertEqual([r["id"] for r in self.ok("GET", "/api/marks/all?exam=cet4")["marks"]], [only4["id"], orphan4["id"]])
        for bad in ("cet5", "CET6", ""):
            with self.subTest(exam=bad):
                self.assertEqual(self.request("GET", f"/api/marks/all?exam={bad}")[0], 422)
        # Existing per-section listing and deletion keep their behavior.
        self.assertEqual([r["id"] for r in self.ok("GET", f"/api/marks?paper_key={cet6['paper_key']}&section=reading1")["marks"]], [old6["id"]])
        self.assertEqual(self.request("GET", "/api/marks")[0], 422)
        self.ok("DELETE", f"/api/marks/{old6['id']}")
        self.assertNotIn(old6["id"], [r["id"] for r in self.ok("GET", "/api/marks/all")["marks"]])

    def test_source_path_rejects_sibling_and_absolute_paths(self):
        sibling = api.ROOT.parent / (api.ROOT.name + "-other") / "private.pdf"
        with self.assertRaises(api.HTTPException):
            api._safe_source_path(str(sibling))
        with self.assertRaises(api.HTTPException):
            api._safe_source_path("../private.pdf")


if __name__ == "__main__":
    print(f"Backend source: {CODE}\nTemporary database root: {WORK_PATH}", flush=True)
    try:
        unittest.main(testRunner=unittest.TextTestRunner(stream=sys.stdout, verbosity=2))
    finally:
        WORK.cleanup()
