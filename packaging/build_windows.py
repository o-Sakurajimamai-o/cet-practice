"""Build on Windows using a clean venv; seed/resources must be supplied separately."""
import importlib.metadata
import argparse
import json
from pathlib import Path
import shutil
import subprocess
import sys

PROJECT=Path(__file__).resolve().parents[1]
def build(edition):
    (PROJECT/'seed/release.json').write_text(json.dumps({'audio_edition':edition}),encoding='utf-8')
    if not (PROJECT/'frontend/dist/index.html').is_file():
        subprocess.run(['npm.cmd','ci','--no-audit','--no-fund'],cwd=PROJECT/'frontend',check=True)
        subprocess.run(['npm.cmd','run','build'],cwd=PROJECT/'frontend',check=True)
    if not (PROJECT/'seed/cet6.db').is_file(): raise RuntimeError('Provide the clean seed database first.')
    command=[sys.executable,'-m','PyInstaller','--noconfirm','--onedir','--console',
       '--name','CET-Practice','--distpath',str(PROJECT/'dist'),'--workpath',str(PROJECT/'build'),
       '--specpath',str(PROJECT/'packaging'),'--paths',str(PROJECT/'backend'),
       '--add-data',f'{PROJECT / "frontend/dist"}:frontend/dist',
       '--add-data',f'{PROJECT / "seed"}:seed',
       '--hidden-import','uvicorn.logging','--hidden-import','uvicorn.loops.asyncio',
       '--hidden-import','uvicorn.protocols.http.h11_impl','--hidden-import','uvicorn.lifespan.on',
       '--copy-metadata','fastapi','--copy-metadata','opentelemetry-api',
       '--exclude-module','pymupdf','--exclude-module','fitz','--exclude-module','numpy',
       str(PROJECT/'packaging/launcher.py')]
    subprocess.run(command,cwd=PROJECT,check=True)
    target=PROJECT/'dist/CET-Practice'
    for name in ['Start.bat','Stop.bat','settings.json','README.md','THIRD_PARTY_NOTICES.md','LICENSE-NOTICE.md']:
        if (PROJECT/name).is_file(): shutil.copy2(PROJECT/name,target/name)
    shutil.copytree(PROJECT/'third_party_licenses',target/'third_party_licenses',dirs_exist_ok=True)
    if edition == 'WithAudio': shutil.copytree(PROJECT/'resources',target/'resources',dirs_exist_ok=True)
    (target/'data').mkdir(exist_ok=True)
    shutil.copy2(PROJECT/'data/README.txt',target/'data/README.txt')
    print('Portable output: '+str(target))

if __name__=='__main__':
    parser=argparse.ArgumentParser(); parser.add_argument('--edition',choices=['WithAudio','NoAudio'],required=True)
    build(parser.parse_args().edition)
