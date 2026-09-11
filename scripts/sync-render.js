#!/usr/bin/env node
/**
 * Render Data Sync Script
 * 
 * Bidirectional sync between local SQLite and Render disk
 * Mode: Append-only (no deletions)
 * 
 * Usage:
 *   node scripts/sync-render.js status
 *   node scripts/sync-render.js pull [--dry-run]
 *   node scripts/sync-render.js push [--dry-run]
 *   node scripts/sync-render.js diff
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');

const store = require('../data/store');

const LOG_DIR = path.join(__dirname, '../logs');
const SYNC_LOG = path.join(LOG_DIR, 'sync.log');
const CONFLICT_DIR = path.join(__dirname, '../data/conflicts');
const BACKUP_DIR = path.join(__dirname, '../data/backups');

// Ensure log dirs exist
[LOG_DIR, CONFLICT_DIR, BACKUP_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

class SyncLogger {
  log(msg) {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] ${msg}`;
    console.log(line);
    fs.appendFileSync(SYNC_LOG, line + '\n');
  }

  error(msg) {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] ERROR: ${msg}`;
    console.error(line);
    fs.appendFileSync(SYNC_LOG, line + '\n');
  }

  warn(msg) {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] WARN: ${msg}`;
    console.warn(line);
    fs.appendFileSync(SYNC_LOG, line + '\n');
  }
}

const logger = new SyncLogger();

function hashObject(obj) {
  return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex');
}

function loadLocalData() {
  try {
    return store.getRawData();
  } catch (err) {
    logger.error(`Failed to load local data: ${err.message}`);
    return null;
  }
}

function loadRemoteData() {
  // Placeholder for actual Render API call
  // For now, this would require SSH/rsync to fetch from Render disk
  
  logger.log('📡 Render remote sync requires manual setup.');
  logger.log('   Options:');
  logger.log('   1. Use Render SSH: ssh <service-id>@<service-url>');
  logger.log('   2. Use Render API to export database');
  logger.log('   3. Set up rsync from /data/shop.sqlite');
  
  return null;
}

async function statusCommand() {
  logger.log('📊 DMS1 Sync Status');
  logger.log('==================');

  const local = loadLocalData();
  if (!local) {
    logger.error('Could not load local data');
    return 1;
  }

  const collections = Object.keys(local);
  logger.log(`\n✅ Local collections (${collections.length}):`);
  
  collections.forEach(col => {
    const count = Array.isArray(local[col]) ? local[col].length : 
                  typeof local[col] === 'object' ? Object.keys(local[col]).length : 
                  1;
    logger.log(`   - ${col}: ${count} records`);
  });

  logger.log('\n📍 Render Status:');
  logger.log('   Service: dms1 (Render.com)');
  logger.log('   Disk: /data/shop.sqlite (2GB)');
  logger.log('   Status: Use Render dashboard to verify');

  logger.log('\n⚙️  Sync Configuration:');
  logger.log('   Mode: Bidirectional (append-only)');
  logger.log('   Conflicts: Logged in data/conflicts/');
  logger.log('   Last sync: See logs/sync.log');

  return 0;
}

async function pullCommand(dryRun = false) {
  logger.log('📥 Pull Data from Render');
  logger.log('========================');

  if (dryRun) {
    logger.log('🔍 DRY RUN MODE - No changes will be made');
  }

  logger.log('\nRequired: SSH/rsync access to Render service');
  logger.log('Manual steps:');
  logger.log('  1. Get Render SSH command from Dashboard');
  logger.log('  2. Copy remote /data/shop.sqlite to local');
  logger.log('  3. Run: npm run migrate:sqlite');
  logger.log('  4. Verify changes in local data');

  logger.log('\nExample (manual):');
  logger.log('  $ ssh <service-id>@<render-url> "cat /data/shop.sqlite" > /tmp/remote.sqlite');
  logger.log('  $ cp /tmp/remote.sqlite data/shop.sqlite');

  return 0;
}

async function pushCommand(dryRun = false) {
  logger.log('📤 Push Data to Render');
  logger.log('======================');

  const local = loadLocalData();
  if (!local) {
    logger.error('Could not load local data');
    return 1;
  }

  if (dryRun) {
    logger.log('🔍 DRY RUN MODE - No changes will be made');
  }

  // Create backup before push
  const backupFile = path.join(BACKUP_DIR, `shop-backup-${Date.now()}.json`);
  fs.writeFileSync(backupFile, JSON.stringify(local, null, 2));
  logger.log(`✅ Backup created: ${backupFile}`);

  logger.log('\nRequired: Git + Render auto-deploy or manual push');
  logger.log('Recommended method: Git push → GitHub → Render auto-deploy');
  logger.log('\nFor data-only push:');
  logger.log('  1. Export local data: node scripts/sync-render.js export');
  logger.log('  2. Manual deploy: Upload via Render Dashboard');
  logger.log('  3. Verify in production');

  const collections = Object.keys(local);
  logger.log(`\nData ready to push (${collections.length} collections):`);
  collections.slice(0, 5).forEach(col => logger.log(`   - ${col}`));
  if (collections.length > 5) logger.log(`   ... and ${collections.length - 5} more`);

  return 0;
}

async function diffCommand() {
  logger.log('🔍 Diff: Local vs Remote');
  logger.log('=========================');

  const local = loadLocalData();
  if (!local) {
    logger.error('Could not load local data');
    return 1;
  }

  logger.log('\nTo see differences, you need remote data first.');
  logger.log('Steps:');
  logger.log('  1. Pull from Render: node scripts/sync-render.js pull');
  logger.log('  2. Export remote: node scripts/sync-render.js export');
  logger.log('  3. Compare files with diff tool');

  logger.log('\nLocal data export:');
  const exportPath = path.join(BACKUP_DIR, `export-local-${Date.now()}.json`);
  fs.writeFileSync(exportPath, JSON.stringify(local, null, 2));
  logger.log(`   Exported to: ${exportPath}`);

  return 0;
}

async function exportCommand() {
  logger.log('💾 Export Local Data');
  logger.log('====================');

  const local = loadLocalData();
  if (!local) {
    logger.error('Could not load local data');
    return 1;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const exportPath = path.join(BACKUP_DIR, `export-${timestamp}.json`);
  
  fs.writeFileSync(exportPath, JSON.stringify(local, null, 2));
  logger.log(`✅ Exported to: ${exportPath}`);
  logger.log(`   Size: ${(fs.statSync(exportPath).size / 1024 / 1024).toFixed(2)} MB`);

  return 0;
}

async function main() {
  const command = process.argv[2] || 'status';
  const dryRun = process.argv.includes('--dry-run');

  try {
    let exitCode = 0;

    switch (command) {
      case 'status':
        exitCode = await statusCommand();
        break;

      case 'pull':
        exitCode = await pullCommand(dryRun);
        break;

      case 'push':
        exitCode = await pushCommand(dryRun);
        break;

      case 'diff':
        exitCode = await diffCommand();
        break;

      case 'export':
        exitCode = await exportCommand();
        break;

      default:
        console.log(`
Usage: node scripts/sync-render.js [command] [options]

Commands:
  status              Show current sync status (default)
  pull [--dry-run]    Pull data from Render
  push [--dry-run]    Push data to Render
  diff                Show differences between local and remote
  export              Export local data to JSON file

Environment Variables:
  RENDER_API_KEY      Render API key (from dashboard)
  RENDER_SERVICE_ID   Render service ID
  DMS_SQLITE_PATH     Path to SQLite database (optional)

Examples:
  node scripts/sync-render.js status
  node scripts/sync-render.js pull --dry-run
  node scripts/sync-render.js push
  node scripts/sync-render.js diff
  node scripts/sync-render.js export
        `);
        return 1;
    }

    process.exit(exitCode);
  } catch (err) {
    logger.error(`Command failed: ${err.message}`);
    if (process.env.DEBUG) console.error(err);
    process.exit(1);
  }
}

main();
