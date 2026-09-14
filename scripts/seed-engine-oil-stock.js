/**
 * Seeds 3 mocked Engine Oil stock entries (Fully Synthetic, Semi Synthetic, Regular)
 * into Warehouse 1, qty 1000 each, receiving date = today. One-off, run manually:
 *   node scripts/seed-engine-oil-stock.js
 */
const store = require('../data/store');
const inventory = require('../lib/parts-inventory-controller');
const { allocatePartsTransactionNumber } = require('../lib/parts-transaction-number');

const LOCATION = 'Warehouse 1';
const QTY = 1000;
const EDITOR = 'SEED-ENGINE-OIL';
const SEED_TAG = 'ENGOIL-SEP26';

const PARTS = [
  {
    part_number: 'W1-EO-FULLSYN-1L',
    part_name: 'Engine Oil Fully Synthetic 1L',
    sub_id: 'EO-FS-001',
    generic: 'Fully Synthetic Motor Oil',
    supplier: 'Castrol Philippines',
    unit: 'bottle',
    cost_price: 420.00,
    markup: 30,
  },
  {
    part_number: 'W1-EO-SEMISYN-1L',
    part_name: 'Engine Oil Semi Synthetic 1L',
    sub_id: 'EO-SS-002',
    generic: 'Semi Synthetic Motor Oil',
    supplier: 'Petron Corporation',
    unit: 'bottle',
    cost_price: 310.00,
    markup: 28,
  },
  {
    part_number: 'W1-EO-REGULAR-1L',
    part_name: 'Engine Oil Regular 1L',
    sub_id: 'EO-RG-003',
    generic: 'Regular Mineral Motor Oil',
    supplier: 'Shell Philippines',
    unit: 'bottle',
    cost_price: 220.00,
    markup: 26,
  },
];

function retailPrice(cost, markup) {
  return Number((cost + cost * (markup / 100)).toFixed(2));
}

function todayKey() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function isoOnDate(dateKey, hour, minute) {
  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  return `${dateKey}T${hh}:${mm}:00+08:00`;
}

function genId(index) {
  return `engoil-sep26-${String(index + 1).padStart(3, '0')}-${SEED_TAG.toLowerCase()}`;
}

function genBarcode(partNumber) {
  return `BC-${partNumber.replace(/[^A-Z0-9]/gi, '')}`;
}

function genReceiptNumber(index, dateKey) {
  return `RCPT-${dateKey.replace(/-/g, '')}-${String(index + 1).padStart(4, '0')}`;
}

async function main() {
  const data = await store.getRawData();
  if (!Array.isArray(data.parts_inventory)) data.parts_inventory = [];
  if (!Array.isArray(data.transactions)) data.transactions = [];

  const existingKeys = new Set(
    [...data.parts_inventory, ...data.transactions]
      .map((row) => String(row && row.part_number || '').trim().toUpperCase())
      .filter(Boolean)
  );

  const dateKey = todayKey();
  let created = 0;
  let skipped = 0;

  PARTS.forEach((part, index) => {
    const partNumber = part.part_number;
    if (existingKeys.has(partNumber.toUpperCase())) {
      skipped += 1;
      return;
    }

    const record = {
      id: genId(index),
      created_at: isoOnDate(dateKey, 9 + index, index * 10),
      date: dateKey,
      transaction_date: dateKey,
      transaction_number: allocatePartsTransactionNumber(data, new Date(`${dateKey}T12:00:00+08:00`)),
      transaction_type: 'stock',
      present_location: LOCATION,
      branch: LOCATION,
      editor: EDITOR,
      barcode: genBarcode(partNumber),
      part_number: partNumber,
      part_name: part.part_name,
      sub_id: part.sub_id,
      generic: part.generic,
      supplier: part.supplier,
      receiving_receipt_number: genReceiptNumber(index, dateKey),
      unit: part.unit,
      qty: QTY,
      cost_price: part.cost_price,
      markup: part.markup,
      retail_price: retailPrice(part.cost_price, part.markup),
      sold_to: '',
      seed_batch: SEED_TAG,
    };

    data.parts_inventory.push(record);
    inventory.rememberTransaction(data, record);
    existingKeys.add(partNumber.toUpperCase());
    created += 1;
  });

  if (created) {
    await store.replaceData(data);
  }

  console.log(`Created: ${created}, Skipped (already existed): ${skipped}`);
  PARTS.forEach((part) => {
    console.log(`  - ${part.part_number} | ${part.part_name} | supplier: ${part.supplier} | qty: ${QTY}`);
  });
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
