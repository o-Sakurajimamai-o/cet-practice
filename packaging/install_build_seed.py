"""Install only the audited public seed created for v1.2.0."""
import hashlib
import zipfile
from pathlib import Path
from fetch_release_data import verify_seed

PROJECT = Path(__file__).resolve().parents[1]
archive = PROJECT / 'build-input/CET-Practice-v1.2.0-clean-build-seed.zip'
released = PROJECT / 'build-input/CET-Practice-v1.2.0-Windows-x64.zip'
if archive.exists():
    with archive.open('rb') as f:
        assert hashlib.file_digest(f, 'sha256').hexdigest() == '84920b9447ffedc05a861013067b9ce4a64f93af3644d962a45003b9d7b9f998'
    prefix = 'seed/'
    source = archive
else:
    prefix = 'CET-Practice/_internal/seed/'
    source = released
expected = {'cet6.db': '362a45cdd8111473a114d8ac4cd4a8f55af5a4b5f5b01216b0b385b7dc1b422e',
            'import-report.json': '1bde73fca86c6478c908a915b66ac7964a16d0df6b1423ccc161f146242beb93'}
with zipfile.ZipFile(source) as z:
    if source == archive:
        assert set(z.namelist()) == {prefix + name for name in expected}
    for name, digest in expected.items():
        content = z.read(prefix + name)
        assert hashlib.sha256(content).hexdigest() == digest, name
        path = PROJECT / 'seed' / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
verify_seed(PROJECT / 'seed/cet6.db')
print('Validated current clean question bank, including empty personal text marks.')
