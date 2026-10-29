@echo off
setlocal
echo Installing A&E Auto Service DMS...
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js not found. Installing via winget...
  winget install --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements
  if errorlevel 1 ( echo Failed to install Node.js. Install manually then rerun. & pause & exit /b 1 )
)
set "APPDIR=%ProgramFiles%\DMS1"
if not exist "%APPDIR%" mkdir "%APPDIR%"
xcopy /E /I /Y "%~dp0app" "%APPDIR%" >nul
cd /d "%APPDIR%"
call npm install --production
if errorlevel 1 ( echo npm install failed. & pause & exit /b 1 )
echo Creating shortcut...
powershell -NoProfile -Command "$ws=New-Object -ComObject WScript.Shell; $s=$ws.CreateShortcut('%USERPROFILE%\Desktop\A&E DMS.lnk'); $s.TargetPath='cmd.exe'; $s.Arguments='/c cd /d \"%APPDIR%\" && node app.js'; $s.WorkingDirectory='%APPDIR%'; $s.Save()"
echo Done. Launch "A&E DMS" from Desktop, then open http://127.0.0.1:3000
pause
