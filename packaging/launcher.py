"""Local launcher: portable Windows data, persistent macOS Application Support data."""
import argparse
import contextlib
import json
import logging
import os
from pathlib import Path
import secrets
import shutil
import socket
import sys
import threading
import time
import urllib.error
import urllib.request
import webbrowser


def runtime_paths():
    frozen = getattr(sys, 'frozen', False)
    home = Path(sys.executable).resolve().parent if frozen else Path(__file__).resolve().parents[1]
    bundle = Path(getattr(sys, '_MEIPASS', home))
    if sys.platform == 'darwin':
        user_root = Path.home() / 'Library/Application Support/CET-Practice'
        if frozen:
            home = bundle  # Read bundled resources; never write inside a signed .app.
    else:
        user_root = home
    user_root = Path(os.environ.get('CET_PRACTICE_USER_DIR', user_root)).expanduser().resolve()
    return home, bundle, user_root


def acquire_lock(lock):
    if sys.platform == 'win32':
        import msvcrt
        lock.seek(0); lock.write(b'0'); lock.flush(); lock.seek(0)
        msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
    else:
        import fcntl
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)


def release_lock(lock):
    if sys.platform == 'win32':
        import msvcrt
        lock.seek(0)
        msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)
    else:
        import fcntl
        fcntl.flock(lock.fileno(), fcntl.LOCK_UN)
    lock.close()


def local_request(record, path='/api/health', stop=False):
    request = urllib.request.Request(
        f"http://127.0.0.1:{record['port']}{path}",
        method='POST' if stop else 'GET',
        headers={'X-CET6-Instance': record.get('token', '')},
    )
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(request, timeout=2) as response:
        return json.load(response)


