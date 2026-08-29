/**
 * SA/SR/SSR branch-parts flow: each branch requests 10% of each listed
 * Warehouse 1 SKU, PM approves, branches confirm receipt. Warehouse 1
 * on-hand is deducted on receive; branch restock rows and receipts stay
 * visible on both portals.
 */
const store = require('../data/store');
const inventory = require('./parts-inventory-controller');
const stockAlerts = require('./parts-stock-alerts');
const {
  PARTS_REQUEST_TYPE,
  REQUEST_TX_STATUS_OPEN,
  buildPartsRequestInventoryPayload,
  mapInventoryPartsRequest,
} = require('./parts-request');
const {
  WAREHOUSE_1,
  sameLocation,
  stockByLocation,
} = require('./parts-location-scope');
const { DEFAULT_OPERATIONAL_BRANCHES, canonicalizeBranchName } = require('./branches');
const { allocatePartsTransactionNumber } = require('./parts-transaction-number');
const { rememberDocument } = require('./parts-document-serial');
const {
  warehouseFulfillmentExtras,
  receiveApprovedPartsTransfer,
} = require('./parts-transfer-receive');
const {
  buildApprovedTransactionRecord,
  saveApprovedReceipt,
} = require('./approved-parts-receipt');
const {
  ROLE_SERVICE_ADVISOR,
  ROLE_SERVICE_RECEPTIONIST,
  ROLE_SENIOR_SERVICE_RECEPTIONIST,
  employeeDisplayName,
  employeeMatchesAccess,
  employeeBranch,
  frontlineRoleLabel,
} = require('./frontline-roles');

const FLOW_PREFIX = 'branch-10pct-';
const FRONTLINE_ROLES = [
  ROLE_SERVICE_ADVISOR,
  ROLE_SENIOR_SERVICE_RECEPTIONIST,
  ROLE_SERVICE_RECEPTIONIST,
];

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function manilaDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function batchIdFor(date = new Date()) {
  return `${FLOW_PREFIX}${manilaDateKey(date)}`;
}

function tenPercentQty(onHand) {
  const stock = Math.max(0, toNumber(onHand));
  if (stock < 1) return 0;
  return Math.max(1, Math.round(stock * 0.1));
}

function splitQty(total, buckets) {
  const n = Math.max(1, buckets);
  const qty = Math.max(0, Math.floor(toNumber(total)));
  const base = Math.floor(qty / n);
  const extra = qty - base * n;
  return Array.from({ length: n }, (_, idx) => base + (idx < extra ? 1 : 0));
}

function catalogMeta(data) {
  const metaByPart = new Map();
  function take(row) {
    const key = inventory.normalizePartNumberKey(row && row.part_number);
    if (!key) return;
    if (!metaByPart.has(key)) {
      metaByPart.set(key, {
        part_number: String(row.part_number || '').trim() || key,
        part_name: String(row.part_name || '').trim(),
        sub_id: String(row.sub_id || '').trim(),
        generic: String(row.generic || '').trim() || 'Unclassified',
        supplier: String(row.supplier || '').trim(),
        cost_price: toNumber(row.cost_price),
        markup: toNumber(row.markup),
        retail_price: toNumber(row.retail_price),
      });
      return;
    }
    const meta = metaByPart.get(key);
    if (!meta.part_name && row.part_name) meta.part_name = row.part_name;
    if (!meta.sub_id && row.sub_id) meta.sub_id = row.sub_id;
    if (!meta.generic && row.generic) meta.generic = row.generic;
    if (row.supplier) meta.supplier = row.supplier;
    if (row.cost_price != null) meta.cost_price = toNumber(row.cost_price);
    if (row.markup != null) meta.markup = toNumber(row.markup);
    if (row.retail_price != null) meta.retail_price = toNumber(row.retail_price);
  }
  (data.parts || []).forEach(take);
  (data.parts_inventory || []).forEach(take);
  return metaByPart;
}

