const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const store = require('../data/store');
const {
  isPendingPartsRequest,
  mapInventoryPartsRequest,
  mapLegacyPartsRequest,
  affectsStock,
  TYPE_RESTOCK,
  TYPE_SOLD,
  TYPE_TRANSFER_REQUEST,
  VALID_PARTS_TRANSACTION_TYPES,
  isValidPartsTransactionType,
  normalizePartsTransactionType,
  displayPartsTransactionType,
} = require('../lib/parts-request');
const {
  APPROVED_RECEIPTS_DIR,
  buildApprovedTransactionRecord,
  saveApprovedReceipt,
} = require('../lib/approved-parts-receipt');
const { allocatePartsTransactionNumber } = require('../lib/parts-transaction-number');
const inventory = require('../lib/parts-inventory-controller');
const { WAREHOUSE_1, sameLocation } = require('../lib/parts-location-scope');
const { buildSortedDatabaseCsv, importPartsCsv } = require('../lib/parts-csv-sync');
const {
  pmLocationOptions,
  buildPmVitals,
  buildPmApprovals,
} = require('../lib/pm-workspace');
const {
  stampNow,
  allocateTransferNumbers,
  allocatePurchaseOrderNumbers,
  rememberDocument,
} = require('../lib/parts-document-serial');
const {
  buildPackingListHtml,
  buildTransmittalHtml,
  buildPurchaseOrderHtml,
} = require('../lib/pm-documents');

const router = express.Router();

const PM_ROLES = new Set(['parts_manager', 'pm']);
const SUPERVISOR_ROLES = new Set(['general_manager']);
const BRANCHES = ['Carx2', 'Carmen', 'CebuCity', 'Lapux2', 'Bogo', 'Toledo', 'ITPark'];
const LOW_STOCK_THRESHOLD = 5;

function isPartsManagerRole(role) {
  return PM_ROLES.has(String(role || '').trim().toLowerCase());
}

function canAccessPartsManagerWorkspace(role) {
  const normalized = String(role || '').trim().toLowerCase();
  return isPartsManagerRole(normalized) || SUPERVISOR_ROLES.has(normalized);
}

function requirePmSession(req, res, next) {
  if (canAccessPartsManagerWorkspace(req.session?.user?.role)) return next();
  return res.status(403).send('Parts Manager access only.');
}

router.use(requirePmSession);

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function computeRetailPrice(costPrice, markup) {
  const cost = toNumber(costPrice);
  const pct = toNumber(markup);
  return Number((cost + cost * (pct / 100)).toFixed(2));
}

function normalizeBranchKey(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function resolveBranch(value) {
  const key = normalizeBranchKey(value);
  if (sameLocation(value, WAREHOUSE_1)) return WAREHOUSE_1;
  return BRANCHES.find((branch) => normalizeBranchKey(branch) === key) || '';
}

function resolvePmLocation(value, data) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (sameLocation(raw, WAREHOUSE_1)) return WAREHOUSE_1;
  const options = pmLocationOptions(data);
  return options.find((name) => normalizeBranchKey(name) === normalizeBranchKey(raw)) || raw;
}

function currentEditor(req) {
  return String(req.session?.user?.username || '').trim();
}

function filterPartsInventory(parts, query) {
  const q = String((query && query.q) || '').trim().toLowerCase();
  const filterType = String((query && query.type) || '').trim();
  const location = String((query && query.location) || '').trim();
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
  if (location && location.toLowerCase() !== 'all') {
    filtered = filtered.filter((p) => sameLocation(p.present_location || p.branch || p.requesting_branch, location));
  }
  return { filtered, q, filterType, location };
}

