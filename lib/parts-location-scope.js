const { isFrontlineRole } = require('./frontline-roles');
const { affectsStock, isPartsActivityLog, isIncomingStockType } = require('./parts-request');

const WAREHOUSE_1 = 'Warehouse 1';

function normalizeLocationKey(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function sameLocation(a, b) {
  const left = normalizeLocationKey(a);
  const right = normalizeLocationKey(b);
  return Boolean(left && right && left === right);
}

function partLocation(part) {
  return String((part && (part.present_location || part.branch || part.requesting_branch)) || '').trim();
}

function belongsToLocation(part, location) {
  return sameLocation(partLocation(part), location);
}

function filterRowsByLocation(rows, location) {
  if (!location) return Array.isArray(rows) ? rows : [];
  return (rows || []).filter((row) => belongsToLocation(row, location));
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizePartNumberKey(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^\d+$/.test(raw)) return raw.replace(/^0+(?=\d)/, '');
  return raw.toUpperCase();
}

function stockByLocation(rows, location) {
  const map = new Map();
  filterRowsByLocation(rows, location).forEach((row) => {
    const partNumber = normalizePartNumberKey(row.part_number);
    if (!partNumber) return;
    if (isPartsActivityLog(row)) return;
    if (!isIncomingStockType(row.transaction_type)) return;
    const qty = Math.max(0, toNumber(row.qty));
    if (!map.has(partNumber)) map.set(partNumber, 0);
    map.set(partNumber, map.get(partNumber) + qty);
  });
  return map;
}

function attachLocationOnHand(rows, stockMap) {
  return (rows || []).map((row) => {
    const partNumber = normalizePartNumberKey(row.part_number);
    const onHand = stockMap && partNumber && stockMap.has(partNumber) ? stockMap.get(partNumber) : row.on_hand;
    return Object.assign({}, row, { on_hand: onHand });
  });
}

function withLocationOnHand(rows, auditRows, location) {
  if (!location) return Array.isArray(rows) ? rows : [];
  return attachLocationOnHand(rows, stockByLocation(auditRows, location));
}

function attachEachRowLocationOnHand(rows, auditRows) {
  const maps = new Map();
  return (rows || []).map((row) => {
    const location = partLocation(row);
    if (!location) return Object.assign({}, row);
    const mapKey = normalizeLocationKey(location);
    if (!maps.has(mapKey)) maps.set(mapKey, stockByLocation(auditRows, location));
    const stockMap = maps.get(mapKey);
    const partNumber = normalizePartNumberKey(row.part_number);
    const onHand = stockMap && partNumber && stockMap.has(partNumber) ? stockMap.get(partNumber) : row.on_hand;
    return Object.assign({}, row, { on_hand: onHand });
  });
}

function isWarehouse1Scope(query) {
  const scope = String((query && query.scope) || '').trim().toLowerCase();
  return scope === 'warehouse1' || sameLocation((query && query.location) || '', WAREHOUSE_1);
}

function resolveFrontlinePartsView(user, query, actorBranch) {
  if (!isFrontlineRole(user && user.role)) {
    return {
      isFrontline: false,
      scope: 'all',
      location: '',
      readOnly: false,
      label: 'Parts Database',
    };
  }

  if (isWarehouse1Scope(query)) {
    return {
      isFrontline: true,
      scope: 'warehouse1',
      location: WAREHOUSE_1,
      readOnly: true,
      label: 'Warehouse 1 Parts Database',
    };
  }

  const branch = String(actorBranch || '').trim();
  return {
    isFrontline: true,
    scope: 'branch',
    location: branch || '__unassigned-branch__',
    readOnly: false,
    label: branch ? `${branch} Parts Database` : 'Branch Parts Database',
  };
}

function scopeQuerySuffix(scope) {
  return scope === 'warehouse1' ? '?scope=warehouse1' : '';
}

function filterDataToLocation(data, location) {
  if (!location || !data || typeof data !== 'object') return data;
  return Object.assign({}, data, {
    parts_inventory: filterRowsByLocation(data.parts_inventory, location),
    transactions: filterRowsByLocation(data.transactions, location),
    parts: filterRowsByLocation(data.parts, location),
  });
}

module.exports = {
  WAREHOUSE_1,
  normalizeLocationKey,
  sameLocation,
  partLocation,
  belongsToLocation,
  filterRowsByLocation,
  stockByLocation,
  attachLocationOnHand,
  withLocationOnHand,
  attachEachRowLocationOnHand,
  isWarehouse1Scope,
  resolveFrontlinePartsView,
  scopeQuerySuffix,
  filterDataToLocation,
};
