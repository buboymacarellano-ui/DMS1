const express = require('express');
const store = require('../data/store');
const {
  PARTS_REQUEST_TYPE,
  TYPE_TRANSFER_REQUEST,
  TYPE_RESTOCK,
  TYPE_STOCK,
  TYPE_PRICE_EDIT,
  TYPE_SOLD,
  VALID_PARTS_TRANSACTION_TYPES,
  WAREHOUSE_DESTINATIONS,
  REQUEST_TX_STATUS_OPEN,
  REQUEST_TX_STATUS_CLOSED,
  isValidWarehouse,
  isPartsRequestType,
  buildPartsRequestInventoryPayload,
  normalizePartsTransactionType,
  displayPartsTransactionType,
  isValidPartsTransactionType,
  isIncomingStockType,
  isPartsActivityLog,
} = require('../lib/parts-request');
const inventory = require('../lib/parts-inventory-controller');
const { collectReportLookups } = require('../lib/parts-reports');
const {
  allocatePartsTransactionNumber,
  backfillMissingTransactionNumbers,
} = require('../lib/parts-transaction-number');
const { resolveBranchCatalog, canonicalizeBranchName, getOperationalBranches } = require('../lib/branches');
const { isFrontlineRole } = require('../lib/frontline-roles');
const { allocateCreatePartNumber } = require('../lib/parts-catalog-number');
const {
  WAREHOUSE_1,
  sameLocation,
  belongsToLocation,
  filterRowsByLocation,
  stockByLocation,
  withLocationOnHand,
  attachEachRowLocationOnHand,
  resolveFrontlinePartsView,
  filterDataToLocation,
} = require('../lib/parts-location-scope');

const router = express.Router();