function parseLines(body) {
  const raw = body && body.lines;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed
          .map((line) => ({
            part_number: String(line.part_number || '').trim(),
            part_name: String(line.part_name || '').trim(),
            sub_id: String(line.sub_id || '').trim(),
            qty: toNumber(line.qty),
            unit: String(line.unit || '').trim(),
            cost_price: toNumber(line.cost_price),
            retail_price: toNumber(line.retail_price),
            supplier: String(line.supplier || '').trim(),
          }))
          .filter((line) => line.part_number && line.qty > 0);
      }
    } catch (_) {
      // fall through to single-line fields
    }
  }
  const partNumber = String((body && body.part_number) || '').trim();
  const qty = toNumber(body && body.qty);
  if (!partNumber || qty <= 0) return [];
  return [{
    part_number: partNumber,
    part_name: String((body && body.part_name) || '').trim(),
    sub_id: String((body && body.sub_id) || '').trim(),
    qty,
    unit: String((body && body.unit) || '').trim(),
    cost_price: toNumber(body && body.cost_price),
    retail_price: toNumber(body && body.retail_price),
    supplier: String((body && body.supplier) || '').trim(),
  }];
}

function renderWorkspace(res, locals = {}) {
  return res.render('parts-manager/workspace', locals);
}

async function loadWorkspaceLocals(req) {
  const data = await store.getRawData();
  inventory.ensureCollections(data);
  const dashboardLogs = inventory.getDashboardLogs(data);
  const { filtered, q, filterType, location } = filterPartsInventory(dashboardLogs, req.query);
  const viewRows = inventory.attachOnHand(data, filtered);
  const locationOptions = pmLocationOptions(data);
  const vitals = buildPmVitals(data);
  const approvals = buildPmApprovals(data);

  return {
    parts: viewRows,
    total: viewRows.length,
    q,
    filterType,
    locationFilter: location,
    transactionTypes: VALID_PARTS_TRANSACTION_TYPES,
    displayPartsTransactionType,
    normalizePartsTransactionType,
    locationOptions,
    warehouse1: WAREHOUSE_1,
    vitals,
    approvals,
    partsView: {
      isFrontline: false,
      scope: 'all',
      readOnly: false,
      label: 'All branches + Warehouse 1 General Parts Database',
      location: '',
    },
    error: req.query.error || '',
    success: req.query.success || '',
    openPanel: String(req.query.panel || '').trim(),
  };
}

function aggregateStock(inventoryRows) {
  const stockByPart = new Map();
  const metaByPart = new Map();

  for (const row of inventoryRows) {
    const partNumber = inventory.normalizePartNumberKey(row.part_number) || String(row.part_number || '').trim() || '__unknown';
    const type = String(row.transaction_type || '').trim().toLowerCase();
    const qty = Math.max(0, toNumber(row.qty));
    if (row.activity_log === true || String(row.created_via || '').trim() === 'create-parts-log') continue;
    const stockEffect = affectsStock(type, row);
    if (stockEffect !== 'increase') continue;

    if (!stockByPart.has(partNumber)) stockByPart.set(partNumber, 0);
    stockByPart.set(partNumber, stockByPart.get(partNumber) + qty);

    if (!metaByPart.has(partNumber)) {
      metaByPart.set(partNumber, {
        part_number: partNumber,
        part_name: row.part_name || '',
        sub_id: row.sub_id || '',
        supplier: row.supplier || '',
        cost_price: row.cost_price,
        retail_price: row.retail_price,
        markup: row.markup,
      });
    }
    const meta = metaByPart.get(partNumber);
    if (!meta.part_name && row.part_name) meta.part_name = row.part_name;
    if (!meta.sub_id && row.sub_id) meta.sub_id = row.sub_id;
    if (row.supplier) meta.supplier = row.supplier;
    if (row.cost_price != null) meta.cost_price = row.cost_price;
    if (row.retail_price != null) meta.retail_price = row.retail_price;
    if (row.markup != null) meta.markup = row.markup;
  }

  return { stockByPart, metaByPart };
}

