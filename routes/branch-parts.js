const express = require('express');
const store = require('../data/store');
const {
  isFrontlineRole,
  frontlineSessionBranch,
  frontlineRoleLabel,
} = require('../lib/frontline-roles');
const {
  PARTS_REQUEST_TYPE,
  REQUEST_TX_STATUS_OPEN,
  buildPartsRequestInventoryPayload,
  affectsStock,
} = require('../lib/parts-request');
const { allocatePartsTransactionNumber } = require('../lib/parts-transaction-number');
const inventory = require('../lib/parts-inventory-controller');

const router = express.Router();
const WAREHOUSE_1 = 'Warehouse 1';
const LOW_STOCK_THRESHOLD = 5;

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeBranchKey(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function sameBranch(a, b) {
  const left = normalizeBranchKey(a);
  const right = normalizeBranchKey(b);
  return Boolean(left && right && left === right);
}

function partLocation(part) {
  return String((part && (part.present_location || part.branch || part.requesting_branch)) || '').trim();
}

function belongsToBranch(part, branch) {
  return sameBranch(partLocation(part), branch);
}

function requireFrontlineBranch(req, res, next) {
  const user = req.session && req.session.user ? req.session.user : {};
  if (!isFrontlineRole(user.role)) return res.redirect('/');
  const branch = frontlineSessionBranch(user);
  if (!branch) return res.status(403).send('Assigned branch is required. Please log in again.');
  req.frontlineBranch = branch;
  req.frontlineUser = user;
  return next();
}

router.use(requireFrontlineBranch);

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  return [value];
}

function parseOrderLines(body) {
  const partNumbers = asArray(body.line_part_number);
  const partNames = asArray(body.line_part_name);
  const subIds = asArray(body.line_sub_id);
  const generics = asArray(body.line_generic);
  const suppliers = asArray(body.line_supplier);
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
    const retail_price = retailRaw !== '' ? toNumber(retailRaw) : Number((cost_price + cost_price * (markup / 100)).toFixed(2));

    lines.push({
      part_number,
      part_name,
      sub_id: String(subIds[i] || '').trim(),
      generic: String(generics[i] || '').trim(),
      supplier: String(suppliers[i] || '').trim(),
      qty: toNumber(qtyRaw),
      cost_price,
      markup,
      retail_price,
      sold_to: String(soldTos[i] || '').trim(),
    });
  }
  return lines;
}

function aggregateBranchStock(parts, branch) {
  const stockByPart = new Map();
  const metaByPart = new Map();

  (parts || []).filter((part) => belongsToBranch(part, branch)).forEach((row) => {
    const partNumber = String(row.part_number || '').trim();
    if (!partNumber) return;
    const qty = Math.max(0, toNumber(row.qty));
    const effect = affectsStock(row.transaction_type, row);
    if (!stockByPart.has(partNumber)) stockByPart.set(partNumber, 0);
    if (effect === 'decrease') stockByPart.set(partNumber, stockByPart.get(partNumber) - qty);
    else if (effect === 'increase') stockByPart.set(partNumber, stockByPart.get(partNumber) + qty);

    if (!metaByPart.has(partNumber)) {
      metaByPart.set(partNumber, {
        part_number: partNumber,
        part_name: row.part_name || '',
        sub_id: row.sub_id || '',
        generic: row.generic || '',
        supplier: row.supplier || '',
        cost_price: row.cost_price,
        markup: row.markup,
        retail_price: row.retail_price,
      });
    }
    const meta = metaByPart.get(partNumber);
    if (!meta.part_name && row.part_name) meta.part_name = row.part_name;
    if (!meta.sub_id && row.sub_id) meta.sub_id = row.sub_id;
    if (!meta.generic && row.generic) meta.generic = row.generic;
    if (row.supplier) meta.supplier = row.supplier;
    if (row.cost_price != null) meta.cost_price = row.cost_price;
    if (row.markup != null) meta.markup = row.markup;
    if (row.retail_price != null) meta.retail_price = row.retail_price;
  });

  return { stockByPart, metaByPart };
}

function buildCatalog(parts, branch) {
  const { metaByPart, stockByPart } = aggregateBranchStock(parts, branch);
  return Array.from(metaByPart.values())
    .map((meta) => Object.assign({}, meta, { qty: stockByPart.get(meta.part_number) || 0 }))
    .sort((a, b) => String(a.part_number).localeCompare(String(b.part_number)));
}

