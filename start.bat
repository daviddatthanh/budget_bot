@echo off
REM Double-click this file to start Wally on Windows.
title Wally
cd /d "%~dp0"

REM Prefer the Python launcher (py), fall back to python on PATH.
where py >nul 2>&1 && (py start.py & goto :done)
where python >nul 2>&1 && (python start.py & goto :done)

echo.
echo [X] Python was not found.
echo     Install it from https://www.python.org/downloads/ and try again.
echo.
pause

:done