async function buildOverview() {
  const [inventoryRows, purchaseOrders, partsRequests] = await Promise.all([
    store.getAll('parts_inventory'),
    store.getAll('parts_purchase_orders'),
    store.getAll('parts_requests'),
  ]);

  const { stockByPart, metaByPart } = aggregateStock(inventoryRows);

  const lowStockAlerts = Array.from(stockByPart.entries())
    .map(([partNumber, qty]) => ({
      part_number: partNumber,
      part_name: metaByPart.get(partNumber)?.part_name || '',
      sub_id: metaByPart.get(partNumber)?.sub_id || '',
      supplier: metaByPart.get(partNumber)?.supplier || '',
      qty,
    }))
    .filter((entry) => entry.qty <= LOW_STOCK_THRESHOLD)
    .sort((a, b) => a.qty - b.qty);

  const pendingPOs = purchaseOrders
    .filter((po) => String(po.status || '').trim().toLowerCase() === 'pending');

  const recentMovements = [...inventoryRows]
    .sort((a, b) => new Date(b.created_at || b.transaction_date || 0) - new Date(a.created_at || a.transaction_date || 0))
    .slice(0, 50)
    .map((row) => ({
      id: row.id,
      transaction_date: row.transaction_date || '',
      transaction_type: row.transaction_type || '',
      part_number: row.part_number || '',
      part_name: row.part_name || '',
      sub_id: row.sub_id || '',
      supplier: row.supplier || '',
      qty: row.qty,
      editor: row.editor || '',
    }));

  const pendingFromInventory = inventoryRows
    .filter(isPendingPartsRequest)
    .map(mapInventoryPartsRequest);

  const pendingFromLegacy = partsRequests
    .filter((req) => String(req.status || '').trim().toLowerCase() === 'pending')
    .map(mapLegacyPartsRequest);

  const pendingPartsRequests = [...pendingFromInventory, ...pendingFromLegacy]
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

  return { lowStockAlerts, pendingPOs, recentMovements, pendingPartsRequests, stockByPart: Object.fromEntries(stockByPart) };
}

async function finalizeApprovedRequest(sourceRequest, resolver) {
  const data = await store.getRawData();
  const payload = buildApprovedTransactionRecord(sourceRequest, resolver, data);
  const record = await store.create('parts_inventory', payload);
  const receipt = await saveApprovedReceipt(record, sourceRequest);
  const fresh = await store.getRawData();
  rememberDocument(fresh, {
    kind: 'receipt',
    serial: record.transaction_number,
    transaction_number: record.transaction_number,
    related_id: record.id,
    created_by: resolver,
    title: 'Approved Parts Receipt',
  });
  await store.replaceData(fresh);
  return { record, receipt };
}

function findTransfer(data, id) {
  return (data.parts_transfers || []).find((row) => String(row.id) === String(id)) || null;
}

function findPurchaseOrder(data, id) {
  return (data.parts_purchase_orders || []).find((row) => String(row.id) === String(id)) || null;
}

router.get('/approved-receipts/:filename', async (req, res) => {
  const filename = path.basename(String(req.params.filename || '').trim());
  if (!filename || !filename.endsWith('.html')) {
    return res.status(400).send('Invalid receipt file.');
  }

  const filepath = path.join(APPROVED_RECEIPTS_DIR, filename);
  try {
    const html = await fs.readFile(filepath, 'utf8');
    return res.type('html').send(html);
  } catch (error) {
    return res.status(404).send('Receipt not found.');
  }
});

router.get('/', async (req, res) => {
  return renderWorkspace(res, await loadWorkspaceLocals(req));
});

router.get('/dashboard', (req, res) => res.redirect('/parts-manager'));
router.get('/inventory', (req, res) => res.redirect('/parts-manager?panel=edit'));
router.get('/branch-reports', (req, res) => res.redirect('/parts-manager?panel=vitals'));
router.get('/suppliers', (req, res) => res.redirect('/parts-manager?panel=approvals'));
router.get('/transfer', (req, res) => res.redirect('/parts-manager?panel=approvals'));

router.get('/export.csv', async (req, res) => {
  const data = await store.getRawData();
  const file = buildSortedDatabaseCsv(data);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
  return res.status(200).send(file.csv);
});