const TRANSACTION_TYPES = VALID_PARTS_TRANSACTION_TYPES;
function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function computeRetailPrice(costPrice, markup) {
  const cost = toNumber(costPrice);
  const pct = toNumber(markup);
  return Number((cost + cost * (pct / 100)).toFixed(2));
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function buildPresentLocationOptions(storedBranches) {
  const seen = new Set();
  return resolveBranchCatalog(storedBranches)
    .map((row) => String(row.name || '').trim())
    .filter((name) => {
      if (!name || name.toUpperCase() === 'ALL') return false;
      const key = name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function normalizePresentLocation(value) {
  const location = canonicalizeBranchName(String(value || '').trim());
  if (!location || location.toUpperCase() === 'ALL') return '';
  return location;
}

function employeeDisplayName(employee) {
  return [employee && employee.first_name, employee && employee.middle_name, employee && employee.last_name]
    .filter(Boolean)
    .map((part) => String(part).trim())
    .join(' ')
    .trim();
}

function resolveActorBranch(user, employees) {
  const sessionBranch = normalizePresentLocation(user && user.branch);
  if (sessionBranch) return sessionBranch;

  const list = Array.isArray(employees) ? employees : [];
  const techId = String((user && user.technician_employee_id) || '').trim().toUpperCase();
  const recId = String((user && (user.employee_id || user.receptionist_employee_id)) || '').trim().toUpperCase();
  const username = String((user && user.username) || '').trim().toUpperCase();

  const match = list.find((employee) => {
    const empId = String((employee && employee.employee_id) || '').trim().toUpperCase();
    if (techId && empId === techId) return true;
    if (recId && empId === recId) return true;
    const name = employeeDisplayName(employee).toUpperCase();
    const labeled = empId && name ? `${name} (${empId})` : name;
    return Boolean(username) && (username === name || username === labeled || username === empId);
  });

  return normalizePresentLocation(match && match.work_location_branch_id);
}

function currentPresentLocation(part) {
  return normalizePresentLocation((part && (part.present_location || part.branch || part.requesting_branch)) || '');
}

const PARTS_REPORT_COLUMNS = [
  { key: 'transaction_date', header: 'Transaction Date' },
  { key: 'transaction_type', header: 'Transaction Type' },
  { key: 'present_location', header: 'Present Location' },
  { key: 'editor', header: 'Editor' },
  { key: 'part_number', header: 'Part Number' },
  { key: 'part_name', header: 'Part Name' },
  { key: 'sub_id', header: 'Sub-ID' },
  { key: 'generic', header: 'Generic' },
  { key: 'supplier', header: 'Supplier' },
  { key: 'qty', header: 'Qty' },
  { key: 'cost_price', header: 'Cost Price' },
  { key: 'markup', header: 'Markup (%)' },
  { key: 'retail_price', header: 'Retail Price' },
  { key: 'sold_to', header: 'Sold To (WO#)' },
];

function asCsvValue(value) {
  const text = value == null ? '' : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function escapeXml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function resolveScopedPartsView(req, data) {
  const user = (req.session && req.session.user) || {};
  const actorBranch = resolveActorBranch(user, data.employees);
  return resolveFrontlinePartsView(user, req.query, actorBranch);
}

function assertFrontlineCanMutate(req, data, part) {
  const user = (req.session && req.session.user) || {};
  if (!isFrontlineRole(user.role)) return { ok: true };
  const actorBranch = resolveActorBranch(user, data.employees);
  if (!actorBranch) return { ok: false, error: 'Assigned branch is required.' };
  if (!part || !belongsToLocation(part, actorBranch)) {
    return { ok: false, error: 'You can only change parts at your own branch.' };
  }
  return { ok: true };
}

function filterPartsInventory(parts, query) {
  const q = String((query && query.q) || '').trim().toLowerCase();
  const filterType = String((query && query.type) || '').trim();
  let filtered = Array.isArray(parts) ? parts : [];
  if (q) {
    filtered = filtered.filter((p) =>
      [p.transaction_number, p.part_number, p.part_name, p.sub_id, p.generic, p.supplier, p.sold_to, p.editor, p.present_location, p.branch]
        .some((f) => String(f || '').toLowerCase().includes(q))
    );
  }
  if (filterType && isValidPartsTransactionType(filterType)) {
    const selectedType = normalizePartsTransactionType(filterType);
    filtered = filtered.filter((p) => normalizePartsTransactionType(p.transaction_type) === selectedType);
  }
  return { filtered, q, filterType };
}

const CREATE_PARTS_SOURCE = 'create-parts';

function createdPartsBranchOptions(data, selected) {
  const names = getOperationalBranches(data && data.branches)
    .map((row) => String((row && row.name) || '').trim())
    .filter(Boolean);
  if (!names.length) {
    names.push('Carx2', 'Carmen', 'CebuCity', 'Lapux2', 'Bogo', 'Toledo', 'ITPark');
  }
  const chosen = canonicalizeBranchName(selected) || String(selected || '').trim();
  if (chosen && !names.some((name) => name.toLowerCase() === chosen.toLowerCase())) {
    names.unshift(chosen);
  }
  return names;
}

function listCreatedParts(data) {
  return ((data && data.parts_inventory) || [])
    .filter((row) => String(row && row.created_via || '').trim() === CREATE_PARTS_SOURCE)
    .sort((a, b) => String(b.created_at || b.transaction_date || '').localeCompare(String(a.created_at || a.transaction_date || '')));
}

const CREATE_PARTS_LOG = 'create-parts-log';

function syncCreatedPartTransaction(data, record) {
  if (!Array.isArray(data.transactions)) data.transactions = [];
  const idx = data.transactions.findIndex((row) => String(row.id) === String(record.id));
  const stored = JSON.parse(JSON.stringify(record));
  if (idx === -1) data.transactions.push(stored);
  else data.transactions[idx] = stored;
  inventory.rebuildPartCatalogEntry(data, record.part_number);
}

function upsertWarehouseActivityLog(data, source) {
  if (!source || !source.id) return null;
  if (!Array.isArray(data.parts_inventory)) data.parts_inventory = [];
  const existingLog = data.parts_inventory.find((row) => (
    String(row.created_via || '').trim() === CREATE_PARTS_LOG
    && String(row.source_part_id || '') === String(source.id)
  ));
  const payload = {
    created_via: CREATE_PARTS_LOG,
    activity_log: true,
    source_part_id: source.id,
    created_branch: source.created_branch,
    transaction_date: source.transaction_date,
    transaction_number: source.transaction_number,
    transaction_type: TYPE_STOCK,
    present_location: WAREHOUSE_1,
    branch: WAREHOUSE_1,
    editor: source.editor,
    part_number: source.part_number,
    part_name: source.part_name,
    sub_id: source.sub_id,
    generic: source.generic,
    supplier: source.supplier,
    unit: source.unit,
    qty: source.qty,
    cost_price: source.cost_price,
    markup: source.markup,
    retail_price: source.retail_price,
    sold_to: source.sold_to || '',
  };
  if (existingLog) {
    Object.assign(existingLog, payload, { updated_at: new Date().toISOString() });
    syncCreatedPartTransaction(data, existingLog);
    return existingLog;
  }
  const log = Object.assign({
    id: genId(),
    created_at: new Date().toISOString(),
  }, payload);
  data.parts_inventory.push(log);
  syncCreatedPartTransaction(data, log);
  return log;
}

function migrateCreatedPartsToBranch(data) {
  let changed = false;
  for (const row of data.parts_inventory || []) {
    if (String(row.created_via || '').trim() !== CREATE_PARTS_SOURCE) continue;
    const branch = String(row.created_branch || '').trim();
    if (!branch) continue;
    if (!sameLocation(row.present_location, branch) || !sameLocation(row.branch, branch)) {
      row.present_location = branch;
      row.branch = branch;
      changed = true;
    }
    if (inventory.syncInventoryRowToTransactions(data, row)) changed = true;
    const hadLog = (data.parts_inventory || []).some((log) => (
      String(log.created_via || '').trim() === CREATE_PARTS_LOG
      && String(log.source_part_id || '') === String(row.id)
    ));
    if (!hadLog || changed) {
      upsertWarehouseActivityLog(data, row);
      if (!hadLog) changed = true;
    }
  }
  return changed;
}

function backfillSoldPartLocations(data) {
  let changed = false;
  const inventoryRows = data.parts_inventory || [];
  const sourceByPart = new Map();
  inventoryRows.forEach((row) => {
    if (isPartsActivityLog(row)) return;
    const key = inventory.normalizePartNumberKey(row.part_number);
    if (!key) return;
    if (String(row.created_via || '').trim() === CREATE_PARTS_SOURCE || isIncomingStockType(row.transaction_type)) {
      sourceByPart.set(key, row);
    }
  });
  inventoryRows.forEach((row) => {
    if (normalizePartsTransactionType(row.transaction_type) !== TYPE_SOLD) return;
    if (isPartsActivityLog(row)) return;
    if (String(row.present_location || row.branch || '').trim()) return;
    const src = sourceByPart.get(inventory.normalizePartNumberKey(row.part_number));
    if (!src) return;
    const loc = String(src.created_branch || src.present_location || src.branch || '').trim();
    if (!loc) return;
    row.present_location = loc;
    row.branch = loc;
    if (src.created_branch) row.created_branch = src.created_branch;
    inventory.syncInventoryRowToTransactions(data, row);
    changed = true;
  });
  return changed;
}

function incomingRemainingByPart(data) {
  const map = new Map();
  for (const row of data.parts_inventory || []) {
    if (isPartsActivityLog(row)) continue;
    if (!isIncomingStockType(row.transaction_type)) continue;
    const key = inventory.normalizePartNumberKey(row.part_number);
    if (!key) continue;
    map.set(key, Number(((map.get(key) || 0) + Math.max(0, toNumber(row.qty))).toFixed(4)));
  }
  return map;
}

function mismatchedCreateSoldCatalogKeys(data) {
  const remaining = incomingRemainingByPart(data);
  const keys = new Set();
  for (const row of data.parts_inventory || []) {
    const type = normalizePartsTransactionType(row.transaction_type);
    if (type !== TYPE_SOLD && String(row.created_via || '').trim() !== CREATE_PARTS_SOURCE) continue;
    const key = inventory.normalizePartNumberKey(row.part_number);
    if (key) keys.add(key);
  }
  const stale = [];
  for (const key of keys) {
    const expected = remaining.get(key) || 0;
    const part = (data.parts || []).find((row) => inventory.normalizePartNumberKey(row.part_number) === key);
    if (!part || Number(toNumber(part.stock).toFixed(4)) !== expected) stale.push(key);
  }
  return stale;
}

function persistCreatedPartsLedger(data) {
  const moved = migrateCreatedPartsToBranch(data);
  const soldLocations = backfillSoldPartLocations(data);
  const synced = syncInventoryLedgerToTransactions(data);
  const soldLogs = backfillWarehouseSoldLogs(data);
  const staleKeys = mismatchedCreateSoldCatalogKeys(data);
  if (!moved && !soldLocations && !synced && !soldLogs && !staleKeys.length) return false;
  const rebuild = new Set(staleKeys);
  for (const row of data.parts_inventory || []) {
    if (String(row.created_via || '').trim() !== CREATE_PARTS_SOURCE
      && normalizePartsTransactionType(row.transaction_type) !== TYPE_SOLD) continue;
    const key = inventory.normalizePartNumberKey(row.part_number);
    if (key) rebuild.add(row.part_number);
  }
  rebuild.forEach((partNumber) => inventory.rebuildPartCatalogEntry(data, partNumber));
  return true;
}

function syncInventoryLedgerToTransactions(data) {
  let changed = false;
  for (const row of data.parts_inventory || []) {
    if (inventory.syncInventoryRowToTransactions(data, row)) changed = true;
  }
  return changed;
}

function backfillWarehouseSoldLogs(data) {
  let changed = false;
  const rows = data.parts_inventory || [];
  for (const row of [...rows]) {
    if (normalizePartsTransactionType(row.transaction_type) !== TYPE_SOLD) continue;
    if (isPartsActivityLog(row)) continue;
    const hadLog = rows.some((log) => (
      String(log.created_via || '').trim() === CREATE_PARTS_LOG
      && String(log.source_part_id || '') === String(row.id)
    ));
    if (hadLog) continue;
    const log = {
      id: genId(),
      created_at: new Date().toISOString(),
      created_via: CREATE_PARTS_LOG,
      activity_log: true,
      source_part_id: row.id,
      created_branch: row.created_branch || row.present_location || row.branch,
      transaction_date: row.transaction_date,
      transaction_type: TYPE_SOLD,
      present_location: WAREHOUSE_1,
      branch: WAREHOUSE_1,
      editor: row.editor,
      part_number: row.part_number,
      part_name: row.part_name,
      sub_id: row.sub_id,
      generic: row.generic,
      supplier: row.supplier,
      unit: row.unit,
      qty: row.qty,
      cost_price: row.cost_price,
      markup: row.markup,
      retail_price: row.retail_price,
      sold_to: row.sold_to,
    };
    rows.push(log);
    inventory.rememberTransaction(data, log);
    changed = true;
  }
  return changed;
}

function persistCatalogIfNeeded(data) {
  inventory.ensureCollections(data);
  if (!data.parts.length && (data.transactions.length || data.parts_inventory.length)) {
    inventory.rebuildPartsCatalog(data);
  }
  return false;
}

function partsReportCell(part, column) {
  if (column.key === 'present_location') return currentPresentLocation(part);
  if (column.key === 'transaction_type') return displayPartsTransactionType(part.transaction_type);
  const value = part[column.key];
  if (column.key === 'cost_price' || column.key === 'retail_price') {
    return value != null && value !== '' ? Number(value).toFixed(2) : '';
  }
  return value == null ? '' : value;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  return [value];
}

function parseRequestOrderLines(body) {
  const partNumbers = asArray(body.line_part_number);
  const partNames = asArray(body.line_part_name);
  const subIds = asArray(body.line_sub_id);
  const generics = asArray(body.line_generic);
  const suppliers = asArray(body.line_supplier);
  const units = asArray(body.line_unit);
  const qtys = asArray(body.line_qty);
  const costPrices = asArray(body.line_cost_price);
  const markups = asArray(body.line_markup);
  const retailPrices = asArray(body.line_retail_price);
  const soldTos = asArray(body.line_sold_to);
  const count = Math.max(
    partNumbers.length,
    partNames.length,
    subIds.length,
    generics.length,
    suppliers.length,
    units.length,
    qtys.length,
    costPrices.length,
    markups.length,
    retailPrices.length,
    soldTos.length
  );

  const lines = [];
  for (let i = 0; i < count; i += 1) {
    const part_number = String(partNumbers[i] || '').trim();
    const part_name = String(partNames[i] || '').trim();
    const qtyRaw = String(qtys[i] || '').trim();
    if (!part_number && !part_name && qtyRaw === '') continue;

    const cost_price = toNumber(costPrices[i]);
    const markup = toNumber(markups[i]);
    const retailRaw = String(retailPrices[i] || '').trim();
    const retail_price = retailRaw !== '' ? toNumber(retailRaw) : computeRetailPrice(cost_price, markup);

    lines.push({
      part_number,
      part_name,
      sub_id: String(subIds[i] || '').trim(),
      generic: String(generics[i] || '').trim(),
      supplier: String(suppliers[i] || '').trim(),
      unit: String(units[i] || '').trim(),
      qty: toNumber(qtyRaw),
      cost_price,
      markup,
      retail_price,
      sold_to: String(soldTos[i] || '').trim(),
    });
  }
  return lines;
}

router.get('/', async (req, res) => {
  const data = await store.getRawData();
  let dirty = Boolean(backfillMissingTransactionNumbers(data));
  if (persistCreatedPartsLedger(data)) dirty = true;
  persistCatalogIfNeeded(data);
  if (dirty) await store.replaceData(data);

  const view = resolveScopedPartsView(req, data);
  const scopedData = view.isFrontline ? filterDataToLocation(data, view.location) : data;
  const dashboardLogs = inventory.getDashboardLogs(scopedData);
  const requestTransactions = (data.parts_request_transactions || [])
    .filter((row) => !view.location || belongsToLocation(row, view.location));
  const q = String(req.query.q || '').trim().toLowerCase();
  const filterType = req.query.type || '';
  const { filtered } = filterPartsInventory(dashboardLogs, req.query);
  const viewRows = withLocationOnHand(
    inventory.attachOnHand(view.location ? scopedData : data, filtered),
    inventory.allAuditRows(data),
    view.location || ''
  );

  const partsRequests = inventory.allAuditRows(scopedData).filter(p => isPartsRequestType(p.transaction_type));
  const sortedRequestTransactions = [...requestTransactions].sort((a, b) =>
    String(b.created_at || '').localeCompare(String(a.created_at || ''))
  );

  return res.render('parts/index', {
    parts: viewRows,
    partsRequests,
    requestTransactions: sortedRequestTransactions,
    warehouses: WAREHOUSE_DESTINATIONS,
    locationOptions: buildPresentLocationOptions(data.branches),
    actorBranch: resolveActorBranch(req.session && req.session.user, data.employees),
    openPartsRequestPanel: String(req.query.panel || '') === 'request',
    total: viewRows.length,
    q,
    filterType,
    transactionTypes: TRANSACTION_TYPES,
    displayPartsTransactionType,
    normalizePartsTransactionType,
    isSoldTransaction: inventory.isSoldTransaction,
    reportLookups: collectReportLookups(scopedData),
    error: req.query.error || '',
    success: req.query.success || '',
    partsView: view,
  });
});

router.post('/request-orders/send', async (req, res) => {
  const warehouse = String(req.body.sent_to || '').trim();
  const lines = parseRequestOrderLines(req.body);
  const data = await store.getRawData();
  const user = req.session && req.session.user ? req.session.user : {};
  const editor = String(user.username || '').trim();
  const requestingBranch = resolveActorBranch(user, data.employees) || String(user.branch || '').trim();

  if (!isValidWarehouse(warehouse)) {
    return res.redirect('/parts?panel=request&error=' + encodeURIComponent('Select Warehouse 1, Warehouse 2, or Warehouse 3.'));
  }
  if (!lines.length) {
    return res.redirect('/parts?panel=request&error=' + encodeURIComponent('Add at least one line order before sending.'));
  }

  const invalid = lines.find(line => !line.part_number || !line.part_name || !Number.isFinite(line.qty));
  if (invalid) {
    return res.redirect('/parts?panel=request&error=' + encodeURIComponent('Each line needs Part Number, Part Name, and Qty.'));
  }

  const transactionDate = new Date().toISOString().slice(0, 10);
  const orderId = genId();
  if (!Array.isArray(data.parts_request_transactions)) data.parts_request_transactions = [];
  if (!Array.isArray(data.parts_inventory)) data.parts_inventory = [];

  lines.forEach((line) => {
    const transactionNumber = allocatePartsTransactionNumber(data);
    const inventoryPayload = buildPartsRequestInventoryPayload({
      partNumber: line.part_number,
      partName: line.part_name,
      subId: line.sub_id,
      unit: line.unit,
      qty: line.qty,
      supplier: line.supplier,
      generic: line.generic,
      costPrice: line.cost_price,
      markup: line.markup,
      retailPrice: line.retail_price,
      editor,
      requestingBranch,
      branch: warehouse,
      workOrderNumber: line.sold_to,
      workOrderId: '',
      transactionDate,
    });
    const inventoryId = genId();
    const inventoryRow = Object.assign({
      id: inventoryId,
      created_at: new Date().toISOString(),
      transaction_number: transactionNumber,
      present_location: requestingBranch,
    }, inventoryPayload, {
      present_location: requestingBranch,
    });
    data.parts_inventory.push(inventoryRow);
    inventory.rememberTransaction(data, inventoryRow);

    data.parts_request_transactions.push({
      id: genId(),
      order_id: orderId,
      created_at: new Date().toISOString(),
      transaction_date: transactionDate,
      transaction_number: transactionNumber,
      transaction_type: PARTS_REQUEST_TYPE,
      status: REQUEST_TX_STATUS_OPEN,
      sent_to: warehouse,
      editor,
      requesting_branch: requestingBranch,
      part_number: line.part_number,
      part_name: line.part_name,
      sub_id: line.sub_id,
      generic: line.generic,
      supplier: line.supplier,
      unit: line.unit,
      qty: line.qty,
      cost_price: line.cost_price,
      markup: line.markup,
      retail_price: line.retail_price,
      sold_to: line.sold_to,
      inventory_request_id: inventoryId,
      received_at: '',
      received_by: '',
    });
  });

  await store.replaceData(data);
  return res.redirect('/parts?panel=request&success=' + encodeURIComponent(`Parts request sent to ${warehouse}.`));
});

router.post('/request-orders/:id/receive', async (req, res) => {
  const data = await store.getRawData();
  if (!Array.isArray(data.parts_request_transactions)) data.parts_request_transactions = [];
  const idx = data.parts_request_transactions.findIndex(row => row.id === req.params.id);
  if (idx === -1) {
    return res.redirect('/parts?panel=request&error=' + encodeURIComponent('Parts request transaction not found.'));
  }

  const row = data.parts_request_transactions[idx];
  if (String(row.status || '') === REQUEST_TX_STATUS_CLOSED) {
    return res.redirect('/parts?panel=request&success=' + encodeURIComponent('Request already marked Closed.'));
  }

  const user = req.session && req.session.user ? req.session.user : {};
  const receivedBy = String(user.username || '').trim();
  const receivedAt = new Date().toISOString();

  data.parts_request_transactions[idx] = Object.assign({}, row, {
    status: REQUEST_TX_STATUS_CLOSED,
    received_at: receivedAt,
    received_by: receivedBy,
  });

  const inventoryId = String(row.inventory_request_id || '').trim();
  if (inventoryId && Array.isArray(data.parts_inventory)) {
    const invIdx = data.parts_inventory.findIndex(p => p.id === inventoryId);
    if (invIdx !== -1) {
      data.parts_inventory[invIdx] = Object.assign({}, data.parts_inventory[invIdx], {
        request_status: 'received',
        received_at: receivedAt,
        received_by: receivedBy,
      });
    }
  }

  await store.replaceData(data);
  return res.redirect('/parts?panel=request&success=' + encodeURIComponent('Part received. Transaction marked Closed.'));
});

router.get('/export.csv', async (req, res) => {
  const data = await store.getRawData();
  const view = resolveScopedPartsView(req, data);
  const parts = view.isFrontline
    ? filterRowsByLocation(data.parts_inventory || [], view.location)
    : (data.parts_inventory || []);
  const { filtered } = filterPartsInventory(parts, req.query);
  const lines = [PARTS_REPORT_COLUMNS.map((col) => asCsvValue(col.header)).join(',')];
  filtered.forEach((part) => {
    lines.push(PARTS_REPORT_COLUMNS.map((col) => asCsvValue(partsReportCell(part, col))).join(','));
  });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="parts-database.csv"');
  return res.status(200).send(`\uFEFF${lines.join('\n')}`);
});

router.get('/export.xls', async (req, res) => {
  const data = await store.getRawData();
  const view = resolveScopedPartsView(req, data);
  const parts = view.isFrontline
    ? filterRowsByLocation(data.parts_inventory || [], view.location)
    : (data.parts_inventory || []);
  const { filtered } = filterPartsInventory(parts, req.query);
  const headerCells = PARTS_REPORT_COLUMNS
    .map((col) => `<Cell><Data ss:Type="String">${escapeXml(col.header)}</Data></Cell>`)
    .join('');
  const bodyRows = filtered.map((part) => {
    const cells = PARTS_REPORT_COLUMNS.map((col) => {
      const value = partsReportCell(part, col);
      const isNumber = columnLooksNumeric(col.key) && value !== '' && Number.isFinite(Number(value));
      return `<Cell><Data ss:Type="${isNumber ? 'Number' : 'String'}">${escapeXml(value)}</Data></Cell>`;
    }).join('');
    return `<Row>${cells}</Row>`;
  }).join('');
  const xml = [
    '<?xml version="1.0"?>',
    '<?mso-application progid="Excel.Sheet"?>',
    '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">',
    '<Worksheet ss:Name="Parts Database">',
    '<Table>',
    `<Row>${headerCells}</Row>`,
    bodyRows,
    '</Table>',
    '</Worksheet>',
    '</Workbook>',
  ].join('');
  res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="parts-database.xls"');
  return res.status(200).send(xml);
});

router.get('/export.pdf', async (req, res) => {
  const data = await store.getRawData();
  const view = resolveScopedPartsView(req, data);
  const parts = view.isFrontline
    ? filterRowsByLocation(data.parts_inventory || [], view.location)
    : (data.parts_inventory || []);
  const { filtered, q, filterType } = filterPartsInventory(parts, req.query);
  return res.render('parts/report', {
    parts: filtered,
    columns: PARTS_REPORT_COLUMNS,
    q,
    filterType,
    generatedAt: new Date().toISOString(),
  });
});

function columnLooksNumeric(key) {
  return key === 'qty' || key === 'cost_price' || key === 'markup' || key === 'retail_price';
}

function renderPartHistory(req, res, data, partNumber) {
  const startDate = String(req.query.startDate || '').trim();
  const endDate = String(req.query.endDate || '').trim();
  const groupBy = String(req.query.groupBy || '').trim();
  const sort = String(req.query.sort || 'asc').trim();
  const view = resolveScopedPartsView(req, data);
  const scopedData = view.isFrontline ? filterDataToLocation(data, view.location) : data;
  const result = inventory.getPartHistory(partNumber, { startDate, endDate, groupBy, sort }, scopedData);
  if (view.location) {
    const stockMap = stockByLocation(inventory.allAuditRows(data), view.location);
    result.on_hand = stockMap.get(inventory.normalizePartNumberKey(partNumber)) || 0;
  }
  return { result, startDate, endDate, groupBy, sort, partsView: view };
}

router.get('/api/history/:partNumber', async (req, res) => {
  const data = await store.getRawData();
  persistCatalogIfNeeded(data);
  const partNumber = decodeURIComponent(String(req.params.partNumber || '').trim());
  if (!partNumber) return res.status(400).json({ error: 'partNumber is required.' });
  const { result } = renderPartHistory(req, res, data, partNumber);
  return res.json({
    partNumber: result.part_number,
    onHand: result.on_hand,
    part: result.part,
    total: result.total,
    history: result.history,
    grouped: result.grouped || null,
  });
});

router.get('/history/:partNumber', async (req, res) => {
  const data = await store.getRawData();
  persistCatalogIfNeeded(data);
  const partNumber = decodeURIComponent(String(req.params.partNumber || '').trim());
  if (!partNumber) return res.redirect('/parts?error=Part+number+is+required.');
  const { result, startDate, endDate, groupBy, sort, partsView } = renderPartHistory(req, res, data, partNumber);
  return res.render('parts/history', {
    partNumber: result.part_number,
    onHand: result.on_hand,
    part: result.part,
    history: result.history,
    grouped: result.grouped || [],
    startDate,
    endDate,
    groupBy,
    sort,
    displayPartsTransactionType,
    normalizePartsTransactionType,
    partsView,
  });
});

router.get('/new', async (req, res) => {
  const data = await store.getRawData();
  const actorBranch = resolveActorBranch(req.session && req.session.user, data.employees);
  return res.render('parts/new', {
    transactionTypes: TRANSACTION_TYPES,
    locationOptions: buildPresentLocationOptions(data.branches),
    actorBranch,
    prefill: { present_location: actorBranch },
    displayPartsTransactionType,
    normalizePartsTransactionType,
    error: '',
  });
});

router.post('/', async (req, res) => {
  const body = req.body;
  const errors = [];

  const transaction_type = normalizePartsTransactionType(body.transaction_type);
  const part_number = String(body.part_number || '').trim();
  const part_name = String(body.part_name || '').trim();
  const qty = String(body.qty || '').trim();

  if (!isValidPartsTransactionType(transaction_type)) errors.push('Invalid transaction type.');
  if (!part_number) errors.push('Part Number is required.');
  if (!part_name) errors.push('Part Name is required.');
  if (qty === '' || isNaN(Number(qty))) errors.push('Qty must be a number.');

  if (errors.length) {
    const dataForForm = await store.getRawData();
    const actorBranch = resolveActorBranch(req.session && req.session.user, dataForForm.employees);
    return res.render('parts/new', {
      transactionTypes: TRANSACTION_TYPES,
      locationOptions: buildPresentLocationOptions(dataForForm.branches),
      actorBranch,
      prefill: Object.assign({}, body, { present_location: actorBranch }),
      displayPartsTransactionType,
      normalizePartsTransactionType,
      error: errors.join(' '),
    });
  }

  const costPrice = toNumber(body.cost_price);
  const markup = toNumber(body.markup);
  const retailPrice = body.retail_price !== undefined && String(body.retail_price).trim() !== ''
    ? toNumber(body.retail_price)
    : computeRetailPrice(costPrice, markup);

  const user = req.session && req.session.user ? req.session.user : {};
  const editor = String(user.username || '').trim();

  const unit = String(body.unit || '').trim();
  const data = await store.getRawData();
  if (!Array.isArray(data.parts_inventory)) data.parts_inventory = [];

  const record = {
    id: genId(),
    created_at: new Date().toISOString(),
    transaction_date: String(body.transaction_date || '').trim() || new Date().toISOString().slice(0, 10),
    transaction_number: allocatePartsTransactionNumber(data),
    transaction_type,
    present_location: resolveActorBranch(user, data.employees),
    editor,
    part_number,
    part_name,
    sub_id: String(body.sub_id || '').trim(),
    generic: String(body.generic || '').trim(),
    supplier: String(body.supplier || '').trim(),
    unit,
    qty: toNumber(qty),
    cost_price: costPrice,
    markup,
    retail_price: retailPrice,
    sold_to: String(body.sold_to || '').trim(),
  };

  if (isPartsRequestType(transaction_type) || transaction_type === TYPE_TRANSFER_REQUEST) {
    Object.assign(record, buildPartsRequestInventoryPayload({
      partNumber: part_number,
      partName: part_name,
      subId: record.sub_id,
      unit,
      qty: toNumber(qty),
      supplier: record.supplier,
      generic: record.generic,
      costPrice,
      markup,
      retailPrice,
      editor,
      requestingBranch: String(body.requesting_branch || user.branch || '').trim(),
      branch: String(body.branch || body.requesting_branch || user.branch || '').trim(),
      workOrderNumber: record.sold_to,
      workOrderId: String(body.work_order_id || '').trim(),
      transactionDate: record.transaction_date,
    }));
    record.transaction_type = transaction_type;
    // Preserve auto-generated auth number after payload merge
    record.transaction_number = record.transaction_number || allocatePartsTransactionNumber(data);
  }

  if (transaction_type === TYPE_RESTOCK) {
    const result = inventory.applyRestock(data, record);
    if (!result.ok) {
      const dataForForm = data;
      const actorBranch = resolveActorBranch(req.session && req.session.user, dataForForm.employees);
      return res.render('parts/new', {
        transactionTypes: TRANSACTION_TYPES,
        locationOptions: buildPresentLocationOptions(dataForForm.branches),
        actorBranch,
        prefill: Object.assign({}, body, { present_location: actorBranch }),
        displayPartsTransactionType,
        normalizePartsTransactionType,
        error: result.error,
      });
    }
    await store.replaceData(data);
    return res.redirect('/parts?success=Restock+saved.+On-hand+' + encodeURIComponent(String(result.on_hand)));
  }

  data.parts_inventory.push(record);
  inventory.rememberTransaction(data, record);
  await store.replaceData(data);

  return res.redirect('/parts?success=Part+entry+saved.');
});

router.get('/create', async (req, res) => {
  const data = await store.getRawData();
  if (persistCreatedPartsLedger(data)) {
    await store.replaceData(data);
  }
  const user = (req.session && req.session.user) || {};
  const actorBranch = resolveActorBranch(user, data.employees);
  return res.render('parts/create', {
    createdParts: attachEachRowLocationOnHand(listCreatedParts(data), inventory.allAuditRows(data)),
    branchOptions: createdPartsBranchOptions(data, actorBranch),
    actorBranch,
    warehouseLocation: WAREHOUSE_1,
    isSoldTransaction: inventory.isSoldTransaction,
    prefill: {
      transaction_date: new Date().toISOString().slice(0, 10),
      created_branch: actorBranch,
      qty: '',
    },
    error: req.query.error || '',
    success: req.query.success || '',
  });
});

router.post('/create', async (req, res) => {
  const body = req.body || {};
  const user = (req.session && req.session.user) || {};
  const data = await store.getRawData();
  inventory.ensureCollections(data);
  const actorBranch = resolveActorBranch(user, data.employees);
  const partName = String(body.part_name || '').trim();
  const createdBranch = canonicalizeBranchName(body.created_branch) || actorBranch;
  const partNumber = String(body.part_number || '').trim() || allocateCreatePartNumber(data);
  const costPrice = toNumber(body.cost_price);
  const markup = toNumber(body.markup);
  const retailPrice = String(body.retail_price || '').trim() !== ''
    ? toNumber(body.retail_price)
    : computeRetailPrice(costPrice, markup);
  const qtyRaw = String(body.qty || '').trim();
  const qty = qtyRaw === '' ? 0 : toNumber(qtyRaw);

  if (!partName) {
    return res.render('parts/create', {
      createdParts: attachEachRowLocationOnHand(listCreatedParts(data), inventory.allAuditRows(data)),
      branchOptions: createdPartsBranchOptions(data, createdBranch || actorBranch),
      actorBranch,
      warehouseLocation: WAREHOUSE_1,
      isSoldTransaction: inventory.isSoldTransaction,
      prefill: Object.assign({}, body, { created_branch: createdBranch || actorBranch }),
      error: 'Part Name is required.',
      success: '',
    });
  }

  const record = {
    id: genId(),
    created_at: new Date().toISOString(),
    created_via: CREATE_PARTS_SOURCE,
    created_branch: createdBranch,
    transaction_date: String(body.transaction_date || '').trim() || new Date().toISOString().slice(0, 10),
    transaction_number: allocatePartsTransactionNumber(data),
    transaction_type: TYPE_STOCK,
    present_location: createdBranch,
    branch: createdBranch,
    editor: String(user.username || '').trim(),
    part_number: partNumber,
    part_name: partName,
    sub_id: String(body.sub_id || '').trim(),
    generic: String(body.generic || '').trim(),
    supplier: String(body.supplier || '').trim(),
    unit: String(body.unit || '').trim(),
    qty,
    cost_price: costPrice,
    markup,
    retail_price: retailPrice,
    sold_to: '',
  };

  data.parts_inventory.push(record);
  syncCreatedPartTransaction(data, record);
  upsertWarehouseActivityLog(data, record);
  await store.replaceData(data);
  return res.redirect(`/parts/create?success=${encodeURIComponent(`Part ${partNumber} saved at ${createdBranch}. Transaction logged to Warehouse 1 and Parts Manager.`)}`);
});

router.get('/create/:id/edit', async (req, res) => {
  const data = await store.getRawData();
  const part = listCreatedParts(data).find((row) => String(row.id) === String(req.params.id));
  if (!part) return res.redirect('/parts/create?error=Created+part+not+found.');
  const soldLock = inventory.assertSoldRecordMutable(part);
  if (!soldLock.ok) return res.redirect('/parts/create?error=' + encodeURIComponent(soldLock.error));
  const user = (req.session && req.session.user) || {};
  const actorBranch = resolveActorBranch(user, data.employees);
  return res.render('parts/create-edit', {
    part,
    branchOptions: createdPartsBranchOptions(data, part.created_branch || actorBranch),
    warehouseLocation: WAREHOUSE_1,
    error: '',
  });
});

router.post('/create/:id/edit', async (req, res) => {
  const body = req.body || {};
  const data = await store.getRawData();
  inventory.ensureCollections(data);
  const idx = (data.parts_inventory || []).findIndex((row) => String(row.id) === String(req.params.id));
  if (idx === -1 || String(data.parts_inventory[idx].created_via || '').trim() !== CREATE_PARTS_SOURCE) {
    return res.redirect('/parts/create?error=Created+part+not+found.');
  }

  const existing = data.parts_inventory[idx];
  const soldLock = inventory.assertSoldRecordMutable(existing);
  if (!soldLock.ok) {
    return res.redirect('/parts/create?error=' + encodeURIComponent(soldLock.error));
  }

  const partName = String(body.part_name || '').trim();
  const user = (req.session && req.session.user) || {};
  const actorBranch = resolveActorBranch(user, data.employees);
  const createdBranch = canonicalizeBranchName(body.created_branch) || existing.created_branch || actorBranch;
  const partNumber = String(body.part_number || '').trim() || existing.part_number;
  const costPrice = toNumber(body.cost_price);
  const markup = toNumber(body.markup);
  const retailPrice = String(body.retail_price || '').trim() !== ''
    ? toNumber(body.retail_price)
    : computeRetailPrice(costPrice, markup);
  const qtyRaw = String(body.qty || '').trim();
  const qty = qtyRaw === '' ? toNumber(existing.qty) : toNumber(qtyRaw);

  if (!partName) {
    return res.render('parts/create-edit', {
      part: Object.assign({}, existing, body, { id: existing.id }),
      branchOptions: createdPartsBranchOptions(data, createdBranch),
      warehouseLocation: WAREHOUSE_1,
      error: 'Part Name is required.',
    });
  }

  const previousPartNumber = existing.part_number;
  data.parts_inventory[idx] = Object.assign({}, existing, {
    created_via: CREATE_PARTS_SOURCE,
    created_branch: createdBranch,
    transaction_date: String(body.transaction_date || '').trim() || existing.transaction_date,
    present_location: createdBranch,
    branch: createdBranch,
    part_number: partNumber,
    part_name: partName,
    sub_id: String(body.sub_id || '').trim(),
    generic: String(body.generic || '').trim(),
    supplier: String(body.supplier || '').trim(),
    unit: String(body.unit || '').trim(),
    qty,
    cost_price: costPrice,
    markup,
    retail_price: retailPrice,
    editor: String(user.username || existing.editor || '').trim(),
    updated_at: new Date().toISOString(),
  });

  syncCreatedPartTransaction(data, data.parts_inventory[idx]);
  upsertWarehouseActivityLog(data, data.parts_inventory[idx]);
  if (previousPartNumber && previousPartNumber !== partNumber) {
    inventory.rebuildPartCatalogEntry(data, previousPartNumber);
  }
  await store.replaceData(data);
  return res.redirect(`/parts/create?success=${encodeURIComponent(`Part ${partNumber} updated.`)}`);
});

router.get('/:id/edit', async (req, res) => {
  const data = await store.getRawData();
  persistCatalogIfNeeded(data);
  const part = (data.parts_inventory || []).find(p => p.id === req.params.id);
  if (!part) return res.redirect('/parts?error=Record+not+found.');
  const soldLock = inventory.assertSoldRecordMutable(part);
  if (!soldLock.ok) return res.redirect('/parts?error=' + encodeURIComponent(soldLock.error));
  const mutate = assertFrontlineCanMutate(req, data, part);
  if (!mutate.ok) return res.redirect('/parts?error=' + encodeURIComponent(mutate.error));

  return res.render('parts/edit', {
    transactionTypes: TRANSACTION_TYPES,
    locationOptions: buildPresentLocationOptions(data.branches),
    actorBranch: resolveActorBranch(req.session && req.session.user, data.employees),
    part,
    onHand: inventory.getOnHand(data, part.part_number),
    displayPartsTransactionType,
    normalizePartsTransactionType,
    error: req.query.error || '',
    success: req.query.success || '',
  });
});

router.post('/:id/edit', async (req, res) => {
  const body = req.body;
  const errors = [];

  const transaction_type = normalizePartsTransactionType(body.transaction_type);
  const part_number = String(body.part_number || '').trim();
  const part_name = String(body.part_name || '').trim();
  const qty = String(body.qty || '').trim();

  if (!isValidPartsTransactionType(transaction_type)) errors.push('Invalid transaction type.');
  if (!part_number) errors.push('Part Number is required.');
  if (!part_name) errors.push('Part Name is required.');
  if (qty === '' || isNaN(Number(qty))) errors.push('Qty must be a number.');

  const data = await store.getRawData();
  const idx = data.parts_inventory.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.redirect('/parts?error=Record+not+found.');
  const soldLock = inventory.assertSoldRecordMutable(data.parts_inventory[idx]);
  if (!soldLock.ok) return res.redirect('/parts?error=' + encodeURIComponent(soldLock.error));
  const mutate = assertFrontlineCanMutate(req, data, data.parts_inventory[idx]);
  if (!mutate.ok) return res.redirect('/parts?error=' + encodeURIComponent(mutate.error));

  if (errors.length) {
    return res.render('parts/edit', {
      transactionTypes: TRANSACTION_TYPES,
      locationOptions: buildPresentLocationOptions(data.branches),
      part: Object.assign({}, data.parts_inventory[idx], body, { id: req.params.id }),
      onHand: inventory.getOnHand(data, part_number || data.parts_inventory[idx].part_number),
      displayPartsTransactionType,
      normalizePartsTransactionType,
      error: errors.join(' '),
      success: '',
    });
  }

  const costPrice = toNumber(body.cost_price);
  const markup = toNumber(body.markup);
  const retailPrice = body.retail_price !== undefined && String(body.retail_price).trim() !== ''
    ? toNumber(body.retail_price)
    : computeRetailPrice(costPrice, markup);

  const unit = String(body.unit || '').trim();
  const existingTransactionNumber = String(data.parts_inventory[idx].transaction_number || '').trim()
    || allocatePartsTransactionNumber(data);

  data.parts_inventory[idx] = Object.assign({}, data.parts_inventory[idx], {
    transaction_date: String(body.transaction_date || '').trim(),
    transaction_number: existingTransactionNumber,
    transaction_type,
    present_location: currentPresentLocation(data.parts_inventory[idx]) || resolveActorBranch(
      (req.session && req.session.user) || {},
      data.employees
    ),
    part_number,
    part_name,
    sub_id: String(body.sub_id || '').trim(),
    generic: String(body.generic || '').trim(),
    supplier: String(body.supplier || '').trim(),
    unit,
    qty: toNumber(qty),
    cost_price: costPrice,
    markup,
    retail_price: retailPrice,
    sold_to: String(body.sold_to || '').trim(),
  });

  if (isPartsRequestType(transaction_type)) {
    const user = req.session && req.session.user ? req.session.user : {};
    Object.assign(data.parts_inventory[idx], buildPartsRequestInventoryPayload({
      partNumber: part_number,
      partName: part_name,
      subId: data.parts_inventory[idx].sub_id,
      unit,
      qty: toNumber(qty),
      supplier: data.parts_inventory[idx].supplier,
      generic: data.parts_inventory[idx].generic,
      costPrice,
      markup,
      retailPrice,
      editor: String(user.username || data.parts_inventory[idx].editor || '').trim(),
      requestingBranch: String(body.requesting_branch || data.parts_inventory[idx].requesting_branch || user.branch || '').trim(),
      branch: String(body.branch || body.requesting_branch || data.parts_inventory[idx].branch || user.branch || '').trim(),
      workOrderNumber: String(body.sold_to || data.parts_inventory[idx].sold_to || '').trim(),
      workOrderId: String(body.work_order_id || data.parts_inventory[idx].work_order_id || '').trim(),
      transactionDate: String(body.transaction_date || '').trim(),
    }));
    if (!String(data.parts_inventory[idx].request_status || '').trim()) {
      data.parts_inventory[idx].request_status = 'pending';
    }
  }
  inventory.rememberTransaction(data, data.parts_inventory[idx]);
  await store.replaceData(data);
  return res.redirect('/parts?success=Part+entry+updated.');
});

router.post('/:id/restock', async (req, res) => {
  const data = await store.getRawData();
  const source = (data.parts_inventory || []).find(p => p.id === req.params.id);
  if (!source) {
    return res.redirect('/parts?error=Source+part+record+not+found.');
  }
  const mutate = assertFrontlineCanMutate(req, data, source);
  if (!mutate.ok) return res.redirect('/parts?error=' + encodeURIComponent(mutate.error));

  const restockQty = toNumber(req.body.restock_qty);
  if (!Number.isFinite(restockQty) || restockQty <= 0) {
    return res.redirect(`/parts/${req.params.id}/edit?error=Restock+quantity+must+be+greater+than+zero.`);
  }

  const transactionDate = String(req.body.restock_date || '').trim() || new Date().toISOString().slice(0, 10);
  const editor = String(req.session && req.session.user ? req.session.user.username : '').trim();

  const restockRecord = {
    id: genId(),
    created_at: new Date().toISOString(),
    transaction_date: transactionDate,
    transaction_number: allocatePartsTransactionNumber(data),
    transaction_type: TYPE_RESTOCK,
    present_location: resolveActorBranch(req.session && req.session.user, data.employees),
    editor,
    part_number: String(source.part_number || '').trim(),
    part_name: String(source.part_name || '').trim(),
    sub_id: String(source.sub_id || '').trim(),
    generic: String(source.generic || '').trim(),
    supplier: String(source.supplier || '').trim(),
    unit: String(source.unit || '').trim(),
    qty: restockQty,
    cost_price: toNumber(req.body.cost_price !== undefined ? req.body.cost_price : source.cost_price),
    markup: toNumber(req.body.markup !== undefined ? req.body.markup : source.markup),
    retail_price: toNumber(req.body.retail_price !== undefined ? req.body.retail_price : source.retail_price),
    sold_to: '',
  };

  const result = inventory.applyRestock(data, restockRecord);
  if (!result.ok) {
    return res.redirect(`/parts/${req.params.id}/edit?error=${encodeURIComponent(result.error)}`);
  }
  await store.replaceData(data);
  return res.redirect(`/parts/${req.params.id}/edit?success=Restock+saved+for+${encodeURIComponent(restockRecord.part_number)}.+On-hand+${encodeURIComponent(String(result.on_hand))}.`);
});

router.post('/:id/delete', async (req, res) => {
  const data = await store.getRawData();
  const idx = data.parts_inventory.findIndex(p => p.id === req.params.id);
  if (idx !== -1) {
    const removed = data.parts_inventory[idx];
    const soldLock = inventory.assertSoldRecordMutable(removed);
    if (!soldLock.ok) return res.redirect('/parts?error=' + encodeURIComponent(soldLock.error));
    const mutate = assertFrontlineCanMutate(req, data, removed);
    if (!mutate.ok) return res.redirect('/parts?error=' + encodeURIComponent(mutate.error));
    inventory.rememberTransaction(data, removed);
    data.parts_inventory.splice(idx, 1);
    inventory.rebuildPartCatalogEntry(data, removed.part_number);
    await store.replaceData(data);
  }
  return res.redirect('/parts?success=Dashboard+entry+removed.+Audit+history+was+kept.');
});

module.exports = router;
module.exports.persistCreatedPartsLedger = persistCreatedPartsLedger;
