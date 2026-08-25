const fs = require('fs');
const path = require('path');

const DEFAULT_DIR = path.join(process.env.LOCALAPPDATA || process.env.APPDATA || path.join(__dirname, '..', 'data'), 'AE-DMS');
const CLOUD_DATA_DIR = '/data';

let db = null;
let dbPath = '';
let engineName = '';
let jsonCache = null;

function isDirectory(dir) {
  try {
    return fs.statSync(dir).isDirectory();
  } catch (_) {
    return false;
  }
}

function resolveDataDir() {
  const fromEnv = String(process.env.DMS_DATA_DIR || '').trim();
  if (fromEnv) return path.resolve(fromEnv);
  if (isDirectory(CLOUD_DATA_DIR)) return CLOUD_DATA_DIR;
  return DEFAULT_DIR;
}

function resolveSqlitePath() {
  const fromEnv = String(process.env.DMS_SQLITE_PATH || '').trim();
  if (fromEnv) return path.resolve(fromEnv);
  return path.join(resolveDataDir(), 'shop.sqlite');
}

function getSqlitePath() {
  if (!dbPath) dbPath = resolveSqlitePath();
  return dbPath;
}

function getSnapshotPath() {
  return path.join(path.dirname(getSqlitePath()), 'data-snapshot.json');
}

function getEngineName() {
  if (!engineName) openDatabase();
  return engineName || 'json';
}

function loadSqliteDriver() {
  try {
    return require('node:sqlite').DatabaseSync;
  } catch (_) {
    return null;
  }
}

function readJsonSnapshot() {
  const filePath = getSnapshotPath();
  if (!fs.existsSync(filePath)) return null;
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return parsed && typeof parsed === 'object' ? parsed : null;
}

function writeJsonSnapshot(data) {
  const filePath = getSnapshotPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data || {}), 'utf8');
  fs.renameSync(tempPath, filePath);
}

function openDatabase() {
  if (engineName === 'json') return null;
  if (db) return db;

  const DatabaseSync = loadSqliteDriver();
  if (!DatabaseSync) {
    engineName = 'json';
    fs.mkdirSync(path.dirname(getSqlitePath()), { recursive: true });
    console.log('SQLite driver unavailable; using persistent JSON at', getSnapshotPath());
    return null;
  }

  const filePath = getSqlitePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  db = new DatabaseSync(filePath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 8000;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS store_docs (
      name TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  engineName = 'sqlite';
  return db;
}

function hasStoreDocs() {
  if (getEngineName() === 'json') {
    const data = jsonCache || readJsonSnapshot();
    return Boolean(data && Object.keys(data).length);
  }
  const database = openDatabase();
  const row = database.prepare('SELECT COUNT(*) AS count FROM store_docs').get();
  return Number(row && row.count) > 0;
}

function readAllDocs() {
  if (getEngineName() === 'json') {
    jsonCache = readJsonSnapshot() || jsonCache || {};
    return jsonCache;
  }
  const rows = openDatabase().prepare('SELECT name, payload FROM store_docs').all();
  const data = {};
  for (const row of rows) {
    try {
      data[row.name] = JSON.parse(row.payload);
    } catch (error) {
      throw new Error(`SQLite document "${row.name}" is not valid JSON: ${error.message}`);
    }
  }
  return data;
}

function writeAllDocs(data) {
  if (getEngineName() === 'json') {
    jsonCache = data || {};
    writeJsonSnapshot(jsonCache);
    return;
  }
  const database = openDatabase();
  const now = new Date().toISOString();
  const upsert = database.prepare(`
    INSERT INTO store_docs (name, payload, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      payload = excluded.payload,
      updated_at = excluded.updated_at
  `);
  database.exec('BEGIN IMMEDIATE');
  try {
    Object.entries(data || {}).forEach(([name, value]) => {
      upsert.run(name, JSON.stringify(value), now);
    });
    database.exec('COMMIT');
  } catch (error) {
    try { database.exec('ROLLBACK'); } catch (_) { /* ignore */ }
    throw error;
  }
}

function checkpoint() {
  if (getEngineName() === 'json' || !db) return;
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
}

function closeDatabase() {
  if (!db) {
    engineName = engineName === 'json' ? 'json' : '';
    return;
  }
  try { db.close(); } catch (_) { /* ignore */ }
  db = null;
  engineName = '';
}

module.exports = {
  getSqlitePath,
  getSnapshotPath,
  getEngineName,
  openDatabase,
  hasStoreDocs,
  readAllDocs,
  writeAllDocs,
  checkpoint,
  closeDatabase,
};