router.post('/csv-import', async (req, res) => {
  const importMode = String(req.body.import_mode || 'integrate').toLowerCase() === 'replace' ? 'replace' : 'integrate';
  const csvPayload = String(req.body.import_csv || '');
  if (!csvPayload.trim()) {
    return res.redirect('/parts-manager?panel=csv&error=' + encodeURIComponent('Paste or upload a CSV file first.'));
  }

  try {
    const backupPath = await store.backupData();
    const data = await store.getRawData();
    const result = await importPartsCsv(data, csvPayload, importMode, currentEditor(req));
    if (!result.ok) {
      return res.redirect('/parts-manager?panel=csv&error=' + encodeURIComponent(result.error));
    }
    await store.replaceData(data);
    const note = importMode === 'replace'
      ? `Replaced P-db with ${result.created} CSV rows.`
      : `Integrated CSV: ${result.created} new, ${result.updated} updated.`;
    return res.redirect('/parts-manager?panel=csv&success=' + encodeURIComponent(`${note} Backup saved.`));
  } catch (error) {
    return res.redirect('/parts-manager?panel=csv&error=' + encodeURIComponent(error.message || 'CSV import failed.'));
  }
});

router.post('/parts/:id/edit', async (req, res) => {
  const body = req.body;
  const data = await store.getRawData();
  const idx = (data.parts_inventory || []).findIndex((p) => String(p.id) === String(req.params.id));
  if (idx === -1) {
    return res.redirect('/parts-manager?panel=edit&error=' + encodeURIComponent('Record not found.'));
  }

  const transaction_type = normalizePartsTransactionType(body.transaction_type);
  const part_number = String(body.part_number || '').trim();
  const part_name = String(body.part_name || '').trim();
  const qty = String(body.qty || '').trim();
  const present_location = resolvePmLocation(body.present_location, data) || WAREHOUSE_1;

  if (!isValidPartsTransactionType(transaction_type) || !part_number || !part_name || qty === '' || isNaN(Number(qty))) {
    return res.redirect('/parts-manager?panel=edit&error=' + encodeURIComponent('Part number, name, type, and qty are required.'));
  }

  const costPrice = toNumber(body.cost_price);
  const markup = toNumber(body.markup);
  const retailPrice = body.retail_price !== undefined && String(body.retail_price).trim() !== ''
    ? toNumber(body.retail_price)
    : computeRetailPrice(costPrice, markup);
  const existingTransactionNumber = String(data.parts_inventory[idx].transaction_number || '').trim()
    || allocatePartsTransactionNumber(data);

  data.parts_inventory[idx] = Object.assign({}, data.parts_inventory[idx], {
    transaction_date: String(body.transaction_date || '').trim() || new Date().toISOString().slice(0, 10),
    transaction_number: existingTransactionNumber,
    transaction_type,
    present_location,
    branch: present_location,
    editor: currentEditor(req) || data.parts_inventory[idx].editor,
    part_number,
    part_name,
    sub_id: String(body.sub_id || '').trim(),
    generic: String(body.generic || '').trim(),
    supplier: String(body.supplier || '').trim(),
    unit: String(body.unit || '').trim(),
    qty: toNumber(qty),
    cost_price: costPrice,
    markup,
    retail_price: retailPrice,
    sold_to: String(body.sold_to || '').trim(),
    updated_at: new Date().toISOString(),
  });

  inventory.rememberTransaction(data, data.parts_inventory[idx]);
  await store.replaceData(data);
  return res.redirect('/parts-manager?panel=edit&success=' + encodeURIComponent(`Updated ${part_number} at ${present_location}.`));
});

router.post('/parts/:id/delete', async (req, res) => {
  const data = await store.getRawData();
  const idx = (data.parts_inventory || []).findIndex((p) => String(p.id) === String(req.params.id));
  if (idx !== -1) {
    const removed = data.parts_inventory[idx];
    inventory.rememberTransaction(data, removed);
    data.parts_inventory.splice(idx, 1);
    inventory.rebuildPartCatalogEntry(data, removed.part_number);
    await store.replaceData(data);
  }
  return res.redirect('/parts-manager?success=' + encodeURIComponent('Dashboard entry removed. Audit history was kept.'));
});

router.get('/print/packing/:id', async (req, res) => {
  const data = await store.getRawData();
  const record = findTransfer(data, req.params.id);
  if (!record) return res.status(404).send('Transfer not found.');
  return res.type('html').send(buildPackingListHtml(record));
});

