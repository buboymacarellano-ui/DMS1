/**
 * Replenish every existing parts-database SKU into Warehouse 1, today.
 * Fluids: 100 units. All other generics: 20 units.
 * Same part numbers, suppliers, cost, markup, and retail.
 *
 * Usage: node scripts/seed-warehouse1-replenish-today.js [--force] [--dry-run]
 */
const store = require('../data/store');
const inventory = require('../lib/parts-inventory-controller');
const { allocatePartsTransactionNumber } = require('../lib/parts-transaction-number');
const { TYPE_RESTOCK } = require('../lib/parts-request');

const LOCATION = 'Warehouse 1';
const EDITOR = 'SEED-REPLENISH-W1';
const BATCH_ID = 'w1-replenish-2026-08-26';
const FLUID_QTY = 100;
const OTHER_QTY = 20;
const FORCE = process.argv.includes('--force');
const DRY_RUN = process.argv.includes('--dry-run');

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

function isoOnDate(dateKey, hour, minute, second) {
  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  const ss = String(second).padStart(2, '0');
  return `${dateKey}T${hh}:${mm}:${ss}+08:00`;
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function retailPrice(cost, markup, existing) {
  const fromRecord = toNumber(existing);
  if (fromRecord > 0) return Number(fromRecord.toFixed(2));
  const safeCost = toNumber(cost);
  const safeMarkup = toNumber(markup);
  return Number((safeCost + safeCost * (safeMarkup / 100)).toFixed(2));
}

function isFluidsPart(part) {
  const generic = String(part.generic || '').trim().toLowerCase();
  const name = String(part.part_name || '').trim().toLowerCase();
  if (generic === 'fluids' || generic.includes('fluid')) return true;
  if (name.includes('filter')) return false;
  return (
    name.includes('fluid')
    || name.includes('coolant')
    || /\batf\b/.test(name)
    || /\bengine oil\b/.test(name)
    || /\bgear oil\b/.test(name)
    || name.includes('transmission fluid')
    || name.includes('brake fluid')
    || name.includes('power steering fluid')
    || name.includes('washer fluid')
  );
}

function stripBatch(data) {
  const keep = (row) => String(row && row.seed_batch || '') !== BATCH_ID;
  data.parts_inventory = (data.parts_inventory || []).filter(keep);
  data.transactions = (data.transactions || []).filter(keep);
}

function uniqueCatalogParts(data) {
  inventory.rebuildPartsCatalog(data);
  const seen = new Set();
  const parts = [];
  (data.parts || []).forEach((part) => {
    const key = inventory.normalizePartNumberKey(part && part.part_number);
    if (!key || seen.has(key)) return;
    seen.add(key);
    parts.push(part);
  });
  return parts.sort((a, b) => String(a.part_number).localeCompare(String(b.part_number)));
}

async function main() {
  const data = await store.getRawData();
  inventory.ensureCollections(data);

  const already = (data.parts_inventory || []).filter((row) => row && row.seed_batch === BATCH_ID).length;
  if (already && !FORCE && !DRY_RUN) {
    console.log(JSON.stringify({
      skipped: true,
      reason: 'batch already present',
      count: already,
      hint: 're-run with --force',
    }, null, 2));
    return;
  }
  if (already && FORCE) stripBatch(data);

  const dateKey = manilaDateKey();
  const catalog = uniqueCatalogParts(data);
  if (!catalog.length) throw new Error('No parts found in the parts database to replenish.');

  const plan = catalog.map((part, index) => {
    const fluids = isFluidsPart(part);
    return {
      part_number: part.part_number,
      part_name: part.part_name || '',
      generic: part.generic || '',
      supplier: part.supplier || '',
      unit: part.unit || 'pc',
      cost_price: toNumber(part.cost_price),
      markup: toNumber(part.markup),
      retail_price: retailPrice(part.cost_price, part.markup, part.retail_price),
      fluids,
      qty: fluids ? FLUID_QTY : OTHER_QTY,
      index,
    };
  });

  const fluids = plan.filter((row) => row.fluids);
  const others = plan.filter((row) => !row.fluids);

  if (DRY_RUN) {
    console.log(JSON.stringify({
      dryRun: true,
      date: dateKey,
      location: LOCATION,
      skus: plan.length,
      fluids: { count: fluids.length, qty_each: FLUID_QTY, total_units: fluids.length * FLUID_QTY },
      others: { count: others.length, qty_each: OTHER_QTY, total_units: others.length * OTHER_QTY },
      sample_fluids: fluids.slice(0, 8).map((row) => row.part_number),
      sample_others: others.slice(0, 8).map((row) => row.part_number),
    }, null, 2));
    return;
  }

  const backupPath = await store.backupData();
  let created = 0;
  plan.forEach((item) => {
    const createdAt = isoOnDate(dateKey, 8, Math.floor(item.index / 60) % 60, item.index % 60);
    const result = inventory.applyRestock(data, {
      id: `inv-${BATCH_ID}-${String(item.index + 1).padStart(4, '0')}`,
      created_at: createdAt,
      seed_batch: BATCH_ID,
      date: dateKey,
      transaction_date: dateKey,
      transaction_number: allocatePartsTransactionNumber(data, new Date(`${dateKey}T08:00:00+08:00`)),
      transaction_type: TYPE_RESTOCK,
      present_location: LOCATION,
      branch: LOCATION,
      created_branch: LOCATION,
      editor: EDITOR,
      part_number: item.part_number,
      part_name: item.part_name,
      generic: item.generic,
      supplier: item.supplier,
      unit: item.unit,
      qty: item.qty,
      cost_price: item.cost_price,
      markup: item.markup,
      retail_price: item.retail_price,
      sold_to: '',
    });
    if (!result.ok) throw new Error(`${item.part_number}: ${result.error}`);
    created += 1;
  });

  inventory.rebuildPartsCatalog(data);
  await store.replaceData(data);

  console.log(JSON.stringify({
    created,
    date: dateKey,
    location: LOCATION,
    fluids: { count: fluids.length, qty_each: FLUID_QTY, total_units: fluids.length * FLUID_QTY },
    others: { count: others.length, qty_each: OTHER_QTY, total_units: others.length * OTHER_QTY },
    backup: backupPath,
    seed_batch: BATCH_ID,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
