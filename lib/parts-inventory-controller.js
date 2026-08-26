const {
  TYPE_RESTOCK,
  TYPE_STOCK,
  TYPE_SOLD,
  TYPE_PRICE_EDIT,
  PARTS_REQUEST_TYPE,
  TYPE_TRANSFER_REQUEST,
  VALID_PARTS_TRANSACTION_TYPES,
  normalizePartsTransactionType,
  displayPartsTransactionType,
  isValidPartsTransactionType,
  isIncomingStockType,
  isPartsActivityLog,
} = require('./parts-request');

const DASHBOARD_RESTOCK_WORKING_DAYS = 3;

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizePartNumber(value) {
  return String(value || '').trim();
}

function normalizePartNumberKey(value) {
  const raw = normalizePartNumber(value);
  if (!raw) return '';
  if (/^\d+$/.test(raw)) return raw.replace(/^0+(?=\d)/, '');
  return raw.toUpperCase();
}

function ensureCollections(data) {
  if (!data || typeof data !== 'object') return data;
  if (!Array.isArray(data.parts)) data.parts = [];
  if (!Array.isArray(data.transactions)) data.transactions = [];
  if (!Array.isArray(data.parts_inventory)) data.parts_inventory = [];
  return data;
}

function transactionType(row) {
  if (!row) return '';
  return normalizePartsTransactionType(row.transaction_type || row.type);
}

function remainingQty(row) {
  return Math.max(0, toNumber(row && row.qty));
}

function isLiveInventoryLot(row) {
  return isIncomingStockType(transactionType(row)) && remainingQty(row) > 0;
}

const SOLD_RECORD_LOCKED_MESSAGE = 'A part that has been sold cannot be edited or erased.';

function isSoldTransaction(row) {
  return transactionType(row) === TYPE_SOLD;
}

function soldRecordLockReason(row) {
  return isSoldTransaction(row) ? SOLD_RECORD_LOCKED_MESSAGE : '';
}

function assertSoldRecordMutable(row) {
  const reason = soldRecordLockReason(row);
  if (reason) return { ok: false, error: reason };
  return { ok: true };
}

function transactionDate(row) {
  return (row && (row.date || row.created_at || row.transaction_date)) || '';
}

function transactionTimestamp(row) {
  return transactionDate(row);
}

function transactionDateKey(row) {
  const raw = String((row && (row.date || row.transaction_date || row.created_at)) || '').trim();
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function toDateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  const text = String(value).trim();
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const [year, month, day] = text.split('-').map(Number);
    return new Date(year, month - 1, day);
  }
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

function isWeekend(date) {
  const day = date.getDay();
  return day === 0 || day === 6;
}

