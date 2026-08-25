const { Readable } = require('stream');
const csvParser = require('csv-parser');
const inventory = require('./parts-inventory-controller');
const {
  normalizePartsTransactionType,
  displayPartsTransactionType,
  isValidPartsTransactionType,
} = require('./parts-request');
const { allocatePartsTransactionNumber } = require('./parts-transaction-number');
const { WAREHOUSE_1 } = require('./parts-location-scope');

const CSV_HEADERS = [
  'Transaction Date',
  'Transaction Type',
  'Present Location',
  'Editor',
  'Part Number',
  'Part Name',
  'Sub-ID',
  'Generic',
  'Supplier',
  'Qty',
  'On-Hand',
  'Cost Price',
  'Markup (%)',
  'Retail Price',
  'Sold To (WO#)',
  'Transaction Number',
  'ID',
  'Unit',
];

const HEADER_ALIASES = {
  transactiondate: 'transaction_date',
  date: 'transaction_date',
  transactiontype: 'transaction_type',
  type: 'transaction_type',
  presentlocation: 'present_location',
  location: 'present_location',
  branch: 'present_location',
  editor: 'editor',
  partnumber: 'part_number',
  partname: 'part_name',
  subid: 'sub_id',
  generic: 'generic',
  supplier: 'supplier',
  qty: 'qty',
  quantity: 'qty',
  onhand: 'on_hand',
  costprice: 'cost_price',
  cost: 'cost_price',
  markup: 'markup',
  markuppct: 'markup',
  retailprice: 'retail_price',
  retail: 'retail_price',
  soldto: 'sold_to',
  soldtoworkorder: 'sold_to',
  transactionnumber: 'transaction_number',
  id: 'id',
  unit: 'unit',
};

function stripBom(text) {
  return String(text || '').replace(/^\uFEFF/, '');
}

