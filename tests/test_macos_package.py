"""Exercise the shipped ZIP on a real macOS runner, including native-menu startup."""
import argparse
import hashlib
import json
import os
import platform
import plistlib
import re
import shutil
import signal
import socket
import sqlite3
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import quote

checks = []
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def check(label, value):
    assert value, label
    checks.append(label)
    if len(checks) < 16 or len(checks) % 10 == 0 or not label.startswith('audio range '):
        print('PASS: ' + label, flush=True)


def request(port, path, method='GET', body=None, headers=None):
    raw = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(f'http://127.0.0.1:{port}' + path, data=raw, method=method,
                                 headers={'Content-Type': 'application/json', **(headers or {})})
    try:
        response = opener.open(req, timeout=15)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        return response.status, dict(response.headers), response.read()


def api(port, path, method='GET', body=None):
    status, headers, raw = request(port, path, method, body)
    assert status == 200, (path, status, raw[:200])
    return json.loads(raw)


def run(archive, arch):
    project = Path(__file__).resolve().parents[1]
    report = project / f'release-assets/verification-macOS-{arch}.json'
    processes = []
    with tempfile.TemporaryDirectory(prefix='四六级 Mac 发布验证 ') as tmp:
        root = Path(tmp)
        unpack = root / '含中文 and spaces'
        subprocess.run(['ditto', '-x', '-k', str(archive.resolve()), str(unpack)], check=True, timeout=120)
        app = unpack / 'CET-Practice-macOS/CET-Practice.app'
        stop_script = unpack / 'CET-Practice-macOS/停止.command'
        binary = app / 'Contents/MacOS/CET-Practice'
        user = root / '用户数据 and settings'
        user.mkdir()
        env = {key: value for key, value in os.environ.items()
               if not key.startswith(('CET', 'PYTHON', 'DYLD', 'GITHUB', 'ACTIONS', 'RUNNER'))}
        mac_user_home = root / '模拟 Mac 用户'
        mac_user_home.mkdir()
        env.update(PATH='/usr/bin:/bin:/usr/sbin:/sbin', HOME=str(mac_user_home), CET_PRACTICE_USER_DIR=str(user))
        record_path = user / 'data/server.json'

        def start(native=False, port=0):
            command = [str(binary), '--port', str(port)] + ([] if native else ['--no-browser'])
            process = subprocess.Popen(command, cwd=root, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            processes.append(process)
            deadline = time.monotonic() + 75
            while time.monotonic() < deadline:
                assert process.poll() is None, f'App exited {process.returncode}: ' + (user / 'launcher.log').read_text(errors='replace')[-4000:]
                try:
                    record = json.loads(record_path.read_text())
                    if api(record['port'], '/api/health')['ok']:
                        return process, record
                except (OSError, ValueError, AssertionError):
                    pass
                time.sleep(.2)
            raise AssertionError('App startup timed out: ' + (user / 'launcher.log').read_text(errors='replace')[-4000:])

        def stop(process, via_script=False):
            command = [str(stop_script)] if via_script else [str(binary), '--stop']
            result = subprocess.run(command, env=env, cwd=root, timeout=30)
            check('app stop command', result.returncode == 0)
            process.wait(timeout=25)
            check('server exits cleanly', process.returncode == 0)
            check('instance record removed', not record_path.exists())

        try:
            check('host architecture', platform.machine() == arch)
            info = plistlib.loads((app / 'Contents/Info.plist').read_bytes())
            check('native menu app metadata', info['LSUIElement'] and info['CFBundleShortVersionString'] == '1.2.0')
            check('ZIP preserves executable permissions', os.access(binary, os.X_OK))
            subprocess.run(['codesign', '--verify', '--deep', '--strict', str(app)], check=True)
            check('extracted application signature valid', True)
            executable_arch = subprocess.check_output(['lipo', '-archs', str(binary)], text=True).strip()
            check('packaged architecture', executable_arch == arch)
            blocker = socket.socket()
            blocker.bind(('127.0.0.1', 0)); blocker.listen()
            process, record = start(port=blocker.getsockname()[1])
            port = record['port']
            check('port collision leaves other listener untouched', port != blocker.getsockname()[1])
            blocker.close()
            check('frontend served', b'id="root"' in request(port, '/')[2])
            check('backend version', api(port, '/api/health')['version'] == '1.2.0')
            papers = api(port, '/api/papers')['papers']
            check('122 papers available', len(papers) == 122)
            check('CET4 filter', len(api(port, '/api/papers?exam=cet4')['papers']) == 46)
            check('CET6 filter', len(api(port, '/api/papers?exam=cet6')['papers']) == 76)
            with sqlite3.connect(user / 'data/cet6.db') as db:
                check('6089 questions', db.execute('SELECT COUNT(*) FROM questions').fetchone()[0] == 6089)
                check('no personal records in seed', all(db.execute('SELECT COUNT(*) FROM ' + t).fetchone()[0] == 0
                      for t in ['sessions', 'wrong_book', 'favorites', 'notes', 'text_marks', 'manual_fixes', 'meta']))
                check('objective answers and explanations', db.execute("SELECT COUNT(*) FROM questions WHERE qtype IN ('mcq','blank','match') AND (trim(coalesce(answer,''))='' OR trim(coalesce(analysis_text,''))='')").fetchone()[0] == 0)
                rows = db.execute("SELECT paper_key,audio_path FROM papers WHERE audio_path IS NOT NULL AND audio_path!=''").fetchall()
                uid, key, answer, pdf = db.execute("SELECT uid,paper_key,answer,source_file FROM questions WHERE qtype='mcq' AND answer IS NOT NULL ORDER BY uid LIMIT 1").fetchone()
            resources = app / 'Contents/Resources/resources'
            check('95 playable papers and 76 audio files', len(rows) == 95 and len({r[1] for r in rows}) == 76)
            for key_audio, relative in rows:
                status, headers, body = request(port, '/api/audio/' + key_audio, headers={'Range': 'bytes=0-1023'})
                check('audio range ' + key_audio, status == 206 and body == (resources / relative).read_bytes()[:1024])
            check('audio suffix seek', request(port, '/api/audio/' + rows[0][0], headers={'Range': 'bytes=-257'})[0] == 206)
            check('invalid audio range rejected', request(port, '/api/audio/' + rows[0][0], headers={'Range': 'bytes=999999999999-'})[0] == 416)
            detail = api(port, '/api/questions/cet4-2026-06-3:listening:25')
            check('sentence insights retained', any(m.get('content', {}).get('sentence_insights') for m in detail.get('materials', [])))
            status, headers, body = request(port, '/api/pdf?path=' + quote(pdf))
            check('optional PDF not required', status == 404 and '尚未安装'.encode() in body)
            sid = api(port, '/api/sessions?paper_key=' + key, 'POST')['session_id']
            api(port, f'/api/sessions/{sid}', 'PUT', {'answers': {uid: answer}, 'elapsed_sec': 123, 'audio_pos': 12.5})
            check('answer saved', api(port, f'/api/sessions/{sid}')['session']['answers'][uid] == answer)
            check('unauthorized stop rejected', request(port, '/api/local/shutdown', 'POST')[0] == 403)
            duplicate = subprocess.run([str(binary), '--no-browser'], env=env, cwd=root, timeout=30)
            check('duplicate launch reuses data owner', duplicate.returncode == 0 and process.poll() is None)
            # WebKit on macOS exercises the browser engine and native M4A decoder.
            from playwright.sync_api import sync_playwright
            with sync_playwright() as playwright:
                browser = playwright.webkit.launch(headless=True)
                page = browser.new_page(viewport={'width': 1440, 'height': 1000})
                failures = []
                page.on('pageerror', lambda error: failures.append(str(error)))
                page.goto(f'http://127.0.0.1:{port}/')
                page.get_by_role('button', name='英语四级').click()
                page.get_by_role('button', name='开始练习', exact=True).click()
                page.wait_for_selector('.qcard')
                check('WebKit renders listening questions', page.locator('.qcard').count() == 25)
                page.wait_for_function('() => document.querySelector("audio")?.readyState >= 2', timeout=45000)
                duration = page.locator('audio').evaluate('(audio) => audio.duration')
                check('WebKit decodes bundled M4A audio', duration > 600)
                page.get_by_role('button', name='播放', exact=True).click()
                page.wait_for_function('() => document.querySelector("audio").currentTime > .3', timeout=15000)
                page.get_by_role('button', name='暂停', exact=True).click()
                page.locator('audio').evaluate('(audio) => {audio.currentTime = 120; return audio.currentTime}')
                page.wait_for_function('() => document.querySelector("audio").currentTime >= 119', timeout=15000)
                check('WebKit playback and seeking', True)
                from browser_practice_checks import check_practice_features
                check_practice_features(page, check)
                page.screenshot(path=str(project / f'release-assets/browser-macOS-{arch}.png'), full_page=True)
                page.set_viewport_size({'width': 390, 'height': 844})
                check('narrow browser layout has no horizontal overflow', page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'))
                check('no browser script errors', not failures)
                browser.close()
            stop(process)
            # Relocate the whole .app, not the user data, as during a normal upgrade.
            new_app = mac_user_home / 'Applications/CET-Practice.app'
            new_app.parent.mkdir()
            app.rename(new_app); app = new_app; binary = app / 'Contents/MacOS/CET-Practice'
            subprocess.run(['codesign', '--verify', '--deep', '--strict', str(app)], check=True)
            external_pdf = root / 'PDF supplement/resources'
            target = external_pdf / pdf; target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(b'%PDF-1.4\n% isolated optional-resource fixture\n%%EOF\n')
            (user / 'settings.json').write_text(json.dumps({'pdf_resource_directory': str(external_pdf)}))
            process, record = start(native=True)
            port = record['port']
            time.sleep(2)
            check('native menu event loop stays running', process.poll() is None)
            restored = api(port, f'/api/sessions/{sid}')['session']
            check('records survive app relocation and native launch', restored['answers'][uid] == answer and restored['elapsed_sec'] == 123 and restored['audio_pos'] == 12.5)
            with sqlite3.connect(user / 'data/cet6.db') as db:
                check('word mark survives app restart', db.execute('SELECT COUNT(*) FROM text_marks').fetchone()[0] == 1)
            check('optional external PDF works', request(port, '/api/pdf?path=' + quote(pdf))[2].startswith(b'%PDF'))
            check('external PDF does not replace bundled audio', request(port, '/api/audio/' + rows[0][0], headers={'Range': 'bytes=0-127'})[0] == 206)
            check('PDF traversal blocked', request(port, '/api/pdf?path=../launcher.log')[0] == 403)
            link = external_pdf / 'escape.pdf'
            link.symlink_to(user / 'launcher.log')
            check('PDF symlink escape blocked', request(port, '/api/pdf?path=escape.pdf')[0] == 403)
            api(port, f'/api/sessions/{sid}/submit', 'POST')
            backup = api(port, '/api/backup/export')
            check('history and export', bool(api(port, '/api/history')) and backup['format'] == 'cet6-backup')
            check('word mark is exported', len(backup['text_marks']) == 1)
            legacy_backup = dict(backup); legacy_backup.pop('text_marks')
            check('older backups can be merged', api(port, '/api/backup/import?merge=true', 'POST', {'data': legacy_backup})['ok'])
            with sqlite3.connect(user / 'data/cet6.db') as db:
                check('merging an older backup preserves word marks', db.execute('SELECT COUNT(*) FROM text_marks').fetchone()[0] == 1)
            stream = opener.open(f'http://127.0.0.1:{port}/api/audio/{rows[0][0]}', timeout=10)
            stream.read(1024)
            started = time.monotonic(); stop(process, via_script=True)
            check('native app exits with active audio stream', time.monotonic() - started < 22)
            check('stop script locates app moved to Applications', True)
            stream.close()
            subprocess.run(['codesign', '--verify', '--deep', '--strict', str(app)], check=True)
            check('running never modifies signed app bundle', True)
            with sqlite3.connect(user / 'data/cet6.db') as db:
                check('saved database integrity', db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok')
            # Simulate upgrading an existing v1.1 user with personal progress.
            legacy = root / 'legacy user data'; (legacy / 'data').mkdir(parents=True)
            shutil.copy2(project / 'build-input/legacy-v1.1.0-cet6.db', legacy / 'data/cet6.db')
            with sqlite3.connect(legacy / 'data/cet6.db') as db:
                db.execute("INSERT INTO sessions(paper_id,mode,answers_json,elapsed_sec) SELECT id,'full','{}',77 FROM papers LIMIT 1")
                db.commit()
            env['CET_PRACTICE_USER_DIR'] = str(legacy)
            user = legacy; record_path = user / 'data/server.json'
            process, record = start()
            with sqlite3.connect(user / 'data/cet6.db') as db:
                check('upgrade preserves existing progress', db.execute('SELECT elapsed_sec FROM sessions').fetchone()[0] == 77)
                check('upgrade creates mark table', db.execute("SELECT COUNT(*) FROM sqlite_master WHERE name='text_marks'").fetchone()[0] == 1)
            stop(process)
            result = {'passed': True, 'architecture': arch, 'macos': platform.mac_ver()[0], 'checks': checks}
        except BaseException as error:
            result = {'passed': False, 'checks': checks, 'error': str(error)}
            raise
        finally:
            if (user / 'launcher.log').exists():
                shutil.copy2(user / 'launcher.log', project / f'release-assets/launcher-macOS-{arch}.log')
            for process in processes:
                if process.poll() is None:
                    process.terminate()
                    try:
                        process.wait(timeout=20)
                    except subprocess.TimeoutExpired:
                        process.kill(); process.wait()
            report.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'passed': True, 'architecture': arch, 'checks': len(checks)}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--arch', required=True)
    args = parser.parse_args()
    def deadline(number, frame):
        raise TimeoutError('macOS package verification exceeded five minutes')
    signal.signal(signal.SIGALRM, deadline)
    signal.alarm(300)
    archive = Path(__file__).resolve().parents[1] / f'release-assets/CET-Practice-v1.2.0-macOS-{args.arch}.zip'
    run(archive, args.arch)