router.get('/print/transmittal/:id', async (req, res) => {
  const data = await store.getRawData();
  const record = findTransfer(data, req.params.id);
  if (!record) return res.status(404).send('Transfer not found.');
  return res.type('html').send(buildTransmittalHtml(record));
});

router.get('/print/po/:id', async (req, res) => {
  const data = await store.getRawData();
  const record = findPurchaseOrder(data, req.params.id);
  if (!record) return res.status(404).send('Purchase order not found.');
  return res.type('html').send(buildPurchaseOrderHtml(record));
});

router.post('/transfer', async (req, res) => {
  const data = await store.getRawData();
  const fromBranch = resolvePmLocation(req.body.from_branch, data);
  const toBranch = resolvePmLocation(req.body.to_branch, data);
  const lines = parseLines(req.body);
  const editor = currentEditor(req);

  if (!fromBranch || !toBranch || fromBranch === toBranch) {
    return res.redirect('/parts-manager?panel=approvals&error=' + encodeURIComponent('Select distinct source and destination locations.'));
  }
  if (!lines.length) {
    return res.redirect('/parts-manager?panel=approvals&error=' + encodeURIComponent('Part number and quantity are required.'));
  }

  if (!Array.isArray(data.parts_transfers)) data.parts_transfers = [];
  if (!Array.isArray(data.parts_inventory)) data.parts_inventory = [];

  const stamp = stampNow();
  const numbers = allocateTransferNumbers(data);
  const first = lines[0];
  const transfer = {
    id: genId(),
    created_at: stamp.iso,
    stamped_at: stamp.iso,
    stamped_label: stamp.label,
    from_branch: fromBranch,
    to_branch: toBranch,
    part_number: first.part_number,
    part_name: first.part_name,
    sub_id: first.sub_id,
    qty: first.qty,
    unit: first.unit,
    lines,
    status: 'pending',
    editor,
    transaction_number: numbers.transaction_number,
    packing_list_number: numbers.packing_list_number,
    transmittal_number: numbers.transmittal_number,
  };
  data.parts_transfers.push(transfer);

  lines.forEach((line) => {
    const row = {
      id: genId(),
      created_at: stamp.iso,
      transaction_date: stamp.date,
      transaction_number: allocatePartsTransactionNumber(data),
      transaction_type: TYPE_TRANSFER_REQUEST,
      present_location: fromBranch,
      branch: fromBranch,
      editor,
      part_number: line.part_number,
      part_name: line.part_name,
      sub_id: line.sub_id,
      qty: line.qty,
      unit: line.unit,
      sold_to: toBranch,
      linked_transfer_id: transfer.id,
    };
    data.parts_inventory.push(row);
    inventory.rememberTransaction(data, row);
  });

  rememberDocument(data, {
    kind: 'packing_list',
    serial: transfer.packing_list_number,
    transaction_number: transfer.transaction_number,
    related_id: transfer.id,
    created_by: editor,
    title: 'Packing List',
    from_branch: fromBranch,
    to_branch: toBranch,
  });
  rememberDocument(data, {
    kind: 'transmittal',
    serial: transfer.transmittal_number,
    transaction_number: transfer.transaction_number,
    related_id: transfer.id,
    created_by: editor,
    title: 'Transmittal List',
    from_branch: fromBranch,
    to_branch: toBranch,
  });

  await store.replaceData(data);
  return res.redirect('/parts-manager?panel=approvals&success=' + encodeURIComponent(`Transfer ${transfer.transaction_number} filed.`));
});