def main():
    parser = argparse.ArgumentParser(description='CET portable practice')
    parser.add_argument('--stop', action='store_true', help='Gracefully stop this folder\'s instance')
    parser.add_argument('--no-browser', action='store_true')
    parser.add_argument('--port', type=int, default=8765)
    args = parser.parse_args()
    home, bundle, user_root = runtime_paths()
    data = user_root / 'data'
    data.mkdir(parents=True, exist_ok=True)
    if sys.platform == 'darwin':
        logging.basicConfig(filename=user_root / 'launcher.log', encoding='utf-8', level=logging.INFO)
    record_path = data / 'server.json'
    if args.stop:
        if not record_path.is_file():
            print('This copy is not running.'); return
        record = json.loads(record_path.read_text(encoding='utf-8'))
        health = local_request(record)
        if health.get('instance_id') != record.get('instance_id'):
            raise RuntimeError('Instance identity mismatch; no process was stopped.')
        local_request(record, '/api/local/shutdown', stop=True)
        print('Shutdown requested. Your saved answers are retained.'); return

    # OS locks are released even after a crash; two copies cannot share this database.
    lock = (data / 'instance.lock').open('a+b')
    try:
        acquire_lock(lock)
    except OSError:
        lock.close()
        for _ in range(20):
            try:
                record = json.loads(record_path.read_text(encoding='utf-8'))
                if local_request(record).get('instance_id') == record.get('instance_id'):
                    if not args.no_browser: webbrowser.open(f"http://127.0.0.1:{record['port']}/")
                    print('Already running. Opened the existing instance.'); return
            except (OSError, ValueError, KeyError): time.sleep(.25)
        raise RuntimeError('Another instance is starting or stopping. Please wait and retry.')

    native_quit_app = None
    try:
        database = data / 'cet6.db'
        if not database.exists():
            seed = bundle / 'seed/cet6.db'
            if not seed.exists(): seed = home / 'seed/cet6.db'
            if not seed.is_file(): raise RuntimeError('Question seed missing. Extract the entire ZIP first.')
            temporary = data / 'cet6.db.new'
            shutil.copy2(seed, temporary)
            temporary.replace(database)
        report = data / 'import-report.json'
        if not report.exists(): shutil.copy2(bundle / 'seed/import-report.json', report)
        settings_path = user_root / 'settings.json'
        settings = json.loads(settings_path.read_text(encoding='utf-8-sig')) if settings_path.exists() else {}
        resources = Path(settings.get('resource_directory', 'resources'))
        if not resources.is_absolute(): resources = home / resources
        os.environ['CET6_PROJECT_DIR'] = str(home)
        os.environ['CET6_RESOURCE_ROOT'] = str(resources.resolve())
        os.environ['CET_RESOURCE_ROOT'] = str(resources.resolve())
        if settings.get('pdf_resource_directory'):
            os.environ['CET_PDF_RESOURCE_ROOT'] = str(Path(settings['pdf_resource_directory']).expanduser().resolve())
        os.environ['CET6_FRONTEND_DIST'] = str(bundle / 'frontend/dist')
        os.environ['CET6_DB_PATH'] = str(database)
        instance_id, token = secrets.token_hex(16), secrets.token_hex(32)
        os.environ['CET6_INSTANCE_TOKEN'] = token
        if not getattr(sys, 'frozen', False): sys.path.insert(0, str(home / 'backend'))
        from app.main import app
        import uvicorn
        # Bind first and pass the reserved socket to Uvicorn, avoiding a port race.
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try: sock.bind(('127.0.0.1', args.port))
        except OSError: sock.bind(('127.0.0.1', 0))
        sock.listen(128)
        port = sock.getsockname()[1]
        server = uvicorn.Server(uvicorn.Config(app, host='127.0.0.1', port=port,
            loop='asyncio', http='h11', ws='none', lifespan='on', access_log=False,
            log_config=None if sys.platform == 'darwin' else uvicorn.config.LOGGING_CONFIG,
            timeout_graceful_shutdown=10))
        app.state.instance_id = instance_id
        app.state.local_server = server
        record = {'pid': os.getpid(), 'port': port, 'instance_id': instance_id, 'token': token}
        tmp = record_path.with_suffix('.tmp')
        tmp.write_text(json.dumps(record), encoding='utf-8'); tmp.replace(record_path)
        print(f'CET Practice: http://127.0.0.1:{port}/')
        print('Use the menu bar Quit command on macOS, or Stop.bat / Ctrl+C on Windows.')
        print(f'Personal progress: {data}')
        def open_when_ready():
            for _ in range(100):
                if server.started:
                    webbrowser.open(f'http://127.0.0.1:{port}/'); return
                if server.should_exit: return
                time.sleep(.1)
        try:
            if sys.platform == 'darwin' and not args.no_browser:
                from mac_menu import run_menu
                native_quit_app = run_menu(server, sock, port, user_root, settings_path, settings)
            else:
                if not args.no_browser: threading.Thread(target=open_when_ready, daemon=True).start()
                server.run(sockets=[sock])
        finally:
            sock.close()
            try:
                if json.loads(record_path.read_text(encoding='utf-8')).get('instance_id') == instance_id:
                    record_path.unlink()
            except (OSError, ValueError): pass
    finally:
        release_lock(lock)
    if native_quit_app is not None:
        native_quit_app.replyToApplicationShouldTerminate_(True)


if __name__ == '__main__':
    for stream in (sys.stdout, sys.stderr):
        if stream and hasattr(stream, 'reconfigure'): stream.reconfigure(encoding='utf-8', errors='replace')
    try: main()
    except Exception as exc:
        logging.exception('Cannot start CET Practice')
        if sys.platform == 'darwin' and getattr(sys, 'frozen', False) and '--no-browser' not in sys.argv:
            try:
                from AppKit import NSAlert
                alert = NSAlert.alloc().init()
                alert.setMessageText_('四六级研习室未能启动')
                alert.setInformativeText_(str(exc))
                alert.runModal()
            except Exception:
                pass
        if sys.stdin and sys.stdin.isatty(): input('Press Enter to close...')
        sys.exit(1)