function listedWarehouseParts(data) {
  stockAlerts.reconcileWarehouse1Stock(data);
  const onHandMap = stockByLocation(inventory.allAuditRows(data), WAREHOUSE_1);
  const metaByPart = catalogMeta(data);
  return Array.from(onHandMap.entries())
    .map(([key, onHand]) => {
      const meta = metaByPart.get(key) || { part_number: key, part_name: key, generic: 'Unclassified' };
      return Object.assign({}, meta, { on_hand: toNumber(onHand) });
    })
    .filter((row) => row.on_hand > 0 && tenPercentQty(row.on_hand) > 0)
    .sort((a, b) => String(a.part_number).localeCompare(String(b.part_number)));
}

function canonicalizeEmpBranch(employee) {
  return canonicalizeBranchName(employeeBranch(employee)) || String(employeeBranch(employee) || '').trim();
}

function frontlineByBranch(data) {
  const map = new Map();
  DEFAULT_OPERATIONAL_BRANCHES.forEach((branch) => map.set(branch, []));
  (data.employees || []).forEach((employee) => {
    const branch = canonicalizeEmpBranch(employee);
    if (!map.has(branch)) return;
    const status = String(employee.employment_status || '').trim().toLowerCase();
    if (status && status !== 'active' && status !== 'regular' && status !== 'probationary') {
      if (status === 'terminated' || status === 'inactive' || status === 'resigned') return;
    }
    FRONTLINE_ROLES.forEach((role) => {
      if (!employeeMatchesAccess(employee, role)) return;
      map.get(branch).push({
        role,
        label: frontlineRoleLabel(role) || role,
        name: employeeDisplayName(employee) || String(employee.employee_id || '').trim(),
        employee_id: String(employee.employee_id || '').trim(),
      });
    });
  });
  map.forEach((list, branch) => {
    const seen = new Set();
    const unique = [];
    list.forEach((entry) => {
      const key = `${entry.role}:${entry.employee_id}`;
      if (seen.has(key)) return;
      seen.add(key);
      unique.push(entry);
    });
    unique.sort((a, b) => FRONTLINE_ROLES.indexOf(a.role) - FRONTLINE_ROLES.indexOf(b.role));
    const byId = new Map();
    unique.forEach((entry) => {
      const idKey = String(entry.employee_id || entry.name).trim().toUpperCase();
      if (!byId.has(idKey)) {
        byId.set(idKey, entry);
        return;
      }
      const current = byId.get(idKey);
      if (FRONTLINE_ROLES.indexOf(entry.role) < FRONTLINE_ROLES.indexOf(current.role)) {
        byId.set(idKey, entry);
      }
    });
    const deduped = Array.from(byId.values())
      .sort((a, b) => FRONTLINE_ROLES.indexOf(a.role) - FRONTLINE_ROLES.indexOf(b.role));
    if (!deduped.length) {
      deduped.push({
        role: ROLE_SERVICE_ADVISOR,
        label: 'SA',
        name: `SA ${branch}`,
        employee_id: '',
      });
    }
    map.set(branch, deduped);
  });
  return map;
}

function findPmName(data, fallback) {
  const user = (data.users || []).find((row) => {
    const role = String(row.role || '').trim().toLowerCase();
    return role === 'parts_manager' || role === 'pm';
  });
  return String((user && user.username) || fallback || 'PM').trim() || 'PM';
}

function alreadyRan(data, batchId) {
  return (data.parts_inventory || []).some((row) => String(row.seed_batch || '') === batchId);
}

