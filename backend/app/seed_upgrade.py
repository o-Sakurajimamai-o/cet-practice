"""Merge a bundled public bank into an existing user DB, preserving stable IDs and records."""
from __future__ import annotations

from datetime import datetime
from contextlib import closing
import hashlib
from pathlib import Path
import sqlite3
import uuid

VERSION = "1.4.0"
PRIVATE_TABLES = ("sessions", "wrong_book", "favorites", "notes", "text_marks", "manual_fixes")


def _insert(conn, table, row):
    columns = list(row)
    names = ",".join(f'"{name}"' for name in columns)
    placeholders = ",".join("?" for _ in columns)
    return conn.execute(f'INSERT INTO "{table}" ({names}) VALUES ({placeholders})', list(row.values()))


def _update(conn, table, row, key, value):
    assignments = ",".join(f'"{name}"=?' for name in row)
    conn.execute(f'UPDATE "{table}" SET {assignments} WHERE "{key}"=?', [*row.values(), value])


def upgrade_from_seed(database: Path, seed: Path, *, fresh: bool = False) -> bool:
    """Called after schema migration under the launcher's exclusive instance lock."""
    with seed.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    with closing(sqlite3.connect(seed.resolve().as_uri() + "?mode=ro", uri=True)) as public:
        public.row_factory = sqlite3.Row
        if public.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise RuntimeError("Bundled question bank is corrupt")
        for table in (*PRIVATE_TABLES, "meta"):
            if public.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]:
                raise RuntimeError("Bundled question bank contains non-public records")
        with closing(sqlite3.connect(database)) as conn:
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA foreign_keys=ON")
            previous = conn.execute("SELECT value FROM meta WHERE key='public_seed_sha256'").fetchone()
            if previous and previous[0] == digest:
                return False
            if not fresh:
                backup_dir = database.parent / "backups"
                backup_dir.mkdir(exist_ok=True)
                backup = backup_dir / f"before-bank-{VERSION}-{datetime.now():%Y%m%d-%H%M%S}-{uuid.uuid4().hex[:8]}.db"
                with closing(sqlite3.connect(backup)) as backup_conn:
                    conn.backup(backup_conn)
            conn.execute("BEGIN IMMEDIATE")
            before = {t: [tuple(r) for r in conn.execute(f'SELECT * FROM "{t}" ORDER BY rowid')] for t in PRIVATE_TABLES}
            if not fresh:
                paper_map = {}
                for raw in public.execute("SELECT * FROM papers ORDER BY id"):
                    row = dict(raw)
                    source_id = row.pop("id")
                    existing = conn.execute("SELECT id FROM papers WHERE paper_key=?", (row["paper_key"],)).fetchone()
                    if existing:
                        local_id = existing[0]
                        _update(conn, "papers", row, "id", local_id)
                    else:
                        local_id = _insert(conn, "papers", row).lastrowid
                    paper_map[source_id] = local_id
                for raw in public.execute("SELECT * FROM questions ORDER BY id"):
                    row = dict(raw)
                    row.pop("id")
                    row["paper_id"] = paper_map[row["paper_id"]]
                    current = conn.execute("SELECT id,manual_locked FROM questions WHERE uid=?", (row["uid"],)).fetchone()
                    if current:
                        if current["manual_locked"]:
                            # A user edit may include the explanation or options too.
                            # Keep the entire question, not just its answer and stem.
                            continue
                        _update(conn, "questions", row, "id", current["id"])
                    else:
                        _insert(conn, "questions", row)
                for source_id, local_id in paper_map.items():
                    conn.execute("DELETE FROM materials WHERE paper_id=?", (local_id,))
                    for raw in public.execute("SELECT * FROM materials WHERE paper_id=?", (source_id,)):
                        row = dict(raw); row.pop("id"); row["paper_id"] = local_id
                        _insert(conn, "materials", row)
                    # Material-level user edits are retained in their original row.
                    locked = {(r[0], r[1]) for r in conn.execute(
                        "SELECT section,group_key FROM section_materials WHERE paper_id=? AND manual_locked=1", (local_id,))}
                    conn.execute("DELETE FROM section_materials WHERE paper_id=? AND manual_locked=0", (local_id,))
                    for raw in public.execute("SELECT * FROM section_materials WHERE paper_id=?", (source_id,)):
                        row = dict(raw)
                        if (row["section"], row["group_key"]) in locked:
                            continue
                        row.pop("id"); row["paper_id"] = local_id
                        _insert(conn, "section_materials", row)
                    conn.execute("DELETE FROM kaoyan_canonical WHERE paper_id=?", (local_id,))
                    for raw in public.execute("SELECT * FROM kaoyan_canonical WHERE paper_id=?", (source_id,)):
                        row = dict(raw); row["paper_id"] = local_id
                        _insert(conn, "kaoyan_canonical", row)
                for key, in public.execute("SELECT paper_key FROM papers"):
                    conn.execute("DELETE FROM import_issues WHERE paper_key=?", (key,))
                for raw in public.execute("SELECT * FROM import_issues"):
                    row = dict(raw); row.pop("id")
                    _insert(conn, "import_issues", row)
                for raw in public.execute("SELECT * FROM answer_checks"):
                    row = dict(raw)
                    conn.execute("DELETE FROM answer_checks WHERE uid=?", (row["uid"],))
                    _insert(conn, "answer_checks", row)
            after = {t: [tuple(r) for r in conn.execute(f'SELECT * FROM "{t}" ORDER BY rowid')] for t in PRIVATE_TABLES}
            if before != after:
                raise RuntimeError("Personal records changed during question bank upgrade")
            if conn.execute("PRAGMA foreign_key_check").fetchall():
                raise RuntimeError("Question bank upgrade failed foreign-key validation")
            conn.execute("INSERT INTO meta(key,value) VALUES('public_seed_sha256',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (digest,))
            conn.execute("INSERT INTO meta(key,value) VALUES('question_bank_version',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (VERSION,))
            conn.commit()
            return True
