"""Exercise the actual Windows/macOS ZIP and isolated upgrade on the target OS."""
import argparse
import json
import os
from pathlib import Path
import shutil
import socket
import sqlite3
import subprocess
import tempfile
import time
from urllib.parse import quote
from urllib.request import build_opener, ProxyHandler, Request
from urllib.error import HTTPError
import zipfile

BASE = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--platform', choices=['Windows-x64', 'macOS-arm64', 'macOS-x86_64'], required=True)
parser.add_argument('--edition', choices=['NoAudio', 'WithAudio'], required=True)
args = parser.parse_args()
name = f'{args.platform}-{args.edition}'
archive = BASE / f'release-assets/CET-Practice-v1.4.0-{name}.zip'
report = BASE / f'release-assets/verification-{name}.json'
opener = build_opener(ProxyHandler({}))
checks = []


def check(name, value):
    if not value:
        raise AssertionError(name)
    checks.append(name)
    print('PASS', name, flush=True)


def call(port, path, method='GET', body=None, headers=None):
    req = Request(f'http://127.0.0.1:{port}{path}', method=method,
                  data=json.dumps(body).encode() if body is not None else None,
                  headers={'Content-Type': 'application/json', **(headers or {})})
    try:
        response = opener.open(req, timeout=15)
    except HTTPError as error:
        response = error
    with response:
        return response.status, response.read()


def api(port, path, method='GET', body=None):
    status, raw = call(port, path, method, body)
    assert status == 200, (path, status, raw[:200])
    return json.loads(raw)


