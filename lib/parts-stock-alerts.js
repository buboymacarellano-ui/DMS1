const inventory = require('./parts-inventory-controller');
const { WAREHOUSE_1, sameLocation, stockByLocation } = require('./parts-location-scope');

const COLLECTION = 'parts_stock_alerts';
const STATUS_PENDING = 'pending';
const STATUS_ORDERED = 'ordered';
const STATUS_RESTOCKED = 'restocked';

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function ensureAlerts(data) {
  if (!data || typeof data !== 'object') return [];
  if (!Array.isArray(data[COLLECTION])) data[COLLECTION] = [];
  return data[COLLECTION];
}

function formatAlertStamp(value) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return '';
  const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  const weekday = date.toLocaleDateString('en-US', { weekday: 'long' });
  const day = date.getDate();
  const month = date.toLocaleDateString('en-US', { month: 'long' });
  const year = date.getFullYear();
  return `${time} ${weekday} ${day}, ${month} ${year}`;
}

function warehouse1OnHand(data, partNumber) {
  const key = inventory.normalizePartNumberKey(partNumber);
  if (!key) return 0;
  const map = stockByLocation(inventory.allAuditRows(data), WAREHOUSE_1);
  return map.has(key) ? Number(map.get(key) || 0) : 0;
}

function failedLoadMessage(partNumber) {
  return `Failed to Load This "${String(partNumber || '').trim()}"`;
}

function requestPopupMessage(branch, partNumber) {
  const location = String(branch || '').trim() || '—';
  const number = String(partNumber || '').trim();
  return `Branch ${location} requesting a Parts- Part#${number}`;
}

function readyMessage(partNumber) {
  return `The Part Number ${String(partNumber || '').trim()} Is Ready and Available`;
}

function statusLabel(status) {
  const value = String(status || '').trim().toLowerCase();
  if (value === STATUS_ORDERED) return 'Ordered';
  if (value === STATUS_RESTOCKED) return 'Restocked';
  return 'Pending';
}

function findOpenAlert(alerts, partNumber, branch) {
  const key = inventory.normalizePartNumberKey(partNumber);
  return (alerts || []).find((row) => (
    inventory.normalizePartNumberKey(row.part_number) === key
    && sameLocation(row.branch, branch)
    && String(row.status || '').toLowerCase() !== STATUS_RESTOCKED
  )) || null;
}

function recordOutOfStock(data, payload) {
  const alerts = ensureAlerts(data);
  const partNumber = String((payload && payload.part_number) || '').trim();
  const branch = String((payload && payload.branch) || '').trim();
  if (!partNumber || !branch) return null;

  const existing = findOpenAlert(alerts, partNumber, branch);
  if (existing) {
    existing.updated_at = new Date().toISOString();
    existing.pm_message = requestPopupMessage(branch, partNumber);
    return existing;
  }

  const now = new Date();
  const row = {
    id: genId(),
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    part_number: partNumber,
    branch,
    account: String((payload && payload.account) || '').trim(),
    user_id: String((payload && payload.user_id) || '').trim(),
    role: String((payload && payload.role) || '').trim(),
    status: STATUS_PENDING,
    pm_message: requestPopupMessage(branch, partNumber),
    stamp_label: formatAlertStamp(now),
    sa_message: '',
    ready_at: '',
    ready_stamp_label: '',
  };
  alerts.unshift(row);
  return row;
}

function markOrdered(data, partNumber, branch) {
  const alerts = ensureAlerts(data);
  const open = findOpenAlert(alerts, partNumber, branch);
  if (!open) return null;
  if (String(open.status || '').toLowerCase() === STATUS_RESTOCKED) return open;
  open.status = STATUS_ORDERED;
  open.updated_at = new Date().toISOString();
  return open;
}

function reconcileWarehouse1Stock(data) {
  const alerts = ensureAlerts(data);
  const open = alerts.filter((alert) => String(alert.status || '').toLowerCase() !== STATUS_RESTOCKED);
  if (!open.length) return false;
  const map = stockByLocation(inventory.allAuditRows(data), WAREHOUSE_1);
  const now = new Date();
  let dirty = false;
  open.forEach((alert) => {
    const key = inventory.normalizePartNumberKey(alert.part_number);
    const onHand = key && map.has(key) ? Number(map.get(key) || 0) : 0;
    if (onHand > 0) {
      alert.status = STATUS_RESTOCKED;
      alert.on_hand = onHand;
      alert.ready_at = now.toISOString();
      alert.ready_stamp_label = formatAlertStamp(now);
      alert.sa_message = readyMessage(alert.part_number);
      alert.updated_at = now.toISOString();
      dirty = true;
    }
  });
  return dirty;
}

function listPendingPopups(data) {
  return ensureAlerts(data)
    .filter((row) => String(row.status || '').toLowerCase() !== STATUS_RESTOCKED)
    .sort((a, b) => String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || '')))
    .map((row) => ({
      id: row.id,
      branch: row.branch || '',
      part_number: row.part_number || '',
      message: requestPopupMessage(row.branch, row.part_number),
    }));
}

function listTransmission(data) {
  return listPendingPopups(data);
}

function listReadyMessages(data, branch) {
  return ensureAlerts(data)
    .filter((row) => String(row.status || '').toLowerCase() === STATUS_RESTOCKED)
    .filter((row) => !branch || sameLocation(row.branch, branch))
    .filter((row) => row.sa_message)
    .sort((a, b) => String(b.ready_at || b.updated_at || '').localeCompare(String(a.ready_at || a.updated_at || '')))
    .slice(0, 40);
}

function maybeReconcileFromRecord(data, record) {
  if (!record) return;
  const location = String(record.present_location || record.branch || '').trim();
  if (!sameLocation(location, WAREHOUSE_1)) return;
  reconcileWarehouse1Stock(data);
}

module.exports = {
  COLLECTION,
  STATUS_PENDING,
  STATUS_ORDERED,
  STATUS_RESTOCKED,
  WAREHOUSE_1,
  formatAlertStamp,
  warehouse1OnHand,
  failedLoadMessage,
  readyMessage,
  statusLabel,
  requestPopupMessage,
  recordOutOfStock,
  markOrdered,
  reconcileWarehouse1Stock,
  listPendingPopups,
  listTransmission,
  listReadyMessages,
  maybeReconcileFromRecord,
};
