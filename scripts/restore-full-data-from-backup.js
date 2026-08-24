/**
 * Restore all business collections from the last full backup.
 * Keeps the current users list (already restored login accounts).
 * Then re-imports employee-db-all.csv so the live roster stays wired.
 *
 * Usage: node scripts/restore-full-data-from-backup.js
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DATA_FILE = path.join(ROOT, 'data', 'data.json');
const BACKUP_FILE = path.join(
  ROOT,
  'data',
  'data.backup.branches-migration.2026-08-13T02-55-49-660Z.json'
);

function countOf(value) {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === 'object') return Object.keys(value).length;
  return value == null ? 0 : 1;
}

function main() {
  if (!fs.existsSync(BACKUP_FILE)) {
    throw new Error(`Missing backup: ${BACKUP_FILE}`);
  }

  const current = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  const backup = JSON.parse(fs.readFileSync(BACKUP_FILE, 'utf8'));
  const snapshot = path.join(ROOT, 'data', `data.before-full-restore-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(snapshot, JSON.stringify(current), 'utf8');

  const restored = Object.assign({}, backup);
  if (Array.isArray(current.users) && current.users.length) {
    restored.users = current.users;
  }

  fs.writeFileSync(DATA_FILE, JSON.stringify(restored, null, 2), 'utf8');

  const imported = spawnSync(process.execPath, [path.join(__dirname, 'import-employee-db-all.js')], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (imported.stdout) process.stdout.write(imported.stdout);
  if (imported.stderr) process.stderr.write(imported.stderr);
  if (imported.status) {
    throw new Error(`import-employee-db-all.js exited ${imported.status}`);
  }

  const live = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  const summary = {};
  Object.keys(live).forEach((key) => {
    summary[key] = countOf(live[key]);
  });
  console.log(JSON.stringify({
    source: path.basename(BACKUP_FILE),
    snapshot: path.basename(snapshot),
    collections: summary,
  }, null, 2));
}

main();