process = None
try:
    with tempfile.TemporaryDirectory(prefix='英语 测试 space ', ignore_cleanup_errors=True) as temp:
        root = Path(temp)
        if args.platform.startswith('Windows'):
            with zipfile.ZipFile(archive) as z:
                z.extractall(root)
            home = root / 'CET-Practice'
            binary = home / 'CET-Practice.exe'
            user = home
            seed = home / '_internal/seed/cet6.db'
            resources = home / 'resources'
        else:
            subprocess.run(['ditto', '-x', '-k', str(archive.resolve()), str(root)], check=True)
            home = root / 'CET-Practice-macOS/CET-Practice.app'
            binary = home / 'Contents/MacOS/CET-Practice'
            user = root / '用户数据 spaces'
            seed = home / 'Contents/Resources/seed/cet6.db'
            resources = home / 'Contents/Resources/resources'
            subprocess.run(['codesign', '--verify', '--deep', '--strict', str(home)], check=True)
            check('macOS app signature', True)
        from contextlib import closing
        with closing(sqlite3.connect(seed)) as db:
            for table in ('sessions', 'wrong_book', 'favorites', 'notes', 'text_marks', 'manual_fixes', 'meta'):
                check('empty personal table ' + table, db.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0] == 0)
            check('public seed integrity', db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok')
            rows = db.execute("SELECT paper_key,audio_path FROM papers WHERE coalesce(audio_path,'')!=''").fetchall()
            uid, paper_key, answer, pdf = db.execute("SELECT uid,paper_key,answer,source_file FROM questions WHERE qtype='mcq' AND answer IS NOT NULL AND source_file IS NOT NULL ORDER BY uid LIMIT 1").fetchone()
        check('audio edition contents', len(list(resources.rglob('*.m4a'))) == (76 if args.edition == 'WithAudio' else 0))
        env = {k: v for k, v in os.environ.items() if not k.startswith(('CET', 'PYTHON', 'DYLD'))}
        env['CET_PRACTICE_USER_DIR'] = str(user)
        env['PATH'] = str(Path(os.environ.get('SystemRoot', r'C:\Windows')) / 'System32') if os.name == 'nt' else '/usr/bin:/bin:/usr/sbin:/sbin'
        flags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
        log_path = root / 'process.log'
        log = log_path.open('wb')

        def start():
            global process
            process = subprocess.Popen([str(binary), '--no-browser', '--port', '0'], env=env, cwd=root, stdout=log, stderr=log, creationflags=flags)
            for _ in range(400):
                if process.poll() is not None:
                    raise RuntimeError('App exited; see isolated process log')
                try:
                    record = json.loads((user / 'data/server.json').read_text(encoding='utf-8'))
                    if record['pid'] == process.pid and api(record['port'], '/api/health')['ok']:
                        return record['port']
                except (OSError, ValueError, AssertionError):
                    pass
                time.sleep(.15)
            raise TimeoutError('Startup failed')

        def stop():
            global process
            result = subprocess.run([str(binary), '--stop'], env=env, cwd=root, capture_output=True, timeout=30, creationflags=flags)
            check('graceful stop', result.returncode == 0)
            process.wait(timeout=30)
            check('clean process exit', process.returncode == 0)
            process = None

        port = start()
        check('frontend served', b'id="root"' in call(port, '/')[1])
        health = api(port, '/api/health')
        check('version and edition', health['version'] == '1.4.0' and health['audio_edition'] == args.edition)
        for exam, count in [('cet4', 46), ('cet6', 76), ('kaoyan', 46)]:
            check(exam + ' papers', len(api(port, '/api/papers?exam=' + exam)['papers']) == count)
        check('unauthorized shutdown rejected', call(port, '/api/local/shutdown', 'POST')[0] == 403)
        status, body = call(port, '/api/audio/' + rows[0][0], headers={'Range': 'bytes=0-1023'})
        check('audio playback range or absence', (status == 206 and len(body) == 1024) if args.edition == 'WithAudio' else status == 404)
        if args.edition == 'WithAudio':
            for key, rel in rows:
                status, body = call(port, '/api/audio/' + key, headers={'Range': 'bytes=0-1023'})
                check('audio ' + key, status == 206 and body == (resources / rel).read_bytes()[:1024])
            check('audio seek', call(port, '/api/audio/' + rows[0][0], headers={'Range': 'bytes=-257'})[0] == 206)
        check('optional PDF absence', call(port, '/api/pdf?path=' + quote(pdf))[0] == 404)
        sid = api(port, '/api/sessions?paper_key=' + paper_key, 'POST')['session_id']
        api(port, f'/api/sessions/{sid}', 'PUT', {'answers': {uid: answer}, 'elapsed_sec': 123, 'audio_pos': 12.5})
        check('answer saved', api(port, f'/api/sessions/{sid}')['session']['answers'].get(uid) == answer)
        from playwright.sync_api import sync_playwright
        with sync_playwright() as playwright:
            browser = (playwright.chromium.launch(channel='chrome', headless=True) if os.name == 'nt' else playwright.webkit.launch(headless=True))
            page = browser.new_page(viewport={'width': 1440, 'height': 1000})
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto(f'http://127.0.0.1:{port}/')
            check('Linux Do link on page', page.locator('a[href="https://linux.do/"]').count() == 1)
            page.get_by_role('button', name='英语四级').click()
            page.locator('.exam-card:not(.kaoyan) .paper-action').first.click()
            page.wait_for_selector('.qcard')
            if args.edition == 'NoAudio':
                check('no-audio edition explains absence', page.get_by_text('当前为无听力音频版', exact=False).count() > 0)
            else:
                page.wait_for_function('() => document.querySelector("audio")?.readyState >= 2', timeout=45000)
                check('browser decodes listening audio', page.locator('audio').evaluate('(a) => a.duration > 0'))
                page.locator('audio').evaluate('(a) => { a.currentTime = 120 }')
                page.wait_for_function('() => document.querySelector("audio").currentTime >= 119', timeout=15000)
                check('browser can seek audio', True)
            page.goto(f'http://127.0.0.1:{port}/')
            page.get_by_role('button', name='考研英语').click()
            page.get_by_role('group', name='卷别').wait_for()
            check('kaoyan paper selection rendered', page.get_by_role('group', name='卷别').get_by_role('button', name='英语一').count() > 0)
            page.locator('.exam-card.kaoyan .paper-action').first.click()
            page.wait_for_selector('.qcard')
            check('kaoyan question rendered', page.locator('.qcard').count() > 0)
            check('kaoyan PDF download link', page.locator('a[href^="https://downloads.lazynote.cn/"]').count() > 0)
            check('no frontend errors', not errors)
            browser.close()
        stop()
        port = start()
        check('answer survives restart', api(port, f'/api/sessions/{sid}')['session']['answers'].get(uid) == answer)
        stop()
        # Use the historical public seed as an old user with synthetic progress.
        user = root / '旧版 用户'
        (user / 'data').mkdir(parents=True)
        shutil.copy2(BASE / 'build-input/legacy-v1.1.0-cet6.db', user / 'data/cet6.db')
        env['CET_PRACTICE_USER_DIR'] = str(user)
        with closing(sqlite3.connect(user / 'data/cet6.db')) as db:
            db.execute("INSERT INTO sessions(paper_id,mode,answers_json,elapsed_sec) SELECT id,'full','{}',77 FROM papers LIMIT 1")
            db.execute("UPDATE questions SET manual_locked=1,analysis_text='user custom analysis' WHERE id=(SELECT MIN(id) FROM questions)")
            locked_uid = db.execute('SELECT uid FROM questions WHERE manual_locked=1').fetchone()[0]
            db.commit()
        port = start()
        with closing(sqlite3.connect(user / 'data/cet6.db')) as db:
            check('legacy progress retained', db.execute('SELECT elapsed_sec FROM sessions').fetchone()[0] == 77)
            check('legacy custom analysis retained', db.execute('SELECT analysis_text FROM questions WHERE uid=?', (locked_uid,)).fetchone()[0] == 'user custom analysis')
            check('legacy gains kaoyan papers', db.execute("SELECT COUNT(*) FROM papers WHERE exam_type='kaoyan'").fetchone()[0] == 46)
            check('upgraded DB integrity', db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok')
        check('upgrade backup created', len(list((user / 'data/backups').glob('before-bank-*.db'))) == 1)
        stop()
        log.close()
        print('all checks passed:', len(checks))
    report.write_text(json.dumps({'passed': True, 'checks': checks, 'platform': args.platform, 'edition': args.edition}, indent=2), encoding='utf-8')
except BaseException as exc:
    if process is not None and process.poll() is None:
        process.terminate()
        process.wait(timeout=20)
    if 'temp' in globals():
        shutil.rmtree(temp, ignore_errors=True)
    report.write_text(json.dumps({'passed': False, 'checks': checks, 'error': str(exc)}, indent=2), encoding='utf-8')
    raise
