"""SQLite 数据库 schema 与连接管理（个人刷题网站后端）。"""
from __future__ import annotations

import sqlite3
import os
import uuid
from pathlib import Path

DB_PATH = Path(os.environ.get("CET6_DB_PATH", Path(__file__).resolve().parents[2] / "data" / "cet6.db"))

SCHEMA = """
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS text_marks (
    id TEXT PRIMARY KEY,
    paper_key TEXT NOT NULL,
    section TEXT NOT NULL,
    passage_index INTEGER NOT NULL,
    start_offset INTEGER NOT NULL,
    end_offset INTEGER NOT NULL,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS papers (
    id INTEGER PRIMARY KEY,
    paper_key TEXT UNIQUE NOT NULL,      -- 例: 2023-06-1
    year INTEGER NOT NULL,
    month INTEGER NOT NULL,
    set_no INTEGER NOT NULL,
    has_listening INTEGER NOT NULL DEFAULT 0,
    has_cloze INTEGER NOT NULL DEFAULT 0,
    has_matching INTEGER NOT NULL DEFAULT 0,
    has_reading1 INTEGER NOT NULL DEFAULT 0,
    has_reading2 INTEGER NOT NULL DEFAULT 0,
    has_writing INTEGER NOT NULL DEFAULT 0,
    has_translation INTEGER NOT NULL DEFAULT 0,
    audio_path TEXT,                     -- 相对题库根目录
    import_version TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS materials (
    id INTEGER PRIMARY KEY,
    paper_id INTEGER NOT NULL REFERENCES papers(id),
    section TEXT NOT NULL,               -- listening/cloze/matching/reading1/reading2/writing/translation/full
    kind TEXT NOT NULL,                  -- question=真题 analysis=解析
    file_path TEXT NOT NULL,             -- 相对题库根目录
    pages INTEGER,
    checksum TEXT,
    file_mtime REAL,
    imported_at TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE(paper_id, section, kind, file_path)
);
CREATE TABLE IF NOT EXISTS questions (
    id INTEGER PRIMARY KEY,
    uid TEXT UNIQUE NOT NULL,            -- paper_key:section:q_no 稳定 ID
    paper_id INTEGER NOT NULL REFERENCES papers(id),
    paper_key TEXT NOT NULL,
    section TEXT NOT NULL,               -- listening/cloze/matching/reading1/reading2/writing/translation
    section_order INTEGER NOT NULL DEFAULT 0,
    q_no INTEGER,                        -- 原卷题号；作文/翻译为 1
    q_index INTEGER NOT NULL,            -- 该题型内序号（0 起）
    qtype TEXT NOT NULL,                 -- mcq / blank / match / essay / translation
    group_key TEXT,                      -- 共享材料分组（同 passage / 词库 / 段落组 / 听力篇目）
    stem TEXT,                           -- 题干（听力无书面题干时为 NULL）
    options_json TEXT,                   -- [{key:'A', text:'...'}, ...]
    answer TEXT,                         -- 'A'/'N'/'C' 段 等
    answer_source TEXT,                  -- 来源描述（哪个解析文件第几页）
    analysis_json TEXT,                  -- 结构化解析 {定位,信号,解析,翻译,...}
    analysis_text TEXT,                  -- 解析全文（fallback 展示）
    source_file TEXT,
    source_page INTEGER,
    status TEXT NOT NULL DEFAULT 'ok',   -- ok / needs_review / missing
    flags_json TEXT,                     -- 异常标记列表
    import_version TEXT,
    manual_locked INTEGER NOT NULL DEFAULT 0  -- 人工校正后锁定，不再被导入覆盖
);
CREATE TABLE IF NOT EXISTS section_materials (
    id INTEGER PRIMARY KEY,
    paper_id INTEGER NOT NULL REFERENCES papers(id),
    section TEXT NOT NULL,
    group_key TEXT NOT NULL DEFAULT '',
    directions TEXT,
    content_json TEXT,                   -- 结构化共享材料: passage/word_bank/paragraphs/transcript 等
    translation_json TEXT,               -- 材料中文翻译（如有）
    analysis_text TEXT,                  -- 该题型整体解析（写作范文/翻译参考译文等）
    source_file TEXT,
    source_page INTEGER,
    status TEXT NOT NULL DEFAULT 'ok',
    manual_locked INTEGER NOT NULL DEFAULT 0,
    UNIQUE(paper_id, section, group_key)
);
CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY,
    paper_id INTEGER NOT NULL REFERENCES papers(id),
    mode TEXT NOT NULL DEFAULT 'full',   -- full / redo / wrong_redo
    started_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT,
    submitted_at TEXT,
    answers_json TEXT NOT NULL DEFAULT '{}',   -- uid -> {'choice':'A', ...} 或作文文本
    current_uid TEXT,
    elapsed_sec INTEGER NOT NULL DEFAULT 0,
    audio_pos REAL NOT NULL DEFAULT 0,
    revealed_uids TEXT NOT NULL DEFAULT '[]',  -- 主动查看过答案的题
    result_json TEXT                     -- 交卷后判分结果
);
CREATE TABLE IF NOT EXISTS wrong_book (
    id INTEGER PRIMARY KEY,
    uid TEXT NOT NULL,
    session_id INTEGER,
    wrong_count INTEGER NOT NULL DEFAULT 1,
    first_wrong_at TEXT DEFAULT (datetime('now','localtime')),
    last_wrong_at TEXT DEFAULT (datetime('now','localtime')),
    resolved INTEGER NOT NULL DEFAULT 0, -- 重做答对后标记
    UNIQUE(uid)
);
CREATE TABLE IF NOT EXISTS favorites (
    uid TEXT NOT NULL PRIMARY KEY,
    created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS notes (
    uid TEXT NOT NULL PRIMARY KEY,
    text TEXT NOT NULL DEFAULT '',
    updated_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS import_issues (
    id INTEGER PRIMARY KEY,
    paper_key TEXT NOT NULL,
    section TEXT,
    uid TEXT,
    level TEXT NOT NULL,                 -- warn / error
    message TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_q_paper ON questions(paper_id);
CREATE INDEX IF NOT EXISTS idx_q_section ON questions(paper_id, section);
CREATE TABLE IF NOT EXISTS manual_fixes (
    id INTEGER PRIMARY KEY,
    uid TEXT NOT NULL,
    field TEXT NOT NULL,
    value TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE(uid, field)
);
"""


def connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db() -> None:
    conn = connect()
    try:
        conn.executescript(SCHEMA)
        # Inspect columns explicitly: an unrelated migration failure must not be hidden.
        conn.execute("BEGIN IMMEDIATE")
        migrations = {
            "papers": {"exam_type": "TEXT NOT NULL DEFAULT 'cet6'", "shared_sources_json": "TEXT NOT NULL DEFAULT '{}'"},
            "sessions": {
                "scope_json": "TEXT NOT NULL DEFAULT '[]'",
                "state_revision": "INTEGER NOT NULL DEFAULT 0",
                "state_client_id": "TEXT",
                "state_client_revision": "INTEGER NOT NULL DEFAULT 0",
                "audio_paper_key": "TEXT",
                "session_key": "TEXT",
            },
            "wrong_book": {"updated_at": "TEXT"},
        }
        for table, columns in migrations.items():
            existing = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})")}
            for column, declaration in columns.items():
                if column not in existing:
                    conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {declaration}")
        for row in conn.execute("SELECT id FROM sessions WHERE session_key IS NULL OR session_key=''").fetchall():
            conn.execute("UPDATE sessions SET session_key=? WHERE id=?", (str(uuid.uuid4()), row["id"]))
        conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_session_key ON sessions(session_key)")
        conn.commit()
    finally:
        conn.close()


def get_meta(key: str, default: str | None = None) -> str | None:
    conn = connect()
    try:
        row = conn.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
        return row["value"] if row else default
    finally:
        conn.close()


def set_meta(key: str, value: str) -> None:
    conn = connect()
    try:
        conn.execute(
            "INSERT INTO meta(key,value) VALUES(?,?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (key, value),
        )
        conn.commit()
    finally:
        conn.close()


if __name__ == "__main__":
    init_db()
    print("数据库初始化完成:", DB_PATH)
