"""Create a portable ZIP from the clean Windows build directory."""
import hashlib
import json
import zipfile
from pathlib import Path
from fetch_release_data import verify_seed

PROJECT = Path(__file__).resolve().parents[1]
VERSION = '1.2.0'
package = PROJECT / 'dist/CET-Practice'
assert (package / 'CET-Practice.exe').is_file()
verify_seed(package / '_internal/seed/cet6.db')
assert len(list((package / 'resources').rglob('*.m4a'))) == 76
assert not (package / 'data/cet6.db').exists()
output = PROJECT / 'release-assets'
output.mkdir(exist_ok=True)
archive = output / f'CET-Practice-v{VERSION}-Windows-x64.zip'
with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as z:
    for path in sorted(package.rglob('*')):
        if path.is_file():
            z.write(path, 'CET-Practice/' + path.relative_to(package).as_posix())
with archive.open('rb') as f:
    digest = hashlib.file_digest(f, 'sha256').hexdigest()
(output / 'SHA256-Windows-x64.txt').write_text(f'{digest}  {archive.name}\n', encoding='utf-8')
(output / 'build-Windows-x64.json').write_text(json.dumps({'version': VERSION, 'bytes': archive.stat().st_size, 'sha256': digest}, indent=2), encoding='utf-8')
print(f'Windows package: {archive.name} ({archive.stat().st_size} bytes) SHA256 {digest}')
