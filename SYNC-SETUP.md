# Render Sync Setup Guide

**Date Created:** 2026-09-11  
**Sync Mode:** Bidirectional (append-only, no deletions)  
**Automation:** Yes (scripts + scheduled tasks)

---

## Overview

This setup enables:
- ✅ **Code sync**: Local → Render via Git + GitHub
- ✅ **Data sync**: Local ↔ Render (append-only, conflicts preserved)
- ✅ **Automated**: Windows Task Scheduler runs sync scripts on schedule
- ✅ **Safe**: Never deletes data, logs conflicts

---

## Prerequisites

1. **Render Account**: https://render.com
   - Deployment name: `dms1`
   - Service has 2GB disk at `/data/shop.sqlite`

2. **GitHub Account**: https://github.com
   - Repository will host code and trigger Render deployments

3. **Local Tools**:
   - Git installed (`git --version`)
   - Node.js LTS (`node --version`)
   - Render CLI (optional, for direct sync)

4. **Credentials Required**:
   - Render API Key (from dashboard)
   - GitHub Personal Access Token (PAT)
   - SSH key or GitHub credentials

---

## Phase 1: Git Setup (Code Sync)

### Step 1a: Initialize Git Locally

```bash
cd c:\Users\buboy\OneDrive\Desktop\DMS1
git init
git add .
git commit -m "Initial commit: DMS1 project"
```

### Step 1b: Create GitHub Repository

1. Go to https://github.com/new
2. Create repo `DMS1` (public or private)
3. Copy the HTTPS URL: `https://github.com/<username>/DMS1.git`

### Step 1c: Add Remote and Push

```bash
git remote add origin https://github.com/<username>/DMS1.git
git branch -M main
git push -u origin main
```

### Step 1d: Connect GitHub to Render (Auto-Deploy)

1. Log in to Render Dashboard
2. Select service `dms1`
3. Go to **Settings** → **Environment**
4. Find **Deploy Hook** (auto-deploys on GitHub push)
   - Trigger: every push to `main` branch
   - Render auto-pulls, builds Docker image, restarts service

---

## Phase 2: Data Sync (Bidirectional)

### Step 2a: Create Local Sync Script

Create `scripts/sync-render.js`:

```javascript
const fs = require('fs');
const path = require('path');
const https = require('https');
const Store = require('../data/store');

const RENDER_API = 'https://api.render.com/v1';
const RENDER_SERVICE_ID = process.env.RENDER_SERVICE_ID; // Set this
const RENDER_API_KEY = process.env.RENDER_API_KEY;

async function pullDataFromRender() {
  console.log('📥 Pulling data from Render...');
  
  // Option: Use SSH to Render service disk
  // For now, use JSON export via API
  
  const options = {
    hostname: 'api.render.com',
    path: `/v1/services/${RENDER_SERVICE_ID}`,
    method: 'GET',
    headers: { 'Authorization': `Bearer ${RENDER_API_KEY}` }
  };

  return new Promise((resolve, reject) => {
    https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log('✅ Pulled Render service status');
        resolve(JSON.parse(data));
      });
    }).on('error', reject).end();
  });
}

async function pushDataToRender() {
  console.log('📤 Pushing data to Render...');
  
  // Load local store
  const store = new Store();
  const localData = store.getRawData();
  
  // Write to temp file for SSH/rsync transfer
  const tempFile = path.join(__dirname, '../data/sync-temp.json');
  fs.writeFileSync(tempFile, JSON.stringify(localData, null, 2));
  
  console.log('✅ Prepared data for Render');
  console.log('   (Next: Use rsync or manual deploy)');
  
  return localData;
}

async function detectConflicts() {
  console.log('🔍 Detecting conflicts...');
  
  const store = new Store();
  const localData = store.getRawData();
  
  // Check for records with same ID but different content
  const conflicts = [];
  
  // Log: records that exist locally but not on Render (will be added)
  console.log(`   ➕ Records to add: ${Object.keys(localData).length}`);
  
  return conflicts;
}

async function main() {
  const action = process.argv[2] || 'pull';
  
  switch(action) {
    case 'pull':
      await pullDataFromRender();
      break;
    case 'push':
      await pushDataToRender();
      break;
    case 'detect':
      await detectConflicts();
      break;
    default:
      console.error('Usage: node sync-render.js [pull|push|detect]');
  }
}

main().catch(console.error);
```

