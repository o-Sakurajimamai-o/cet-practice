"""Audit an already sanitized public seed. Never modify the user's database."""
import re
import sqlite3
import sys
from pathlib import Path

PRIVATE = ('sessions', 'wrong_book', 'favorites', 'notes', 'text_marks', 'manual_fixes', 'meta')
# Do not mistake the s:/ in https:// for a Windows drive.
LOCAL = re.compile(r'(?<![A-Za-z0-9])(?:[A-Za-z]:[\\/]|/Users/|/home/|C:\\Users\\)', re.I)


def audit(path):
    with sqlite3.connect(Path(path).resolve().as_uri() + '?mode=ro', uri=True) as db:
        assert db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
        assert not db.execute('PRAGMA foreign_key_check').fetchall()
        for table in PRIVATE:
            assert db.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0] == 0, table
        for table, in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").fetchall():
            cols = [r[1] for r in db.execute(f'PRAGMA table_info("{table}")')]
            for row in db.execute(f'SELECT * FROM "{table}"'):
                for col, value in zip(cols, row):
                    if isinstance(value, str) and LOCAL.search(value):
                        raise AssertionError(f'Local path in {table}.{col}')
        for table in ('questions', 'section_materials'):
            assert db.execute(f'SELECT COUNT(*) FROM {table} WHERE manual_locked != 0').fetchone()[0] == 0, table
        print('Public seed audit passed:', dict(db.execute('SELECT exam_type, count(*) FROM papers GROUP BY exam_type')))


if __name__ == '__main__':
    audit(sys.argv[1])
