const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { rememberTransaction, ensureCollections } = require('../lib/parts-inventory-controller');
const sqlite = require('../lib/sqlite-engine');
const DATA_FILE = path.join(__dirname, 'data.json');
const SQLITE_POINTER_FILE = path.join(__dirname, 'sqlite-path.txt');
const PASSWORD_ITERATIONS = 120000;

let cache = null;

function normalizeData(data) {
  const source = data || {};
  const next = {
    users: source.users || [],
    customers: source.customers || [],
    vehicles: source.vehicles || [],
    work_orders: source.work_orders || [],
    transaction_records: source.transaction_records || [],
    pricing_rules: source.pricing_rules || [],
    pricing_settings: source.pricing_settings || { hourly_rate: 350 },
    delete_password_settings: source.delete_password_settings || { password_salt: '', password_hash: '' },
    auth_settings: source.auth_settings || { login_disabled: false },
    parts: source.parts || [],
    transactions: source.transactions || [],
    parts_inventory: source.parts_inventory || [],
    parts_transfers: source.parts_transfers || [],
    parts_purchase_orders: source.parts_purchase_orders || [],
    parts_suppliers: source.parts_suppliers || [],
    parts_requests: source.parts_requests || [],
    parts_documents: source.parts_documents || [],
    parts_request_transactions: source.parts_request_transactions || [],
    branch_parts_order_drafts: source.branch_parts_order_drafts || [],
    branches: source.branches || [],
    employees: source.employees || [],
    technician_updates: source.technician_updates || [],
    approval_requests: source.approval_requests || [],
    store_pos_sales: source.store_pos_sales || [],
    store_tills: source.store_tills || [],
    store_shelves: source.store_shelves || [],
    hr_rosters: source.hr_rosters || [],
    hr_payroll: source.hr_payroll || [],
  };
  return ensureCollections(next);
}

const OPERATIONAL_COLLECTIONS = [
  'customers',
  'vehicles',
  'work_orders',
  'transaction_records',
  'transactions',
  'parts_inventory',
  'parts_transfers',
  'parts_purchase_orders',
  'parts_requests',
  'parts_documents',
  'parts_request_transactions',
  'branch_parts_order_drafts',
  'technician_updates',
  'approval_requests',
  'store_pos_sales',
  'store_tills',
  'store_shelves',
  'hr_rosters',
  'hr_payroll',
];

const QTY_KEYS = [
  'qty', 'quantity', 'stock', 'sold', 'on_hand', 'onhand', 'balance',
  'amount', 'total', 'count', 'hours', 'revenue', 'cost',
];

function zeroNumericFields(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return row;
  const next = Object.assign({}, row);
  QTY_KEYS.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(next, key) && typeof next[key] === 'number') {
      next[key] = 0;
    }
  });
  if (typeof next.qty === 'string' && next.qty.trim() !== '') next.qty = 0;
  if (typeof next.stock === 'string' && next.stock.trim() !== '') next.stock = 0;
  return next;
}

async function zeroOperationalDatabases() {
  const data = await load();
  OPERATIONAL_COLLECTIONS.forEach((name) => {
    data[name] = [];
  });
  data.parts = (data.parts || []).map((part) => {
    const next = zeroNumericFields(part);
    next.qty = 0;
    next.stock = 0;
    next.sold = 0;
    return next;
  });
  await save();
  return {
    emptied: OPERATIONAL_COLLECTIONS.slice(),
    partsZeroed: (data.parts || []).length,
  };
}

async function writeSqlitePointer() {
  try {
    await fs.writeFile(SQLITE_POINTER_FILE, `${sqlite.getSqlitePath()}\n`, 'utf8');
  } catch (_) {
    // Pointer is informational only.
  }
}

async function readJsonFile(filePath) {
  const txt = await fs.readFile(filePath, 'utf8');
  return normalizeData(JSON.parse(txt));
}

async function migrateFromJsonIfNeeded() {
  if (sqlite.hasStoreDocs()) return;

  const snapshotPath = sqlite.getSnapshotPath();
  const candidates = [snapshotPath, DATA_FILE];
  for (const filePath of candidates) {
    try {
      const parsed = await readJsonFile(filePath);
      sqlite.writeAllDocs(parsed);
      console.log('Loaded JSON seed into SQLite from', filePath, '->', sqlite.getSqlitePath());
      return;
    } catch (error) {
      if (error && error.code !== 'ENOENT') {
        console.error('JSON seed failed for', filePath, error.message || error);
      }
    }
  }
}

async function writePersistentJsonSnapshot(data) {
  try {
    await fs.writeFile(sqlite.getSnapshotPath(), JSON.stringify(data), 'utf8');
  } catch (error) {
    console.error('Persistent JSON snapshot failed:', error.message || error);
  }
}

async function load() {
  if (cache) return cache;
  sqlite.openDatabase();
  await writeSqlitePointer();
  await migrateFromJsonIfNeeded();
  if (sqlite.hasStoreDocs()) {
    cache = normalizeData(sqlite.readAllDocs());
    return cache;
  }
  cache = normalizeData({});
  sqlite.writeAllDocs(cache);
  await writePersistentJsonSnapshot(cache);
  return cache;
}

