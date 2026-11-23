@echo off
setlocal
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
    echo Creating Python virtual environment...
    python -m venv .venv
    if errorlevel 1 (
        echo Failed to create venv. Make sure Python 3.11+ is installed.
        pause
        exit /b 1
    )
    echo Installing Python dependencies...
    ".venv\Scripts\python.exe" -m pip install --upgrade pip
    ".venv\Scripts\python.exe" -m pip install -r requirements.txt
)

if not exist "frontend\dist\index.html" (
    where npm >nul 2>nul
    if %errorlevel%==0 (
        echo Building frontend bundle...
        pushd frontend
        call npm ci
        call npm run build
        popd
    )
)

echo Launching PFE Assistant...
".venv\Scripts\python.exe" -m backend.app.cli %*
endlocal
