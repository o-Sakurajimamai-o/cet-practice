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
