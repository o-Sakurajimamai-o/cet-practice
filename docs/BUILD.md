# 源码与构建

Windows x64，Python 3.12，Node.js 18+。

从 Release 便携包提取 `_internal/seed` 为仓库根目录的 `seed`，并准备 `resources`。源码仓库不包含个人数据库、题库、音频或 PDF。

```powershell
python -m venv backend/venv
backend/venv/Scripts/python.exe -m pip install -r backend/requirements-runtime.txt
cd frontend
npm ci
npm run build
cd ..
backend/venv/Scripts/python.exe packaging/launcher.py
```

安装 `packaging/requirements-build.txt` 后运行 `python packaging/build_windows.py`，输出 `dist/CET-Practice`。导入器依赖另见 `backend/requirements.txt`，支持 `--exam cet4` / `--exam cet6`；资源根目录由 `CET_RESOURCE_ROOT` 指定。更新题库时须保留个人记录。

## macOS

使用对应架构的 macOS 14+、Python 3.12.10、Node.js 22。在 macOS 主机上构建，不能从 Windows 交叉生成。GitHub Actions 的 `Build and verify macOS apps` 工作流分别运行于 Apple 芯片和 Intel macOS 主机，构建并验证完整 ZIP，供手动发布。

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r packaging/requirements-macos.txt
python packaging/fetch_release_data.py
cd frontend
npm ci
npm run build
cd ..
python tests/test_backend_regressions.py
python packaging/build_macos.py --arch arm64  # Intel 主机改为 x86_64
python tests/test_macos_package.py --arch arm64
```

`fetch_release_data.py` 只提取经过 SHA-256 核验的公开 v1.1.0 题库与听力，不读取开发机个人数据库。打包前校验种子库完整性及个人表为空。macOS 成品包含题库与音频，本地数据写入 Application Support；不修改签名应用。签名为 ad-hoc，未进行 Apple 公证，首次打开操作见 [Mac 使用说明](MACOS.md)。