router.post('/purchase-orders', async (req, res) => {
  const data = await store.getRawData();
  const supplier = String(req.body.supplier || '').trim();
  if (!supplier) {
    return res.redirect('/parts-manager?panel=approvals&error=' + encodeURIComponent('Supplier is required.'));
  }
  const stamp = stampNow();
  const numbers = allocatePurchaseOrderNumbers(data);
  const location = resolvePmLocation(req.body.branch, data) || WAREHOUSE_1;
  const lines = parseLines(req.body);
  if (!Array.isArray(data.parts_purchase_orders)) data.parts_purchase_orders = [];
  const po = {
    id: genId(),
    created_at: stamp.iso,
    stamped_at: stamp.iso,
    stamped_label: stamp.label,
    supplier,
    branch: location,
    present_location: location,
    status: 'pending',
    notes: String(req.body.notes || '').trim(),
    created_by: currentEditor(req),
    transaction_number: numbers.transaction_number,
    po_number: numbers.po_number,
    lines,
    part_number: lines[0] ? lines[0].part_number : '',
    part_name: lines[0] ? lines[0].part_name : '',
    qty: lines[0] ? lines[0].qty : 0,
  };
  data.parts_purchase_orders.push(po);
  rememberDocument(data, {
    kind: 'purchase_order',
    serial: po.po_number,
    transaction_number: po.transaction_number,
    related_id: po.id,
    created_by: po.created_by,
    title: 'Purchase Order',
  });
  await store.replaceData(data);
  return res.redirect('/parts-manager?panel=approvals&success=' + encodeURIComponent(`PO ${po.po_number} created.`));
});

router.post('/api/transfers/:id/complete', async (req, res) => {
  const data = await store.getRawData();
  const transfer = findTransfer(data, req.params.id);
  if (!transfer) return res.status(404).json({ error: 'Transfer not found.' });
  if (String(transfer.status || '').toLowerCase() === 'completed') {
    return res.json({ ok: true, transfer });
  }

  const stamp = stampNow();
  const editor = currentEditor(req);
  const lines = Array.isArray(transfer.lines) && transfer.lines.length
    ? transfer.lines
    : [{
      part_number: transfer.part_number,
      part_name: transfer.part_name,
      sub_id: transfer.sub_id,
      qty: transfer.qty,
      unit: transfer.unit,
    }];

  lines.forEach((line) => {
    const outRow = {
      id: genId(),
      created_at: stamp.iso,
      transaction_date: stamp.date,
      transaction_number: allocatePartsTransactionNumber(data),
      transaction_type: TYPE_SOLD,
      present_location: transfer.from_branch,
      branch: transfer.from_branch,
      editor,
      part_number: line.part_number,
      part_name: line.part_name,
      sub_id: line.sub_id,
      qty: toNumber(line.qty),
      unit: line.unit || '',
      sold_to: `Transfer ${transfer.transaction_number}`,
      linked_transfer_id: transfer.id,
    };
    const inRow = {
      id: genId(),
      created_at: stamp.iso,
      transaction_date: stamp.date,
      transaction_number: allocatePartsTransactionNumber(data),
      transaction_type: TYPE_RESTOCK,
      present_location: transfer.to_branch,
      branch: transfer.to_branch,
      editor,
      part_number: line.part_number,
      part_name: line.part_name,
      sub_id: line.sub_id,
      qty: toNumber(line.qty),
      unit: line.unit || '',
      sold_to: '',
      linked_transfer_id: transfer.id,
    };
    data.parts_inventory.push(outRow, inRow);
    inventory.rememberTransaction(data, outRow);
    inventory.rememberTransaction(data, inRow);
  });

  transfer.status = 'completed';
  transfer.completed_at = stamp.iso;
  transfer.completed_by = editor;
  transfer.stamped_at = stamp.iso;
  transfer.stamped_label = stamp.label;
  await store.replaceData(data);
  return res.json({ ok: true, transfer });
});

router.post('/api/purchase-orders/:id/receive', async (req, res) => {
  const data = await store.getRawData();
  const po = findPurchaseOrder(data, req.params.id);
  if (!po) return res.status(404).json({ error: 'Purchase order not found.' });

  const stamp = stampNow();
  const editor = currentEditor(req);
  const location = po.branch || po.present_location || WAREHOUSE_1;
  const lines = Array.isArray(po.lines) && po.lines.length
    ? po.lines
    : [{
      part_number: po.part_number,
      part_name: po.part_name,
      qty: po.qty,
      supplier: po.supplier,
    }];

  lines.forEach((line) => {
    if (!line.part_number || toNumber(line.qty) <= 0) return;
    const row = {
      id: genId(),
      created_at: stamp.iso,
      transaction_date: stamp.date,
      transaction_number: allocatePartsTransactionNumber(data),
      transaction_type: TYPE_RESTOCK,
      present_location: location,
      branch: location,
      editor,
      part_number: line.part_number,
      part_name: line.part_name || '',
      sub_id: line.sub_id || '',
      supplier: line.supplier || po.supplier,
      qty: toNumber(line.qty),
      unit: line.unit || '',
      cost_price: toNumber(line.cost_price),
      retail_price: toNumber(line.retail_price),
      sold_to: '',
      linked_po_id: po.id,
    };
    data.parts_inventory.push(row);
    inventory.rememberTransaction(data, row);
  });

  po.status = 'received';
  po.received_at = stamp.iso;
  po.received_by = editor;
  po.stamped_at = stamp.iso;
  po.stamped_label = stamp.label;
  await store.replaceData(data);
  return res.json({ ok: true, po });
});

