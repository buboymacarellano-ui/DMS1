const {
  TYPE_RESTOCK,
  TYPE_SOLD,
  WAREHOUSE_DESTINATIONS,
  normalizePartsTransactionType,
  displayPartsTransactionType,
} = require('./parts-request');
const inventory = require('./parts-inventory-controller');

const DEFAULT_LOW_STOCK_THRESHOLD = 5;

const REPORT_TYPES = {
  lifecycle: 'Single Part Lifecycle',
  'date-range': 'Report by Date Range',
  supplier: 'Report by Supplier',
  warehouse: 'Report by Warehouse',
  audit: 'System Audit Trail',
  'low-stock': 'Critical Low Stock Report',
  'whole-database': 'Download Whole Database CSV',
};

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function uniqueSorted(values) {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

function locationOf(row) {
  return String((row && (row.present_location || row.branch || row.requesting_branch || row.sent_to)) || '').trim();
}

function csvValue(value) {
  const text = String(value == null ? '' : value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function money(value) {
  if (value == null || value === '') return '';
  return Number(value).toFixed(2);
}

function rowDate(row) {
  return String((row && (row.date || row.transaction_date || row.created_at)) || '').slice(0, 10);
}

function safeMinimum(part) {
  const explicit = [part.min_stock, part.minimum_stock, part.reorder_point, part.safety_stock, part.min_qty]
    .map(toNumber)
    .find((value) => value > 0);
  return explicit || DEFAULT_LOW_STOCK_THRESHOLD;
}

function collectReportLookups(data) {
  inventory.ensureCollections(data);
  const rows = inventory.allAuditRows(data);
  return {
    suppliers: uniqueSorted(rows.map((row) => row.supplier)),
    warehouses: uniqueSorted([
      ...WAREHOUSE_DESTINATIONS,
      ...rows.map(locationOf),
    ]),
    partNumbers: uniqueSorted(rows.map((row) => row.part_number)),
  };
}

function transactionColumns() {
  return [
    { key: 'transaction_date', header: 'Date' },
    { key: 'transaction_type', header: 'Type' },
    { key: 'part_number', header: 'Part Number' },
    { key: 'part_name', header: 'Part Name' },
    { key: 'sub_id', header: 'Sub-ID' },
    { key: 'supplier', header: 'Supplier' },
    { key: 'location', header: 'Location' },
    { key: 'qty', header: 'Qty', numeric: true },
    { key: 'on_hand', header: 'On-Hand', numeric: true },
    { key: 'cost_price', header: 'Cost', numeric: true, money: true },
    { key: 'retail_price', header: 'Retail', numeric: true, money: true },
    { key: 'sold_to', header: 'Sold To' },
    { key: 'editor', header: 'Editor' },
  ];
}

function mapTxRow(data, row) {
  const type = normalizePartsTransactionType(row.transaction_type || row.type);
  return {
    transaction_date: rowDate(row),
    transaction_type: displayPartsTransactionType(type),
    type,
    part_number: row.part_number || '',
    part_name: row.part_name || '',
    sub_id: row.sub_id || '',
    supplier: row.supplier || '',
    location: locationOf(row),
    qty: row.qty,
    on_hand: inventory.getOnHand(data, row.part_number),
    cost_price: money(row.cost_price),
    retail_price: money(row.retail_price),
    sold_to: row.sold_to || '',
    editor: row.editor || '',
    transaction_number: row.transaction_number || '',
  };
}

function applyDateWindow(rows, query) {
  let startDate = String(query.startDate || '').trim();
  let endDate = String(query.endDate || '').trim();
  const month = String(query.month || '').trim();
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    startDate = startDate || `${month}-01`;
    const [year, mon] = month.split('-').map(Number);
    const last = new Date(year, mon, 0).getDate();
    endDate = endDate || `${month}-${String(last).padStart(2, '0')}`;
  }
  return rows.filter((row) => inventory.inDateRange(row, startDate, endDate));
}

function buildGeneratedReport(data, query) {
  inventory.ensureCollections(data);
  if (!data.parts.length) inventory.rebuildPartsCatalog(data);

  const type = String(query.type || '').trim();
  const title = REPORT_TYPES[type] || 'Parts Report';
  const generatedAt = new Date().toISOString();
  const allRows = inventory.allAuditRows(data);

  if (type === 'lifecycle') {
    const partNumber = String(query.partNumber || query.part_number || '').trim();
    if (!partNumber) {
      return { ok: false, error: 'Part number is required for the Single Part Lifecycle report.' };
    }
    const history = inventory.getPartHistory(partNumber, {
      startDate: query.startDate,
      endDate: query.endDate,
      sort: 'asc',
    }, data);
    return {
      ok: true,
      type,
      title,
      generatedAt,
      subtitle: `Part ${history.part_number} · Current on-hand: ${history.on_hand}`,
      meta: [
        { label: 'Part Number', value: history.part_number },
        { label: 'Part Name', value: (history.part && history.part.part_name) || '' },
        { label: 'Sub-ID', value: (history.part && history.part.sub_id) || '' },
        { label: 'Current On-Hand', value: history.on_hand },
        { label: 'Lifetime Events', value: history.total },
      ],
      tables: [{
        heading: 'Continuous lifetime history',
        columns: transactionColumns(),
        rows: history.history.map((row) => mapTxRow(data, row)),
      }],
    };
  }

  if (type === 'date-range') {
    const filtered = inventory.sortChronological(applyDateWindow(allRows, query), 'asc');
    return {
      ok: true,
      type,
      title,
      generatedAt,
      subtitle: `Window ${query.month || [query.startDate, query.endDate].filter(Boolean).join(' to ') || 'all dates'}`,
      tables: [{
        heading: 'Chronological records',
        columns: transactionColumns(),
        rows: filtered.map((row) => mapTxRow(data, row)),
      }],
    };
  }

  if (type === 'supplier') {
    const supplier = String(query.supplier || '').trim().toLowerCase();
    if (!supplier) {
      return { ok: false, error: 'Supplier is required for the supplier report.' };
    }
    const filtered = allRows.filter((row) => String(row.supplier || '').trim().toLowerCase() === supplier);
    return {
      ok: true,
      type,
      title,
      generatedAt,
      subtitle: `Supplier: ${query.supplier}`,
      tables: [{
        heading: 'Matching supplier records',
        columns: transactionColumns(),
        rows: inventory.sortChronological(filtered, 'asc').map((row) => mapTxRow(data, row)),
      }],
    };
  }

  if (type === 'warehouse') {
    const warehouse = String(query.warehouse || '').trim().toLowerCase();
    if (!warehouse) {
      return { ok: false, error: 'Warehouse / location is required for the warehouse report.' };
    }
    const filtered = allRows.filter((row) => locationOf(row).toLowerCase() === warehouse);
    return {
      ok: true,
      type,
      title,
      generatedAt,
      subtitle: `Warehouse / location: ${query.warehouse}`,
      tables: [{
        heading: 'Parts at this location',
        columns: transactionColumns(),
        rows: inventory.sortChronological(filtered, 'asc').map((row) => mapTxRow(data, row)),
      }],
    };
  }

  if (type === 'audit') {
    const restockRows = allRows.filter((row) => normalizePartsTransactionType(row.transaction_type || row.type) === TYPE_RESTOCK);
    const soldRows = allRows.filter((row) => normalizePartsTransactionType(row.transaction_type || row.type) === TYPE_SOLD);
    const windowedRestock = applyDateWindow(restockRows, query);
    const windowedSold = applyDateWindow(soldRows, query);
    return {
      ok: true,
      type,
      title,
      generatedAt,
      subtitle: 'Restock vs Sold accounting verification',
      layout: 'split',
      tables: [
        {
          heading: `Restock (${windowedRestock.length})`,
          columns: transactionColumns(),
          rows: inventory.sortChronological(windowedRestock, 'asc').map((row) => mapTxRow(data, row)),
        },
        {
          heading: `Sold (${windowedSold.length})`,
          columns: transactionColumns(),
          rows: inventory.sortChronological(windowedSold, 'asc').map((row) => mapTxRow(data, row)),
        },
      ],
    };
  }

  if (type === 'whole-database') {
    const rows = inventory.sortChronological(allRows, 'asc').map((row) => {
      const mapped = mapTxRow(data, row);
      return {
        ...mapped,
        generic: row.generic || '',
        markup: row.markup != null ? row.markup : '',
        sub_id: row.sub_id || mapped.sub_id || '',
      };
    });
    const headers = [
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
    ];
    const lines = [headers.map(csvValue).join(',')];
    rows.forEach((row) => {
      lines.push([
        row.transaction_date,
        row.transaction_type,
        row.location,
        row.editor,
        row.part_number,
        row.part_name,
        row.sub_id,
        row.generic,
        row.supplier,
        row.qty,
        row.on_hand,
        row.cost_price,
        row.markup,
        row.retail_price,
        row.sold_to,
      ].map(csvValue).join(','));
    });
    return {
      ok: true,
      type,
      title,
      generatedAt,
      format: 'csv',
      filename: `parts-database-${generatedAt.slice(0, 10)}.csv`,
      csv: `${lines.join('\n')}\n`,
      subtitle: `Whole parts database · ${rows.length} rows`,
    };
  }

  if (type === 'low-stock') {
    const requested = toNumber(query.threshold);
    const parts = (data.parts || []).map((part) => {
      const threshold = requested > 0 ? requested : safeMinimum(part);
      return {
        part_number: part.part_number,
        part_name: part.part_name || '',
        sub_id: part.sub_id || '',
        supplier: part.supplier || '',
        location: part.present_location || part.branch || '',
        stock: toNumber(part.stock),
        threshold,
      };
    }).filter((part) => part.stock <= part.threshold)
      .sort((a, b) => a.stock - b.stock);
    return {
      ok: true,
      type,
      title,
      generatedAt,
      subtitle: `Items at or below safe minimum${requested > 0 ? ` (${requested})` : ''}`,
      tables: [{
        heading: 'Critical low stock',
        columns: [
          { key: 'part_number', header: 'Part Number' },
          { key: 'part_name', header: 'Part Name' },
          { key: 'sub_id', header: 'Sub-ID' },
          { key: 'supplier', header: 'Supplier' },
          { key: 'location', header: 'Location' },
          { key: 'stock', header: 'On-Hand', numeric: true },
          { key: 'threshold', header: 'Safe Minimum', numeric: true },
        ],
        rows: parts,
      }],
    };
  }

  return { ok: false, error: 'Select a valid report type.' };
}

module.exports = {
  REPORT_TYPES,
  DEFAULT_LOW_STOCK_THRESHOLD,
  collectReportLookups,
  buildGeneratedReport,
};
