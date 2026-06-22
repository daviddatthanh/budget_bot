@echo off
title Budget Bot Launcher
echo ===================================================
echo 🚀 Launching Budget Bot Command Center...
echo ===================================================

echo [1/2] Starting FastAPI Backend in a new window...
start "Budget Bot Backend (Port 8000)" cmd /k "title Budget Bot Backend && .venv\Scripts\python.exe -m uvicorn core.api:app --host 127.0.0.1 --port 8000 --reload"

echo [2/2] Starting Vite Frontend in a new window...
start "Budget Bot Frontend (Port 5173)" cmd /k "title Budget Bot Frontend && cd frontend && npm run dev"

echo ===================================================
echo ✨ Both servers are successfully starting up!
echo.
echo 🔗 Backend API: http://127.0.0.1:8000
echo 🔗 Frontend Website: http://localhost:5173
echo.
echo (You can close this window now. Keep the other two windows open!)
echo ===================================================
pause
