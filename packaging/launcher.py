"""Portable launcher. User data stays beside the EXE, outside the runtime bundle."""
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
    home = Path(sys.executable).resolve().parent if getattr(sys, 'frozen', False) else Path(__file__).resolve().parents[1]
    bundle = Path(getattr(sys, '_MEIPASS', home))
    data = home / 'data'
    data.mkdir(exist_ok=True)
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

    # A folder-specific OS file lock prevents two processes sharing this database.
    import msvcrt
    lock = (data / 'instance.lock').open('a+b')
    lock.seek(0); lock.write(b'0'); lock.flush(); lock.seek(0)
    try:
        msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
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
        settings_path = home / 'settings.json'
        settings = json.loads(settings_path.read_text(encoding='utf-8-sig')) if settings_path.exists() else {}
        resources = Path(settings.get('resource_directory', 'resources'))
        if not resources.is_absolute(): resources = home / resources
        os.environ['CET6_PROJECT_DIR'] = str(home)
        os.environ['CET6_RESOURCE_ROOT'] = str(resources.resolve())
        os.environ['CET_RESOURCE_ROOT'] = str(resources.resolve())
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
            timeout_graceful_shutdown=10))
        app.state.instance_id = instance_id
        app.state.local_server = server
        record = {'pid': os.getpid(), 'port': port, 'instance_id': instance_id, 'token': token}
        tmp = record_path.with_suffix('.tmp')
        tmp.write_text(json.dumps(record), encoding='utf-8'); tmp.replace(record_path)
        print(f'CET Practice: http://127.0.0.1:{port}/')
        print('Keep this window open. Use Stop.bat or Ctrl+C to stop normally.')
        print('Personal progress is stored in the data folder beside the EXE.')
        def open_when_ready():
            for _ in range(100):
                if server.started:
                    webbrowser.open(f'http://127.0.0.1:{port}/'); return
                if server.should_exit: return
                time.sleep(.1)
        if not args.no_browser: threading.Thread(target=open_when_ready, daemon=True).start()
        try: server.run(sockets=[sock])
        finally:
            sock.close()
            try:
                if json.loads(record_path.read_text(encoding='utf-8')).get('instance_id') == instance_id:
                    record_path.unlink()
            except (OSError, ValueError): pass
    finally:
        lock.seek(0)
        msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)
        lock.close()


if __name__ == '__main__':
    for stream in (sys.stdout, sys.stderr):
        if stream and hasattr(stream, 'reconfigure'): stream.reconfigure(encoding='utf-8', errors='replace')
    try: main()
    except Exception as exc:
        logging.exception('Cannot start CET Practice')
        if sys.stdin and sys.stdin.isatty(): input('Press Enter to close...')
        sys.exit(1)