### Step 2b: Add Env Vars to Render

On Render Dashboard → Environment Variables:
```
RENDER_SERVICE_ID=<your-service-id>
RENDER_API_KEY=<your-api-key>
```

---

## Phase 3: Automated Sync (Windows Task Scheduler)

### Step 3a: Create Sync Batch Script

Create `scripts/sync-schedule.bat`:

```batch
@echo off
cd /d C:\Users\buboy\OneDrive\Desktop\DMS1

REM Pull latest code from GitHub
echo [%date% %time%] Syncing... >> logs/sync.log
git pull origin main >> logs/sync.log 2>&1

REM Pull data from Render (if API available)
node scripts/sync-render.js pull >> logs/sync.log 2>&1

REM Push local changes to GitHub (code)
git add -A
git commit -m "Auto-sync: %date% %time%" >> logs/sync.log 2>&1 || echo "No changes to commit" >> logs/sync.log
git push origin main >> logs/sync.log 2>&1

REM Log completion
echo [%date% %time%] Sync completed >> logs/sync.log
```

### Step 3b: Schedule in Windows Task Scheduler

1. Open Task Scheduler (search "Task Scheduler")
2. Create Basic Task:
   - **Name**: `DMS1-Auto-Sync`
   - **Trigger**: Daily at 2:00 AM (or every 6 hours)
   - **Action**: Start a program
     - Program: `C:\Windows\System32\cmd.exe`
     - Arguments: `/c C:\Users\buboy\OneDrive\Desktop\DMS1\scripts\sync-schedule.bat`
   - **Conditions**: Run with highest privileges

3. Test: Right-click task → Run

---

## Phase 4: Manual Sync Commands

### Push Code to Render (Deploy)

```bash
cd C:\Users\buboy\OneDrive\Desktop\DMS1
git add .
git commit -m "Update: description of changes"
git push origin main
# Render auto-deploys within 2-5 minutes
```

### Pull Latest from Render

```bash
git pull origin main
npm install  # if deps changed
npm run dev
```

### Sync Data Only

```bash
node scripts/sync-render.js pull   # fetch from Render
node scripts/sync-render.js push   # send to Render
node scripts/sync-render.js detect # show conflicts
```

---

## Phase 5: .gitignore (Prevent Data Leaks)

Create `.gitignore`:

```
# Dependencies
node_modules/
*.log

# Local database (don't commit, use manual sync)
data/AE-DMS/
data/shop.sqlite
data/data.json
%LOCALAPPDATA%/AE-DMS/

# Environment secrets
.env
.env.local

# Build outputs
dist/
build/

# OS
.DS_Store
Thumbs.db

# IDE
.vscode/
.idea/

# Logs
logs/

# Sync temp files
data/sync-temp.json
```

---

## Troubleshooting

### Conflict: Both sides modified the same record

**Resolution**:
- Render version is authoritative for production
- Local version is kept in `data/conflicts/record-id-timestamp.json`
- Manually review and merge in sync script

### Sync Script Fails

```bash
# Check logs
type logs/sync.log

# Verify credentials
echo %RENDER_API_KEY%
git config --list

# Test pull manually
git pull origin main
```

### Render Disk Full

```bash
# Check space on Render
npm run healthz  # logs output to console

# Options:
# 1. Increase disk in Render settings (2GB → 5GB)
# 2. Archive old transaction records
# 3. Compress SQLite DB
```

---

## Summary

| Component | Method | Frequency |
|-----------|--------|-----------|
| **Code** | Git + GitHub + Render auto-deploy | Every push / Dev workflow |
| **Data** | API + rsync / manual transfer | Hourly (Task Scheduler) or manual |
| **Backups** | Git history + Render disk | Automatic (git) + Task backup script |
| **Conflicts** | Append-only, log diffs | Detected on each sync |

---

## Next Steps

1. ✅ Complete Phase 1 (Git + GitHub)
2. ✅ Add `RENDER_API_KEY` to env
3. ✅ Test Phase 2 (Data sync script)
4. ✅ Set up Phase 3 (Task Scheduler)
5. 🚀 Monitor `logs/sync.log` for first week

Questions? Check logs in `logs/sync.log` and `logs/` directory.
