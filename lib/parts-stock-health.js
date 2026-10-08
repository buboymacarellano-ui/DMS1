const inventory = require('./parts-inventory-controller');
const { filterRowsByLocation, stockByLocation } = require('./parts-location-scope');
const { isIncomingStockType, isPartsActivityLog } = require('./parts-request');
const normalizePartNumberKey = inventory.normalizePartNumberKey;

const DEFAULT_LOW_STOCK_THRESHOLD = 10;

function lowStockThreshold() {
  const n = Number(process.env.PARTS_LOW_STOCK_THRESHOLD);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_LOW_STOCK_THRESHOLD;
}

// Uses the same per-location on-hand as the Parts Database table, so the grid always matches it.
function listLowStockParts(data, location, options) {
  const threshold = options && Number.isFinite(options.threshold) ? options.threshold : lowStockThreshold();
  const auditRows = inventory.allAuditRows(data);
  const onHandMap = stockByLocation(auditRows, location);
  const parts = new Map();

  filterRowsByLocation(auditRows, location).forEach((row) => {
    if (isPartsActivityLog(row) || !isIncomingStockType(row.transaction_type)) return;
    const key = normalizePartNumberKey(row.part_number);
    if (!key) return;
    const known = parts.get(key);
    const stamp = String(row.transaction_date || row.created_at || '');
    if (known && known.stamp >= stamp) return;
    parts.set(key, {
      stamp,
      part_number: row.part_number,
      part_name: row.part_name || '',
      sub_id: row.sub_id || '',
      supplier: row.supplier || '',
    });
  });

  const items = [];
  parts.forEach((info, key) => {
    const onHand = onHandMap.has(key) ? Number(onHandMap.get(key) || 0) : 0;
    if (onHand > threshold) return;
    items.push({
      part_number: info.part_number,
      part_name: info.part_name,
      sub_id: info.sub_id,
      supplier: info.supplier,
      on_hand: onHand,
      level: onHand <= 0 ? 'out' : 'low',
    });
  });
  items.sort((a, b) => (a.on_hand - b.on_hand) || String(a.part_name).localeCompare(String(b.part_name)));

  const outCount = items.filter((i) => i.level === 'out').length;
  return {
    location: location || '',
    threshold,
    status: outCount ? 'error' : (items.length ? 'degraded' : 'healthy'),
    outCount,
    lowCount: items.length - outCount,
    items,
    timestamp: new Date().toISOString(),
  };
}

module.exports = { DEFAULT_LOW_STOCK_THRESHOLD, lowStockThreshold, listLowStockParts };
