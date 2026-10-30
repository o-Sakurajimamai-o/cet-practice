"""Build on the target macOS architecture; never cross-compile from Windows."""
import argparse
import hashlib
import importlib.metadata
import json
import platform
import plistlib
import shutil
import subprocess
import sys
from pathlib import Path

from fetch_release_data import verify_seed

PROJECT = Path(__file__).resolve().parents[1]
VERSION = '1.4.0'


def build(arch, edition):
    assert sys.platform == 'darwin', 'A macOS build host is required.'
    assert platform.machine() == arch, f'Expected {arch}, got {platform.machine()}'
    verify_seed(PROJECT / 'seed/cet6.db')
    assert (PROJECT / 'frontend/dist/index.html').is_file(), 'Build frontend first.'
    (PROJECT/'seed/release.json').write_text(json.dumps({'audio_edition':edition}), encoding='utf-8')
    if edition == 'WithAudio': assert len(list((PROJECT / 'resources').rglob('*.m4a'))) == 76
    command = [sys.executable, '-m', 'PyInstaller', '--noconfirm', '--clean', '--onedir', '--windowed',
               '--name', 'CET-Practice', '--target-architecture', arch,
               '--osx-bundle-identifier', 'io.github.o-sakurajimamai-o.cetpractice',
               '--distpath', str(PROJECT / 'dist'), '--workpath', str(PROJECT / 'build'),
               '--specpath', str(PROJECT / 'packaging'), '--paths', str(PROJECT / 'backend'),
               '--paths', str(PROJECT / 'packaging'),
               '--add-data', f'{PROJECT / "frontend/dist"}:frontend/dist',
               '--add-data', f'{PROJECT / "seed"}:seed',
               '--add-data', f'{PROJECT / "third_party_licenses"}:third_party_licenses',
               '--add-data', f'{PROJECT / "THIRD_PARTY_NOTICES.md"}:.',
               '--add-data', f'{PROJECT / "LICENSE-NOTICE.md"}:.',
               '--hidden-import', 'mac_menu', '--hidden-import', 'uvicorn.logging',
               '--hidden-import', 'uvicorn.loops.asyncio', '--hidden-import', 'uvicorn.protocols.http.h11_impl',
               '--hidden-import', 'uvicorn.lifespan.on', '--copy-metadata', 'fastapi',
               '--copy-metadata', 'opentelemetry-api',
               '--exclude-module', 'pymupdf', '--exclude-module', 'fitz', '--exclude-module', 'numpy',
               str(PROJECT / 'packaging/launcher.py')]
    if edition == 'WithAudio':
        command[-1:-1] = ['--add-data', f'{PROJECT / "resources"}:resources']
    subprocess.run(command, cwd=PROJECT, check=True)
    app = PROJECT / 'dist/CET-Practice.app'
    info_path = app / 'Contents/Info.plist'
    info = plistlib.loads(info_path.read_bytes())
    info.update(CFBundleDisplayName='四六级研习室', CFBundleShortVersionString=VERSION,
                CFBundleVersion=VERSION, LSMinimumSystemVersion='14.0', LSUIElement=True,
                NSHighResolutionCapable=True)
    info_path.write_bytes(plistlib.dumps(info))
    # Include the actual macOS-only dependency notices and resolved build versions.
    licenses = app / 'Contents/Resources/third_party_licenses'
    for name in ['pyobjc-core', 'pyobjc-framework-Cocoa']:
        distribution = importlib.metadata.distribution(name)
        for file in distribution.files or []:
            if 'license' in str(file).lower() or 'copying' in str(file).lower():
                source = Path(distribution.locate_file(file))
                if source.is_file():
                    target = licenses / name / Path(str(file)).name
                    target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(source, target)
    lock = subprocess.check_output([sys.executable, '-m', 'pip', 'freeze'], text=True)
    (app / 'Contents/Resources/build-environment-macos.txt').write_text(lock, encoding='utf-8')
    subprocess.run(['codesign', '--force', '--deep', '--sign', '-', '--timestamp=none', str(app)], check=True)
    subprocess.run(['codesign', '--verify', '--deep', '--strict', '--verbose=2', str(app)], check=True)
    architecture = subprocess.check_output(['lipo', '-archs', str(app / 'Contents/MacOS/CET-Practice')], text=True).strip()
    assert architecture == arch, architecture
    package = PROJECT / f'dist/package-{arch}/CET-Practice-macOS'
    package.mkdir(parents=True, exist_ok=True)
    subprocess.run(['ditto', str(app), str(package / app.name)], check=True)
    shutil.copy2(PROJECT / 'docs/MACOS.md', package / '使用说明.md')
    for name in ['THIRD_PARTY_NOTICES.md', 'LICENSE-NOTICE.md']:
        shutil.copy2(PROJECT / name, package / name)
    stop = package / '停止.command'
    stop.write_text('''#!/bin/sh
cd "$(dirname "$0")" || exit 1
for app in "./CET-Practice.app" "$HOME/Applications/CET-Practice.app" "/Applications/CET-Practice.app"; do
    if [ -x "$app/Contents/MacOS/CET-Practice" ]; then
        exec "$app/Contents/MacOS/CET-Practice" --stop
    fi
done
printf '%s\\n' '未找到 CET-Practice.app，请使用菜单栏「四六级」退出。'
exit 1
''', encoding='utf-8')
    stop.chmod(0o755)
    out = PROJECT / 'release-assets'
    out.mkdir(exist_ok=True)
    archive = out / f'CET-Practice-v{VERSION}-macOS-{arch}-{edition}.zip'
    subprocess.run(['ditto', '-c', '-k', '--sequesterRsrc', '--keepParent', str(package), str(archive)], check=True)
    digest = hashlib.file_digest(archive.open('rb'), 'sha256').hexdigest()
    (out / f'SHA256-macOS-{arch}-{edition}.txt').write_text(f'{digest}  {archive.name}\n', encoding='utf-8')
    (out / f'build-macOS-{arch}-{edition}.json').write_text(json.dumps({
        'version': VERSION, 'edition':edition, 'architecture': arch, 'build_os': platform.mac_ver()[0],
        'minimum_os': '14.0', 'signature': 'ad-hoc; not Apple notarized',
        'bytes': archive.stat().st_size, 'sha256': digest,
    }, indent=2), encoding='utf-8')
    print(f'Mac package: {archive.name} ({archive.stat().st_size} bytes) SHA256 {digest}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--arch', choices=['arm64', 'x86_64'], required=True)
    parser.add_argument('--edition', choices=['WithAudio','NoAudio'], required=True)
    args=parser.parse_args()
    build(args.arch, args.edition)
