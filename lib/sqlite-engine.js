const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DEFAULT_DIR = path.join(process.env.LOCALAPPDATA || process.env.APPDATA || path.join(__dirname, '..', 'data'), 'AE-DMS');
const CLOUD_DATA_DIR = '/data';

let db = null;
let dbPath = '';

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

function openDatabase() {
  if (db) return db;
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
  return db;
}

function hasStoreDocs() {
  const row = openDatabase().prepare('SELECT COUNT(*) AS count FROM store_docs').get();
  return Number(row && row.count) > 0;
}

function readAllDocs() {
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
  openDatabase().exec('PRAGMA wal_checkpoint(TRUNCATE)');
}

function closeDatabase() {
  if (!db) return;
  try { db.close(); } catch (_) { /* ignore */ }
  db = null;
}

module.exports = {
  getSqlitePath,
  getSnapshotPath,
  openDatabase,
  hasStoreDocs,
  readAllDocs,
  writeAllDocs,
  checkpoint,
  closeDatabase,
};
