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
  isPartsRequestType,
} = require('../lib/parts-request');
const {
  APPROVED_RECEIPTS_DIR,
  buildApprovedTransactionRecord,
  saveApprovedReceipt,
  saveConsolidatedReceipt,
  saveTransitReceipt,
} = require('../lib/approved-parts-receipt');
const { warehouseFulfillmentExtras } = require('../lib/parts-transfer-receive');
const approvalControls = require('../lib/approval-controls');
const { allocatePartsTransactionNumber } = require('../lib/parts-transaction-number');
const inventory = require('../lib/parts-inventory-controller');
const stockAlerts = require('../lib/parts-stock-alerts');
const { WAREHOUSE_1, sameLocation, filterDataToLocation, withLocationOnHand, stockByLocation } = require('../lib/parts-location-scope');
const { DEFAULT_OPERATIONAL_BRANCHES } = require('../lib/branches');
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
  buildPurchaseOrderDetailsHtml,
} = require('../lib/pm-documents');
const { recordGmApproval, TYPES: GM_TXN_TYPES } = require('../lib/gm-transaction-log');
const { findReceivablePo, isOpenLine } = require('../lib/po-receiving');
const { findPartByBarcode } = require('../lib/parts-barcode-lookup');
const { DATABASE_TYPES, recordPartOperation, buildDatabaseRecords } = require('../lib/pm-database-records');

const router = express.Router();

const PM_ROLES = new Set(['parts_manager', 'pm', 'parts_clerk']);
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

