# DMS1 Render Sync - Quick Reference

**Status**: Setup files created ✓  
**Mode**: Bidirectional (append-only, safe)  
**Automation**: Enabled (Windows Task Scheduler)

---

## 🚀 Quick Start (5 minutes)

### 1. Run the Setup Script

```bash
cd C:\Users\buboy\OneDrive\Desktop\DMS1
node scripts/setup-sync.js
```

This will:
- ✅ Initialize Git locally
- ✅ Connect to your GitHub repo
- ✅ Set up Render API keys
- ✅ Test sync system
- ✅ Guide you through Task Scheduler setup

### 2. Push to GitHub (First Time)

```bash
git push -u origin main
```

This triggers auto-deploy to Render within 2-5 minutes.

### 3. Verify Render Deployment

1. Go to https://dashboard.render.com
2. Select service `dms1`
3. Check Logs → Deploy Log
4. Should show "Deploy successful" 🎉

---

## 📋 Common Commands

### Check Sync Status
```bash
npm run sync:render:status
```

### Push Code to Render (Deploy)
```bash
git add .
git commit -m "Your description"
git push origin main
# Render auto-deploys in 2-5 minutes
```

### Pull Latest from Render
```bash
git pull origin main
npm install  # if dependencies changed
npm run dev
```

### Export Local Data
```bash
npm run sync:render:export
# Creates timestamped JSON in data/backups/
```

### Full Sync Test
```bash
npm run sync:render:diff
```

---

## ⏱️ Automated Sync (Optional)

### Enable Windows Task Scheduler

1. **Open Task Scheduler**
   - Press `Win + R`
   - Type: `taskschd.msc`
   - Press Enter

2. **Create New Task** (right panel: "Create Basic Task...")
   - **Name**: `DMS1-Auto-Sync`
   - **Trigger**: Daily, 2:00 AM (adjust as needed)
   - **Action**: Program
     - Program: `C:\Windows\System32\cmd.exe`
     - Arguments: `/c C:\Users\buboy\OneDrive\Desktop\DMS1\scripts\sync-schedule.bat`
   - **Conditions**: Run with highest privileges

3. **Test Immediately**
   - Right-click task → **Run**
   - Check `logs/sync.log` for output
   - Should complete in < 1 minute

### What Automated Sync Does

Every day at 2:00 AM (or on schedule):
1. ✅ Pulls latest code from GitHub
2. ✅ Adds all local changes
3. ✅ Commits with timestamp
4. ✅ Pushes to GitHub (triggers Render deploy)
5. ✅ Logs all activity to `logs/sync.log`

---

## 🔍 Monitoring

### View Sync Logs
```bash
# Live tail (Windows PowerShell)
Get-Content logs\sync.log -Wait -Tail 20

# Or just view
type logs\sync.log
```

### Render Deployment Logs
https://dashboard.render.com → Service `dms1` → Logs

### GitHub Commits
https://github.com/YOUR_USERNAME/DMS1/commits/main

---

## 🚨 Troubleshooting

### Git Push Fails
```bash
# Verify credentials
git config --global user.name "Your Name"
git config --global user.email "your@email.com"

# Test connection
git ls-remote origin

# If auth fails:
# 1. Use GitHub Personal Access Token (not password)
# 2. Store in Windows Credential Manager:
#    git credential-manager store
```

### Render Deployment Fails
1. Check Render Dashboard → Logs
2. Common issues:
   - `node_modules` not installed → run `npm install`
   - Environment variables missing → check .env
   - Port conflict → check PORT 3000 not in use

### Sync Script Doesn't Run
1. Verify Task Scheduler shows task enabled
2. Check `logs/sync.log` for errors
3. Verify batch file path is correct
4. Try running batch manually: `scripts\sync-schedule.bat`

### No Data Sync Between Local and Render
- **Current limitation**: Manual database sync only
- **Workaround**: Use Git for code + manual SQL dumps
- **Future**: SSH/rsync from Render disk

---

## 📁 File Structure

```
DMS1/
├── .git/                    # Git repository
├── SYNC-SETUP.md            # Full setup guide (read this!)
├── SYNC-QUICK-REF.md        # This file
├── scripts/
│   ├── setup-sync.js        # Interactive setup wizard
│   ├── sync-render.js       # Sync controller
│   ├── sync-schedule.bat    # Task Scheduler runner
│   └── ...
├── logs/
│   └── sync.log             # Sync activity log
├── data/
│   ├── backups/             # Data exports
│   ├── conflicts/           # Conflict logs
│   ├── shop.sqlite          # Local database
│   └── ...
└── ...
```

---

## 🔐 Security Notes

- ✅ **`.gitignore`** protects database files (not committed)
- ✅ **Append-only mode** prevents accidental deletions
- ✅ **Backups** created before every push
- ⚠️ **API keys** never committed (set as env vars)
- ⚠️ **Render disk** at `/data` is your source of truth

---

## 📞 Support

- **Full Guide**: See `SYNC-SETUP.md`
- **Setup Issues**: Run `node scripts/setup-sync.js --help`
- **Render Help**: https://render.com/docs
- **Git Help**: https://git-scm.com/doc

---

## ✅ Verification Checklist

- [ ] Git initialized locally
- [ ] GitHub repo created and connected
- [ ] First push to GitHub successful
- [ ] Render auto-deploy completed (check dashboard)
- [ ] App running at https://dms1.onrender.com
- [ ] Task Scheduler configured (optional but recommended)
- [ ] First automated sync logged in `logs/sync.log`

---

**Last Updated**: 2026-09-11  
**Version**: 1.0  
**Mode**: Append-Only Bidirectional Sync
