@echo off
chcp 65001 >nul
rem 六级刷题网站 - 启动脚本（仅监听本机 127.0.0.1）
setlocal
cd /d "%~dp0.."

if not exist "backend\venv\Scripts\python.exe" (
    echo [错误] 未安装后端依赖，请先运行 scripts\install.bat
    pause & exit /b 1
)
if not exist "frontend\dist\index.html" (
    echo [提示] 前端尚未构建，正在构建…
    pushd frontend && call npm run build && popd
)

rem 端口被占用时先停掉旧实例
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /c:":8765 " ^| findstr /c:"LISTENING"') do taskkill /f /pid %%p >nul 2>&1

echo 正在启动六级刷题网站…
start "cet6-practice-server" /min cmd /c "backend\venv\Scripts\python -m uvicorn app.main:app --host 127.0.0.1 --port 8765 --app-dir backend > data\server.log 2>&1"

ping -n 4 127.0.0.1 >nul
start http://127.0.0.1:8765/
echo 已启动：浏览器应自动打开 http://127.0.0.1:8765/
echo 停止网站请运行 scripts\stop.bat（或直接关闭最小化的黑色窗口）
