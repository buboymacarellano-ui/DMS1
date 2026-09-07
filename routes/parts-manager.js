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
  isPartsActivityLog,
} = require('../lib/parts-request');
const {
  APPROVED_RECEIPTS_DIR,
  buildApprovedTransactionRecord,
  saveApprovedReceipt,
  saveConsolidatedReceipt,
  saveTransitReceipt,
} = require('../lib/approved-parts-receipt');
const { warehouseFulfillmentExtras } = require('../lib/parts-transfer-receive');
const { allocatePartsTransactionNumber } = require('../lib/parts-transaction-number');
const inventory = require('../lib/parts-inventory-controller');
const stockAlerts = require('../lib/parts-stock-alerts');
const { WAREHOUSE_1, sameLocation, filterDataToLocation, withLocationOnHand } = require('../lib/parts-location-scope');
const { buildSortedDatabaseCsv, importPartsCsv } = require('../lib/parts-csv-sync');
const { collectReportLookups } = require('../lib/parts-reports');
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

/**
 * Calculate health metrics for Parts Database
 */
function calculateHealthMetrics(data) {
  const parts = (data.parts_inventory || []).filter(
    (p) => !isPartsActivityLog(p)
  );

  const now = new Date();
  const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);

  // Data Integrity
  const partNumbers = new Map();
  let duplicateSkus = 0;
  let missingDimensions = 0;
  let orphanedRecords = 0;

  parts.forEach((p) => {
    const pn = String(p.part_number || '').trim().toUpperCase();
    if (pn) {
      const count = (partNumbers.get(pn) || 0) + 1;
      if (count > 1) duplicateSkus = count;
      partNumbers.set(pn, count);
    }
    if (!String(p.unit || '').trim()) missingDimensions++;
    if (!String(p.supplier || '').trim() && toNumber(p.qty) > 0) orphanedRecords++;
  });

  // Inventory Risk
  let deadStock = 0;
  let lowStock = 0;
  const safetyThreshold = 5;

  parts.forEach((p) => {
    const qty = toNumber(p.qty);
    if (qty <= 0) return;
    if (qty < safetyThreshold) lowStock++;

    const txnDate = new Date(p.transaction_date || p.created_at || now);
    if (txnDate < oneYearAgo && !p.sold_at) deadStock++;
  });

  // Financial Discrepancies
  let zeroCostParts = 0;
  let outdatedPricing = 0;

  parts.forEach((p) => {
    if (toNumber(p.cost_price) === 0 && toNumber(p.qty) > 0) zeroCostParts++;
    if (!p.markup || toNumber(p.markup) === 0) outdatedPricing++;
  });

  return {
    dataIntegrity: { duplicateSkus, missingDimensions, orphanedRecords },
    inventoryRisk: { deadStock, lowStock },
    financialDiscrepancies: { zeroCostParts, outdatedPricing },
  };
}

/**
 * Identify "delicate parts" - critical items needing attention
 */
function getDelicateParts(data) {
  const parts = (data.parts_inventory || []).filter(
    (p) => !isPartsActivityLog(p)
  );

  const safetyThreshold = 5;
  const delicate = [];

  parts.forEach((p) => {
    const qty = toNumber(p.qty);
    const partNum = String(p.part_number || '').trim();
    const status = [];

    // Critical low stock
    if (qty > 0 && qty < safetyThreshold) {
      status.push('Critical Low');
    }

    // No supplier
    if (!String(p.supplier || '').trim() && qty > 0) {
      status.push('No Supplier');
    }

    // Zero cost (pricing issue)
    if (toNumber(p.cost_price) === 0 && qty > 0) {
      status.push('$0 Cost');
    }

    if (status.length > 0) {
      delicate.push({
        id: p.id,
        part_number: partNum,
        part_name: String(p.part_name || '').trim(),
        supplier: String(p.supplier || '').trim(),
        current_stock: qty,
        safety_stock: safetyThreshold,
        cost_price: toNumber(p.cost_price),
        status: status.join(' | '),
      });
    }
  });

  // Sort by criticality: critical low > no supplier > $0 cost
  return delicate.sort((a, b) => {
    const aScore = (a.current_stock === 0 ? 10 : 0) + (a.status.includes('Critical Low') ? 5 : 0);
    const bScore = (b.current_stock === 0 ? 10 : 0) + (b.status.includes('Critical Low') ? 5 : 0);
    return bScore - aScore;
  });
}