router.get('/api/overview', async (req, res) => {
  return res.json(await buildOverview());
});

router.get('/api/workspace', async (req, res) => {
  const data = await store.getRawData();
  return res.json({
    vitals: buildPmVitals(data),
    approvals: buildPmApprovals(data),
  });
});

router.get('/api/parts/:id', async (req, res) => {
  const part = await store.getById('parts_inventory', req.params.id);
  if (!part) return res.status(404).json({ error: 'Record not found.' });
  return res.json(part);
});

router.get('/api/branch-reports', async (req, res) => {
  const branch = resolveBranch(req.query.branch);
  if (!branch) return res.status(400).json({ error: 'Invalid branch.' });

  const inventoryRows = await store.getAll('parts_inventory');
  const branchKey = normalizeBranchKey(branch);
  const rows = inventoryRows.filter((row) => normalizeBranchKey(row.branch) === branchKey);

  return res.json({ branch, rows, total: rows.length });
});

router.get('/api/suppliers', async (req, res) => {
  const [suppliers, purchaseOrders, inventoryRows] = await Promise.all([
    store.getAll('parts_suppliers'),
    store.getAll('parts_purchase_orders'),
    store.getAll('parts_inventory'),
  ]);
  return res.json({ suppliers, purchaseOrders, billingHistory: inventoryRows.filter((row) => row.supplier).slice(-20) });
});

router.post('/api/stock-adjust', async (req, res) => {
  const partNumber = String(req.body.part_number || '').trim();
  const delta = toNumber(req.body.delta);
  const editor = currentEditor(req);

  if (!partNumber || !delta || delta === 0) {
    return res.status(400).json({ error: 'Part number and non-zero adjustment are required.' });
  }

  const inventoryRows = await store.getAll('parts_inventory');
  const { stockByPart, metaByPart } = aggregateStock(inventoryRows);
  const currentQty = stockByPart.get(partNumber) || 0;
  const meta = metaByPart.get(partNumber) || {};
  const absQty = Math.abs(delta);

  if (delta < 0 && absQty > currentQty) {
    return res.status(400).json({ error: `Cannot reduce below zero. Current stock: ${currentQty}.` });
  }

  const data = await store.getRawData();
  const record = await store.create('parts_inventory', {
    transaction_date: new Date().toISOString().slice(0, 10),
    transaction_number: allocatePartsTransactionNumber(data),
    transaction_type: delta > 0 ? 'stock' : 'sold',
    editor,
    present_location: resolvePmLocation(req.body.present_location, data) || WAREHOUSE_1,
    part_number: partNumber,
    part_name: String(req.body.part_name || meta.part_name || '').trim(),
    sub_id: String(req.body.sub_id || meta.sub_id || '').trim(),
    generic: String(req.body.generic || '').trim(),
    supplier: String(req.body.supplier || meta.supplier || '').trim(),
    unit: String(req.body.unit || meta.unit || '').trim(),
    qty: absQty,
    cost_price: toNumber(req.body.cost_price ?? meta.cost_price),
    markup: toNumber(req.body.markup ?? meta.markup),
    retail_price: toNumber(req.body.retail_price ?? meta.retail_price),
    sold_to: delta < 0 ? String(req.body.sold_to || 'PM-Adjust').trim() : '',
  });

  const overview = await buildOverview();
  return res.json({
    ok: true,
    record,
    newQty: (stockByPart.get(partNumber) || 0) + delta,
    overview,
  });
});