async function save() {
  const data = await load();
  sqlite.writeAllDocs(data);
  await writePersistentJsonSnapshot(data);
}

async function getRawData() {
  const data = await load();
  return JSON.parse(JSON.stringify(data));
}

async function replaceData(nextData) {
  cache = normalizeData(nextData || {});
  await save();
  return getRawData();
}

async function backupData() {
  const stamp = new Date().toISOString().replace(/[.:]/g, '-');
  const backupPath = path.join(__dirname, `data.backup.${stamp}.json`);
  const data = await load();
  await fs.writeFile(backupPath, JSON.stringify(data, null, 2), 'utf8');
  try {
    sqlite.checkpoint();
    await fs.copyFile(sqlite.getSqlitePath(), path.join(__dirname, `shop.backup.${stamp}.sqlite`));
  } catch (error) {
    console.error('SQLite backup copy failed:', error.message || error);
  }
  return backupPath;
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

async function getAll(collection) {
  const data = await load();
  return data[collection] || [];
}

async function getById(collection, id) {
  const items = await getAll(collection);
  return items.find(i => i.id === id) || null;
}

async function create(collection, obj) {
  const data = await load();
  if (!Array.isArray(data[collection])) data[collection] = [];
  const id = genId();
  const item = Object.assign({ id, created_at: new Date().toISOString() }, obj);
  data[collection].push(item);
  if (collection === 'parts_inventory') {
    rememberTransaction(data, item);
  }
  await save();
  return item;
}

async function update(collection, id, patch) {
  const data = await load();
  const idx = data[collection].findIndex(i => i.id === id);
  if (idx === -1) return null;
  data[collection][idx] = Object.assign({}, data[collection][idx], patch);
  await save();
  return data[collection][idx];
}

async function remove(collection, id) {
  const data = await load();
  const idx = data[collection].findIndex(i => i.id === id);
  if (idx === -1) return false;
  data[collection].splice(idx, 1);
  await save();
  return true;
}

async function isLoginAuthDisabled() {
  const data = await load();
  const settings = data.auth_settings || {};
  return settings.login_disabled === true;
}

async function setLoginAuthDisabled(disabled) {
  const data = await load();
  data.auth_settings = Object.assign({}, data.auth_settings || {}, {
    login_disabled: Boolean(disabled),
    updated_at: new Date().toISOString(),
  });
  await save();
  return data.auth_settings.login_disabled === true;
}

async function getPricingSettings() {
  const data = await load();
  return data.pricing_settings || { hourly_rate: 350 };
}

async function updatePricingSettings(patch) {
  const data = await load();
  data.pricing_settings = Object.assign({}, data.pricing_settings || { hourly_rate: 350 }, patch);
  await save();
  return data.pricing_settings;
}

async function hasDeletePassword() {
  const data = await load();
  const settings = data.delete_password_settings || {};
  return Boolean(String(settings.password_salt || '') && String(settings.password_hash || ''));
}

async function isDeletePasswordEnabled() {
  const data = await load();
  const settings = data.delete_password_settings || {};
  return settings.enabled !== false;
}

async function setDeletePasswordEnabled(enabled) {
  const data = await load();
  data.delete_password_settings = Object.assign({}, data.delete_password_settings || {}, {
    enabled: Boolean(enabled),
    updated_at: new Date().toISOString(),
  });
  await save();
  return data.delete_password_settings.enabled;
}

async function setDeletePassword(password) {
  const data = await load();
  const currentSettings = data.delete_password_settings || {};
  const passwordText = String(password || '');
  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = crypto.pbkdf2Sync(passwordText, salt, PASSWORD_ITERATIONS, 64, 'sha512').toString('hex');
  data.delete_password_settings = {
    enabled: currentSettings.enabled !== false,
    password_salt: salt,
    password_hash: passwordHash,
    updated_at: new Date().toISOString(),
  };
  await save();
}

async function verifyDeletePassword(password) {
  const data = await load();
  const settings = data.delete_password_settings || {};
  const salt = String(settings.password_salt || '');
  const expectedHash = String(settings.password_hash || '');
  if (!salt || !expectedHash || !password) return false;

  const actualHash = crypto.pbkdf2Sync(String(password), salt, PASSWORD_ITERATIONS, 64, 'sha512').toString('hex');
  const actualBuffer = Buffer.from(actualHash, 'hex');
  const expectedBuffer = Buffer.from(expectedHash, 'hex');
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

module.exports = {
  getAll,
  getById,
  create,
  update,
  remove,
  isLoginAuthDisabled,
  setLoginAuthDisabled,
  getPricingSettings,
  updatePricingSettings,
  hasDeletePassword,
  isDeletePasswordEnabled,
  setDeletePasswordEnabled,
  setDeletePassword,
  verifyDeletePassword,
  getRawData,
  replaceData,
  backupData,
  zeroOperationalDatabases,
  getSqlitePath: sqlite.getSqlitePath,
  getSnapshotPath: sqlite.getSnapshotPath,
  getEngineName: sqlite.getEngineName,
};