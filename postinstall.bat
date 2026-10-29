@echo off
cd /d "%~dp0"
where node >nul 2>&1 || (echo Node.js required. Install from nodejs.org & exit /b 1)
call npm install --production