async function runBranchParts10pctFlow(options) {
  const opts = options || {};
  const dryRun = Boolean(opts.dryRun);
  const force = Boolean(opts.force);
  const batchId = String(opts.batchId || batchIdFor()).trim();
  const data = await store.getRawData();
  if (!Array.isArray(data.parts_inventory)) data.parts_inventory = [];
  if (!Array.isArray(data.parts_request_transactions)) data.parts_request_transactions = [];
  if (!Array.isArray(data.parts_documents)) data.parts_documents = [];

  if (!force && alreadyRan(data, batchId)) {
    return {
      ok: true,
      skipped: true,
      batchId,
      message: `Flow ${batchId} already exists. Pass force=1 to run again.`,
    };
  }

  const listed = listedWarehouseParts(data);
  const branches = DEFAULT_OPERATIONAL_BRANCHES.slice();
  const actorsByBranch = frontlineByBranch(data);
  const pmName = findPmName(data, opts.pmName);
  const snapshot = listed.map((part) => ({
    part_number: part.part_number,
    generic: part.generic,
    w1_on_hand: part.on_hand,
    qty_each_branch: tenPercentQty(part.on_hand),
  }));

  const neededByPart = new Map();
  snapshot.forEach((part) => {
    neededByPart.set(
      inventory.normalizePartNumberKey(part.part_number),
      part.qty_each_branch * branches.length
    );
  });

  const runnable = listed.filter((part) => {
    const key = inventory.normalizePartNumberKey(part.part_number);
    const needed = neededByPart.get(key) || 0;
    return part.on_hand >= needed && needed > 0;
  });
  const skippedShort = listed
    .filter((part) => !runnable.some((row) => row.part_number === part.part_number))
    .map((part) => ({
      part_number: part.part_number,
      w1_on_hand: part.on_hand,
      needed: (tenPercentQty(part.on_hand) * branches.length),
    }));

  if (!runnable.length) {
    return {
      ok: false,
      batchId,
      error: 'Warehouse 1 does not have enough on-hand to fill 10% for every branch.',
      skippedShort,
    };
  }

  const summary = {
    ok: true,
    dryRun,
    batchId,
    pm: pmName,
    branches: [],
    requested: 0,
    approved: 0,
    received: 0,
    receipts: 0,
    kinds: Array.from(new Set(runnable.map((row) => row.generic))).sort(),
    listedCount: runnable.length,
    skippedShort,
  };

  if (dryRun) {
    branches.forEach((branch) => {
      const actors = actorsByBranch.get(branch) || [];
      summary.branches.push({
        branch,
        actors: actors.map((actor) => `${actor.label} ${actor.name}`),
        lines: runnable.length,
      });
    });
    summary.requested = runnable.length * branches.length;
    return summary;
  }

  const pendingCreated = [];
  const stamp = new Date().toISOString();
  const transactionDate = stamp.slice(0, 10);

  branches.forEach((branch) => {
    const actors = actorsByBranch.get(branch) || [];
    const branchReport = {
      branch,
      actors: actors.map((actor) => `${actor.label} ${actor.name}`),
      requested: 0,
      received: 0,
    };

    runnable.forEach((part) => {
      const totalQty = tenPercentQty(part.on_hand);
      const qtyShares = splitQty(totalQty, actors.length);
      const orderId = genId();
      actors.forEach((actor, actorIdx) => {
        const qty = qtyShares[actorIdx];
        if (!(qty > 0)) return;
        const transactionNumber = allocatePartsTransactionNumber(data);
        const inventoryPayload = buildPartsRequestInventoryPayload({
          partNumber: part.part_number,
          partName: part.part_name,
          subId: part.sub_id,
          unit: '',
          qty,
          supplier: part.supplier,
          generic: part.generic,
          costPrice: part.cost_price,
          markup: part.markup,
          retailPrice: part.retail_price,
          editor: actor.name,
          requestingBranch: branch,
          branch: WAREHOUSE_1,
          workOrderNumber: `${actor.label}-10PCT-${batchId}`,
          workOrderId: '',
          transactionDate,
        });
        const inventoryId = genId();
        const inventoryRow = Object.assign({
          id: inventoryId,
          created_at: stamp,
          transaction_number: transactionNumber,
          present_location: branch,
          sent_to: WAREHOUSE_1,
          warehouse_order_id: orderId,
          seed_batch: batchId,
          requested_by_role: actor.label,
        }, inventoryPayload, {
          present_location: branch,
          branch: WAREHOUSE_1,
          requesting_branch: branch,
        });
        data.parts_inventory.push(inventoryRow);
        inventory.rememberTransaction(data, inventoryRow);
        stockAlerts.markOrdered(data, part.part_number, branch);
        data.parts_request_transactions.push({
          id: genId(),
          order_id: orderId,
          created_at: stamp,
          transaction_date: transactionDate,
          transaction_number: transactionNumber,
          transaction_type: PARTS_REQUEST_TYPE,
          status: REQUEST_TX_STATUS_OPEN,
          sent_to: WAREHOUSE_1,
          editor: actor.name,
          requesting_branch: branch,
          part_number: part.part_number,
          part_name: part.part_name,
          sub_id: part.sub_id,
          generic: part.generic,
          supplier: part.supplier,
          unit: '',
          qty,
          cost_price: part.cost_price,
          markup: part.markup,
          retail_price: part.retail_price,
          sold_to: `${actor.label}-10PCT-${batchId}`,
          inventory_request_id: inventoryId,
          received_at: '',
          received_by: '',
          seed_batch: batchId,
        });
        pendingCreated.push({
          row: inventoryRow,
          actor,
          branch,
        });
        branchReport.requested += 1;
        summary.requested += 1;
      });
    });
    summary.branches.push(branchReport);
  });

  const approvedCreated = [];
  pendingCreated.forEach((entry) => {
    const pending = entry.row;
    pending.request_status = 'approved';
    pending.resolved_at = stamp;
    pending.resolved_by = pmName;
    inventory.syncInventoryRowToTransactions(data, pending);
    const mapped = mapInventoryPartsRequest(pending);
    const extras = Object.assign({}, warehouseFulfillmentExtras(mapped), {
      linked_request_id: pending.id,
    });
    const approved = Object.assign(
      { id: genId(), created_at: stamp, seed_batch: batchId },
      buildApprovedTransactionRecord(mapped, pmName, data, extras)
    );
    data.parts_inventory.push(approved);
    inventory.rememberTransaction(data, approved);
    approvedCreated.push({ approved, pending, actor: entry.actor, branch: entry.branch });
    summary.approved += 1;
  });

  const receiveErrors = [];
  approvedCreated.forEach((entry) => {
    const result = receiveApprovedPartsTransfer(data, entry.approved.id, {
      receiver: entry.actor.name,
      branch: entry.branch,
    });
    if (!result.ok) {
      receiveErrors.push({
        branch: entry.branch,
        part_number: entry.approved.part_number,
        error: result.error,
      });
      return;
    }
    if (result.restock) result.restock.seed_batch = batchId;
    if (result.record) result.record.seed_batch = batchId;
    const branchReport = summary.branches.find((row) => row.branch === entry.branch);
    if (branchReport) branchReport.received += 1;
    summary.received += 1;
  });

  const receipts = [];
  for (const entry of approvedCreated) {
    const receipt = await saveApprovedReceipt(entry.approved, mapInventoryPartsRequest(entry.pending));
    rememberDocument(data, {
      kind: 'receipt',
      serial: entry.approved.transaction_number,
      transaction_number: entry.approved.transaction_number,
      related_id: entry.approved.id,
      created_by: pmName,
      title: `Approved Parts Receipt · ${entry.branch} · ${entry.actor.label}`,
      seed_batch: batchId,
    });
    receipts.push(receipt.filename);
    summary.receipts += 1;
  }

  await store.replaceData(data);
  summary.receiveErrors = receiveErrors;
  summary.receiptFiles = receipts.slice(0, 12);
  summary.message = receiveErrors.length
    ? `Flow saved with ${receiveErrors.length} receive error(s).`
    : `Requested, PM-approved, and branch-received ${summary.received} line(s) across ${branches.length} branches.`;
  return summary;
}

module.exports = {
  FLOW_PREFIX,
  batchIdFor,
  tenPercentQty,
  listedWarehouseParts,
  runBranchParts10pctFlow,
};
