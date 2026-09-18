@echo off
setlocal
cd /d "%~dp0"
if exist "quiz-app\run_quiz.py" cd "quiz-app"

set "PY=python"
if exist "C:\Program Files\Python312\python.exe" set "PY=C:\Program Files\Python312\python.exe"

"%PY%" run_quiz.py
if errorlevel 1 (
    echo.
    echo [ERROR] Failed to start. Please ensure Python is installed.
    pause
)
