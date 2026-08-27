const {
  PARTS_REQUEST_TYPE,
  TYPE_RESTOCK,
  isPartsRequestType,
  isPartsActivityLog,
  normalizePartsTransactionType,
} = require('./parts-request');
const inventory = require('./parts-inventory-controller');
const { WAREHOUSE_1, sameLocation } = require('./parts-location-scope');
const { allocatePartsTransactionNumber } = require('./parts-transaction-number');
const stockAlerts = require('./parts-stock-alerts');

const FULFILLMENT_IN_TRANSIT = 'in_transit';
const FULFILLMENT_COMPLETE = 'complete';

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function fulfillmentLabel(row) {
  if (!row) return '';
  const fulfillment = String(row.fulfillment_status || '').trim().toLowerCase();
  const requestStatus = String(row.request_status || '').trim().toLowerCase();
  if (fulfillment === FULFILLMENT_COMPLETE || requestStatus === 'received' || row.received_at) {
    return 'Complete';
  }
  if (fulfillment === FULFILLMENT_IN_TRANSIT || requestStatus === 'approved') {
    return 'In transit';
  }
  const type = normalizePartsTransactionType(row.transaction_type);
  if (type === 'sold') return 'Complete';
  return 'Approved';
}

function isAwaitingBranchReceive(row) {
  if (!row || !row.approved_at) return false;
  if (String(row.fulfillment_status || '').trim().toLowerCase() === FULFILLMENT_COMPLETE) return false;
  if (String(row.request_status || '').trim().toLowerCase() === 'received') return false;
  if (row.received_at) return false;
  if (!isPartsRequestType(row.transaction_type)) return false;
  return String(row.fulfillment_status || FULFILLMENT_IN_TRANSIT).trim().toLowerCase() === FULFILLMENT_IN_TRANSIT
    || String(row.request_status || '').trim().toLowerCase() === 'approved';
}

function listInboundApprovedTransfers(data, branch) {
  return (data.parts_inventory || [])
    .filter((row) => isAwaitingBranchReceive(row) && sameLocation(row.requesting_branch || row.to_branch, branch))
    .sort((a, b) => String(b.approved_at || b.created_at || '').localeCompare(String(a.approved_at || a.created_at || '')));
}

function warehouseFulfillmentExtras(source) {
  const requester = String((source && (source.requested_by || source.editor)) || '').trim();
  const requestingBranch = String((source && (source.requesting_branch || source.to_branch || source.branch)) || '').trim();
  return {
    transaction_type: PARTS_REQUEST_TYPE,
    editor: requester,
    present_location: WAREHOUSE_1,
    branch: WAREHOUSE_1,
    from_branch: WAREHOUSE_1,
    to_branch: requestingBranch,
    request_status: 'approved',
    fulfillment_status: FULFILLMENT_IN_TRANSIT,
    sent_to: String((source && source.sent_to) || WAREHOUSE_1).trim(),
    warehouse_order_id: String((source && source.warehouse_order_id) || '').trim(),
  };
}

function deductIncomingLotsAtLocation(data, partNumber, qty, location) {
  let remaining = Math.max(0, toNumber(qty));
  if (remaining <= 0) return { ok: true, remaining: 0 };

  const key = inventory.normalizePartNumberKey(partNumber);
  const lots = (data.parts_inventory || []).filter((row) => {
    if (inventory.normalizePartNumberKey(row.part_number) !== key) return false;
    if (isPartsActivityLog(row)) return false;
    if (!inventory.isIncomingStockType(row.transaction_type)) return false;
    if (!sameLocation(row.present_location || row.branch, location)) return false;
    return toNumber(row.qty) > 0;
  });

  lots.forEach((row) => {
    if (remaining <= 0) return;
    const available = Math.max(0, toNumber(row.qty));
    const consumed = Math.min(available, remaining);
    row.qty = Number((available - consumed).toFixed(2));
    inventory.syncInventoryRowToTransactions(data, row);
    remaining = Number((remaining - consumed).toFixed(2));
  });

  inventory.rebuildPartCatalogEntry(data, partNumber);
  return { ok: remaining <= 0, remaining };
}

