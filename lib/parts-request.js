const TYPE_RESTOCK = 'restock';
const TYPE_STOCK = 'stock';
const TYPE_SOLD = 'sold';
const TYPE_PRICE_EDIT = 'priceedit';
const PARTS_REQUEST_TYPE = 'parts request';
const TYPE_TRANSFER_REQUEST = 'transfer request';
const TYPE_NEW_STOCK = TYPE_RESTOCK;

const VALID_PARTS_TRANSACTION_TYPES = [
  TYPE_RESTOCK,
  TYPE_STOCK,
  TYPE_SOLD,
  TYPE_PRICE_EDIT,
  PARTS_REQUEST_TYPE,
  TYPE_TRANSFER_REQUEST,
];

const TRANSACTION_TYPE_ALIASES = {
  newentry: TYPE_RESTOCK,
  'new entry': TYPE_RESTOCK,
  newstock: TYPE_RESTOCK,
  'new stock': TYPE_RESTOCK,
  restock: TYPE_RESTOCK,
  stock: TYPE_STOCK,
  sold: TYPE_SOLD,
  priceedit: TYPE_PRICE_EDIT,
  'price edit': TYPE_PRICE_EDIT,
  'parts request': PARTS_REQUEST_TYPE,
  partsrequest: PARTS_REQUEST_TYPE,
  transfer: TYPE_TRANSFER_REQUEST,
  'transfer request': TYPE_TRANSFER_REQUEST,
  transferrequest: TYPE_TRANSFER_REQUEST,
};

const TRANSACTION_TYPE_LABELS = {
  [TYPE_RESTOCK]: 'Restock',
  [TYPE_STOCK]: 'Stock',
  [TYPE_SOLD]: 'Sold',
  [TYPE_PRICE_EDIT]: 'Price Edit',
  [PARTS_REQUEST_TYPE]: 'Parts Request',
  [TYPE_TRANSFER_REQUEST]: 'Transfer Request',
};

function normalizePartsTransactionType(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return TRANSACTION_TYPE_ALIASES[raw.toLowerCase()] || raw.toLowerCase();
}

function displayPartsTransactionType(value) {
  const type = normalizePartsTransactionType(value);
  return TRANSACTION_TYPE_LABELS[type] || rawDisplayFallback(value);
}

function rawDisplayFallback(value) {
  const raw = String(value || '').trim();
  return raw || '';
}

function isValidPartsTransactionType(value) {
  return VALID_PARTS_TRANSACTION_TYPES.includes(normalizePartsTransactionType(value));
}

function isIncomingStockType(value) {
  const type = normalizePartsTransactionType(value);
  return type === TYPE_RESTOCK || type === TYPE_STOCK;
}

const WAREHOUSE_DESTINATIONS = ['Warehouse 1', 'Warehouse 2', 'Warehouse 3'];
const REQUEST_TX_STATUS_OPEN = 'Open';
const REQUEST_TX_STATUS_CLOSED = 'Closed';

function normalizeType(value) {
  return String(value || '').trim().toLowerCase();
}

function isValidWarehouse(value) {
  return WAREHOUSE_DESTINATIONS.includes(String(value || '').trim());
}

function isPartsRequestType(value) {
  const type = normalizePartsTransactionType(value);
  return type === PARTS_REQUEST_TYPE;
}

function isPendingPartsRequest(row) {
  if (!row || !isPartsRequestType(row.transaction_type)) return false;
  const status = String(row.request_status || 'pending').trim().toLowerCase();
  return status === 'pending';
}

function mapInventoryPartsRequest(row) {
  return {
    id: row.id,
    source: 'inventory',
    requesting_branch: String(row.requesting_branch || row.branch || '').trim(),
    branch: String(row.branch || '').trim(),
    work_order_number: String(row.work_order_number || row.sold_to || '').trim(),
    work_order_id: String(row.work_order_id || '').trim(),
    transaction_number: String(row.transaction_number || '').trim(),
    part_number: String(row.part_number || '').trim(),
    part_name: String(row.part_name || '').trim(),
    sub_id: String(row.sub_id || '').trim(),
    supplier: String(row.supplier || '').trim(),
    unit: String(row.unit || '').trim(),
    qty: row.qty,
    editor: String(row.editor || '').trim(),
    requested_by: String(row.editor || '').trim(),
    created_at: row.created_at || row.transaction_date || '',
    cost_price: row.cost_price,
    markup: row.markup,
    retail_price: row.retail_price,
    generic: String(row.generic || '').trim(),
    sent_to: String(row.sent_to || '').trim(),
    warehouse_order_id: String(row.warehouse_order_id || '').trim(),
  };
}

