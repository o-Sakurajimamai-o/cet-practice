"""Use the temporary draft seed or, after publication, the released Windows ZIP."""
import json
import os
import subprocess
import urllib.error
import urllib.request
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[1]
target = PROJECT / 'build-input'
target.mkdir(exist_ok=True)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def download_asset_via_api(repo, asset_id, token, dest):
    url = f'https://api.github.com/repos/{repo}/releases/assets/{asset_id}'
    req = urllib.request.Request(url, headers={
        'Authorization': f'Bearer {token}',
        'Accept': 'application/octet-stream',
        'User-Agent': 'CET-Practice-CI'
    })
    opener = urllib.request.build_opener(NoRedirect)
    try:
        resp = opener.open(req, timeout=90)
    except urllib.error.HTTPError as err:
        if err.code in (301, 302, 303, 307, 308):
            resp = urllib.request.urlopen(err.headers['Location'], timeout=90)
        else:
            raise
    temp = dest.with_suffix('.part')
    with resp, temp.open('wb') as f:
        while chunk := resp.read(1024 * 1024):
            f.write(chunk)
    temp.replace(dest)


def get_asset_via_api(repo, token):
    url = f'https://api.github.com/repos/{repo}/releases'
    req = urllib.request.Request(url, headers={
        'Authorization': f'Bearer {token}',
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'CET-Practice-CI'
    })
    with urllib.request.urlopen(req, timeout=30) as resp:
        releases = json.load(resp)
    for r in releases:
        if r.get('tag_name') == 'v1.2.0':
            for asset in r.get('assets', []):
                for name in ['CET-Practice-v1.2.0-clean-build-seed.zip', 'CET-Practice-v1.2.0-Windows-x64.zip']:
                    if asset['name'] == name:
                        dest = target / name
                        print(f"Downloading {name} (asset ID {asset['id']}) via GitHub API...", flush=True)
                        download_asset_via_api(repo, asset['id'], token, dest)
                        return True
    return False


def main():
    for name in ['CET-Practice-v1.2.0-clean-build-seed.zip', 'CET-Practice-v1.2.0-Windows-x64.zip']:
        if (target / name).is_file():
            print(f'Found existing build seed: {name}')
            return

    token = os.environ.get('GH_TOKEN') or os.environ.get('GITHUB_TOKEN')
    repo = os.environ.get('GH_REPO') or os.environ.get('GITHUB_REPOSITORY', 'o-Sakurajimamai-o/cet-practice')

    if token:
        try:
            if get_asset_via_api(repo, token):
                print('Retrieved a build seed via GitHub API; content hashes are checked separately.')
                return
        except Exception as e:
            print(f'API download failed: {e}', flush=True)

    for name in ['CET-Practice-v1.2.0-clean-build-seed.zip', 'CET-Practice-v1.2.0-Windows-x64.zip']:
        result = subprocess.run(['gh', 'release', 'download', 'v1.2.0', '--pattern', name, '--dir', str(target)],
                                capture_output=True, text=True)
        if result.returncode == 0 and (target / name).is_file():
            print(f'Retrieved a build seed via gh CLI: {name}')
            return

    raise RuntimeError('Neither the draft clean seed nor the released Windows package could be downloaded.')


if __name__ == '__main__':
    main()