// Falls back to the GM-controlled Part Retail Margin (Control Panel) when no markup is entered on the form.
function resolveMarkupPercent(rawMarkup, settings) {
  const raw = String(rawMarkup == null ? '' : rawMarkup).trim();
  if (raw !== '') return toNumber(rawMarkup);
  return toNumber(settings && settings.parts_retail_margin_percent);
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

function rowDateKey(row) {
  const raw = String((row && (row.transaction_date || row.date || row.created_at)) || '').trim();
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return parsed.getFullYear() + '-' + pad(parsed.getMonth() + 1) + '-' + pad(parsed.getDate());
}

function filterPartsInventory(parts, query) {
  const q = String((query && query.q) || '').trim().toLowerCase();
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  const dateFrom = dateRe.test(String((query && query.date_from) || '').trim()) ? String(query.date_from).trim() : '';
  const dateTo = dateRe.test(String((query && query.date_to) || '').trim()) ? String(query.date_to).trim() : '';
  const stockSortRaw = String((query && query.stock_sort) || '').trim().toLowerCase();
  const stockSort = stockSortRaw === 'asc' || stockSortRaw === 'desc' ? stockSortRaw : '';
  const filterType = String((query && query.type) || '').trim();
  const location = String((query && query.location) || '').trim();
  let filtered = Array.isArray(parts) ? parts : [];
  if (q) {
    filtered = filtered.filter((p) =>
      [p.transaction_number, p.part_number, p.part_name, p.sub_id, p.generic, p.supplier, p.sold_to, p.editor, p.present_location, p.branch]
        .some((f) => String(f || '').toLowerCase().includes(q))
    );
  }
  if (dateFrom || dateTo) {
    filtered = filtered.filter((p) => {
      const key = rowDateKey(p);
      if (!key) return false;
      return (!dateFrom || key >= dateFrom) && (!dateTo || key <= dateTo);
    });
  }
  if (filterType) {
    filtered = filtered.filter((p) => p.database_type === filterType);
  }
  if (location && location.toLowerCase() !== 'all') {
    filtered = filtered.filter((p) => sameLocation(p.present_location || p.branch || p.requesting_branch, location));
  }
  return { filtered, q, filterType, location, dateFrom, dateTo, stockSort };
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
  const safetyThreshold = 5;
  const rows = (data.parts_inventory || []).filter((p) => !isPartsActivityLog(p));
  const auditRows = inventory.allAuditRows(data);
  const warehouseStock = stockByLocation(auditRows, WAREHOUSE_1);
  const branchStocks = new Map(DEFAULT_OPERATIONAL_BRANCHES.map((branch) => [
    branch,
    stockByLocation(auditRows, branch),
  ]));
  const metadata = new Map();

  rows.forEach((p) => {
    const partNumber = String(p.part_number || '').trim();
    const key = inventory.normalizePartNumberKey(partNumber);
    const subId = String(p.sub_id || '').trim().toLowerCase().replace(/[\s-]/g, '');
    if (!key || subId === 'xparts') return;
    if (!metadata.has(key)) metadata.set(key, p);
  });

  const delicate = [];
  metadata.forEach((part, key) => {
    const warehouseQty = toNumber(warehouseStock.get(key));
    if (warehouseQty <= 0) return;

    branchStocks.forEach((stock, branch) => {
      const branchQty = toNumber(stock.get(key));
      if (branchQty >= safetyThreshold) return;
      const status = ['Critical Low', `W1 Available: ${warehouseQty}`];
      if (!String(part.supplier || '').trim()) status.push('No Supplier');
      if (toNumber(part.cost_price) === 0) status.push('$0 Cost');
      delicate.push({
        id: part.id,
        part_number: String(part.part_number || '').trim(),
        part_name: String(part.part_name || '').trim(),
        supplier: String(part.supplier || '').trim(),
        location: branch,
        source_location: WAREHOUSE_1,
        current_stock: branchQty,
        safety_stock: safetyThreshold,
        cost_price: toNumber(part.cost_price),
        status: status.join(' | '),
      });
    });
  });

  // Keep each branch and Warehouse 1 visible as its own health row.
  return delicate.sort((a, b) => {
    const locationOrder = a.location.localeCompare(b.location);
    if (locationOrder !== 0) return locationOrder;
    const aScore = (a.current_stock === 0 ? 10 : 0) + (a.status.includes('Critical Low') ? 5 : 0);
    const bScore = (b.current_stock === 0 ? 10 : 0) + (b.status.includes('Critical Low') ? 5 : 0);
    return bScore - aScore;
  });
}

async function loadWorkspaceLocals(req) {
  const data = await store.getRawData();
  inventory.ensureCollections(data);
  const dashboardLogs = buildDatabaseRecords(data);
  const { filtered, q, filterType, location, dateFrom, dateTo, stockSort } = filterPartsInventory(dashboardLogs, req.query);
  const scopedData = location ? filterDataToLocation(data, location) : data;
  const viewRows = withLocationOnHand(
    inventory.attachOnHand(scopedData, filtered),
    inventory.allAuditRows(data),
    location || ''
  );
  if (stockSort) {
    const dir = stockSort === 'asc' ? 1 : -1;
    viewRows.sort((a, b) => dir * ((Number(a.on_hand) || 0) - (Number(b.on_hand) || 0)));
  }
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

  const approvedTransfers = (data.parts_transfers || [])
    .filter((row) => String(row.status || '').trim().toLowerCase() === 'approved')
    .sort((a, b) => new Date(b.approved_at || 0) - new Date(a.approved_at || 0));

  return {
    parts: viewRows,
    total: viewRows.length,
    q,
    filterType,
    locationFilter: location,
    dateFrom,
    dateTo,
    stockSort,
    transactionTypes: VALID_PARTS_TRANSACTION_TYPES,
    databaseTypes: DATABASE_TYPES,
    displayPartsTransactionType,
    normalizePartsTransactionType,
    isSoldTransaction: inventory.isSoldTransaction,
    transactionQty: inventory.transactionQty,
    locationOptions,
    warehouse1: WAREHOUSE_1,
    vitals,
    approvals,
    healthMetrics,
    delicateParts,
    approvedPOs,
    approvedTransfers,
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

// Used when the GM Control Panel turns the stock-transfer GM approval step off.
function transferAmount(transfer) {
  return transferLineList(transfer).reduce((sum, line) => sum + (Number(line.qty) || 0) * (Number(line.cost_price) || 0), 0);
}

function poAmount(po) {
  return (po.lines || []).reduce((sum, line) => sum + (Number(line.qty) || 0) * (Number(line.cost_price) || 0), 0);
}

function autoApproveTransfer(data, transfer) {
  transfer.status = 'approved';
  transfer.approved_at = new Date().toISOString();
  transfer.approved_by = approvalControls.AUTO_APPROVER;
  transfer.auto_approved = true;
  recordGmApproval(data, {
    transaction_number: transfer.transaction_number || transfer.id,
    type: GM_TXN_TYPES.STOCK_TRANSFER,
    requester_name: transfer.editor || '',
    requested_at: transfer.created_at || transfer.stamped_at || '',
    amount: transferLineList(transfer).reduce((sum, line) => sum + (Number(line.qty) || 0) * (Number(line.cost_price) || 0), 0),
    approved_at: transfer.approved_at,
    approved_by: approvalControls.AUTO_APPROVER,
  });
}

// Used when the GM Control Panel turns the PO GM approval step off.
function autoApprovePurchaseOrder(data, po) {
  po.status = 'approved';
  po.approved_at = new Date().toISOString();
  po.approved_by = approvalControls.AUTO_APPROVER;
  po.auto_approved = true;
  recordGmApproval(data, {
    transaction_number: po.transaction_number || po.po_number || po.id,
    type: GM_TXN_TYPES.PO,
    requester_name: po.created_by || po.sent_for_approval_by || '',
    requested_at: po.sent_for_approval_at || po.created_at || '',
    amount: (po.lines || []).reduce((sum, line) => sum + (Number(line.qty) || 0) * (Number(line.cost_price) || 0), 0),
    approved_at: po.approved_at,
    approved_by: approvalControls.AUTO_APPROVER,
  });
}

// Approves a pending parts request exactly like the Parts Manager "Proceed" action.
// Called right after a request is filed when the Control Panel turns that approval step off.
async function autoApprovePartsRequestIfEnabled(requestId) {
  const controls = await store.getApprovalControls();
  if (approvalControls.isRequired(controls, 'parts_request_approval')) return null;
  const bundle = await loadPendingRequestBundle(requestId);
  if (!bundle) return null;
  const unitPrice = Number(bundle.mapped.cost_price) || Number(bundle.mapped.retail_price) || 0;
  const amount = (Number(bundle.mapped.qty) || 0) * unitPrice;
  if (!approvalControls.autoApproves(controls, 'parts_request_approval', amount)) return null;
  const resolver = approvalControls.AUTO_APPROVER;
  const resolvedAt = new Date().toISOString();
  if (bundle.kind === 'inventory') {
    await store.update('parts_inventory', bundle.raw.id, { request_status: 'approved', resolved_at: resolvedAt, resolved_by: resolver });
  } else {
    await store.update('parts_requests', bundle.raw.id, { status: 'approved', resolved_at: resolvedAt, resolved_by: resolver });
  }
  const { record } = await finalizeApprovedRequest(bundle.mapped, resolver, warehouseFulfillmentExtras(bundle.mapped));
  return record;
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

function renderApprovePrint(res, locals) {
  return res.render('parts-manager/approve-print', locals);
}

function findTransfer(data, id) {
  return (data.parts_transfers || []).find((row) => String(row.id) === String(id)) || null;
}

function recordTransactionMade(data, req, kind, record, status, extra) {
  if (!Array.isArray(data.transactions_made)) data.transactions_made = [];
  const entry = Object.assign({
    id: genId(),
    kind,
    status,
    ref_id: record.id,
    reference_number: record.po_number || record.transaction_number || record.id,
    supplier: record.supplier || '',
    from_branch: record.from_branch || '',
    to_branch: record.to_branch || '',
    lines: Array.isArray(record.lines) ? record.lines.map((line) => Object.assign({}, line)) : [],
    approved_by: record.approved_by || '',
    approved_at: record.approved_at || '',
    recorded_by: currentEditor(req),
    recorded_at: new Date().toISOString(),
  }, extra || {});
  data.transactions_made.push(entry);
  return entry;
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

  if (['in_transit', 'branch receiving'].includes(String(transfer.status || '').toLowerCase())) {
    const transitRow = (data.parts_inventory || []).find((row) => (
      String(row.linked_transfer_id || '') === String(transfer.id)
      && String(row.fulfillment_status || '').toLowerCase() === 'in_transit'
    ));
    if (transitRow) return res.redirect('/parts-manager/approved/' + encodeURIComponent(transitRow.id));
    return res.redirect('/parts-manager?panel=approvals&error=' + encodeURIComponent('Transit rows are missing for this transfer.'));
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
    proceedAction: String(transfer.status || '').toLowerCase() === 'approved'
      ? '/parts-manager/transfers/' + encodeURIComponent(transfer.id) + '/transit'
      : '/parts-manager/transfers/' + encodeURIComponent(transfer.id) + '/proceed',
    actionLabel: String(transfer.status || '').toLowerCase() === 'approved'
      ? 'Create Transit Receipt'
      : 'Approve Transfer',
    cancelHref: '/parts-manager?panel=approvals',
    removeAction: String(transfer.status || '').toLowerCase() === 'approved'
      ? '/parts-manager/transfers/' + encodeURIComponent(transfer.id) + '/pm-remove'
      : '',
    autoPrint: '',
    error: '',
    success: '',
  });
});

router.post('/transfers/:id/remove', async (req, res) => {
  const approverRole = String(req.session?.user?.role || '').trim().toLowerCase();
  if (approverRole !== 'general_manager') {
    return res.redirect('/approvals?error=' + encodeURIComponent('Only the General Manager can remove stock transfers.'));
  }

  const data = await store.getRawData();
  const transferIndex = (data.parts_transfers || []).findIndex((row) => String(row.id) === String(req.params.id));
  if (transferIndex === -1) return res.redirect('/approvals?error=' + encodeURIComponent('Transfer not found.'));

  const transfer = data.parts_transfers[transferIndex];
  if (String(transfer.status || '').toLowerCase() !== 'pending') {
    return res.redirect('/approvals?error=' + encodeURIComponent('Only pending transfers can be removed.'));
  }

  // Keep the transfer as a rejected record (GM My Record) instead of deleting it.
  transfer.status = 'rejected';
  transfer.rejected_at = new Date().toISOString();
  transfer.rejected_by = currentEditor(req);
  data.parts_inventory = (data.parts_inventory || []).filter((row) => (
    String(row.linked_transfer_id || '') !== String(transfer.id)
    || row.approved_at
  ));
  data.parts_documents = (data.parts_documents || []).filter((document) => (
    String(document.related_id || '') !== String(transfer.id)
  ));
  await store.replaceData(data);
  return res.redirect('/approvals?success=' + encodeURIComponent(`Stock transfer ${transfer.transaction_number || transfer.id} rejected.`));
});

router.post('/transfers/:id/pm-remove', async (req, res) => {
  const role = String(req.session?.user?.role || '').trim().toLowerCase();
  if (!isPartsManagerRole(role)) {
    return res.redirect('/parts-manager?panel=approvals&error=' + encodeURIComponent('Parts Manager access is required to remove an approved transfer.'));
  }
  const data = await store.getRawData();
  const transfer = findTransfer(data, req.params.id);
  if (!transfer || String(transfer.status || '').toLowerCase() !== 'approved') {
    return res.redirect('/parts-manager?panel=approvals&error=' + encodeURIComponent('Approved transfer not found.'));
  }
  transfer.status = 'removed';
  transfer.removed_at = new Date().toISOString();
  transfer.removed_by = currentEditor(req);
  recordTransactionMade(data, req, 'transfer', transfer, 'remove', { removed_at: transfer.removed_at });
  await store.replaceData(data);
  return res.redirect('/parts-manager?panel=approvals&success=' + encodeURIComponent(`Transfer ${transfer.transaction_number || transfer.id} removed and recorded.`));
});

router.post('/transfers/:id/proceed', async (req, res) => {
  const approverRole = String(req.session?.user?.role || '').trim().toLowerCase();
  if (approverRole !== 'general_manager') {
    return res.redirect('/parts-manager?panel=approvals&error=' + encodeURIComponent('Only the General Manager can approve and complete stock transfers.'));
  }

  const data = await store.getRawData();
  const transfer = findTransfer(data, req.params.id);
  if (!transfer) {
    return res.redirect('/parts-manager?panel=approvals&error=' + encodeURIComponent('Transfer not found.'));
  }
  if (['rejected', 'removed'].includes(String(transfer.status || '').toLowerCase())) {
    return res.redirect('/approvals?error=' + encodeURIComponent(`Transfer ${transfer.transaction_number || transfer.id} was ${transfer.status} and cannot be approved.`));
  }

  const editor = currentEditor(req);
  transfer.status = 'approved';
  transfer.approved_at = new Date().toISOString();
  transfer.approved_by = editor;

  const transferAmount = transferLineList(transfer).reduce((sum, line) => sum + (Number(line.qty) || 0) * (Number(line.cost_price) || 0), 0);
  recordGmApproval(data, {
    transaction_number: transfer.transaction_number || transfer.id,
    type: GM_TXN_TYPES.STOCK_TRANSFER,
    requester_name: transfer.editor || '',
    requested_at: transfer.created_at || '',
    amount: transferAmount,
    approved_at: transfer.approved_at,
    approved_by: editor,
  });

  await store.replaceData(data);
  return res.redirect('/approvals?success=' + encodeURIComponent(`Stock transfer ${transfer.transaction_number || transfer.id} approved.`));
});

router.post('/transfers/:id/transit', async (req, res) => {
  const role = String(req.session?.user?.role || '').trim().toLowerCase();
  if (!isPartsManagerRole(role)) {
    return res.redirect('/parts-manager?panel=approvals&error=' + encodeURIComponent('Parts Manager access is required to create a transit receipt.'));
  }
  const data = await store.getRawData();
  const transfer = findTransfer(data, req.params.id);
  if (!transfer) return res.redirect('/parts-manager?panel=approvals&error=' + encodeURIComponent('Transfer not found.'));
  if (String(transfer.status || '').toLowerCase() !== 'approved') {
    return res.redirect('/parts-manager?panel=approvals&error=' + encodeURIComponent('GM approval is required before creating a transit receipt.'));
  }

  const existingTransitRow = (data.parts_inventory || []).find((row) => (
    String(row.linked_transfer_id || '') === String(transfer.id)
    && String(row.fulfillment_status || '').toLowerCase() === 'in_transit'
  ));
  if (existingTransitRow) {
    return res.redirect('/parts-manager/approved/' + encodeURIComponent(existingTransitRow.id) + '?print=1');
  }

  const transitRows = dispatchTransferToBranch(data, transfer, currentEditor(req));
  transfer.status = 'in_transit';
  recordTransactionMade(data, req, 'transfer', transfer, 'executed', { executed_at: transfer.transit_at });
  await store.replaceData(data);
  const source = mapTransferAsRequest(transfer);
  await saveApprovedReceipt(transitRows[0], source);
  return res.redirect('/parts-manager/approved/' + encodeURIComponent(transitRows[0].id) + '?print=1');
});

// Branch-receivable rows (parts request, in_transit) linked to this transfer.
function transferDispatchRows(data, transfer) {
  return (data.parts_inventory || []).filter((row) => (
    String(row.linked_transfer_id || '') === String(transfer.id)
    && row.approved_at
    && isPartsRequestType(row.transaction_type)
  ));
}

// Creates one in-transit "parts request" row per transfer line so the destination
// branch can load the PTN / packing list / transmittal in Parts Receiving.
function dispatchTransferToBranch(data, transfer, editor) {
  if (!Array.isArray(data.parts_inventory)) data.parts_inventory = [];
  const stamp = stampNow();
  const barcodes = new Map();
  data.parts_inventory.forEach((row) => {
    const key = String(row.part_number || '').trim().toUpperCase();
    if (key && String(row.barcode || '').trim()) barcodes.set(key, String(row.barcode).trim());
  });
  const transitRows = transferLineList(transfer).map((line) => {
    const row = {
      id: genId(),
      created_at: stamp.iso,
      transaction_date: stamp.date,
      transaction_number: allocatePartsTransactionNumber(data),
      transaction_type: 'parts request',
      present_location: transfer.from_branch,
      branch: transfer.from_branch,
      requesting_branch: transfer.to_branch,
      from_branch: transfer.from_branch,
      to_branch: transfer.to_branch,
      editor,
      part_number: line.part_number,
      part_name: line.part_name,
      sub_id: line.sub_id,
      unit: line.unit || '',
      qty: toNumber(line.qty),
      cost_price: line.cost_price,
      retail_price: line.retail_price,
      supplier: line.supplier || '',
      barcode: line.barcode || barcodes.get(String(line.part_number || '').trim().toUpperCase()) || '',
      sold_to: transfer.to_branch,
      linked_transfer_id: transfer.id,
      approved_at: stamp.iso,
      approved_by: transfer.approved_by || editor,
      request_status: 'approved',
      fulfillment_status: 'in_transit',
      packing_list_number: transfer.packing_list_number,
      transmittal_number: transfer.transmittal_number,
    };
    data.parts_inventory.push(row);
    inventory.rememberTransaction(data, row);
    return row;
  });
  transfer.transit_at = stamp.iso;
  transfer.transit_by = editor;
  return transitRows;
}

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

router.get('/multiple-entry', async (req, res) => {
  const data = await store.getRawData();
  return res.render('parts-manager/multiple-entry', {
    warehouse1: WAREHOUSE_1,
    locationOptions: pmLocationOptions(data),
    error: req.query.error || '',
    success: req.query.success || '',
  });
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
  const markup = resolveMarkupPercent(body.markup, data.pricing_settings);
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
    barcode: body.barcode !== undefined ? String(body.barcode || '').trim() : String(existing.barcode || '').trim(),
    updated_at: new Date().toISOString(),
  });

  inventory.rememberTransaction(data, data.parts_inventory[idx]);
  recordPartOperation(data, data.parts_inventory[idx], 'edit', currentEditor(req));
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
    recordPartOperation(data, removed, 'remove', currentEditor(req));
    data.parts_inventory.splice(idx, 1);
    inventory.rebuildPartCatalogEntry(data, removed.part_number);
    await store.replaceData(data);
  }
  return res.redirect('/parts-manager?success=' + encodeURIComponent('Dashboard entry removed. Audit history was kept.'));
});