function mapLegacyPartsRequest(row) {
  return {
    id: row.id,
    source: 'legacy',
    requesting_branch: String(row.requesting_branch || row.branch || '').trim(),
    branch: String(row.branch || '').trim(),
    work_order_number: String(row.work_order_number || row.work_order_id || '').trim(),
    work_order_id: String(row.work_order_id || '').trim(),
    transaction_number: String(row.transaction_number || '').trim(),
    part_number: String(row.part_number || '').trim(),
    part_name: String(row.part_name || '').trim(),
    sub_id: String(row.sub_id || '').trim(),
    supplier: String(row.supplier || '').trim(),
    unit: String(row.unit || '').trim(),
    qty: row.qty,
    editor: String(row.requested_by || '').trim(),
    requested_by: String(row.requested_by || '').trim(),
    created_at: row.created_at || '',
    cost_price: row.cost_price,
    markup: row.markup,
    retail_price: row.retail_price,
    generic: String(row.notes || '').trim(),
  };
}

function buildPartsRequestInventoryPayload({
  partNumber,
  partName,
  subId,
  unit,
  qty,
  supplier,
  generic,
  costPrice,
  markup,
  retailPrice,
  editor,
  requestingBranch,
  branch,
  workOrderNumber,
  workOrderId,
  transactionDate,
}) {
  return {
    transaction_date: transactionDate || new Date().toISOString().slice(0, 10),
    transaction_type: PARTS_REQUEST_TYPE,
    request_status: 'pending',
    editor: String(editor || '').trim(),
    part_number: String(partNumber || '').trim(),
    part_name: String(partName || '').trim(),
    sub_id: String(subId || '').trim(),
    generic: String(generic || '').trim(),
    supplier: String(supplier || '').trim(),
    unit: String(unit || '').trim(),
    qty,
    cost_price: costPrice,
    markup,
    retail_price: retailPrice,
    sold_to: String(workOrderNumber || '').trim(),
    work_order_number: String(workOrderNumber || '').trim(),
    work_order_id: String(workOrderId || '').trim(),
    requesting_branch: String(requestingBranch || '').trim(),
    branch: String(branch || requestingBranch || '').trim(),
  };
}

function isPartsActivityLog(row) {
  return Boolean(row && (
    row.activity_log === true
    || String(row.created_via || '').trim() === 'create-parts-log'
  ));
}

function affectsStock(type, row) {
  if (isPartsActivityLog(row)) return 'none';
  const normalized = normalizePartsTransactionType(type);
  if (normalized === TYPE_SOLD) return 'decrease';
  if (normalized === PARTS_REQUEST_TYPE) return 'none';
  if (normalized === TYPE_TRANSFER_REQUEST) return 'none';
  if (normalized === TYPE_PRICE_EDIT) return 'none';
  if (normalized === TYPE_RESTOCK || normalized === TYPE_STOCK) return 'increase';
  return 'none';
}

module.exports = {
  PARTS_REQUEST_TYPE,
  TYPE_TRANSFER_REQUEST,
  TYPE_RESTOCK,
  TYPE_NEW_STOCK,
  TYPE_STOCK,
  TYPE_PRICE_EDIT,
  TYPE_SOLD,
  VALID_PARTS_TRANSACTION_TYPES,
  TRANSACTION_TYPE_LABELS,
  WAREHOUSE_DESTINATIONS,
  REQUEST_TX_STATUS_OPEN,
  REQUEST_TX_STATUS_CLOSED,
  isValidWarehouse,
  isPartsRequestType,
  isPendingPartsRequest,
  mapInventoryPartsRequest,
  mapLegacyPartsRequest,
  buildPartsRequestInventoryPayload,
  normalizePartsTransactionType,
  displayPartsTransactionType,
  isValidPartsTransactionType,
  isIncomingStockType,
  isPartsActivityLog,
  affectsStock,
};
