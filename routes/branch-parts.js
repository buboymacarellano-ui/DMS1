const express = require('express');
const store = require('../data/store');
const {
  isFrontlineRole,
  frontlineSessionBranch,
  frontlineRoleLabel,
} = require('../lib/frontline-roles');
const {
  PARTS_REQUEST_TYPE,
  TYPE_TRANSFER_REQUEST,
  REQUEST_TX_STATUS_OPEN,
  buildPartsRequestInventoryPayload,
  displayPartsTransactionType,
} = require('../lib/parts-request');
const { allocatePartsTransactionNumber } = require('../lib/parts-transaction-number');
const { allocateTransferNumbers, stampNow, rememberDocument } = require('../lib/parts-document-serial');
const inventory = require('../lib/parts-inventory-controller');
const stockAlerts = require('../lib/parts-stock-alerts');
const {
  WAREHOUSE_1,
  sameLocation,
  belongsToLocation,
  filterDataToLocation,
  stockByLocation,
  withLocationOnHand,
} = require('../lib/parts-location-scope');

const router = express.Router();
const LOW_STOCK_THRESHOLD = 5;

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function belongsToBranch(part, branch) {
  return belongsToLocation(part, branch);
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

function catalogMetaByPart(parts, branch) {
  const metaByPart = new Map();
  (parts || []).filter((part) => belongsToBranch(part, branch)).forEach((row) => {
    const partNumber = inventory.normalizePartNumberKey(row.part_number);
    if (!partNumber) return;
    if (!metaByPart.has(partNumber)) {
      metaByPart.set(partNumber, {
        part_number: String(row.part_number || '').trim() || partNumber,
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
  return metaByPart;
}

function buildCatalog(parts, branch, stockMap) {
  const metaByPart = catalogMetaByPart(parts, branch);
  return Array.from(metaByPart.entries())
    .map(([key, meta]) => {
      const onHand = stockMap && stockMap.has(key) ? stockMap.get(key) : 0;
      return Object.assign({}, meta, { qty: onHand, on_hand: onHand });
    })
    .sort((a, b) => String(a.part_number).localeCompare(String(b.part_number)));
}

async function findDraft(user, branch) {
  const drafts = await store.getAll('branch_parts_order_drafts');
  return drafts.find((draft) => (
    String(draft.status || 'draft') === 'draft'
    && String(draft.user_id || '') === String(user.id || '')
    && sameLocation(draft.requesting_branch, branch)
  )) || null;
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function hasPendingShortageTransfer(data, partNumber, branch) {
  const key = inventory.normalizePartNumberKey(partNumber);
  if (!key) return false;
  return (data.parts_transfers || []).some((row) => {
    if (String(row.status || '').toLowerCase() !== 'pending') return false;
    if (!sameLocation(row.from_branch, WAREHOUSE_1) || !sameLocation(row.to_branch, branch)) return false;
    if (inventory.normalizePartNumberKey(row.part_number) === key) return true;
    return (row.lines || []).some((line) => inventory.normalizePartNumberKey(line.part_number) === key);
  });
}

function notifyWarehouse1Shortage(data, { user, branch, lines }) {
  const shortageLines = (lines || []).filter((line) => line && line.part_number);
  if (!shortageLines.length) return null;

  if (!Array.isArray(data.parts_transfers)) data.parts_transfers = [];
  if (!Array.isArray(data.parts_inventory)) data.parts_inventory = [];
  if (!Array.isArray(data.parts_documents)) data.parts_documents = [];

  const editor = String((user && user.username) || '').trim();
  const freshLines = shortageLines.filter((line) => !hasPendingShortageTransfer(data, line.part_number, branch));
  shortageLines.forEach((line) => {
    stockAlerts.recordOutOfStock(data, {
      part_number: line.part_number,
      branch,
      account: editor,
      user_id: user && user.id,
      role: user && user.role,
    });
  });
  if (!freshLines.length) return null;

  const stamp = stampNow();
  const numbers = allocateTransferNumbers(data);
  const first = freshLines[0];
  const transfer = {
    id: genId(),
    created_at: stamp.iso,
    stamped_at: stamp.iso,
    stamped_label: stamp.label,
    from_branch: WAREHOUSE_1,
    to_branch: branch,
    part_number: first.part_number,
    part_name: first.part_name || '',
    sub_id: first.sub_id || '',
    qty: first.qty,
    unit: first.unit || '',
    lines: freshLines.map((line) => ({
      part_number: line.part_number,
      part_name: line.part_name || '',
      sub_id: line.sub_id || '',
      qty: line.qty,
      unit: line.unit || '',
    })),
    status: 'pending',
    editor,
    source: 'branch-parts-out-of-stock',
    transaction_number: numbers.transaction_number,
    packing_list_number: numbers.packing_list_number,
    transmittal_number: numbers.transmittal_number,
    note: 'Failed to load / out of stock at Warehouse 1',
  };
  data.parts_transfers.push(transfer);

  freshLines.forEach((line) => {
    const row = {
      id: genId(),
      created_at: stamp.iso,
      transaction_date: stamp.date,
      transaction_number: allocatePartsTransactionNumber(data),
      transaction_type: TYPE_TRANSFER_REQUEST,
      present_location: WAREHOUSE_1,
      branch: WAREHOUSE_1,
      requesting_branch: branch,
      editor,
      part_number: line.part_number,
      part_name: line.part_name || '',
      sub_id: line.sub_id || '',
      qty: line.qty,
      unit: line.unit || '',
      sold_to: branch,
      linked_transfer_id: transfer.id,
      request_status: 'pending',
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
    from_branch: WAREHOUSE_1,
    to_branch: branch,
  });
  rememberDocument(data, {
    kind: 'transmittal',
    serial: transfer.transmittal_number,
    transaction_number: transfer.transaction_number,
    related_id: transfer.id,
    created_by: editor,
    title: 'Transmittal',
    from_branch: WAREHOUSE_1,
    to_branch: branch,
  });
  return transfer;
}

function redirectHome(role) {
  return isFrontlineRole(role) ? '/service-receptionist' : '/';
}

async function renderDashboard(req, res, extras = {}) {
  const branch = req.frontlineBranch;
  const user = req.frontlineUser;
  const data = await store.getRawData();
  inventory.ensureCollections(data);
  const allParts = data.parts_inventory || [];
  const scopedData = filterDataToLocation(data, branch);
  const dashboardLogs = inventory.getDashboardLogs(scopedData);
  const auditRows = inventory.allAuditRows(data);
  const stockMap = stockByLocation(auditRows, branch);
  const metaByPart = catalogMetaByPart(allParts, branch);

  const q = String(req.query.q || extras.q || '').trim().toLowerCase();
  const visibleLogs = q
    ? dashboardLogs.filter((part) =>
      [part.transaction_number, part.part_number, part.part_name, part.sub_id, part.generic, part.supplier, part.sold_to, part.editor]
        .some((field) => String(field || '').toLowerCase().includes(q)))
    : dashboardLogs;
  const parts = withLocationOnHand(
    inventory.attachOnHand(scopedData, visibleLogs),
    auditRows,
    branch
  );

  const lowStock = Array.from(stockMap.entries())
    .map(([partNumber, onHand]) => {
      const meta = metaByPart.get(partNumber) || { part_number: partNumber };
      return {
        part_number: meta.part_number || partNumber,
        part_name: meta.part_name || '',
        sub_id: meta.sub_id || '',
        generic: meta.generic || '',
        supplier: meta.supplier || '',
        cost_price: meta.cost_price,
        markup: meta.markup,
        retail_price: meta.retail_price,
        qty: onHand,
        on_hand: onHand,
      };
    })
    .filter((row) => row.qty <= LOW_STOCK_THRESHOLD)
    .sort((a, b) => a.qty - b.qty);

  const draft = extras.draft || await findDraft(user, branch);
  const sentOrders = (data.parts_request_transactions || [])
    .filter((row) => sameLocation(row.requesting_branch, branch) && String(row.sent_to || '') === WAREHOUSE_1)
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
    .slice(0, 40);

  stockAlerts.reconcileWarehouse1Stock(data);
  const readyMessages = stockAlerts.listReadyMessages(data, branch);

  return res.render('branch-parts/index', {
    branch,
    roleLabel: frontlineRoleLabel(user.role) || 'SA',
    homeHref: redirectHome(user.role),
    parts,
    total: parts.length,
    q,
    lowStock,
    catalog: buildCatalog(allParts, branch, stockMap),
    draftLines: (draft && Array.isArray(draft.lines) && draft.lines.length) ? draft.lines : [{}],
    sentOrders,
    warehouse: WAREHOUSE_1,
    displayPartsTransactionType,
    readyMessages,
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
    stockAlerts.reconcileWarehouse1Stock(data);
    const shortageLines = lines.filter((line) => {
      const onHand = stockAlerts.warehouse1OnHand(data, line.part_number);
      const needed = Number.isFinite(line.qty) && line.qty > 0 ? line.qty : 1;
      return !(onHand > 0 && onHand >= needed);
    });
    if (shortageLines.length) {
      notifyWarehouse1Shortage(data, { user, branch, lines: shortageLines });
      await store.replaceData(data);
      const partList = shortageLines.map((line) => line.part_number).join(', ');
      return renderDashboard(req, res, {
        error: `No Stock for this Part Number: ${partList}. Order was not sent. A transfer request and message were sent to Parts Manager.`,
        draft: { lines },
      });
    }
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
      stockAlerts.markOrdered(data, line.part_number, branch);

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
      if (String(draft.user_id || '') === String(user.id || '') && sameLocation(draft.requesting_branch, branch) && String(draft.status || 'draft') === 'draft') {
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

router.get('/api/warehouse1-stock', async (req, res) => {
  const partNumber = String(req.query.part_number || '').trim();
  if (!partNumber) return res.json({ ok: true, part_number: '', on_hand: 0, in_stock: false });
  const data = await store.getRawData();
  stockAlerts.reconcileWarehouse1Stock(data);
  const onHand = stockAlerts.warehouse1OnHand(data, partNumber);
  const qty = Number(req.query.qty);
  const needed = Number.isFinite(qty) && qty > 0 ? qty : 0;
  const inStock = needed > 0 ? onHand >= needed : onHand > 0;
  return res.json({
    ok: true,
    part_number: partNumber,
    on_hand: onHand,
    in_stock: inStock,
  });
});

router.post('/api/out-of-stock', async (req, res) => {
  const partNumber = String((req.body && req.body.part_number) || '').trim();
  if (!partNumber) return res.status(400).json({ ok: false, error: 'Part number is required.' });
  const data = await store.getRawData();
  stockAlerts.reconcileWarehouse1Stock(data);
  const onHand = stockAlerts.warehouse1OnHand(data, partNumber);
  const qty = Number(req.body && req.body.qty);
  const needed = Number.isFinite(qty) && qty > 0 ? qty : 0;
  const inStock = needed > 0 ? onHand >= needed : onHand > 0;
  if (inStock) {
    return res.json({
      ok: true,
      in_stock: true,
      warning: null,
      on_hand: onHand,
    });
  }
  const user = req.frontlineUser || {};
  const qtyValue = Number.isFinite(qty) && qty > 0 ? qty : 1;
  notifyWarehouse1Shortage(data, {
    user,
    branch: req.frontlineBranch,
    lines: [{
      part_number: partNumber,
      part_name: String((req.body && req.body.part_name) || '').trim(),
      sub_id: String((req.body && req.body.sub_id) || '').trim(),
      qty: qtyValue,
    }],
  });
  const alert = (data.parts_stock_alerts || []).find((row) => (
    inventory.normalizePartNumberKey(row.part_number) === inventory.normalizePartNumberKey(partNumber)
    && sameLocation(row.branch, req.frontlineBranch)
  ));
  await store.replaceData(data);
  return res.json({
    ok: true,
    in_stock: false,
    warning: 'No Stock for this Part Number',
    message: stockAlerts.failedLoadMessage(partNumber),
    stamp_label: alert && alert.stamp_label,
    status: alert && alert.status,
    on_hand: onHand,
  });
});

module.exports = router;