router.post('/api/parts-requests/:id/resolve', async (req, res) => {
  const decision = String(req.body.decision || '').trim().toLowerCase();
  if (!['approved', 'rejected'].includes(decision)) {
    return res.status(400).json({ error: 'Decision must be approved or rejected.' });
  }

  const resolver = currentEditor(req);
  const inventoryRequest = await store.getById('parts_inventory', req.params.id);

  if (inventoryRequest && isPendingPartsRequest(inventoryRequest)) {
    await store.update('parts_inventory', inventoryRequest.id, {
      request_status: decision,
      resolved_at: new Date().toISOString(),
      resolved_by: resolver,
    });

    if (decision === 'approved') {
      const sourceRequest = mapInventoryPartsRequest(inventoryRequest);
      const { receipt } = await finalizeApprovedRequest(sourceRequest, resolver);
      const overview = await buildOverview();
      return res.json({ ok: true, decision, overview, receiptUrl: receipt.receiptUrl, receiptFile: receipt.filename });
    }

    const overview = await buildOverview();
    return res.json({ ok: true, decision, overview });
  }

  const request = await store.getById('parts_requests', req.params.id);
  if (!request || String(request.status || '').trim().toLowerCase() !== 'pending') {
    return res.status(404).json({ error: 'Pending request not found.' });
  }

  await store.update('parts_requests', request.id, {
    status: decision,
    resolved_at: new Date().toISOString(),
    resolved_by: resolver,
  });

  if (decision === 'approved') {
    const sourceRequest = mapLegacyPartsRequest(request);
    const { receipt } = await finalizeApprovedRequest(sourceRequest, resolver);
    const overview = await buildOverview();
    return res.json({ ok: true, decision, overview, receiptUrl: receipt.receiptUrl, receiptFile: receipt.filename });
  }

  const overview = await buildOverview();
  return res.json({ ok: true, decision, overview });
});

router.post('/api/transfers', async (req, res) => {
  const data = await store.getRawData();
  const fromBranch = resolvePmLocation(req.body.from_branch, data);
  const toBranch = resolvePmLocation(req.body.to_branch, data);
  const lines = parseLines(req.body);

  if (!fromBranch || !toBranch || fromBranch === toBranch || !lines.length) {
    return res.status(400).json({ error: 'Invalid transfer payload.' });
  }

  const stamp = stampNow();
  const numbers = allocateTransferNumbers(data);
  const first = lines[0];
  const transfer = await store.create('parts_transfers', {
    from_branch: fromBranch,
    to_branch: toBranch,
    part_number: first.part_number,
    part_name: first.part_name,
    sub_id: first.sub_id,
    qty: first.qty,
    unit: first.unit,
    lines,
    status: 'pending',
    editor: currentEditor(req),
    transaction_number: numbers.transaction_number,
    packing_list_number: numbers.packing_list_number,
    transmittal_number: numbers.transmittal_number,
    stamped_at: stamp.iso,
    stamped_label: stamp.label,
  });
  return res.status(201).json(transfer);
});

router.post('/api/purchase-orders', async (req, res) => {
  const data = await store.getRawData();
  const supplier = String(req.body.supplier || '').trim();
  if (!supplier) return res.status(400).json({ error: 'Supplier is required.' });

  const stamp = stampNow();
  const numbers = allocatePurchaseOrderNumbers(data);
  const po = await store.create('parts_purchase_orders', {
    supplier,
    branch: resolvePmLocation(req.body.branch, data) || WAREHOUSE_1,
    status: 'pending',
    notes: String(req.body.notes || '').trim(),
    created_by: currentEditor(req),
    transaction_number: numbers.transaction_number,
    po_number: numbers.po_number,
    stamped_at: stamp.iso,
    stamped_label: stamp.label,
  });
  return res.status(201).json(po);
});

module.exports = router;
module.exports.isPartsManagerRole = isPartsManagerRole;
module.exports.canAccessPartsManagerWorkspace = canAccessPartsManagerWorkspace;
