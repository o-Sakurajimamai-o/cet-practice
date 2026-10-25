@echo off
chcp 65001 >nul
rem 六级刷题网站 - 题库导入/更新脚本（可重复运行，不会重复建题、不影响作答记录）
setlocal
cd /d "%~dp0..\backend"
if not exist "venv\Scripts\python.exe" (
    echo [错误] 请先运行 scripts\install.bat
    pause & exit /b 1
)
echo 正在导入/更新题库（未变更的套次会自动跳过）…
venv\Scripts\python -m importer.import_all %*
pause