async function loadWorkspaceLocals(req) {
  const data = await store.getRawData();
  inventory.ensureCollections(data);
  const dashboardLogs = inventory.getDashboardLogs(data);
  const { filtered, q, filterType, location } = filterPartsInventory(dashboardLogs, req.query);
  const scopedData = location ? filterDataToLocation(data, location) : data;
  const viewRows = withLocationOnHand(
    inventory.attachOnHand(scopedData, filtered),
    inventory.allAuditRows(data),
    location || ''
  );
  const locationOptions = pmLocationOptions(data);
  const vitals = buildPmVitals(data);
  const approvals = buildPmApprovals(data);
  stockAlerts.reconcileWarehouse1Stock(data);

  // Calculate health metrics
  const healthMetrics = calculateHealthMetrics(data);
  const delicateParts = getDelicateParts(data);

  // Get approved purchase orders (read-only view for PM)
  const allPOs = (data && data.parts_purchase_orders) || [];
  const approvedPOs = allPOs
    .filter(po => String(po.status || '').trim().toLowerCase() === 'approved')
    .sort((a, b) => new Date(b.approved_at || 0) - new Date(a.approved_at || 0));

  return {
    parts: viewRows,
    total: viewRows.length,
    q,
    filterType,
    locationFilter: location,
    transactionTypes: VALID_PARTS_TRANSACTION_TYPES,
    displayPartsTransactionType,
    normalizePartsTransactionType,
    isSoldTransaction: inventory.isSoldTransaction,
    locationOptions,
    warehouse1: WAREHOUSE_1,
    vitals,
    approvals,
    healthMetrics,
    delicateParts,
    approvedPOs,
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
    pendingPartRequests: stockAlerts.listPendingPopups(data),
    reportLookups: collectReportLookups(data),
    reportIncludeWholeDatabase: true,
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

async function finalizeApprovedRequest(sourceRequest, resolver, extras) {
  const data = await store.getRawData();
  const payload = buildApprovedTransactionRecord(sourceRequest, resolver, data, extras);
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

function findApprovedInventoryRow(data, opts) {
  const rows = Array.isArray(data.parts_inventory) ? data.parts_inventory : [];
  if (opts && opts.requestId) {
    return rows.find((row) => String(row.linked_request_id) === String(opts.requestId) && row.approved_at) || null;
  }
  if (opts && opts.transferId) {
    return rows.find((row) => String(row.linked_transfer_id) === String(opts.transferId) && row.approved_at) || null;
  }
  if (opts && opts.id) {
    return rows.find((row) => String(row.id) === String(opts.id)) || null;
  }
  return null;
}

async function loadPendingRequestBundle(id) {
  const data = await store.getRawData();
  const inventoryRequest = (data.parts_inventory || []).find((row) => String(row.id) === String(id));
  if (inventoryRequest && isPendingPartsRequest(inventoryRequest)) {
    return { kind: 'inventory', raw: inventoryRequest, mapped: mapInventoryPartsRequest(inventoryRequest) };
  }
  const request = (data.parts_requests || []).find((row) => String(row.id) === String(id));
  if (request && String(request.status || '').trim().toLowerCase() === 'pending') {
    return { kind: 'legacy', raw: request, mapped: mapLegacyPartsRequest(request) };
  }
  return null;
}

function transferLineList(transfer) {
  if (Array.isArray(transfer.lines) && transfer.lines.length) return transfer.lines;
  return [{
    part_number: transfer.part_number,
    part_name: transfer.part_name,
    sub_id: transfer.sub_id,
    qty: transfer.qty,
    unit: transfer.unit,
  }];
}

function mapTransferAsRequest(transfer) {
  const first = transferLineList(transfer)[0] || {};
  return {
    id: transfer.id,
    requesting_branch: transfer.to_branch,
    branch: transfer.from_branch,
    from_branch: transfer.from_branch,
    to_branch: transfer.to_branch,
    work_order_number: '',
    transaction_number: transfer.transaction_number,
    part_number: first.part_number,
    part_name: first.part_name,
    sub_id: first.sub_id,
    qty: first.qty,
    unit: first.unit,
    editor: transfer.editor || transfer.created_by || '',
    requested_by: transfer.editor || transfer.created_by || '',
    created_at: transfer.created_at || transfer.stamped_label || transfer.stamped_at || '',
    packing_list_number: transfer.packing_list_number,
    transmittal_number: transfer.transmittal_number,
    original_transaction_type: 'Transfer Request',
    sold_to: `Transfer ${transfer.transaction_number || ''}`.trim(),
  };
}

function applyCompletedTransfer(data, transfer, editor) {
  if (String(transfer.status || '').toLowerCase() === 'completed') {
    const existing = (data.parts_inventory || []).filter((row) => String(row.linked_transfer_id) === String(transfer.id) && row.approved_at);
    return { transfer, approvedRows: existing };
  }

  const stamp = stampNow();
  const lines = transferLineList(transfer);
  const approvedRows = [];
  if (!Array.isArray(data.parts_inventory)) data.parts_inventory = [];

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
      requesting_branch: transfer.to_branch,
      from_branch: transfer.from_branch,
      to_branch: transfer.to_branch,
      packing_list_number: transfer.packing_list_number,
      transmittal_number: transfer.transmittal_number,
      approved_at: stamp.iso,
      approved_by: editor,
      original_transaction_type: 'Transfer Request',
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
    approvedRows.push(outRow);
  });

  transfer.status = 'completed';
  transfer.completed_at = stamp.iso;
  transfer.completed_by = editor;
  transfer.stamped_at = stamp.iso;
  transfer.stamped_label = stamp.label;
  return { transfer, approvedRows };
}

function renderApprovePrint(res, locals) {
  return res.render('parts-manager/approve-print', locals);
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

// Transit Receipt: print all approved items with same transaction number on one page
router.get('/api/transit-receipt/:transactionNumber', async (req, res) => {
  try {
    const txnNumber = String(req.params.transactionNumber || '').trim();
    if (!txnNumber) {
      return res.status(400).json({ error: 'Transaction number required.' });
    }

    const data = await store.getRawData();
    // Approved items are in parts_inventory collection with an approved_at field
    const approvedItems = (data.parts_inventory || []).filter(
      (item) => String(item.transaction_number || '') === txnNumber && item.approved_at
    );

    if (approvedItems.length === 0) {
      return res.status(404).json({ error: `No approved items found for transaction ${txnNumber}.` });
    }

    const approver = String(req.session?.user?.username || 'System').trim();
    const receipt = await saveTransitReceipt(txnNumber, approvedItems, approver);

    return res.json({
      ok: true,
      transactionNumber: txnNumber,
      itemCount: approvedItems.length,
      receiptUrl: receipt.receiptUrl,
      filename: receipt.filename,
    });
  } catch (err) {
    console.error('Error generating transit receipt:', err);
    return res.status(500).json({ error: err.message });
  }
});

router.get('/requests/:id/preview', async (req, res) => {
  const bundle = await loadPendingRequestBundle(req.params.id);
  if (!bundle) {
    const data = await store.getRawData();
    const existing = findApprovedInventoryRow(data, { requestId: req.params.id });
    if (existing) {
      return res.redirect('/parts-manager/approved/' + encodeURIComponent(existing.id));
    }
    return res.redirect('/parts-manager?panel=approvals&error=' + encodeURIComponent('Pending request not found.'));
  }

  const data = await store.getRawData();
  const resolver = currentEditor(req);
  const extras = warehouseFulfillmentExtras(bundle.mapped);
  const record = buildApprovedTransactionRecord(bundle.mapped, resolver, data, extras);
  record.approved_at = '';
  return renderApprovePrint(res, {
    mode: 'preview',
    kindLabel: 'Parts Request',
    record,
    source: bundle.mapped,
    lines: [],
    proceedAction: '/parts-manager/requests/' + encodeURIComponent(bundle.mapped.id) + '/proceed',
    cancelHref: '/parts-manager?panel=approvals',
    autoPrint: '',
    error: '',
    success: '',
  });
});

router.post('/requests/:id/proceed', async (req, res) => {
  const bundle = await loadPendingRequestBundle(req.params.id);
  if (!bundle) {
    const data = await store.getRawData();
    const existing = findApprovedInventoryRow(data, { requestId: req.params.id });
    if (existing) {
      return res.redirect('/parts-manager/approved/' + encodeURIComponent(existing.id) + '?print=1');
    }
    return res.redirect('/parts-manager?panel=approvals&error=' + encodeURIComponent('Pending request not found.'));
  }

  const resolver = currentEditor(req);
  if (bundle.kind === 'inventory') {
    await store.update('parts_inventory', bundle.raw.id, {
      request_status: 'approved',
      resolved_at: new Date().toISOString(),
      resolved_by: resolver,
    });
  } else {
    await store.update('parts_requests', bundle.raw.id, {
      status: 'approved',
      resolved_at: new Date().toISOString(),
      resolved_by: resolver,
    });
  }

  const { record } = await finalizeApprovedRequest(bundle.mapped, resolver, warehouseFulfillmentExtras(bundle.mapped));
  return res.redirect('/parts-manager/approved/' + encodeURIComponent(record.id) + '?print=1');
});

router.get('/transfers/:id/preview', async (req, res) => {
  const data = await store.getRawData();
  const transfer = findTransfer(data, req.params.id);
  if (!transfer) {
    return res.redirect('/parts-manager?panel=approvals&error=' + encodeURIComponent('Transfer not found.'));
  }
  if (String(transfer.status || '').toLowerCase() === 'completed') {
    const existing = findApprovedInventoryRow(data, { transferId: transfer.id });
    if (existing) {
      return res.redirect('/parts-manager/approved/' + encodeURIComponent(existing.id));
    }
    return res.redirect('/parts-manager?panel=approvals&error=' + encodeURIComponent('That transfer is already completed.'));
  }

  const source = mapTransferAsRequest(transfer);
  const record = buildApprovedTransactionRecord(source, currentEditor(req), data, {
    original_transaction_type: 'Transfer Request',
    sold_to: source.sold_to,
    linked_request_id: '',
    linked_transfer_id: transfer.id,
    from_branch: transfer.from_branch,
    to_branch: transfer.to_branch,
  });
  record.approved_at = '';
  return renderApprovePrint(res, {
    mode: 'preview',
    kindLabel: 'Transfer Request',
    record,
    source,
    lines: transferLineList(transfer),
    proceedAction: '/parts-manager/transfers/' + encodeURIComponent(transfer.id) + '/proceed',
    cancelHref: '/parts-manager?panel=approvals',
    autoPrint: '',
    error: '',
    success: '',
  });
});

router.post('/transfers/:id/proceed', async (req, res) => {
  const data = await store.getRawData();
  const transfer = findTransfer(data, req.params.id);
  if (!transfer) {
    return res.redirect('/parts-manager?panel=approvals&error=' + encodeURIComponent('Transfer not found.'));
  }

  const editor = currentEditor(req);
  const { approvedRows } = applyCompletedTransfer(data, transfer, editor);
  const printable = approvedRows[0];
  if (printable) {
    const source = mapTransferAsRequest(transfer);
    await saveApprovedReceipt(printable, source);
    rememberDocument(data, {
      kind: 'receipt',
      serial: printable.transaction_number,
      transaction_number: printable.transaction_number,
      related_id: printable.id,
      created_by: editor,
      title: 'Approved Transfer Receipt',
    });
  }
  await store.replaceData(data);

  if (printable) {
    return res.redirect('/parts-manager/approved/' + encodeURIComponent(printable.id) + '?print=1');
  }
  return res.redirect('/parts-manager?panel=approvals&success=' + encodeURIComponent('Transfer completed.'));
});

router.get('/approved/:id', async (req, res) => {
  const data = await store.getRawData();
  const record = findApprovedInventoryRow(data, { id: req.params.id })
    || (data.parts_inventory || []).find((row) => String(row.id) === String(req.params.id));
  if (!record || !record.approved_at) {
    return res.redirect('/parts-manager?panel=approvals&error=' + encodeURIComponent('Approved transaction not found.'));
  }

  let source = {
    requested_by: record.approved_by || record.editor || '',
    editor: record.editor || '',
    created_at: record.created_at || record.approved_at || '',
  };
  if (record.linked_request_id) {
    const inventoryRequest = (data.parts_inventory || []).find((row) => String(row.id) === String(record.linked_request_id));
    if (inventoryRequest) source = mapInventoryPartsRequest(inventoryRequest);
    else {
      const legacy = (data.parts_requests || []).find((row) => String(row.id) === String(record.linked_request_id));
      if (legacy) source = mapLegacyPartsRequest(legacy);
    }
  } else if (record.linked_transfer_id) {
    const transfer = findTransfer(data, record.linked_transfer_id);
    if (transfer) source = mapTransferAsRequest(transfer);
  }

  return renderApprovePrint(res, {
    mode: 'final',
    kindLabel: record.original_transaction_type || 'Parts Request',
    record,
    source,
    lines: record.linked_transfer_id && findTransfer(data, record.linked_transfer_id)
      ? transferLineList(findTransfer(data, record.linked_transfer_id))
      : [],
    proceedAction: '',
    cancelHref: '/parts-manager?panel=approvals',
    autoPrint: String(req.query.print || '') === '1' ? '1' : '',
    error: '',
    success: '',
  });
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

/**
 * GET /export-empty-template.csv
 * Download an empty Parts-DB CSV template with headers only.
 */
router.get('/export-empty-template.csv', async (req, res) => {
  const emptyData = {
    parts_inventory: [],
    parts_request_transactions: [],
  };
  const file = buildSortedDatabaseCsv(emptyData);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="Parts-DB-Template-${new Date().toISOString().slice(0, 10)}.csv"`);
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

  const existing = data.parts_inventory[idx];
  const soldLock = inventory.assertSoldRecordMutable(existing);
  if (!soldLock.ok) {
    return res.redirect('/parts-manager?panel=edit&error=' + encodeURIComponent(soldLock.error));
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
    receiving_receipt_number: String(body.receiving_receipt_number || '').trim(),
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
    const soldLock = inventory.assertSoldRecordMutable(removed);
    if (!soldLock.ok) {
      return res.redirect('/parts-manager?error=' + encodeURIComponent(soldLock.error));
    }
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

  const { transfer: updated } = applyCompletedTransfer(data, transfer, currentEditor(req));
  await store.replaceData(data);
  return res.json({ ok: true, transfer: updated });
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

router.get('/api/part-request-popups', async (req, res) => {
  const data = await store.getRawData();
  stockAlerts.reconcileWarehouse1Stock(data);
  return res.json({
    ok: true,
    items: stockAlerts.listPendingPopups(data),
  });
});

router.get('/api/parts/find-by-number/:partNumber', async (req, res) => {
  try {
    const partNumber = String(req.params.partNumber || '').trim().toUpperCase();
    if (!partNumber) {
      return res.status(400).json({ error: 'Part number required.' });
    }

    const data = await store.getRawData();
    const part = (data.parts_inventory || []).find(
      (p) => String(p.part_number || '').trim().toUpperCase() === partNumber
    );

    if (!part) {
      return res.status(404).json({ error: 'Part not found', found: false });
    }

    // Return only fields relevant for auto-fill
    return res.json({
      found: true,
      part_name: part.part_name || '',
      supplier: part.supplier || '',
      unit: part.unit || '',
      cost_price: part.cost_price != null ? Number(part.cost_price) : 0,
      markup: part.markup != null ? Number(part.markup) : 0,
      retail_price: part.retail_price != null ? Number(part.retail_price) : 0,
      on_hand: part.on_hand || 0,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/parts/search-numbers/:prefix
 * Search for part numbers by prefix (for autocomplete suggestions).
 * Returns up to 15 matching part numbers sorted by frequency.
 */
router.get('/api/parts/search-numbers/:prefix', async (req, res) => {
  try {
    const prefix = String(req.params.prefix || '').trim().toUpperCase();
    if (!prefix || prefix.length < 1) {
      return res.json({ suggestions: [] });
    }

    const data = await store.getRawData();
    const seen = new Map(); // Count occurrences to sort by frequency

    (data.parts_inventory || []).forEach((row) => {
      const pn = String(row.part_number || '').trim().toUpperCase();
      if (pn.startsWith(prefix)) {
        seen.set(pn, (seen.get(pn) || 0) + 1);
      }
    });

    // Sort by frequency (descending) then alphabetically
    const suggestions = Array.from(seen.entries())
      .sort((a, b) => {
        if (b[1] !== a[1]) return b[1] - a[1]; // by frequency desc
        return a[0].localeCompare(b[0]); // alphabetically asc
      })
      .slice(0, 15)
      .map((entry) => entry[0]);

    return res.json({ suggestions });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/api/parts/:id', async (req, res) => {
  const part = await store.getById('parts_inventory', req.params.id);
  if (!part) return res.status(404).json({ error: 'Record not found.' });
  const soldLock = inventory.assertSoldRecordMutable(part);
  return res.json(Object.assign({}, part, {
    locked: !soldLock.ok,
    lockReason: soldLock.error || '',
  }));
});

/**
 * POST /api/parts/receiving-entry
 * Batch add receiving entries with auto-generated transaction data.
 * Each entry becomes a new 'restock' transaction.
 * Auto-generates: transaction_date (today), transaction_number, transaction_type='restock'
 * Required fields per entry: part_number, part_name, qty, present_location
 */
router.post('/api/parts/receiving-entry', async (req, res) => {
  try {
    const entries = Array.isArray(req.body.entries) ? req.body.entries : [];
    if (!entries.length) {
      return res.status(400).json({ error: 'No entries provided.' });
    }

    const editor = String(req.session?.user?.username || 'system').trim();
    const data = await store.getRawData();
    const createdRecords = [];
    const errors = [];

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const entryNum = i + 1;

      // Validate required fields
      const partNumber = String(entry.part_number || '').trim();
      const partName = String(entry.part_name || '').trim();
      const qtyVal = toNumber(entry.qty);
      const location = resolvePmLocation(entry.present_location, data) || WAREHOUSE_1;

      if (!partNumber) {
        errors.push(`Row ${entryNum}: Part Number is required.`);
        continue;
      }
      if (!partName) {
        errors.push(`Row ${entryNum}: Part Name is required.`);
        continue;
      }
      if (qtyVal <= 0) {
        errors.push(`Row ${entryNum}: Qty must be greater than 0.`);
        continue;
      }

      // Create restock transaction
      const restock = {
        id: genId(),
        created_at: new Date().toISOString(),
        transaction_date: new Date().toISOString().slice(0, 10),
        transaction_number: allocatePartsTransactionNumber(data),
        transaction_type: TYPE_RESTOCK,
        present_location: location,
        branch: location,
        editor,
        part_number: partNumber,
        part_name: partName,
        sub_id: String(entry.sub_id || '').trim(),
        generic: String(entry.generic || '').trim(),
        supplier: String(entry.supplier || '').trim(),
        receiving_receipt_number: String(entry.receiving_receipt_number || '').trim(),
        unit: String(entry.unit || '').trim(),
        qty: qtyVal,
        cost_price: toNumber(entry.cost_price),
        markup: toNumber(entry.markup),
        retail_price: toNumber(entry.retail_price),
        sold_to: '',
      };

      // Push to data and persist
      if (!Array.isArray(data.parts_inventory)) data.parts_inventory = [];
      data.parts_inventory.push(restock);
      inventory.rememberTransaction(data, restock);
      createdRecords.push(restock);
    }

    // Save all changes
    if (createdRecords.length > 0) {
      await store.replaceData(data);
      stockAlerts.reconcileWarehouse1Stock(data);
    }

    return res.json({
      ok: true,
      created: createdRecords.length,
      records: createdRecords,
      errors: errors.length > 0 ? errors : undefined,
      message: `Successfully created ${createdRecords.length} receiving ${createdRecords.length === 1 ? 'entry' : 'entries'}.`,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/parts/csv-batch-add
 * Parse CSV text and merge rows as restock transactions.
 * Similar to receiving-entry but accepts raw CSV format.
 * Each valid row becomes a new 'restock' transaction.
 * Auto-generates: transaction_date, transaction_number, transaction_type='restock'
 */
router.post('/api/parts/csv-batch-add', async (req, res) => {
  try {
    const csvText = String(req.body.csv || '').trim();
    if (!csvText) {
      return res.status(400).json({ error: 'No CSV data provided.' });
    }

    const editor = String(req.session?.user?.username || 'system').trim();
    const data = await store.getRawData();
    const createdRecords = [];
    const errors = [];
    const { Readable } = require('stream');
    const csvParser = require('csv-parser');

    // Parse CSV using stream parser
    const lines = csvText.split('\n').filter(Boolean);
    if (lines.length < 1) {
      return res.status(400).json({ error: 'CSV file is empty.' });
    }

    // Simple manual CSV parsing to extract headers and rows
    const headerLine = lines[0];
    const headers = headerLine.split(',').map((h) => String(h || '').trim().toLowerCase());

    const FIELD_ALIASES = {
      'part #': 'part_number',
      'part number': 'part_number',
      'partnumber': 'part_number',
      'part name': 'part_name',
      'partname': 'part_name',
      'name': 'part_name',
      'qty': 'qty',
      'quantity': 'qty',
      'location': 'present_location',
      'present location': 'present_location',
      'branch': 'present_location',
      'supplier': 'supplier',
      'receipt #': 'receiving_receipt_number',
      'receipt number': 'receiving_receipt_number',
      'receiving receipt #': 'receiving_receipt_number',
      'receiving receipt number': 'receiving_receipt_number',
      'unit': 'unit',
      'cost': 'cost_price',
      'cost price': 'cost_price',
      'markup': 'markup',
      'markup (%)': 'markup',
      'retail': 'retail_price',
      'retail price': 'retail_price',
      'sub-id': 'sub_id',
      'subid': 'sub_id',
      'generic': 'generic',
      'description': 'generic',
    };

    // Map header columns to field names
    const fieldIndices = {};
    headers.forEach((header, idx) => {
      const alias = FIELD_ALIASES[header] || header;
      fieldIndices[alias] = idx;
    });

    // Process each data row (skip header)
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue; // Skip empty lines

      const rowNum = i + 1;
      const values = line.split(',').map((v) => String(v || '').trim());
      const entry = {};

      // Build entry object from CSV values
      Object.keys(fieldIndices).forEach((field) => {
        const idx = fieldIndices[field];
        if (idx >= 0 && idx < values.length) {
          entry[field] = values[idx];
        }
      });

      // Validate required fields
      const partNumber = String(entry.part_number || '').trim();
      const partName = String(entry.part_name || '').trim();
      const qtyVal = toNumber(entry.qty);
      const location = resolvePmLocation(entry.present_location, data) || WAREHOUSE_1;

      if (!partNumber) {
        errors.push(`Row ${rowNum}: Part Number is required.`);
        continue;
      }
      if (!partName) {
        errors.push(`Row ${rowNum}: Part Name is required.`);
        continue;
      }
      if (qtyVal <= 0) {
        errors.push(`Row ${rowNum}: Qty must be greater than 0.`);
        continue;
      }

      // Create restock transaction
      const restock = {
        id: genId(),
        created_at: new Date().toISOString(),
        transaction_date: new Date().toISOString().slice(0, 10),
        transaction_number: allocatePartsTransactionNumber(data),
        transaction_type: TYPE_RESTOCK,
        present_location: location,
        branch: location,
        editor,
        part_number: partNumber,
        part_name: partName,
        sub_id: String(entry.sub_id || '').trim(),
        generic: String(entry.generic || '').trim(),
        supplier: String(entry.supplier || '').trim(),
        receiving_receipt_number: String(entry.receiving_receipt_number || '').trim(),
        unit: String(entry.unit || '').trim(),
        qty: qtyVal,
        cost_price: toNumber(entry.cost_price),
        markup: toNumber(entry.markup),
        retail_price: toNumber(entry.retail_price),
        sold_to: '',
      };

      // Push to data
      if (!Array.isArray(data.parts_inventory)) data.parts_inventory = [];
      data.parts_inventory.push(restock);
      inventory.rememberTransaction(data, restock);
      createdRecords.push(restock);
    }

    // Save all changes
    if (createdRecords.length > 0) {
      await store.replaceData(data);
      stockAlerts.reconcileWarehouse1Stock(data);
    }

    return res.json({
      ok: true,
      created: createdRecords.length,
      records: createdRecords,
      errors: errors.length > 0 ? errors : undefined,
      message: `Successfully merged ${createdRecords.length} CSV ${createdRecords.length === 1 ? 'row' : 'rows'} into P-db.`,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
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
      const { receipt } = await finalizeApprovedRequest(sourceRequest, resolver, warehouseFulfillmentExtras(sourceRequest));
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
    const { receipt } = await finalizeApprovedRequest(sourceRequest, resolver, warehouseFulfillmentExtras(sourceRequest));
    const overview = await buildOverview();
    return res.json({ ok: true, decision, overview, receiptUrl: receipt.receiptUrl, receiptFile: receipt.filename });
  }

  const overview = await buildOverview();
  return res.json({ ok: true, decision, overview });
});

router.post('/api/requests/approve-all', async (req, res) => {
  try {
    const data = await store.getRawData();
    const resolver = currentEditor(req);
    
    // Get all pending inventory requests using the exact same filter as displayed
    const allInventory = (data.parts_inventory || []);
    const pending = allInventory.filter(isPendingPartsRequest);
    
    console.log('🔍 Approve-all called');
    console.log('  Total inventory:', allInventory.length);
    console.log('  Pending requests:', pending.length);
    
    if (pending.length === 0) {
      console.log('  First 3 inventory rows (to debug filter):');
      allInventory.slice(0, 3).forEach((row, i) => {
        console.log(`    [${i}] type=${row.transaction_type}, status=${row.request_status}, isPending=${isPendingPartsRequest(row)}`);
      });
      return res.status(400).json({ error: 'No pending requests to approve.' });
    }
    
    console.log('  ✓ Processing', pending.length, 'requests');
    
    // Allocate one transaction number for all
    const masterTransactionNumber = allocatePartsTransactionNumber(data);
    const now = new Date().toISOString();
    
    // Process each one and collect items for consolidated receipt
    const results = [];
    const approvedItems = [];
    for (const item of pending) {
      try {
        await store.update('parts_inventory', item.id, {
          request_status: 'approved',
          resolved_at: now,
          resolved_by: resolver,
          transaction_number: masterTransactionNumber,
        });
        
        const mapped = mapInventoryPartsRequest(item);
        const extras = warehouseFulfillmentExtras(mapped);
        const payload = buildApprovedTransactionRecord(mapped, resolver, data, extras);
        const record = await store.create('parts_inventory', payload);
        
        // Collect for consolidated receipt instead of saving individual receipt
        approvedItems.push({
          part_number: record.part_number,
          part_name: record.part_name,
          sub_id: record.sub_id,
          generic: record.generic,
          supplier: record.supplier,
          unit: record.unit,
          qty: record.qty,
          cost_price: record.cost_price,
          markup: record.markup,
          retail_price: record.retail_price,
          sold_to: record.sold_to,
          work_order_number: record.work_order_number,
          requesting_branch: record.requesting_branch,
        });
        
        // Remember document for audit trail
        rememberDocument(data, {
          kind: 'receipt',
          serial: record.transaction_number,
          transaction_number: record.transaction_number,
          related_id: record.id,
          created_by: resolver,
          title: 'Approved Parts Receipt',
        });
        
        results.push({ id: item.id, ok: true, part_number: record.part_number });
      } catch (err) {
        console.error('    Error on request ' + item.id + ':', err.message);
        results.push({ id: item.id, ok: false, error: err.message });
      }
    }
    
    console.log('  Results:', results.map((r) => r.ok ? '✓' : '✗').join(''));
    
    // Save ONE consolidated receipt for all items
    let consolidatedReceipt = null;
    const successCount = results.filter((r) => r.ok).length;
    if (successCount > 0 && approvedItems.length > 0) {
      consolidatedReceipt = await saveConsolidatedReceipt(masterTransactionNumber, approvedItems, resolver);
      console.log('  ✓ Consolidated receipt:', consolidatedReceipt.filename);
    }
    
    // Persist all changes
    await store.replaceData(data);
    
    const overview = await buildOverview();
    return res.json({
      ok: true,
      message: 'Approved ' + pending.length + ' requests',
      transactionNumber: masterTransactionNumber,
      requestsApproved: successCount,
      receiptUrl: consolidatedReceipt ? consolidatedReceipt.receiptUrl : '',
      receiptFile: consolidatedReceipt ? consolidatedReceipt.filename : '',
      overview,
    });
  } catch (err) {
    console.error('❌ Approve all error:', err.message);
    console.error(err.stack);
    return res.status(500).json({ error: err.message });
  }
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

/**
 * POST /api/purchase-orders-create
 * Create a PO from ordering grid items (semi-automated workflow)
 */
router.post('/api/purchase-orders-create', async (req, res) => {
  try {
    const supplier = String(req.body.supplier || '').trim();
    const location = String(req.body.location || '').trim();
    const items = Array.isArray(req.body.items) ? req.body.items : [];

    if (!supplier || !location || items.length === 0) {
      return res.status(400).json({ ok: false, error: 'Supplier, location, and items are required.' });
    }

    const data = await store.getRawData();
    const resolvedLocation = resolvePmLocation(location, data) || WAREHOUSE_1;
    const stamp = stampNow();
    const numbers = allocatePurchaseOrderNumbers(data);

    // Format lines from ordering grid items
    const lines = items.map((item) => ({
      part_number: String(item.part_number || '').trim(),
      part_name: String(item.part_name || '').trim(),
      supplier: String(item.supplier || '').trim(),
      qty: toNumber(item.qty),
      unit: String(item.unit || 'pcs').trim(),
    })).filter((line) => line.part_number && line.qty > 0);

    if (!Array.isArray(data.parts_purchase_orders)) data.parts_purchase_orders = [];

    const po = {
      id: genId(),
      created_at: stamp.iso,
      stamped_at: stamp.iso,
      stamped_label: stamp.label,
      supplier: supplier,
      branch: resolvedLocation,
      present_location: resolvedLocation,
      status: 'draft', // Start as draft, move to pending_approval after user approves
      notes: '',
      created_by: currentEditor(req),
      transaction_number: numbers.transaction_number,
      po_number: numbers.po_number,
      lines: lines,
      part_number: lines[0] ? lines[0].part_number : '',
      part_name: lines[0] ? lines[0].part_name : '',
      qty: lines.reduce((sum, line) => sum + (line.qty || 0), 0),
    };

    data.parts_purchase_orders.push(po);

    // Remember document for audit trail
    rememberDocument(data, {
      kind: 'purchase_order',
      serial: po.po_number,
      transaction_number: po.transaction_number,
      related_id: po.id,
      created_by: po.created_by,
      title: 'Purchase Order',
    });

    await store.replaceData(data);

    return res.json({
      ok: true,
      po: po,
      message: `PO ${po.po_number} created. Ready for approval.`,
    });
  } catch (err) {
    console.error('PO creation error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/purchase-orders-send-approval
 * Send PO to GM for approval (marks status as pending_approval)
 */
router.post('/api/purchase-orders-send-approval', async (req, res) => {
  try {
    const po_id = String(req.body.po_id || '').trim();
    const po_number = String(req.body.po_number || '').trim();

    if (!po_id || !po_number) {
      return res.status(400).json({ ok: false, error: 'PO ID and number are required.' });
    }

    const data = await store.getRawData();
    const po = findPurchaseOrder(data, po_id);

    if (!po) {
      return res.status(404).json({ ok: false, error: 'Purchase order not found.' });
    }

    const editor = currentEditor(req);
    const stamp = stampNow();

    // Update PO status to pending_approval
    po.status = 'pending_approval';
    po.sent_for_approval_at = stamp.iso;
    po.sent_for_approval_by = editor;
    po.approval_requested_at = stamp.iso;
    po.approval_requested_by = editor;

    // Remember document event for audit trail
    rememberDocument(data, {
      kind: 'purchase_order_approval_request',
      serial: po.po_number,
      transaction_number: po.transaction_number,
      related_id: po.id,
      created_by: editor,
      title: `PO ${po.po_number} Sent for GM Approval`,
    });

    await store.replaceData(data);

    // In production, you would send a notification to GM here
    // For now, just log it
    console.log(`✓ PO ${po_number} sent to GM for approval by ${editor}`);

    return res.json({
      ok: true,
      po: po,
      message: `PO ${po_number} sent to GM for approval. Awaiting review...`,
    });
  } catch (err) {
    console.error('Send for approval error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/purchase-orders/:id/approve
 * GM approves a PO (called from approval panel)
 */
router.post('/api/purchase-orders/:id/approve', async (req, res) => {
  try {
    const po_id = req.params.id;
    const data = await store.getRawData();
    const po = findPurchaseOrder(data, po_id);

    if (!po) {
      return res.status(404).json({ ok: false, error: 'Purchase order not found.' });
    }

    const editor = currentEditor(req);
    const stamp = stampNow();

    // Update PO status to approved
    po.status = 'approved';
    po.approved_at = stamp.iso;
    po.approved_by = editor;

    // Remember document event for audit trail
    rememberDocument(data, {
      kind: 'purchase_order_approved',
      serial: po.po_number,
      transaction_number: po.transaction_number,
      related_id: po.id,
      created_by: editor,
      title: `PO ${po.po_number} Approved by GM`,
    });

    await store.replaceData(data);

    return res.json({
      ok: true,
      po: po,
      message: `PO ${po.po_number} approved! Ready to print and send to supplier.`,
    });
  } catch (err) {
    console.error('Approve PO error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/purchase-orders/:id/reject
 * GM rejects a PO (called from approval panel)
 */
router.post('/api/purchase-orders/:id/reject', async (req, res) => {
  try {
    const po_id = req.params.id;
    const reason = String(req.body.reason || 'No reason provided').trim();
    const data = await store.getRawData();
    const po = findPurchaseOrder(data, po_id);

    if (!po) {
      return res.status(404).json({ ok: false, error: 'Purchase order not found.' });
    }

    const editor = currentEditor(req);
    const stamp = stampNow();

    // Update PO status to rejected
    po.status = 'rejected';
    po.rejected_at = stamp.iso;
    po.rejected_by = editor;
    po.rejection_reason = reason;

    // Remember document event for audit trail
    rememberDocument(data, {
      kind: 'purchase_order_rejected',
      serial: po.po_number,
      transaction_number: po.transaction_number,
      related_id: po.id,
      created_by: editor,
      title: `PO ${po.po_number} Rejected by GM`,
    });

    await store.replaceData(data);

    return res.json({
      ok: true,
      po: po,
      message: `PO ${po.po_number} rejected. Return to ordering grid to revise.`,
    });
  } catch (err) {
    console.error('Reject PO error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
module.exports.isPartsManagerRole = isPartsManagerRole;
module.exports.canAccessPartsManagerWorkspace = canAccessPartsManagerWorkspace;
