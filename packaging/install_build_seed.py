"""Install and independently audit the exact sanitized v1.4.0 build seed."""
import hashlib
from pathlib import Path
from zipfile import ZipFile
from audit_release_seed import audit
from fetch_release_data import verify_seed

root = Path(__file__).resolve().parents[1]
archive = root / 'build-input/CET-Practice-v1.4.0-clean-build-seed.zip'
with archive.open('rb') as stream:
    assert hashlib.file_digest(stream, 'sha256').hexdigest() == '057353d6c5a217732dadef5968ce70faff5e8b55af28db4bbf5dba431203e277'
with ZipFile(archive) as z:
    assert set(z.namelist()) == {'seed/cet6.db', 'seed/import-report.json'}
    for name in z.namelist():
        path = root / name
        path.parent.mkdir(exist_ok=True)
        path.write_bytes(z.read(name))
audit(root / 'seed/cet6.db')
verify_seed(root / 'seed/cet6.db')
