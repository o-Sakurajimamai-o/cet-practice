"""Use the temporary draft seed or, after publication, the released Windows ZIP."""
import subprocess
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[1]
target = PROJECT / 'build-input'
target.mkdir(exist_ok=True)
for name in ['CET-Practice-v1.2.0-clean-build-seed.zip', 'CET-Practice-v1.2.0-Windows-x64.zip']:
    if (target / name).is_file():
        break
    result = subprocess.run(['gh', 'release', 'download', 'v1.2.0', '--pattern', name, '--dir', str(target)],
                            capture_output=True, text=True)
    if result.returncode == 0:
        break
else:
    raise RuntimeError('Neither the draft clean seed nor the released Windows package could be downloaded.')
print('Retrieved a build seed; content hashes are checked separately.')
