@echo off
title Stop Budget Bot Services
echo ===================================================
echo 🛑 Shutting down Budget Bot Services...
echo ===================================================

echo [1/2] Stopping Backend on port 8000...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr /r /c:":8000 "') do (
    echo Killing Backend PID %%a
    taskkill /f /pid %%a >nul 2>&1
)

echo [2/2] Stopping Frontend on port 5173...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr /r /c:":5173 "') do (
    echo Killing Frontend PID %%a
    taskkill /f /pid %%a >nul 2>&1
)

echo ===================================================
echo ✨ Services successfully stopped!
echo ===================================================
timeout /t 2 >nul