router.post('/transactions/:id/delete', async (req, res) => {
  const data = await store.getRawData();
  const selected = inventory.allAuditRows(data)
    .find((row) => String(row.id) === String(req.params.id));
  if (!selected) {
    return res.redirect('/parts-manager?error=' + encodeURIComponent('Transaction record not found.'));
  }

  const transactionNumber = String(selected.transaction_number || '').trim();
  const matchesSelectedTransaction = (row) => transactionNumber
    ? String(row && row.transaction_number || '').trim() === transactionNumber
    : String(row && row.id || '') === String(selected.id);

  inventory.allAuditRows(data).filter(matchesSelectedTransaction).forEach((row) => {
    recordPartOperation(data, row, 'remove', currentEditor(req));
  });
  data.parts_inventory = (data.parts_inventory || []).filter((row) => !matchesSelectedTransaction(row));
  data.transactions = (data.transactions || []).filter((row) => !matchesSelectedTransaction(row));
  inventory.rebuildPartsCatalog(data);
  await store.replaceData(data);

  const label = transactionNumber || selected.id;
  return res.redirect('/parts-manager?success=' + encodeURIComponent(`Transaction ${label} removed.`));
});

router.post('/transactions/:id/activate-number', async (req, res) => {
  const data = await store.getRawData();
  const row = (data.parts_inventory || []).find((item) => String(item.id) === String(req.params.id));
  if (!row) return res.status(404).json({ error: 'Transaction record not found.' });
  const transactionNumber = String(row.transaction_number || '').trim() || allocatePartsTransactionNumber(data);
  row.transaction_number = transactionNumber;
  inventory.rememberTransaction(data, row);
  await store.replaceData(data);
  return res.json({ ok: true, transaction_number: transactionNumber });
});

