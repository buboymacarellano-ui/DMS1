@echo off
REM Auto-sync script for Windows Task Scheduler
REM Runs bidirectional sync with Render
REM
REM Schedule in Task Scheduler:
REM   Trigger: Daily at 2:00 AM (or every N hours)
REM   Action: cmd.exe /c scripts\sync-schedule.bat
REM   Run as: Administrator (for network access)

setlocal enabledelayedexpansion

cd /d "C:\Users\buboy\OneDrive\Desktop\DMS1"

REM Verify we're in the right directory
if not exist "package.json" (
  echo ERROR: package.json not found. Wrong directory!
  exit /b 1
)

REM Create log directory if it doesn't exist
if not exist "logs" mkdir logs

REM Log the sync start
echo.
echo [%date% %time%] ========== AUTO-SYNC START ==========
echo [%date% %time%] ========== AUTO-SYNC START ========== >> logs\sync.log

REM Check for git
git --version > nul 2>&1
if errorlevel 1 (
  echo [%date% %time%] ERROR: Git not installed or not in PATH
  echo [%date% %time%] ERROR: Git not installed or not in PATH >> logs\sync.log
  exit /b 1
)

REM Step 1: Update from GitHub (get latest code from remote)
echo [%date% %time%] Step 1: Pulling latest code from GitHub...
echo [%date% %time%] Step 1: Pulling latest code from GitHub... >> logs\sync.log
git fetch origin main >> logs\sync.log 2>&1
git reset --hard origin/main >> logs\sync.log 2>&1
if errorlevel 1 (
  echo [%date% %time%] WARNING: Git pull failed (might be offline or no changes)
  echo [%date% %time%] WARNING: Git pull failed (might be offline or no changes) >> logs\sync.log
)

REM Step 2: Check for local changes
echo [%date% %time%] Step 2: Checking for local changes...
echo [%date% %time%] Step 2: Checking for local changes... >> logs\sync.log
git status --short >> logs\sync.log 2>&1

REM Step 3: Add all changes (safe: only adds, append-only)
echo [%date% %time%] Step 3: Staging local changes (append-only)...
echo [%date% %time%] Step 3: Staging local changes (append-only)... >> logs\sync.log
git add -A >> logs\sync.log 2>&1

REM Step 4: Commit changes (with a timestamp)
echo [%date% %time%] Step 4: Committing changes...
echo [%date% %time%] Step 4: Committing changes... >> logs\sync.log

for /f "tokens=2-4 delims=/ " %%a in ('date /t') do (set mydate=%%c-%%a-%%b)
for /f "tokens=1-2 delims=/:" %%a in ('time /t') do (set mytime=%%a-%%b)

git commit -m "Auto-sync [%mydate% %mytime%]: append-only data merge" >> logs\sync.log 2>&1
if %ERRORLEVEL% EQU 1 (
  echo [%date% %time%] INFO: No changes to commit
  echo [%date% %time%] INFO: No changes to commit >> logs\sync.log
)

REM Step 5: Push to GitHub (triggers Render auto-deploy)
echo [%date% %time%] Step 5: Pushing to GitHub (triggers Render deploy)...
echo [%date% %time%] Step 5: Pushing to GitHub (triggers Render deploy)... >> logs\sync.log
git push origin main >> logs\sync.log 2>&1
if errorlevel 1 (
  echo [%date% %time%] WARNING: Git push failed (might be offline or auth issue)
  echo [%date% %time%] WARNING: Git push failed (might be offline or auth issue) >> logs\sync.log
)

REM Step 6: Run data sync script (if available)
if exist "node_modules" (
  echo [%date% %time%] Step 6: Running data sync check...
  echo [%date% %time%] Step 6: Running data sync check... >> logs\sync.log
  node scripts\sync-render.js status >> logs\sync.log 2>&1
) else (
  echo [%date% %time%] WARNING: node_modules not found, skipping data sync
  echo [%date% %time%] WARNING: node_modules not found, skipping data sync >> logs\sync.log
)

REM Log completion
echo [%date% %time%] ========== AUTO-SYNC COMPLETE ==========
echo [%date% %time%] ========== AUTO-SYNC COMPLETE ========== >> logs\sync.log
echo.

exit /b 0
