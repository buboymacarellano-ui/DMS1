const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const store = require('../data/store');
const {
  isPendingPartsRequest,
  mapInventoryPartsRequest,
  mapLegacyPartsRequest,
  affectsStock,
} = require('../lib/parts-request');
const {
  APPROVED_RECEIPTS_DIR,
  buildApprovedTransactionRecord,
  saveApprovedReceipt,
} = require('../lib/approved-parts-receipt');
const { allocatePartsTransactionNumber } = require('../lib/parts-transaction-number');
const { normalizePartNumberKey } = require('../lib/parts-inventory-controller');

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
  // GM has full supervisory read/write access across PM operational views
  if (canAccessPartsManagerWorkspace(req.session?.user?.role)) return next();
  return res.status(403).send('Parts Manager access only.');
}

router.use(requirePmSession);

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function normalizeBranchKey(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function resolveBranch(value) {
  const key = normalizeBranchKey(value);
  return BRANCHES.find((branch) => normalizeBranchKey(branch) === key) || '';
}

function renderPage(res, view, activeSection, locals = {}) {
  return res.render(`parts-manager/${view}`, {
    activeSection,
    branches: BRANCHES,
    ...locals,
  });
}

function aggregateStock(inventory) {
  const stockByPart = new Map();
  const metaByPart = new Map();

  for (const row of inventory) {
    const partNumber = normalizePartNumberKey(row.part_number) || String(row.part_number || '').trim() || '__unknown';
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
  const [inventory, purchaseOrders, partsRequests] = await Promise.all([
    store.getAll('parts_inventory'),
    store.getAll('parts_purchase_orders'),
    store.getAll('parts_requests'),
  ]);

  const { stockByPart, metaByPart } = aggregateStock(inventory);

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

  const recentMovements = [...inventory]
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

  const pendingFromInventory = inventory
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
  return { record, receipt };
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

router.get('/', (req, res) => res.redirect('/parts-manager/dashboard'));

router.get('/dashboard', async (req, res) => {
  const overview = await buildOverview();
  return renderPage(res, 'dashboard', 'dashboard', { overview });
});

router.get('/inventory', async (req, res) => {
  const parts = await store.getAll('parts_inventory');
  return renderPage(res, 'inventory', 'inventory', { partsCount: parts.length });
});

router.get('/transfer', (req, res) => {
  const step = Math.min(3, Math.max(1, toNumber(req.query.step) || 1));
  return renderPage(res, 'transfer', 'inventory', {
    step,
    fromBranch: resolveBranch(req.query.from) || '',
    toBranch: resolveBranch(req.query.to) || '',
    error: req.query.error || '',
    success: req.query.success || '',
  });
});

router.post('/transfer', async (req, res) => {
  const fromBranch = resolveBranch(req.body.from_branch);
  const toBranch = resolveBranch(req.body.to_branch);
  const partNumber = String(req.body.part_number || '').trim();
  const qty = toNumber(req.body.qty);
  const editor = String(req.session?.user?.username || '').trim();

  if (!fromBranch || !toBranch || fromBranch === toBranch) {
    return res.redirect('/parts-manager/transfer?step=1&error=Select+distinct+source+and+destination+branches.');
  }
  if (!partNumber || qty <= 0) {
    return res.redirect(`/parts-manager/transfer?step=2&from=${encodeURIComponent(fromBranch)}&to=${encodeURIComponent(toBranch)}&error=Part+number+and+quantity+are+required.`);
  }

  await store.create('parts_transfers', {
    from_branch: fromBranch,
    to_branch: toBranch,
    part_number: partNumber,
    part_name: String(req.body.part_name || '').trim(),
    sub_id: String(req.body.sub_id || '').trim(),
    qty,
    status: 'pending',
    editor,
  });

  return res.redirect('/parts-manager/transfer?step=3&success=Transfer+request+submitted.');
});

router.get('/branch-reports', (req, res) => {
  const branch = resolveBranch(req.query.branch) || BRANCHES[0];
  return renderPage(res, 'branch-reports', 'branch-reports', { selectedBranch: branch });
});

router.get('/suppliers', async (req, res) => {
  const [suppliers, purchaseOrders] = await Promise.all([
    store.getAll('parts_suppliers'),
    store.getAll('parts_purchase_orders'),
  ]);
  return renderPage(res, 'suppliers', 'suppliers', { suppliers, purchaseOrders });
});

router.get('/api/overview', async (req, res) => {
  return res.json(await buildOverview());
});

router.get('/api/branch-reports', async (req, res) => {
  const branch = resolveBranch(req.query.branch);
  if (!branch) return res.status(400).json({ error: 'Invalid branch.' });

  const inventory = await store.getAll('parts_inventory');
  const branchKey = normalizeBranchKey(branch);
  const rows = inventory.filter((row) => normalizeBranchKey(row.branch) === branchKey);

  return res.json({ branch, rows, total: rows.length });
});

router.get('/api/suppliers', async (req, res) => {
  const [suppliers, purchaseOrders, inventory] = await Promise.all([
    store.getAll('parts_suppliers'),
    store.getAll('parts_purchase_orders'),
    store.getAll('parts_inventory'),
  ]);
  return res.json({ suppliers, purchaseOrders, billingHistory: inventory.filter((row) => row.supplier).slice(-20) });
});

router.post('/api/stock-adjust', async (req, res) => {
  const partNumber = String(req.body.part_number || '').trim();
  const delta = toNumber(req.body.delta);
  const editor = String(req.session?.user?.username || '').trim();

  if (!partNumber || !delta || delta === 0) {
    return res.status(400).json({ error: 'Part number and non-zero adjustment are required.' });
  }

  const inventory = await store.getAll('parts_inventory');
  const { stockByPart, metaByPart } = aggregateStock(inventory);
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

  const resolver = String(req.session?.user?.username || '').trim();
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
  const fromBranch = resolveBranch(req.body.from_branch);
  const toBranch = resolveBranch(req.body.to_branch);
  const qty = toNumber(req.body.qty);
  const partNumber = String(req.body.part_number || '').trim();

  if (!fromBranch || !toBranch || fromBranch === toBranch || !partNumber || qty <= 0) {
    return res.status(400).json({ error: 'Invalid transfer payload.' });
  }

  const transfer = await store.create('parts_transfers', {
    from_branch: fromBranch,
    to_branch: toBranch,
    part_number: partNumber,
    part_name: String(req.body.part_name || '').trim(),
    sub_id: String(req.body.sub_id || '').trim(),
    qty,
    status: 'pending',
    editor: String(req.session?.user?.username || '').trim(),
  });
  return res.status(201).json(transfer);
});

router.post('/api/purchase-orders', async (req, res) => {
  const supplier = String(req.body.supplier || '').trim();
  if (!supplier) return res.status(400).json({ error: 'Supplier is required.' });

  const po = await store.create('parts_purchase_orders', {
    supplier,
    branch: resolveBranch(req.body.branch) || '',
    status: 'pending',
    notes: String(req.body.notes || '').trim(),
    created_by: String(req.session?.user?.username || '').trim(),
  });
  return res.status(201).json(po);
});

module.exports = router;
module.exports.isPartsManagerRole = isPartsManagerRole;
module.exports.canAccessPartsManagerWorkspace = canAccessPartsManagerWorkspace;