async function findDraft(user, branch) {
  const drafts = await store.getAll('branch_parts_order_drafts');
  return drafts.find((draft) => (
    String(draft.status || 'draft') === 'draft'
    && String(draft.user_id || '') === String(user.id || '')
    && sameBranch(draft.requesting_branch, branch)
  )) || null;
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function redirectHome(role) {
  return isFrontlineRole(role) ? '/service-receptionist' : '/';
}

async function renderDashboard(req, res, extras = {}) {
  const branch = req.frontlineBranch;
  const user = req.frontlineUser;
  const data = await store.getRawData();
  const allParts = data.parts_inventory || [];
  const branchParts = allParts
    .filter((part) => belongsToBranch(part, branch))
    .sort((a, b) => String(b.transaction_date || b.created_at || '').localeCompare(String(a.transaction_date || a.created_at || '')));

  const { stockByPart, metaByPart } = aggregateBranchStock(allParts, branch);
  const lowStock = Array.from(stockByPart.entries())
    .map(([partNumber, qty]) => ({
      part_number: partNumber,
      part_name: (metaByPart.get(partNumber) || {}).part_name || '',
      sub_id: (metaByPart.get(partNumber) || {}).sub_id || '',
      generic: (metaByPart.get(partNumber) || {}).generic || '',
      supplier: (metaByPart.get(partNumber) || {}).supplier || '',
      cost_price: (metaByPart.get(partNumber) || {}).cost_price,
      markup: (metaByPart.get(partNumber) || {}).markup,
      retail_price: (metaByPart.get(partNumber) || {}).retail_price,
      qty,
    }))
    .filter((row) => row.qty <= LOW_STOCK_THRESHOLD)
    .sort((a, b) => a.qty - b.qty);

  const draft = extras.draft || await findDraft(user, branch);
  const sentOrders = (data.parts_request_transactions || [])
    .filter((row) => sameBranch(row.requesting_branch, branch) && String(row.sent_to || '') === WAREHOUSE_1)
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
    .slice(0, 40);

  const q = String(req.query.q || extras.q || '').trim().toLowerCase();
  const visibleParts = q
    ? branchParts.filter((part) =>
      [part.transaction_number, part.part_number, part.part_name, part.sub_id, part.generic, part.supplier, part.sold_to, part.editor]
        .some((field) => String(field || '').toLowerCase().includes(q)))
    : branchParts;

  return res.render('branch-parts/index', {
    branch,
    roleLabel: frontlineRoleLabel(user.role) || 'SA',
    homeHref: redirectHome(user.role),
    parts: visibleParts,
    total: branchParts.length,
    q,
    lowStock,
    catalog: buildCatalog(allParts, branch),
    draftLines: (draft && Array.isArray(draft.lines) && draft.lines.length) ? draft.lines : [{}],
    sentOrders,
    warehouse: WAREHOUSE_1,
    error: extras.error || req.query.error || '',
    success: extras.success || req.query.success || '',
  });
}

router.get('/', async (req, res) => {
  return renderDashboard(req, res);
});

router.post('/orders', async (req, res) => {
  const intent = String(req.body.intent || 'save').trim().toLowerCase();
  const lines = parseOrderLines(req.body);
  const branch = req.frontlineBranch;
  const user = req.frontlineUser;

  if (intent === 'send') {
    if (!lines.length) {
      return renderDashboard(req, res, { error: 'Add at least one part line before sending.', draft: { lines } });
    }
    const invalid = lines.find((line) => !line.part_number || !line.part_name || !Number.isFinite(line.qty) || line.qty <= 0);
    if (invalid) {
      return renderDashboard(req, res, {
        error: 'Each line needs Part Number, Part Name, and a quantity greater than 0.',
        draft: { lines },
      });
    }

    const data = await store.getRawData();
    if (!Array.isArray(data.parts_inventory)) data.parts_inventory = [];
    if (!Array.isArray(data.parts_request_transactions)) data.parts_request_transactions = [];
    if (!Array.isArray(data.branch_parts_order_drafts)) data.branch_parts_order_drafts = [];

    const editor = String(user.username || '').trim();
    const transactionDate = new Date().toISOString().slice(0, 10);
    const orderId = genId();

    lines.forEach((line) => {
      const transactionNumber = allocatePartsTransactionNumber(data);
      const inventoryPayload = buildPartsRequestInventoryPayload({
        partNumber: line.part_number,
        partName: line.part_name,
        subId: line.sub_id,
        unit: '',
        qty: line.qty,
        supplier: line.supplier,
        generic: line.generic,
        costPrice: line.cost_price,
        markup: line.markup,
        retailPrice: line.retail_price,
        editor,
        requestingBranch: branch,
        branch: WAREHOUSE_1,
        workOrderNumber: line.sold_to,
        workOrderId: '',
        transactionDate,
      });
      const inventoryId = genId();
      const inventoryRow = Object.assign({
        id: inventoryId,
        created_at: new Date().toISOString(),
        transaction_number: transactionNumber,
        present_location: branch,
        sent_to: WAREHOUSE_1,
        warehouse_order_id: orderId,
      }, inventoryPayload, {
        present_location: branch,
        branch: WAREHOUSE_1,
        requesting_branch: branch,
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
        sent_to: WAREHOUSE_1,
        editor,
        requesting_branch: branch,
        part_number: line.part_number,
        part_name: line.part_name,
        sub_id: line.sub_id,
        generic: line.generic,
        supplier: line.supplier,
        unit: '',
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

    data.branch_parts_order_drafts = data.branch_parts_order_drafts.map((draft) => {
      if (String(draft.user_id || '') === String(user.id || '') && sameBranch(draft.requesting_branch, branch) && String(draft.status || 'draft') === 'draft') {
        return Object.assign({}, draft, {
          status: 'sent',
          lines,
          sent_at: new Date().toISOString(),
          sent_order_id: orderId,
          destination_warehouse: WAREHOUSE_1,
        });
      }
      return draft;
    });

    await store.replaceData(data);
    return res.redirect('/branch-parts?success=' + encodeURIComponent(`Order sent to Parts Manager and ${WAREHOUSE_1}.`));
  }

  const existing = await findDraft(user, branch);
  const payload = {
    user_id: user.id,
    requested_by: String(user.username || '').trim(),
    requested_by_role: String(user.role || '').trim(),
    requesting_branch: branch,
    destination_warehouse: WAREHOUSE_1,
    status: 'draft',
    lines,
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    await store.update('branch_parts_order_drafts', existing.id, payload);
  } else {
    await store.create('branch_parts_order_drafts', payload);
  }

  return res.redirect('/branch-parts?success=' + encodeURIComponent('Draft saved. You can add more lines or edit before sending.'));
});

module.exports = router;
