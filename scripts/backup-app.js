const fs = require('fs').promises;
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const backupBase = process.env.BACKUP_DIR
  ? path.resolve(process.env.BACKUP_DIR)
  : path.resolve(projectRoot, '..', 'DMS-backup');
const backupRetentionDays = Number(process.env.BACKUP_RETENTION_DAYS || 30);

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = path.join(backupBase, `DMS-${timestamp}`);
const excludedNames = new Set(['.git', 'node_modules', 'backups', 'DMS-backup', 'Unconfirmed 599575.crdownload']);

async function copyDirectory(sourceDir, targetDir) {
  await fs.mkdir(targetDir, { recursive: true });
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    if (excludedNames.has(entry.name)) continue;

    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      await copyDirectory(sourcePath, targetPath);
    } else {
      await fs.copyFile(sourcePath, targetPath);
    }
  }
}

async function writeManifest() {
  const manifestPath = path.join(backupDir, 'backup-manifest.txt');
  const content = [
    `Backup created: ${new Date().toISOString()}`,
    `Source: ${projectRoot}`,
    `Backup folder: ${backupDir}`,
    'Included: app code, views, routes, public files, scripts, and data/data.json',
    'Note: node_modules and .git are excluded to keep the backup smaller.',
  ].join('\n');

  await fs.writeFile(manifestPath, content, 'utf8');
}

async function pruneOldBackups() {
  if (!Number.isFinite(backupRetentionDays) || backupRetentionDays <= 0) return;
  const cutoff = Date.now() - (backupRetentionDays * 24 * 60 * 60 * 1000);
  const entries = await fs.readdir(backupBase, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!entry.name.startsWith('DMS-')) continue;

    const fullPath = path.join(backupBase, entry.name);
    const stats = await fs.stat(fullPath);
    if (stats.mtimeMs < cutoff) {
      await fs.rm(fullPath, { recursive: true, force: true });
    }
  }
}

async function main() {
  await fs.mkdir(backupBase, { recursive: true });
  await fs.mkdir(backupDir, { recursive: true });
  await copyDirectory(projectRoot, backupDir);
  await writeManifest();
  await pruneOldBackups();

  console.log(`Backup created at ${backupDir}`);
}

main().catch((error) => {
  console.error('Backup failed:', error);
  process.exit(1);
});