function closeMatchingRequestTransactions(data, row, receiver, receivedAt) {
  const linkedId = String(row.linked_request_id || '').trim();
  const txn = String(row.transaction_number || '').trim();
  (data.parts_request_transactions || []).forEach((entry, idx) => {
    const inventoryId = String(entry.inventory_request_id || '').trim();
    const sameRequest = (linkedId && inventoryId === linkedId)
      || (linkedId && String(entry.id) === linkedId)
      || (txn && String(entry.transaction_number || '').trim() === txn);
    if (!sameRequest) return;
    data.parts_request_transactions[idx] = Object.assign({}, entry, {
      status: 'Closed',
      received_at: receivedAt,
      received_by: receiver,
    });
  });
}

function markSourceRequestReceived(data, row, receiver, receivedAt) {
  const linkedId = String(row.linked_request_id || '').trim();
  if (!linkedId || !Array.isArray(data.parts_inventory)) return;
  const idx = data.parts_inventory.findIndex((entry) => String(entry.id) === linkedId);
  if (idx === -1) return;
  data.parts_inventory[idx] = Object.assign({}, data.parts_inventory[idx], {
    request_status: 'received',
    received_at: receivedAt,
    received_by: receiver,
  });
}

function receiveApprovedPartsTransfer(data, rowId, { receiver, branch }) {
  if (!Array.isArray(data.parts_inventory)) data.parts_inventory = [];
  const idx = data.parts_inventory.findIndex((row) => String(row.id) === String(rowId));
  if (idx === -1) return { ok: false, error: 'Approved transfer not found.' };

  const row = data.parts_inventory[idx];
  if (!isAwaitingBranchReceive(row)) {
    return { ok: false, error: 'This transfer is not waiting for receipt.' };
  }
  if (!sameLocation(row.requesting_branch || row.to_branch, branch)) {
    return { ok: false, error: 'This transfer belongs to another branch.' };
  }

  const qty = Math.max(1, toNumber(row.qty));
  const deducted = deductIncomingLotsAtLocation(data, row.part_number, qty, WAREHOUSE_1);
  if (!deducted.ok) {
    return {
      ok: false,
      error: `Warehouse 1 on-hand is short for ${row.part_number}. Available lots could not cover qty ${qty}.`,
    };
  }

  const stamp = new Date().toISOString();
  const restock = {
    id: genId(),
    created_at: stamp,
    transaction_date: stamp.slice(0, 10),
    transaction_number: allocatePartsTransactionNumber(data),
    transaction_type: TYPE_RESTOCK,
    present_location: branch,
    branch,
    editor: receiver,
    part_number: row.part_number,
    part_name: row.part_name,
    sub_id: row.sub_id,
    generic: row.generic,
    supplier: row.supplier,
    unit: row.unit,
    qty,
    cost_price: row.cost_price,
    markup: row.markup,
    retail_price: row.retail_price,
    sold_to: '',
    linked_request_id: row.linked_request_id || row.id,
    linked_fulfillment_id: row.id,
  };
  data.parts_inventory.push(restock);
  inventory.rememberTransaction(data, restock);

  const updated = Object.assign({}, row, {
    present_location: branch,
    branch,
    request_status: 'received',
    fulfillment_status: FULFILLMENT_COMPLETE,
    received_at: stamp,
    received_by: receiver,
  });
  data.parts_inventory[idx] = updated;
  inventory.syncInventoryRowToTransactions(data, updated);
  inventory.rememberTransaction(data, updated);

  closeMatchingRequestTransactions(data, updated, receiver, stamp);
  markSourceRequestReceived(data, updated, receiver, stamp);
  stockAlerts.reconcileWarehouse1Stock(data);

  return { ok: true, record: updated, restock };
}

module.exports = {
  FULFILLMENT_IN_TRANSIT,
  FULFILLMENT_COMPLETE,
  fulfillmentLabel,
  isAwaitingBranchReceive,
  listInboundApprovedTransfers,
  warehouseFulfillmentExtras,
  deductIncomingLotsAtLocation,
  receiveApprovedPartsTransfer,
};
