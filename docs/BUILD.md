# 源码与构建

需要 Python 3.12.10、Node.js 22；macOS 需要在对应芯片架构的 Mac 上构建。仓库不包含数据库、听力或原 PDF。可从对应版本的发布包提取 `seed/cet6.db` 和 `seed/import-report.json`；附听力版还需从发布包准备 `resources`。请勿使用包含个人记录的数据库作为发布种子。

```sh
python -m pip install -r packaging/requirements-build.txt # Mac 使用 requirements-macos.txt
cd frontend
npm ci
npm run build
cd ..
python packaging/audit_release_seed.py seed/cet6.db
python tests/test_backend_regressions.py
```

Windows 构建及压缩：`python packaging/build_windows.py --edition NoAudio`，然后 `python packaging/package_windows.py --edition NoAudio`。附听力版将 `NoAudio` 换成 `WithAudio` 并准备全部音频。

Mac 构建：`python packaging/build_macos.py --arch arm64 --edition NoAudio`；Intel 主机将 `arm64` 改成 `x86_64`，附听力版改为 `WithAudio`。分别使用对应系统运行 `python tests/test_release_v140.py --platform Windows-x64 --edition NoAudio`，或把平台改为 `macOS-arm64` / `macOS-x86_64`。测试还需 Playwright 和旧版公开数据库夹具。

构建工作流使用经校验的清洁种子和公开听力，并在六种系统和音频组合上验证。Mac 使用 ad-hoc 签名，未经过 Apple 公证；使用方式见 [Mac 使用说明](MACOS.md)。