function csvValue(value) {
  const text = String(value == null ? '' : value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function normalizeHeader(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/%/g, 'pct')
    .replace(/\(wo#\)/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function locationOf(row) {
  return String((row && (row.present_location || row.branch || row.requesting_branch)) || '').trim();
}

function parseCsvRows(text) {
  const payload = stripBom(text).trim();
  if (!payload) return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    const rows = [];
    Readable.from([payload])
      .pipe(csvParser())
      .on('data', (row) => rows.push(row))
      .on('end', () => resolve(rows))
      .on('error', reject);
  });
}

function mapCsvRow(row) {
  const mapped = {};
  Object.entries(row || {}).forEach(([header, value]) => {
    const key = HEADER_ALIASES[normalizeHeader(header)];
    if (!key) return;
    mapped[key] = String(value == null ? '' : value).trim();
  });
  return mapped;
}

function sortInventoryRows(rows) {
  return [...(rows || [])].sort((a, b) => {
    const loc = locationOf(a).localeCompare(locationOf(b), undefined, { sensitivity: 'base' });
    if (loc) return loc;
    const part = String(a.part_number || '').localeCompare(String(b.part_number || ''), undefined, { sensitivity: 'base' });
    if (part) return part;
    return String(a.transaction_date || a.created_at || '').localeCompare(String(b.transaction_date || b.created_at || ''));
  });
}

function buildSortedDatabaseCsv(data) {
  inventory.ensureCollections(data);
  const rows = sortInventoryRows(inventory.allAuditRows(data));
  const lines = [CSV_HEADERS.map(csvValue).join(',')];
  rows.forEach((row) => {
    const type = normalizePartsTransactionType(row.transaction_type);
    lines.push([
      String(row.transaction_date || '').slice(0, 10),
      displayPartsTransactionType(type) || row.transaction_type || '',
      locationOf(row),
      row.editor || '',
      row.part_number || '',
      row.part_name || '',
      row.sub_id || '',
      row.generic || '',
      row.supplier || '',
      row.qty != null ? row.qty : '',
      inventory.getOnHand(data, row.part_number),
      row.cost_price != null ? Number(row.cost_price).toFixed(2) : '',
      row.markup != null ? row.markup : '',
      row.retail_price != null ? Number(row.retail_price).toFixed(2) : '',
      row.sold_to || '',
      row.transaction_number || '',
      row.id || '',
      row.unit || '',
    ].map(csvValue).join(','));
  });
  const generatedAt = new Date().toISOString();
  return {
    csv: `${lines.join('\n')}\n`,
    filename: `parts-database-sorted-${generatedAt.slice(0, 10)}.csv`,
    count: rows.length,
  };
}

function normalizeImportedRecord(raw, data, editor) {
  const typeRaw = normalizePartsTransactionType(raw.transaction_type);
  const transaction_type = isValidPartsTransactionType(typeRaw) ? typeRaw : 'stock';
  const location = String(raw.present_location || '').trim() || WAREHOUSE_1;
  return {
    id: String(raw.id || '').trim() || genId(),
    created_at: new Date().toISOString(),
    transaction_date: String(raw.transaction_date || '').trim() || new Date().toISOString().slice(0, 10),
    transaction_number: String(raw.transaction_number || '').trim(),
    transaction_type,
    present_location: location,
    branch: location,
    editor: String(raw.editor || editor || '').trim(),
    part_number: String(raw.part_number || '').trim(),
    part_name: String(raw.part_name || '').trim(),
    sub_id: String(raw.sub_id || '').trim(),
    generic: String(raw.generic || '').trim(),
    supplier: String(raw.supplier || '').trim(),
    unit: String(raw.unit || '').trim(),
    qty: toNumber(raw.qty),
    cost_price: toNumber(raw.cost_price),
    markup: toNumber(raw.markup),
    retail_price: raw.retail_price !== undefined && String(raw.retail_price).trim() !== ''
      ? toNumber(raw.retail_price)
      : Number((toNumber(raw.cost_price) + toNumber(raw.cost_price) * (toNumber(raw.markup) / 100)).toFixed(2)),
    sold_to: String(raw.sold_to || '').trim(),
  };
}

function assignMissingTransactionNumbers(data, records) {
  const scratch = {
    parts_inventory: [...(data.parts_inventory || [])],
    parts_request_transactions: data.parts_request_transactions || [],
  };
  records.forEach((record) => {
    if (String(record.transaction_number || '').trim()) {
      scratch.parts_inventory.push(record);
      return;
    }
    record.transaction_number = allocatePartsTransactionNumber(scratch);
    scratch.parts_inventory.push(record);
  });
}

function findMatchIndex(list, incoming) {
  const byId = list.findIndex((row) => incoming.id && String(row.id) === String(incoming.id));
  if (byId !== -1) return byId;
  const txn = String(incoming.transaction_number || '').trim();
  if (txn) {
    const byTxn = list.findIndex((row) => String(row.transaction_number || '').trim() === txn);
    if (byTxn !== -1) return byTxn;
  }
  return -1;
}

async function importPartsCsv(data, csvText, mode, editor) {
  const rows = await parseCsvRows(csvText);
  const incoming = rows
    .map(mapCsvRow)
    .filter((row) => String(row.part_number || '').trim() && String(row.part_name || '').trim())
    .map((row) => normalizeImportedRecord(row, data, editor));

  if (!incoming.length) {
    return { ok: false, error: 'CSV did not contain any parts rows with Part Number and Part Name.' };
  }

  inventory.ensureCollections(data);
  if (!Array.isArray(data.parts_inventory)) data.parts_inventory = [];
  assignMissingTransactionNumbers(data, incoming);

  const importMode = String(mode || 'integrate').toLowerCase() === 'replace' ? 'replace' : 'integrate';
  let created = 0;
  let updated = 0;

  if (importMode === 'replace') {
    data.parts_inventory = incoming;
    created = incoming.length;
  } else {
    incoming.forEach((record) => {
      const idx = findMatchIndex(data.parts_inventory, record);
      if (idx === -1) {
        data.parts_inventory.push(record);
        created += 1;
        return;
      }
      data.parts_inventory[idx] = Object.assign({}, data.parts_inventory[idx], record, {
        id: data.parts_inventory[idx].id,
        created_at: data.parts_inventory[idx].created_at || record.created_at,
      });
      updated += 1;
    });
  }

  incoming.forEach((record) => inventory.rememberTransaction(data, record));
  inventory.rebuildPartsCatalog(data);

  return {
    ok: true,
    mode: importMode,
    created,
    updated,
    total: data.parts_inventory.length,
  };
}

module.exports = {
  CSV_HEADERS,
  parseCsvRows,
  buildSortedDatabaseCsv,
  importPartsCsv,
};
