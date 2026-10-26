@echo off
chcp 65001 >nul
rem 六级刷题网站 - 停止脚本
setlocal
echo 正在停止六级刷题网站…
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /c:":8765 " ^| findstr /c:"LISTENING"') do (
    echo 结束进程 %%p
    taskkill /f /pid %%p >nul 2>&1
)
taskkill /f /fi "WINDOWTITLE eq cet6-practice-server*" >nul 2>&1
echo 已停止。
ping -n 3 127.0.0.1 >nul
