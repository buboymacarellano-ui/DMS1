const inventory = require('./parts-inventory-controller');
const {
  TYPE_SOLD,
  isPendingPartsRequest,
  mapInventoryPartsRequest,
  mapLegacyPartsRequest,
  isIncomingStockType,
  isPartsActivityLog,
  displayPartsTransactionType,
  normalizePartsTransactionType,
} = require('./parts-request');
const { WAREHOUSE_1, sameLocation } = require('./parts-location-scope');
const { getOperationalBranches, canonicalizeBranchName } = require('./branches');
const { stampNow } = require('./parts-document-serial');

const IDLE_DAYS = 90;
const FAST_WINDOW_DAYS = 90;
const LOW_STOCK_THRESHOLD = 5;

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function locationOf(row) {
  return String((row && (row.present_location || row.branch || row.requesting_branch || row.to_branch || row.from_branch)) || '').trim();
}

function partKey(row) {
  return String(row && row.part_number ? row.part_number : '').trim().toUpperCase();
}

function daysAgo(days) {
  return Date.now() - days * 24 * 60 * 60 * 1000;
}

function rowTime(row) {
  const parsed = new Date(row && (row.created_at || row.transaction_date || row.stamped_at) || 0);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function pmLocationOptions(data) {
  const names = getOperationalBranches(data && data.branches)
    .map((row) => String((row && row.name) || '').trim())
    .filter(Boolean);
  if (!names.length) {
    names.push('Carx2', 'Carmen', 'CebuCity', 'Lapux2', 'Bogo', 'Toledo', 'ITPark');
  }
  if (!names.some((name) => sameLocation(name, WAREHOUSE_1))) names.unshift(WAREHOUSE_1);
  else {
    const idx = names.findIndex((name) => sameLocation(name, WAREHOUSE_1));
    if (idx > 0) {
      names.splice(idx, 1);
      names.unshift(WAREHOUSE_1);
    }
  }
  return names;
}

function stockByPartLocation(rows) {
  const map = new Map();
  (rows || []).forEach((row) => {
    if (isPartsActivityLog(row)) return;
    const key = `${partKey(row)}|${locationOf(row).toLowerCase()}`;
    if (!partKey(row) || !locationOf(row)) return;
    if (!map.has(key)) {
      map.set(key, {
        part_number: row.part_number,
        part_name: row.part_name || '',
        sub_id: row.sub_id || '',
        supplier: row.supplier || '',
        location: locationOf(row),
        qty: 0,
        cost_price: toNumber(row.cost_price),
        retail_price: toNumber(row.retail_price),
        last_in: 0,
        last_sold: 0,
        sold_qty: 0,
        sold_retail: 0,
      });
    }
    const entry = map.get(key);
    if (row.part_name) entry.part_name = row.part_name;
    if (row.supplier) entry.supplier = row.supplier;
    if (row.cost_price != null) entry.cost_price = toNumber(row.cost_price);
    if (row.retail_price != null) entry.retail_price = toNumber(row.retail_price);
    const qty = Math.max(0, toNumber(row.qty));
    const type = normalizePartsTransactionType(row.transaction_type);
    if (isIncomingStockType(type)) {
      entry.qty += qty;
      entry.last_in = Math.max(entry.last_in, rowTime(row));
    }
    if (type === TYPE_SOLD) {
      entry.qty -= qty;
      entry.sold_qty += qty;
      entry.sold_retail += qty * toNumber(row.retail_price);
      entry.last_sold = Math.max(entry.last_sold, rowTime(row));
    }
  });
  map.forEach((entry) => {
    entry.qty = Math.max(0, entry.qty);
  });
  return Array.from(map.values());
}

function buildPmVitals(data) {
  const rows = inventory.allAuditRows(data);
  const stock = stockByPartLocation(rows);
  const windowStart = daysAgo(FAST_WINDOW_DAYS);
  const idleCutoff = daysAgo(IDLE_DAYS);

  const fastMoving = [...stock]
    .filter((row) => row.last_sold >= windowStart)
    .sort((a, b) => b.sold_qty - a.sold_qty || b.sold_retail - a.sold_retail)
    .slice(0, 20);

  const idle = [...stock]
    .filter((row) => row.qty > 0 && (!row.last_sold || row.last_sold < idleCutoff))
    .sort((a, b) => (b.qty * b.cost_price) - (a.qty * a.cost_price) || b.qty - a.qty)
    .slice(0, 20);

  const mostVolume = [...stock]
    .sort((a, b) => b.sold_qty - a.sold_qty)
    .slice(0, 12);

  const mostCostlyOnHand = [...stock]
    .map((row) => Object.assign({}, row, { inventory_value: row.qty * row.cost_price }))
    .sort((a, b) => b.inventory_value - a.inventory_value)
    .slice(0, 12);

  const warehouseStock = stock.filter((row) => sameLocation(row.location, WAREHOUSE_1));
  const totalOnHandValue = stock.reduce((sum, row) => sum + row.qty * row.cost_price, 0);
  const totalSoldRetail = stock.reduce((sum, row) => sum + row.sold_retail, 0);
  const skuCount = new Set(stock.map((row) => partKey(row)).filter(Boolean)).size;
  const lowStock = stock.filter((row) => row.qty > 0 && row.qty <= LOW_STOCK_THRESHOLD).length;

  return {
    fastMoving,
    idle,
    mostVolume,
    mostCostlyOnHand,
    cards: {
      skuCount,
      locationCount: new Set(stock.map((row) => row.location).filter(Boolean)).size,
      warehouse1Skus: new Set(warehouseStock.map((row) => partKey(row)).filter(Boolean)).size,
      warehouse1Value: warehouseStock.reduce((sum, row) => sum + row.qty * row.cost_price, 0),
      totalOnHandValue,
      totalSoldRetail,
      lowStock,
      fastCount: fastMoving.length,
      idleCount: idle.length,
    },
  };
}

function pendingRequests(data) {
  const inventoryPending = (data.parts_inventory || [])
    .filter(isPendingPartsRequest)
    .map(mapInventoryPartsRequest);
  const legacyPending = (data.parts_requests || [])
    .filter((row) => String(row.status || '').trim().toLowerCase() === 'pending')
    .map(mapLegacyPartsRequest);
  return [...inventoryPending, ...legacyPending]
    .sort((a, b) => rowTime(b) - rowTime(a));
}

function groupByLocation(rows, keyFn) {
  const map = new Map();
  (rows || []).forEach((row) => {
    const location = canonicalizeBranchName(keyFn(row)) || keyFn(row) || 'Unassigned';
    if (!map.has(location)) map.set(location, []);
    map.get(location).push(row);
  });
  return Array.from(map.entries()).map(([location, items]) => ({ location, items, count: items.length }));
}

function buildPmApprovals(data) {
  const requests = pendingRequests(data);
  const transfers = [...(data.parts_transfers || [])]
    .sort((a, b) => rowTime(b) - rowTime(a));
  const purchaseOrders = [...(data.parts_purchase_orders || [])]
    .sort((a, b) => rowTime(b) - rowTime(a));
  const documents = [...(data.parts_documents || [])]
    .sort((a, b) => rowTime(b) - rowTime(a))
    .slice(0, 80);
  const transactions = inventory.sortChronological(inventory.allAuditRows(data), 'desc').slice(0, 80)
    .map((row) => Object.assign({}, row, {
      present_location: locationOf(row),
      transaction_type_label: displayPartsTransactionType(row.transaction_type),
    }));

  return {
    requests,
    requestsByLocation: groupByLocation(requests, (row) => row.requesting_branch || row.branch || locationOf(row)),
    transfers,
    purchaseOrders,
    documents,
    transactions,
    pendingRequestCount: requests.length,
    pendingTransferCount: transfers.filter((row) => String(row.status || '').toLowerCase() === 'pending').length,
    pendingPoCount: purchaseOrders.filter((row) => String(row.status || '').toLowerCase() === 'pending').length,
  };
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatStamp(value) {
  if (!value) return stampNow().label;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return stampNow(parsed).label;
}

module.exports = {
  IDLE_DAYS,
  FAST_WINDOW_DAYS,
  WAREHOUSE_1,
  pmLocationOptions,
  buildPmVitals,
  buildPmApprovals,
  formatMoney,
  formatStamp,
  locationOf,
};
