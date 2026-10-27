@echo off
chcp 65001 >nul
rem 题库导入后，从源卷重建仔细阅读段落并构建网页；不会修改个人作答。
setlocal
cd /d "%~dp0.."
if not exist "backend\venv\Scripts\python.exe" (
    echo [错误] 请先运行 scripts\install.bat
    pause
    exit /b 1
)
echo 正在导入或更新题库…
pushd backend
venv\Scripts\python -m importer.import_all %*
if errorlevel 1 (
    popd
    echo [错误] 题库导入失败，未更新阅读分段和网页。
    pause
    exit /b 1
)
popd
echo 正在根据源 PDF 重建仔细阅读分段…
backend\venv\Scripts\python scripts\reading_paragraphs.py
if errorlevel 1 (
    echo [错误] 阅读分段生成失败，请检查上方错误。
    pause
    exit /b 1
)
where npm >nul 2>nul
if errorlevel 1 (
    echo [错误] 未找到 npm，题库已导入但网页未更新，请安装 Node.js 后重新运行。
    pause
    exit /b 1
)
pushd frontend
call npm run build
if errorlevel 1 (
    popd
    echo [错误] 网页构建失败，题库已导入但网页未更新。
    pause
    exit /b 1
)
popd
echo 题库、阅读分段和网页已更新。
pause
