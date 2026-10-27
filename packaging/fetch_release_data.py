"""Reuse verified public audio from v1.1.0; install the new clean seed separately."""
import hashlib
import shutil
import sqlite3
import urllib.request
import zipfile
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[1]
URL = ('https://github.com/o-Sakurajimamai-o/cet-practice/releases/download/v1.1.0/'
       'CET-Practice-v1.1.0-Windows-x64.zip')
SHA256 = '80a1f833f038048cbff8c0d724efda202eb539a917c141cba76101c237aef3f1'


def verify_seed(path):
    with sqlite3.connect(f'{path.as_uri()}?mode=ro', uri=True) as conn:
        assert conn.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
        assert not conn.execute('PRAGMA foreign_key_check').fetchall()
        assert conn.execute('SELECT COUNT(*) FROM papers').fetchone()[0] == 122
        assert conn.execute('SELECT COUNT(*) FROM questions').fetchone()[0] == 6089
        for table in ['sessions', 'wrong_book', 'favorites', 'notes', 'text_marks', 'manual_fixes', 'meta']:
            assert conn.execute('SELECT COUNT(*) FROM ' + table).fetchone()[0] == 0, table


def main():
    archive = PROJECT / 'build-input/windows-v1.1.0.zip'
    archive.parent.mkdir(parents=True, exist_ok=True)
    if not archive.exists():
        temporary = archive.with_suffix('.download')
        with urllib.request.urlopen(URL, timeout=90) as response, temporary.open('wb') as output:
            shutil.copyfileobj(response, output)
        temporary.replace(archive)
    assert hashlib.file_digest(archive.open('rb'), 'sha256').hexdigest() == SHA256, 'Public input checksum mismatch'
    with zipfile.ZipFile(archive) as z:
        count = 0
        for item in z.infolist():
            pieces = item.filename.split('/')
            # The v1.1.0 ZIP has a single CET-Practice top-level directory.
            relative = '/'.join(pieces[1:])
            if relative == '_internal/seed/cet6.db':
                relative = 'build-input/legacy-v1.1.0-cet6.db'
            elif not relative.startswith('resources/'):
                continue
            if item.is_dir():
                continue
            target = (PROJECT / relative).resolve()
            assert target.is_relative_to(PROJECT)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(z.read(item))
            count += 1
    assert len(list((PROJECT / 'resources').rglob('*.m4a'))) == 76
    print(f'Public audio verified: {count} files; 76 independent audio files.')


if __name__ == '__main__':
    main()
