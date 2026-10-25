@echo off
chcp 65001 >nul
rem 六级刷题网站 - 首次安装脚本
rem 作用：创建后端虚拟环境、安装依赖、构建前端（需要已安装 Node.js 与 Python）
setlocal
cd /d "%~dp0.."

echo ============================================
echo  六级刷题网站 首次安装
echo ============================================

where python >nul 2>nul
if errorlevel 1 (
    echo [错误] 未找到 python，请先安装 Python 3.10+ 并加入 PATH。
    pause & exit /b 1
)
where npm >nul 2>nul
if errorlevel 1 (
    echo [错误] 未找到 npm，请先安装 Node.js 18+ 并加入 PATH。
    pause & exit /b 1
)

echo [1/3] 创建后端虚拟环境并安装依赖…
if not exist "backend\venv" (
    python -m venv backend\venv || (echo [错误] venv 创建失败 & pause & exit /b 1)
)
backend\venv\Scripts\python -m pip install --quiet --upgrade pip
backend\venv\Scripts\python -m pip install --quiet -r backend\requirements-runtime.txt
if errorlevel 1 (echo [错误] 后端依赖安装失败 & pause & exit /b 1)

echo [2/3] 构建前端…
cd frontend
if not exist "node_modules" (
    call npm ci --no-audit --no-fund || (echo [错误] npm install 失败 & pause & exit /b 1)
)
call npm run build || (echo [错误] 前端构建失败 & pause & exit /b 1)
cd ..

echo [3/3] 初始化数据库…
echo The portable launcher initializes data from the Release seed at first launch.

echo.
echo 安装完成！双击 scripts\start.bat 启动网站。
echo 如需重建/更新题库，在 backend 目录运行：
echo     venv\Scripts\python -m importer.import_all
pause