function workingDaysElapsed(from, to) {
  const start = toDateOnly(from);
  const end = toDateOnly(to || new Date());
  if (!start || !end || end <= start) return 0;
  let count = 0;
  const cursor = new Date(start);
  cursor.setDate(cursor.getDate() + 1);
  while (cursor <= end) {
    if (!isWeekend(cursor)) count += 1;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

function isOlderThanThreeWorkingDays(date, now) {
  return workingDaysElapsed(date, now || new Date()) > DASHBOARD_RESTOCK_WORKING_DAYS;
}

function isRestockHiddenFromDashboard(row, now) {
  return transactionType(row) === TYPE_RESTOCK && isOlderThanThreeWorkingDays(transactionDate(row), now);
}

function allAuditRows(data) {
  ensureCollections(data);
  const seen = new Set();
  const rows = [];
  for (const row of [...data.parts_inventory, ...data.transactions]) {
    if (!row) continue;
    const id = String(row.id || '');
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    rows.push(row);
  }
  return rows;
}

function syncInventoryRowToTransactions(data, row) {
  ensureCollections(data);
  if (!row || !row.id) return false;
  if (isSoldTransaction(row)) return false;
  const patch = {
    qty: row.qty,
    present_location: row.present_location,
    branch: row.branch,
    created_branch: row.created_branch,
    part_number: row.part_number,
    part_name: row.part_name,
    sub_id: row.sub_id,
    generic: row.generic,
    supplier: row.supplier,
    unit: row.unit,
    cost_price: row.cost_price,
    markup: row.markup,
    retail_price: row.retail_price,
    sold_to: row.sold_to,
    transaction_type: row.transaction_type,
  };
  const idx = data.transactions.findIndex((entry) => String(entry.id) === String(row.id));
  if (idx === -1) return false;
  if (isSoldTransaction(data.transactions[idx])) return false;
  const current = data.transactions[idx];
  const changed = Object.keys(patch).some((key) => String(current[key] ?? '') !== String(patch[key] ?? ''));
  if (!changed) return false;
  data.transactions[idx] = Object.assign({}, current, patch);
  return true;
}

function matchesPartNumber(row, partNumber) {
  const target = normalizePartNumberKey(partNumber);
  if (!target) return false;
  return normalizePartNumberKey(row && row.part_number) === target;
}

function inDateRange(row, startDate, endDate) {
  const key = transactionDateKey(row);
  if (startDate && key && key < String(startDate).slice(0, 10)) return false;
  if (endDate && key && key > String(endDate).slice(0, 10)) return false;
  if ((startDate || endDate) && !key) return false;
  return true;
}

function sortChronological(rows, direction) {
  const dir = String(direction || 'asc').toLowerCase() === 'desc' ? -1 : 1;
  return [...rows].sort((a, b) => {
    const aKey = `${transactionDateKey(a)}T${transactionTimestamp(a)}`;
    const bKey = `${transactionDateKey(b)}T${transactionTimestamp(b)}`;
    return aKey.localeCompare(bKey) * dir;
  });
}

function groupTransactionsByMonth(rows) {
  const groups = {};
  for (const row of rows) {
    const key = transactionDateKey(row);
    const month = key ? key.slice(0, 7) : 'undated';
    if (!groups[month]) groups[month] = [];
    groups[month].push(row);
  }
  return Object.keys(groups)
    .sort()
    .map((month) => ({ month, rows: groups[month] }));
}

function upsertCatalogPart(data, source) {
  ensureCollections(data);
  const partNumber = normalizePartNumber(source.part_number);
  const key = normalizePartNumberKey(partNumber);
  if (!key) return null;

  let part = data.parts.find((row) => normalizePartNumberKey(row.part_number) === key);
  if (!part) {
    part = {
      id: `part-${key.toLowerCase()}`,
      part_number: partNumber,
      part_name: '',
      sub_id: '',
      generic: '',
      supplier: '',
      unit: '',
      stock: 0,
      qty: 0,
      cost_price: 0,
      markup: 0,
      retail_price: 0,
      present_location: '',
      branch: '',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    data.parts.push(part);
  }

  if (source.part_name) part.part_name = String(source.part_name);
  if (source.sub_id) part.sub_id = String(source.sub_id);
  if (source.generic) part.generic = String(source.generic);
  if (source.supplier) part.supplier = String(source.supplier);
  if (source.unit) part.unit = String(source.unit);
  if (source.present_location) part.present_location = String(source.present_location);
  if (source.branch) part.branch = String(source.branch);
  if (source.cost_price != null && source.cost_price !== '') part.cost_price = toNumber(source.cost_price);
  if (source.markup != null && source.markup !== '') part.markup = toNumber(source.markup);
  if (source.retail_price != null && source.retail_price !== '') part.retail_price = toNumber(source.retail_price);
  part.updated_at = new Date().toISOString();
  return part;
}

function applyStockEffect(part, type, qty) {
  const amount = Math.max(0, toNumber(qty));
  // Incoming rows keep remaining on-hand after sold deductions mutate those rows.
  // Sum remaining restock/stock qty so sold is not subtracted twice.
  if (isIncomingStockType(type)) {
    part.stock = Number((toNumber(part.stock) + amount).toFixed(4));
  }
  part.qty = part.stock;
  return part.stock;
}

function rebuildPartCatalogEntry(data, partNumber) {
  ensureCollections(data);
  const history = allAuditRows(data).filter((row) => matchesPartNumber(row, partNumber));
  const existingIdx = data.parts.findIndex((row) => normalizePartNumberKey(row.part_number) === normalizePartNumberKey(partNumber));
  if (existingIdx !== -1) data.parts.splice(existingIdx, 1);

  let part = null;
  for (const row of sortChronological(history, 'asc')) {
    if (isPartsActivityLog(row)) continue;
    part = upsertCatalogPart(data, row);
    applyStockEffect(part, row.transaction_type, row.qty);
  }
  if (!part && normalizePartNumber(partNumber)) {
    part = upsertCatalogPart(data, { part_number: partNumber });
    part.stock = 0;
    part.qty = 0;
  }
  return part;
}

function rebuildPartsCatalog(data) {
  ensureCollections(data);
  const byPart = new Map();
  for (const row of allAuditRows(data)) {
    const key = normalizePartNumberKey(row.part_number);
    if (!key) continue;
    if (!byPart.has(key)) byPart.set(key, []);
    byPart.get(key).push(row);
  }
  data.parts = [];
  for (const rows of byPart.values()) {
    let part = null;
    for (const row of sortChronological(rows, 'asc')) {
      if (isPartsActivityLog(row)) continue;
      part = upsertCatalogPart(data, row);
      applyStockEffect(part, row.transaction_type, row.qty);
    }
  }
  return data.parts;
}

function getPart(data, partNumber) {
  ensureCollections(data);
  const key = normalizePartNumberKey(partNumber);
  if (!key) return null;
  if (!data.parts.length && (data.transactions.length || data.parts_inventory.length)) {
    rebuildPartsCatalog(data);
  }
  return data.parts.find((row) => normalizePartNumberKey(row.part_number) === key) || rebuildPartCatalogEntry(data, partNumber);
}

function getOnHand(data, partNumber) {
  const part = getPart(data, partNumber);
  return part ? toNumber(part.stock) : 0;
}

function rememberTransaction(data, record) {
  ensureCollections(data);
  if (!record || !record.id) return record;
  const exists = data.transactions.some((row) => String(row.id) === String(record.id));
  if (!exists) {
    const stored = clone(record);
    stored.transaction_type = normalizePartsTransactionType(stored.transaction_type) || stored.transaction_type;
    data.transactions.push(stored);
  }
  rebuildPartCatalogEntry(data, record.part_number);
  return record;
}

function appendImmutableTransaction(data, payload) {
  ensureCollections(data);
  const record = Object.assign({
    id: payload.id,
    created_at: payload.created_at || new Date().toISOString(),
  }, payload);
  record.transaction_type = normalizePartsTransactionType(record.transaction_type) || record.transaction_type;
  rememberTransaction(data, record);
  return record;
}

function applyRestock(data, payload) {
  ensureCollections(data);
  const partNumber = normalizePartNumber(payload.part_number);
  const qty = toNumber(payload.qty);
  if (!partNumber) {
    return { ok: false, error: 'Part number is required for restock.' };
  }
  if (!Number.isFinite(qty) || qty <= 0) {
    return { ok: false, error: 'Restock quantity must be greater than zero.' };
  }

  const record = appendImmutableTransaction(data, Object.assign({}, payload, {
    part_number: partNumber,
    qty,
    transaction_type: TYPE_RESTOCK,
  }));

  if (!data.parts_inventory.some((row) => String(row.id) === String(record.id))) {
    data.parts_inventory.push(clone(record));
  }

  const part = rebuildPartCatalogEntry(data, partNumber);
  return { ok: true, transaction: record, part, on_hand: part ? toNumber(part.stock) : qty };
}

function getPartHistory(partNumber, options, data) {
  const opts = options || {};
  const history = sortChronological(
    allAuditRows(data)
      .filter((row) => matchesPartNumber(row, partNumber))
      .filter((row) => inDateRange(row, opts.startDate, opts.endDate)),
    opts.sort || 'asc'
  );
  const onHand = getOnHand(data, partNumber);
  const part = getPart(data, partNumber);
  const result = {
    part_number: normalizePartNumber(partNumber),
    on_hand: onHand,
    part,
    history,
    total: history.length,
  };
  if (String(opts.groupBy || '').toLowerCase() === 'month') {
    result.grouped = groupTransactionsByMonth(history);
  }
  return result;
}

function getDashboardLogs(data, query) {
  const q = query || {};
  const now = q.now || new Date();
  ensureCollections(data);
  const transactions = allAuditRows(data);
  const activeDashboardLogs = transactions.filter((t) => {
    // Warehouse activity copies are not inventory lots and must not flood the database as Sold.
    if (isPartsActivityLog(t)) return false;
    // Remaining restock/stock qty is current on-hand — keep it regardless of age.
    if (isLiveInventoryLot(t)) return true;
    const type = transactionType(t);
    // Daily view drops aged restock and sold movements so live stock is not buried.
    if (
      (type === TYPE_RESTOCK || type === TYPE_SOLD)
      && isOlderThanThreeWorkingDays(transactionDate(t), now)
    ) {
      return false;
    }
    return true;
  });
  return sortChronological(activeDashboardLogs, q.sort || 'desc');
}

function attachOnHand(data, rows) {
  return (rows || []).map((row) => Object.assign({}, row, {
    transaction_type: normalizePartsTransactionType(row.transaction_type) || row.transaction_type,
    on_hand: getOnHand(data, row.part_number),
  }));
}

module.exports = {
  TYPE_RESTOCK,
  TYPE_STOCK,
  TYPE_SOLD,
  SOLD_RECORD_LOCKED_MESSAGE,
  isSoldTransaction,
  soldRecordLockReason,
  assertSoldRecordMutable,
  TYPE_PRICE_EDIT,
  PARTS_REQUEST_TYPE,
  TYPE_TRANSFER_REQUEST,
  VALID_PARTS_TRANSACTION_TYPES,
  DASHBOARD_RESTOCK_WORKING_DAYS,
  normalizePartNumber,
  normalizePartNumberKey,
  normalizePartsTransactionType,
  displayPartsTransactionType,
  isValidPartsTransactionType,
  isIncomingStockType,
  ensureCollections,
  workingDaysElapsed,
  isOlderThanThreeWorkingDays,
  isRestockHiddenFromDashboard,
  allAuditRows,
  syncInventoryRowToTransactions,
  getPart,
  getOnHand,
  rememberTransaction,
  appendImmutableTransaction,
  applyRestock,
  getPartHistory,
  getDashboardLogs,
  attachOnHand,
  rebuildPartsCatalog,
  rebuildPartCatalogEntry,
  sortChronological,
  groupTransactionsByMonth,
  inDateRange,
};