router.get('/print/transaction/:id', async (req, res) => {
  const data = await store.getRawData();
  const row = inventory.allAuditRows(data).find((item) => String(item.id) === String(req.params.id));
  if (!row) return res.status(404).send('Transaction record not found.');
  const esc = (value) => String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const number = row.transaction_number || row.id || '—';
  return res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><title>Transaction Report ${esc(number)}</title><link rel="stylesheet" href="/fonts/inter.css"><style>body{font-family:"Inter","Segoe UI",Roboto,Arial,sans-serif;margin:24px;color:#10202f}h1{margin-bottom:4px}table{border-collapse:collapse;width:100%;max-width:720px}th,td{border:1px solid #ccd5df;padding:8px;text-align:left}th{width:30%;background:#eef4fb}.actions{margin-top:20px}@media print{.actions{display:none}}</style></head><body><h1>Parts Transaction Report</h1><p>Transaction Number: <strong>${esc(number)}</strong></p><table><tbody><tr><th>Date</th><td>${esc(row.transaction_date || row.created_at || '')}</td></tr><tr><th>Type</th><td>${esc(row.transaction_type || '')}</td></tr><tr><th>Location</th><td>${esc(row.present_location || row.branch || '')}</td></tr><tr><th>Part Number</th><td>${esc(row.part_number || '')}</td></tr><tr><th>Part Name</th><td>${esc(row.part_name || '')}</td></tr><tr><th>Quantity</th><td>${esc(row.qty)}</td></tr><tr><th>Supplier</th><td>${esc(row.supplier || '')}</td></tr><tr><th>Editor</th><td>${esc(row.editor || '')}</td></tr></tbody></table><div class="actions"><button type="button" onclick="window.print()">Print</button></div></body></html>`);
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

router.post('/transfers/:id/transmit', async (req, res) => {
  const data = await store.getRawData();
  const transfer = findTransfer(data, req.params.id);
  if (!transfer) return res.redirect('/parts-manager?panel=approvals&error=' + encodeURIComponent('Transfer not found.'));
  const currentStatus = String(transfer.status || '').toLowerCase();
  if (['rejected', 'removed', 'completed'].includes(currentStatus)) {
    return res.redirect('/parts-manager?panel=approvals&error=' + encodeURIComponent(`Transfer ${transfer.transaction_number || transfer.id} is ${transfer.status} and cannot be transmitted.`));
  }
  if (!transfer.approved_at) {
    return res.redirect('/parts-manager?panel=approvals&error=' + encodeURIComponent('GM approval is required before transmitting this transfer to the branch.'));
  }

  const editor = currentEditor(req);
  let dispatched = transferDispatchRows(data, transfer);
  if (!dispatched.length) {
    dispatched = dispatchTransferToBranch(data, transfer, editor);
    recordTransactionMade(data, req, 'transfer', transfer, 'executed', { executed_at: transfer.transit_at });
  }
  transfer.status = 'Branch Receiving';
  transfer.transmitted_at = new Date().toISOString();
  transfer.transmitted_by = editor;
  await store.replaceData(data);
  return res.redirect('/parts-manager?panel=approvals&success=' + encodeURIComponent(`Transmittal ${transfer.transmittal_number || transfer.id} sent. Status set to Branch Receiving — ${transfer.to_branch} can now load ${transfer.transaction_number || ''} in Parts Receiving.`));
});

router.get('/print/po/:id', async (req, res) => {
  const data = await store.getRawData();
  const record = findPurchaseOrder(data, req.params.id);
  if (!record) return res.status(404).send('Purchase order not found.');
  const returnHtml = '<a href="/parts-manager?panel=proc-po-records" style="display:inline-block;margin-left:8px;padding:2px 10px;border:1px solid #767676;border-radius:3px;background:#efefef;color:#10202f;text-decoration:none;font:13px Arial,sans-serif;">RETURN TO PO RECORDS</a>';
  return res.type('html').send(buildPurchaseOrderHtml(record, { autoPrint: String(req.query.print || '') === '1', actionsHtml: returnHtml }));
});

router.get('/po-details/:id', async (req, res) => {
  const data = await store.getRawData();
  const record = findPurchaseOrder(data, req.params.id);
  if (!record) return res.status(404).send('Purchase order not found.');
  return res.type('html').send(buildPurchaseOrderDetailsHtml(record));
});

router.get('/po/:id', async (req, res) => {
  const data = await store.getRawData();
  const po = findPurchaseOrder(data, req.params.id);
  if (!po || String(po.status || '').trim().toLowerCase() !== 'approved') {
    return res.redirect('/parts-manager?panel=approvals&error=' + encodeURIComponent('Approved purchase order not found.'));
  }
  const id = encodeURIComponent(po.id);
  const actionsHtml = `
    <form method="post" action="/parts-manager/po/${id}/proceed" style="display:inline-block;margin-left:8px;">
      <button type="submit">Proceed</button>
    </form>
    <form method="post" action="/parts-manager/po/${id}/remove" style="display:inline-block;margin-left:8px;" onsubmit="return confirm('Remove this ticket? It will be recorded with status remove.');">
      <button type="submit">Remove</button>
    </form>
    <a href="/parts-manager?panel=approvals" style="margin-left:8px;">Back</a>`;
  return res.type('html').send(buildPurchaseOrderHtml(po, { actionsHtml }));
});

router.post('/po/:id/proceed', async (req, res) => {
  const role = String(req.session?.user?.role || '').trim().toLowerCase();
  if (!isPartsManagerRole(role)) {
    return res.redirect('/parts-manager?panel=approvals&error=' + encodeURIComponent('Parts Manager access is required.'));
  }
  const data = await store.getRawData();
  const po = findPurchaseOrder(data, req.params.id);
  if (!po || String(po.status || '').trim().toLowerCase() !== 'approved') {
    return res.redirect('/parts-manager?panel=approvals&error=' + encodeURIComponent('Approved purchase order not found.'));
  }
  po.status = 'purchased';
  po.purchased_at = new Date().toISOString();
  po.purchased_by = currentEditor(req);
  recordTransactionMade(data, req, 'purchase_order', po, 'purchased', { purchased_at: po.purchased_at });
  await store.replaceData(data);
  return res.redirect('/parts-manager/print/po/' + encodeURIComponent(po.id) + '?print=1');
});

router.post('/po/:id/remove', async (req, res) => {
  const role = String(req.session?.user?.role || '').trim().toLowerCase();
  if (!isPartsManagerRole(role)) {
    return res.redirect('/parts-manager?panel=approvals&error=' + encodeURIComponent('Parts Manager access is required.'));
  }
  const data = await store.getRawData();
  const po = findPurchaseOrder(data, req.params.id);
  if (!po || String(po.status || '').trim().toLowerCase() !== 'approved') {
    return res.redirect('/parts-manager?panel=approvals&error=' + encodeURIComponent('Approved purchase order not found.'));
  }
  po.status = 'removed';
  po.removed_at = new Date().toISOString();
  po.removed_by = currentEditor(req);
  recordTransactionMade(data, req, 'purchase_order', po, 'remove', { removed_at: po.removed_at });
  await store.replaceData(data);
  return res.redirect('/parts-manager?panel=approvals&success=' + encodeURIComponent(`Purchase order ${po.po_number || po.id} removed and recorded.`));
});

// Warehouse 1 shortfalls for the combined lines of every transfer in a batch.
function warehouseShortfalls(data, groups) {
  const requested = new Map();
  groups.filter((g) => sameLocation(g.fromBranch, WAREHOUSE_1)).forEach((g) => g.lines.forEach((line) => {
    const key = inventory.normalizePartNumberKey(line.part_number);
    requested.set(key, { part_number: line.part_number, qty: ((requested.get(key) || {}).qty || 0) + line.qty });
  }));
  if (!requested.size) return [];
  const stock = stockByLocation(inventory.allAuditRows(data), WAREHOUSE_1);
  return Array.from(requested.entries())
    .filter(([key, item]) => (stock.get(key) || 0) < item.qty)
    .map(([key, item]) => `${item.part_number} (requested ${item.qty}, on hand ${stock.get(key) || 0})`);
}

// Files one stock transfer (one PTN + packing list + transmittal) for a single source -> destination.
function createStockTransfer(data, { fromBranch, toBranch, lines, editor }) {
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
  const autoApproved = approvalControls.autoApproves(approvalControls.fromData(data), 'stock_transfer_gm_approval', transferAmount(transfer));
  if (autoApproved) autoApproveTransfer(data, transfer);

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

  [['packing_list', transfer.packing_list_number, 'Packing List'], ['transmittal', transfer.transmittal_number, 'Transmittal List']]
    .forEach(([kind, serial, title]) => rememberDocument(data, {
      kind,
      serial,
      transaction_number: transfer.transaction_number,
      related_id: transfer.id,
      created_by: editor,
      title,
      from_branch: fromBranch,
      to_branch: toBranch,
    }));
  return { transfer, autoApproved };
}

router.post('/transfer', async (req, res) => {
  const data = await store.getRawData();
  const fromBranch = resolvePmLocation(req.body.from_branch, data);
  const toBranch = resolvePmLocation(req.body.to_branch, data);
  const lines = parseLines(req.body);

  if (!fromBranch || !toBranch || fromBranch === toBranch) {
    return res.redirect('/parts-manager?panel=approvals&error=' + encodeURIComponent('Select distinct source and destination locations.'));
  }
  if (!lines.length) {
    return res.redirect('/parts-manager?panel=approvals&error=' + encodeURIComponent('Part number and quantity are required.'));
  }
  if (warehouseShortfalls(data, [{ fromBranch, lines }]).length) {
    return res.redirect('/parts-manager?panel=approvals&error=' + encodeURIComponent('Under Stocks for the Request'));
  }

  const { transfer, autoApproved } = createStockTransfer(data, { fromBranch, toBranch, lines, editor: currentEditor(req) });
  await store.replaceData(data);
  return res.redirect('/parts-manager?panel=approvals&success=' + encodeURIComponent(autoApproved
    ? `Transfer ${transfer.transaction_number} filed and auto-approved (within the GM Control Panel auto-approve range).`
    : `Transfer ${transfer.transaction_number} filed.`));
});

/**
 * POST /transfers/batch  { lines: [{ from_branch, to_branch, part_number, part_name, sub_id, qty, unit }] }
 * Splits the staged lines by source -> destination and files one PTN per destination.
 * All-or-nothing: nothing is saved if any group is invalid or Warehouse 1 is short.
 */
router.post('/transfers/batch', async (req, res) => {
  const data = await store.getRawData();
  const raw = Array.isArray(req.body && req.body.lines) ? req.body.lines : [];
  const groups = new Map();
  const problems = [];
  raw.forEach((item, index) => {
    const fromBranch = resolvePmLocation(item.from_branch, data);
    const toBranch = resolvePmLocation(item.to_branch, data);
    const [line] = parseLines({ lines: JSON.stringify([item]) });
    if (!line) return problems.push(`Line ${index + 1}: part number and quantity are required.`);
    if (!fromBranch || !toBranch || sameLocation(fromBranch, toBranch)) {
      return problems.push(`Line ${index + 1} (${line.part_number}): choose a destination different from ${fromBranch || 'the source'}.`);
    }
    const key = `${fromBranch}|${toBranch}`;
    if (!groups.has(key)) groups.set(key, { fromBranch, toBranch, lines: [] });
    const group = groups.get(key);
    const same = group.lines.find((l) => l.part_number.toUpperCase() === line.part_number.toUpperCase() && l.sub_id === line.sub_id);
    if (same) same.qty += line.qty;
    else group.lines.push(line);
  });
  if (!raw.length) problems.push('No lines to transfer.');
  if (problems.length) return res.status(400).json({ ok: false, error: problems.join(' ') });

  const list = Array.from(groups.values());
  const short = warehouseShortfalls(data, list);
  if (short.length) {
    return res.status(400).json({ ok: false, error: `Under Stocks for the Request: ${short.join('; ')}. No transfers were filed.` });
  }

  const editor = currentEditor(req);
  const created = list.map((group) => {
    const { transfer, autoApproved } = createStockTransfer(data, Object.assign({ editor }, group));
    return {
      id: transfer.id,
      transaction_number: transfer.transaction_number,
      packing_list_number: transfer.packing_list_number,
      transmittal_number: transfer.transmittal_number,
      from_branch: transfer.from_branch,
      to_branch: transfer.to_branch,
      lines: transfer.lines.length,
      qty: transfer.lines.reduce((sum, l) => sum + l.qty, 0),
      status: transfer.status,
      auto_approved: autoApproved,
    };
  });
  await store.replaceData(data);
  return res.json({
    ok: true,
    transfers: created,
    message: `${raw.length} line(s) split into ${created.length} stock transfer(s): `
      + created.map((t) => `${t.transaction_number} → ${t.to_branch} (${t.lines} line${t.lines === 1 ? '' : 's'})${t.auto_approved ? ' auto-approved' : ''}`).join(', ') + '.',
  });
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
    lines: inventory.preparePurchaseLines(data, lines),
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
  return res.status(409).json({ error: 'Transfers are completed by Service receiving after PM transit processing.' });
});

function buildPoRestockRow(data, po, line, location, editor, stamp, qty) {
  return inventory.prepareReceipt(data, {
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
    generic: line.generic || '',
    receiving_receipt_number: line.receiving_receipt_number || '',
    barcode: line.barcode || '',
    supplier: line.supplier || po.supplier,
    qty,
    unit: line.unit || '',
    cost_price: toNumber(line.cost_price),
    markup: toNumber(line.markup),
    retail_price: toNumber(line.retail_price),
    sold_to: '',
    linked_po_id: po.id,
    po_number: po.po_number || '',
  });
}

// Closes the PO once every remaining line has been Received.
function closePoIfDone(po, editor, stamp) {
  const lines = Array.isArray(po.lines) ? po.lines : [];
  if (!lines.length || !lines.every((line) => !isOpenLine(line))) return false;
  po.status = 'closed';
  po.closed_at = stamp.iso;
  po.closed_by = editor;
  return true;
}

router.post('/api/purchase-orders/:id/receive', async (req, res) => {
  const data = await store.getRawData();
  const po = findPurchaseOrder(data, req.params.id);
  if (!po) return res.status(404).json({ error: 'Purchase order not found.' });
  if (['received', 'closed'].includes(String(po.status || '').trim().toLowerCase())) {
    return res.status(409).json({ error: `PO ${po.po_number || po.id} is already closed.` });
  }

  const stamp = stampNow();
  const editor = currentEditor(req);
  const location = po.branch || po.present_location || WAREHOUSE_1;
  if (!Array.isArray(po.lines) || !po.lines.length) {
    po.lines = [{ part_number: po.part_number, part_name: po.part_name, qty: po.qty, supplier: po.supplier }];
  }

  // Lines already marked in the Multiple Entry grid are not received a second time.
  po.lines.filter(isOpenLine).forEach((line) => {
    line.receive_status = 'received';
    line.decided_at = stamp.iso;
    line.decided_by = editor;
    if (!line.part_number || toNumber(line.qty) <= 0) return;
    const row = buildPoRestockRow(data, po, line, location, editor, stamp, toNumber(line.qty));
    line.transaction_type = row.transaction_type;
    line.initial_receipt_id = row.initial_receipt_id;
    line.receipt_id = row.id;
    data.parts_inventory.push(row);
    inventory.rememberTransaction(data, row);
  });

  po.received_at = stamp.iso;
  po.received_by = editor;
  closePoIfDone(po, editor, stamp);
  po.stamped_at = stamp.iso;
  po.stamped_label = stamp.label;
  stockAlerts.reconcileWarehouse1Stock(data);
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
 * GET /api/parts/find-by-barcode/:barcode
 * Uses received stock first, then saved PO lines so ordering can look up items before receipt.
 */
router.get('/api/parts/find-by-barcode/:barcode', async (req, res) => {
  try {
    const barcode = String(req.params.barcode || '').trim().toUpperCase();
    if (!barcode) {
      return res.status(400).json({ error: 'Barcode required.' });
    }

    const data = await store.getRawData();
    const part = findPartByBarcode(data, barcode);

    if (!part) {
      return res.status(404).json({ error: 'Barcode not found', found: false });
    }

    return res.json({
      found: true,
      barcode: String(part.barcode || '').trim(),
      part_number: part.part_number || '',
      part_name: part.part_name || '',
      sub_id: part.sub_id || '',
      generic: part.generic || '',
      supplier: part.supplier || '',
      unit: part.unit || '',
      cost_price: part.cost_price != null ? Number(part.cost_price) : 0,
      markup: part.markup != null ? Number(part.markup) : 0,
      retail_price: part.retail_price != null ? Number(part.retail_price) : 0,
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

router.get('/api/po-lookup/:poNumber', async (req, res) => {
  const data = await store.getRawData();
  const found = findReceivablePo(data, req.params.poNumber);
  if (!found.ok) return res.status(404).json({ ok: false, error: found.error });
  return res.json({
    ok: true,
    po_number: found.po.po_number,
    supplier: found.supplier,
    source: found.source,
    retrieved_at: new Date().toISOString(),
    lines: found.lines,
  });
});

const PO_DECISIONS = { received: 'received', no_receive: 'not_received' };

// Saves the grid under an approved PO: each line is Received (stock added now) or No receive.
// The PO is recorded as retrieved/viewed, and becomes Closed PO once every line is decided.
async function recordPoReceivingEntry(req, res, data, poNumber, entries) {
  const found = findReceivablePo(data, poNumber);
  if (!found.ok) return res.status(409).json({ ok: false, error: found.error });

  const errors = [];
  const newLines = [];
  entries.forEach((entry, index) => {
    const partNumber = String(entry.part_number || '').trim();
    const partName = String(entry.part_name || '').trim();
    const rowLabel = `Row ${index + 1}`;
    const decision = PO_DECISIONS[String(entry.receive_decision || '').trim()] || '';
    if (!partNumber) return errors.push(`${rowLabel}: Part Number is required.`);
    if (!partName) return errors.push(`${rowLabel}: Part Name is required.`);
    if (decision !== 'not_received' && toNumber(entry.qty) <= 0) return errors.push(`${rowLabel}: Qty must be greater than 0.`);
    newLines.push({
      part_number: partNumber,
      part_name: partName,
      sub_id: String(entry.sub_id || '').trim(),
      generic: String(entry.generic || '').trim(),
      supplier: String(entry.supplier || '').trim() || found.supplier,
      receiving_receipt_number: String(entry.receiving_receipt_number || '').trim(),
      unit: String(entry.unit || '').trim(),
      qty: toNumber(entry.qty),
      cost_price: toNumber(entry.cost_price),
      markup: toNumber(entry.markup),
      retail_price: toNumber(entry.retail_price),
      barcode: String(entry.barcode || '').trim(),
      receive_status: decision,
    });
  });
  if (errors.length) return res.status(400).json({ ok: false, error: errors.join(' ') });

  const editor = String(req.session?.user?.username || 'system').trim();
  const stamp = stampNow();
  if (!Array.isArray(data.parts_purchase_orders)) data.parts_purchase_orders = [];
  const location = resolvePmLocation(entries[0].present_location, data) || WAREHOUSE_1;
  let po;

  if (found.source === 'parts_purchase_orders') {
    po = found.po;
  } else {
    const source = found.po;
    const approval = (source.history || []).filter((h) => h.action === 'approved').pop() || {};
    po = {
      id: genId(),
      created_at: stamp.iso,
      supplier: found.supplier,
      branch: location,
      present_location: location,
      notes: String(source.remarks || '').trim(),
      created_by: String(source.created_by || editor),
      transaction_number: allocatePartsTransactionNumber(data),
      po_number: source.po_number,
      source_po_order_id: source.id,
      approved_at: source.approved_at || '',
      approved_by: approval.by || '',
    };
    data.parts_purchase_orders.push(po);
  }

  const stockLocation = po.branch || po.present_location || location;
  newLines.forEach((line) => {
    if (!line.receive_status) return;
    line.decided_at = stamp.iso;
    line.decided_by = editor;
    if (line.receive_status !== 'received') return;
    const row = buildPoRestockRow(data, po, line, stockLocation, editor, stamp, line.qty);
    line.transaction_type = row.transaction_type;
    line.initial_receipt_id = row.initial_receipt_id;
    line.receipt_id = row.id;
    data.parts_inventory.push(row);
    inventory.rememberTransaction(data, row);
  });

  const decidedBefore = (Array.isArray(po.lines) ? po.lines : []).filter((line) => !isOpenLine(line));
  const retrievedAt = new Date(String(req.body.po_retrieved_at || ''));
  const retrievedIso = Number.isNaN(retrievedAt.getTime()) ? stamp.iso : retrievedAt.toISOString();
  const receivedNow = newLines.filter((line) => line.receive_status === 'received').length;
  const notReceivedNow = newLines.filter((line) => line.receive_status === 'not_received').length;

  po.lines = decidedBefore.concat(newLines);
  Object.assign(po, {
    status: 'pending',
    part_number: po.lines[0].part_number,
    part_name: po.lines[0].part_name,
    qty: po.lines.reduce((sum, line) => sum + toNumber(line.qty), 0),
    receipt_entry_by: editor,
    receipt_entry_at: stamp.iso,
    retrieved_at: retrievedIso,
    retrieved_by: editor,
    stamped_at: stamp.iso,
    stamped_label: stamp.label,
  });
  po.retrieval_log = (Array.isArray(po.retrieval_log) ? po.retrieval_log : []).concat({
    retrieved_at: retrievedIso,
    saved_at: stamp.iso,
    by: editor,
    received: receivedNow,
    not_received: notReceivedNow,
  });
  const closed = closePoIfDone(po, editor, stamp);
  rememberDocument(data, {
    kind: closed ? 'purchase_order_closed' : 'purchase_order_receiving_entry',
    serial: po.po_number,
    transaction_number: po.transaction_number,
    related_id: po.id,
    created_by: editor,
    title: closed ? `PO ${po.po_number} closed` : `PO ${po.po_number} partly processed in receiving`,
  });
  stockAlerts.reconcileWarehouse1Stock(data);
  await store.replaceData(data);

  const openLeft = po.lines.filter(isOpenLine).length;
  const summary = `${receivedNow} received, ${notReceivedNow} not received`;
  return res.json({
    ok: true,
    po_processed: true,
    po_closed: closed,
    po_number: po.po_number,
    created: receivedNow,
    message: closed
      ? `PO ${po.po_number} saved (${summary}) and is now Closed PO.`
      : `PO ${po.po_number} saved (${summary}). ${openLeft} line(s) still to receive — the PO stays Receiving until they arrive, or remove the non-arriving lines under PO Records > Edit to close it.`,
  });
}

/**
 * POST /api/purchase-orders/:id/remove-lines
 * While a PO is Receiving, removes lines confirmed as not arriving (never lines already received).
 * The PO closes once every remaining line has been received.
 */
router.post('/api/purchase-orders/:id/remove-lines', async (req, res) => {
  try {
    const data = await store.getRawData();
    const po = findPurchaseOrder(data, req.params.id);
    if (!po) return res.status(404).json({ ok: false, error: 'Purchase order not found.' });
    if (String(po.status || '').trim().toLowerCase() !== 'pending') {
      return res.status(409).json({ ok: false, error: `PO ${po.po_number || po.id} is not in Receiving, so its lines cannot be removed.` });
    }
    const lines = Array.isArray(po.lines) ? po.lines : [];
    const indexes = new Set((Array.isArray(req.body.lines) ? req.body.lines : [])
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value >= 0 && value < lines.length));
    if (!indexes.size) return res.status(400).json({ ok: false, error: 'Select at least one line to remove.' });
    if ([...indexes].some((index) => !isOpenLine(lines[index]))) {
      return res.status(400).json({ ok: false, error: 'Lines already received cannot be removed.' });
    }
    const kept = lines.filter((line, index) => !indexes.has(index));
    if (!kept.length) {
      return res.status(400).json({ ok: false, error: 'Nothing on this PO has been received. Keep at least one line, or remove the whole PO instead.' });
    }

    const stamp = stampNow();
    const editor = currentEditor(req);
    const removed = lines.filter((line, index) => indexes.has(index)).map((line) => Object.assign({}, line, {
      removed_at: stamp.iso,
      removed_by: editor,
    }));
    po.lines = kept;
    po.removed_lines = (Array.isArray(po.removed_lines) ? po.removed_lines : []).concat(removed);
    po.total_amount = kept.reduce((sum, line) => sum + toNumber(line.qty) * toNumber(line.cost_price), 0);
    po.qty = kept.reduce((sum, line) => sum + toNumber(line.qty), 0);
    po.part_number = kept[0].part_number;
    po.part_name = kept[0].part_name;
    po.stamped_at = stamp.iso;
    po.stamped_label = stamp.label;
    const closed = closePoIfDone(po, editor, stamp);
    recordTransactionMade(data, req, 'purchase_order', po, 'remove_lines', {
      removed_lines: removed.map((line) => line.part_number).join(', '),
      po_closed: closed,
    });
    await store.replaceData(data);

    const openLeft = kept.filter(isOpenLine).length;
    return res.json({
      ok: true,
      po_closed: closed,
      message: closed
        ? `Removed ${removed.length} line(s) from PO ${po.po_number}. All remaining lines are received — PO is now Closed.`
        : `Removed ${removed.length} line(s) from PO ${po.po_number}. ${openLeft} line(s) still to receive.`,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});
/**
 * POST /api/parts/receiving-entry
 * Batch add receiving entries with auto-generated transaction data.
 * Entries become New (first received part number) or Restock (later receipts).
 * Auto-generates transaction date, number, type and initial receipt reference.
 * With po_number, only lines marked Received add stock and update the PO receiving log.
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
    const poNumber = String(req.body.po_number || '').trim();
    if (poNumber) return await recordPoReceivingEntry(req, res, data, poNumber, entries);
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
        transaction_date: /^\d{4}-\d{2}-\d{2}$/.test(String(entry.transaction_date || '').trim())
          ? String(entry.transaction_date).trim()
          : new Date().toISOString().slice(0, 10),
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
        barcode: String(entry.barcode || '').trim(),
        sold_to: '',
      };

      // Push to data and persist
      if (!Array.isArray(data.parts_inventory)) data.parts_inventory = [];
      inventory.prepareReceipt(data, restock);
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
      message: `Successfully created ${createdRecords.length} receiving ${createdRecords.length === 1 ? 'entry' : 'entries'} (${createdRecords.filter((row) => row.transaction_type === inventory.TYPE_NEW_STOCK).length} New, ${createdRecords.filter((row) => row.transaction_type === TYPE_RESTOCK).length} Stock).`,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/parts/csv-batch-add
 * Parse CSV text and merge rows as New / Restock receiving transactions.
 * Similar to receiving-entry but accepts raw CSV format.
 * Each valid row becomes New for its first part-number receipt, otherwise Restock.
 * Auto-generates transaction date, number, type and initial receipt reference.
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
      inventory.prepareReceipt(data, restock);
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
  const autoApprove = approvalControls.autoApproves(approvalControls.fromData(data), 'stock_transfer_gm_approval', transferAmount({ lines }));
  const transfer = await store.create('parts_transfers', {
    from_branch: fromBranch,
    to_branch: toBranch,
    part_number: first.part_number,
    part_name: first.part_name,
    sub_id: first.sub_id,
    qty: first.qty,
    unit: first.unit,
    lines,
    status: autoApprove ? 'approved' : 'pending',
    editor: currentEditor(req),
    transaction_number: numbers.transaction_number,
    packing_list_number: numbers.packing_list_number,
    transmittal_number: numbers.transmittal_number,
    stamped_at: stamp.iso,
    stamped_label: stamp.label,
  });
  if (autoApprove) {
    const fresh = await store.getRawData();
    const saved = findTransfer(fresh, transfer.id);
    if (saved) {
      autoApproveTransfer(fresh, saved);
      await store.replaceData(fresh);
      return res.status(201).json(saved);
    }
  }
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
      lines: inventory.preparePurchaseLines(data, lines),
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

    const poAutoApproved = approvalControls.autoApproves(approvalControls.fromData(data), 'po_gm_approval', poAmount(po));
    if (poAutoApproved) autoApprovePurchaseOrder(data, po);

    await store.replaceData(data);

    // In production, you would send a notification to GM here
    // For now, just log it
    console.log(`✓ PO ${po_number} sent to GM for approval by ${editor}`);

    return res.json({
      ok: true,
      po: po,
      message: poAutoApproved
        ? `PO ${po_number} auto-approved (within the GM Control Panel auto-approve range).`
        : `PO ${po_number} sent to GM for approval. Awaiting review...`,
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

const EDITABLE_PO_STATUSES = new Set(['draft', 'rejected']);

function cleanPoGridLines(raw) {
  const rows = Array.isArray(raw) ? raw : [];
  return rows.map((line) => {
    const qty = toNumber(line && line.qty);
    const costPrice = Math.max(0, toNumber(line && line.cost_price));
    const markup = Math.max(0, toNumber(line && line.markup));
    return {
      barcode: String((line && line.barcode) || '').trim(),
      part_number: String((line && line.part_number) || '').trim(),
      part_name: String((line && line.part_name) || '').trim(),
      sub_id: String((line && line.sub_id) || '').trim(),
      generic: String((line && line.generic) || '').trim(),
      unit: String((line && line.unit) || '').trim(),
      qty,
      cost_price: costPrice,
      markup,
      retail_price: computeRetailPrice(costPrice, markup),
      notes: String((line && line.notes) || '').trim(),
    };
  }).filter((line) => line.part_number && line.qty > 0);
}

router.get('/api/purchase-orders/:id', async (req, res) => {
  const data = await store.getRawData();
  const po = findPurchaseOrder(data, req.params.id);
  if (!po) return res.status(404).json({ ok: false, error: 'Purchase order not found.' });
  return res.json({ ok: true, po });
});

// Grid PO: action "save" keeps it as an editable draft; "create" sends it to the GM approval queue.
router.post('/api/purchase-orders-grid', async (req, res) => {
  try {
    const sendForApproval = String(req.body.action || '').trim().toLowerCase() === 'create';
    const data = await store.getRawData();
    const supplier = String(req.body.supplier || '').trim();
    if (!supplier) return res.status(400).json({ ok: false, error: 'Supplier is required.' });
    const lines = cleanPoGridLines(req.body.lines);
    if (!lines.length) {
      return res.status(400).json({ ok: false, error: 'Add at least one line with a Part Number and a Qty above zero.' });
    }

    const stamp = stampNow();
    const editor = currentEditor(req);
    const location = resolvePmLocation(req.body.branch, data) || WAREHOUSE_1;
    const requestedDate = String(req.body.po_date || '').trim();
    const poDate = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? requestedDate : stamp.iso.slice(0, 10);
    if (!Array.isArray(data.parts_purchase_orders)) data.parts_purchase_orders = [];

    const existingId = String(req.body.id || '').trim();
    let po = existingId ? findPurchaseOrder(data, existingId) : null;
    if (existingId && !po) return res.status(404).json({ ok: false, error: 'Purchase order not found.' });
    if (po && !EDITABLE_PO_STATUSES.has(String(po.status || '').trim().toLowerCase())) {
      return res.status(409).json({ ok: false, error: `PO ${po.po_number || po.id} is ${po.status} and can no longer be edited.` });
    }

    if (!po) {
      const numbers = allocatePurchaseOrderNumbers(data);
      po = {
        id: genId(),
        created_at: stamp.iso,
        created_by: editor,
        transaction_number: numbers.transaction_number,
        po_number: numbers.po_number,
      };
      data.parts_purchase_orders.push(po);
      rememberDocument(data, {
        kind: 'purchase_order',
        serial: po.po_number,
        transaction_number: po.transaction_number,
        related_id: po.id,
        created_by: editor,
        title: 'Purchase Order',
      });
    }

    Object.assign(po, {
      supplier,
      branch: location,
      present_location: location,
      po_date: poDate,
      notes: String(req.body.notes || '').trim(),
      lines: inventory.preparePurchaseLines(data, lines),
      part_number: lines[0].part_number,
      part_name: lines[0].part_name,
      qty: lines.reduce((sum, line) => sum + line.qty, 0),
      total_amount: Number(lines.reduce((sum, line) => sum + line.qty * line.cost_price, 0).toFixed(2)),
      stamped_at: stamp.iso,
      stamped_label: stamp.label,
      updated_at: stamp.iso,
      updated_by: editor,
    });

    if (sendForApproval) {
      po.status = 'pending_approval';
      po.sent_for_approval_at = stamp.iso;
      po.sent_for_approval_by = editor;
      po.approval_requested_at = stamp.iso;
      po.approval_requested_by = editor;
      delete po.rejected_at;
      delete po.rejected_by;
      delete po.rejection_reason;
      rememberDocument(data, {
        kind: 'purchase_order_approval_request',
        serial: po.po_number,
        transaction_number: po.transaction_number,
        related_id: po.id,
        created_by: editor,
        title: `PO ${po.po_number} Sent for GM Approval`,
      });
      if (approvalControls.autoApproves(approvalControls.fromData(data), 'po_gm_approval', poAmount(po))) {
        autoApprovePurchaseOrder(data, po);
      }
    } else {
      po.status = 'draft';
    }

    await store.replaceData(data);
    return res.json({
      ok: true,
      po,
      message: !sendForApproval
        ? `PO ${po.po_number} saved. You can edit it from the PO records and send it to the GM later.`
        : (po.auto_approved
          ? `PO ${po.po_number} auto-approved (within the GM Control Panel auto-approve range). Release it from PO Records.`
          : `PO ${po.po_number} sent to the GM for approval.`),
    });
  } catch (err) {
    console.error('PO grid save error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
module.exports.isPartsManagerRole = isPartsManagerRole;
module.exports.canAccessPartsManagerWorkspace = canAccessPartsManagerWorkspace;
module.exports.autoApprovePartsRequestIfEnabled = autoApprovePartsRequestIfEnabled;
