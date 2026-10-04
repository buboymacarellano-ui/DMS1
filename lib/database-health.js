const store = require('../data/store');

const CORE_COLLECTIONS = [
  'work_orders',
  'customers',
  'vehicles',
  'employees',
  'parts_inventory',
  'transaction_records',
  'users',
];

async function checkDatabaseHealth() {
  const started = Date.now();
  const collections = {};
  let okCount = 0;
  for (const name of CORE_COLLECTIONS) {
    const t0 = Date.now();
    try {
      const rows = await store.getAll(name);
      collections[name] = {
        ok: Array.isArray(rows),
        count: Array.isArray(rows) ? rows.length : 0,
        responseTime: Date.now() - t0,
      };
    } catch (err) {
      collections[name] = { ok: false, count: 0, responseTime: Date.now() - t0, error: err.message };
    }
    if (collections[name].ok) okCount += 1;
  }
  const total = CORE_COLLECTIONS.length;
  const healthPercentage = Math.round((okCount / total) * 100);
  let status = 'healthy';
  if (okCount === 0) status = 'error';
  else if (okCount < total) status = 'degraded';
  return {
    status,
    healthPercentage,
    timestamp: new Date().toISOString(),
    activeCollections: okCount,
    totalCollections: total,
    collections,
    responseTime: Date.now() - started,
  };
}

async function getHealthSummary() {
  const h = await checkDatabaseHealth();
  return {
    status: h.status,
    healthPercentage: h.healthPercentage,
    activeCollections: h.activeCollections,
    totalCollections: h.totalCollections,
    responseTime: h.responseTime,
    timestamp: h.timestamp,
  };
}

function formatHealthDisplay(health) {
  const h = health || {};
  const tone = h.status === 'healthy' ? 'healthy' : h.status === 'degraded' ? 'watch' : 'alert';
  const icon = h.status === 'healthy' ? '\u2713' : h.status === 'degraded' ? '\u26A0' : '\u2715';
  return {
    tone,
    icon,
    status: h.status || 'error',
    healthPercentage: h.healthPercentage || 0,
    message: `${h.activeCollections || 0}/${h.totalCollections || CORE_COLLECTIONS.length} collections active`,
    responseTime: h.responseTime,
    timestamp: h.timestamp,
  };
}

module.exports = { CORE_COLLECTIONS, checkDatabaseHealth, getHealthSummary, formatHealthDisplay };
