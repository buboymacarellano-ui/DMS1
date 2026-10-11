const test = require('node:test');
const assert = require('node:assert/strict');
const inventory = require('../lib/parts-inventory-controller');
const { deductIncomingLotsAtLocation } = require('../lib/parts-transfer-receive');
const { stockByLocation } = require('../lib/parts-location-scope');
const { buildSortedDatabaseCsv, parseCsvRows, importPartsCsv } = require('../lib/parts-csv-sync');
const { buildGeneratedReport } = require('../lib/parts-reports');

function receipt(data, id, qty, location = 'Warehouse 1') {
  const result = inventory.applyRestock(data, {
    id, part_number: 'OIL-1', part_name: 'Engine oil', qty,
    present_location: location, branch: location,
    transaction_date: '2026-09-01', created_at: '2026-09-01T00:00:00Z',
  });
  assert.equal(result.ok, true);
  return data.parts_inventory.find((row) => row.id === id);
}

test('received quantity stays fixed through repeated deductions and later receipts', () => {
  const data = {};
  const first = receipt(data, 'r1', 10);
  assert.equal(first.received_qty, 10);
  assert.equal(deductIncomingLotsAtLocation(data, 'OIL-1', 3, 'Warehouse 1').ok, true);
  assert.equal(first.qty, 7);
  assert.equal(inventory.transactionQty(first), 10);
  assert.equal(data.transactions[0].received_qty, 10);
  assert.equal(data.transactions[0].qty, 7);
  const second = receipt(data, 'r2', 5);
  assert.equal(stockByLocation(inventory.allAuditRows(data), 'Warehouse 1').get('OIL-1'), 12);
  assert.equal(inventory.transactionQty(first), 10);
  assert.equal(inventory.transactionQty(second), 5);
  assert.equal(deductIncomingLotsAtLocation(data, 'OIL-1', 9, 'Warehouse 1').ok, true);
  assert.equal(first.qty, 0);
  assert.equal(second.qty, 3);
  assert.equal(inventory.getOnHand(data, 'OIL-1'), 3);
  assert.equal(inventory.transactionQty(first), 10);
  assert.equal(inventory.transactionQty(second), 5);
});

test('sale synchronization updates remaining stock without changing received quantity', () => {
  const data = {};
  const lot = receipt(data, 'r1', 2.5, 'CebuCity');
  lot.qty = 1.25;
  inventory.syncInventoryRowToTransactions(data, lot);
  inventory.rebuildPartCatalogEntry(data, lot.part_number);
  assert.equal(data.transactions[0].qty, 1.25);
  assert.equal(data.transactions[0].received_qty, 2.5);
  inventory.rememberTransaction(data, lot);
  assert.equal(lot.received_qty, 2.5);
  assert.equal(inventory.getOnHand(data, lot.part_number), 1.25);
});

test('insufficient stock and another location do not alter receipts', () => {
  const data = {};
  const warehouse = receipt(data, 'r1', 4);
  const branch = receipt(data, 'r2', 9, 'CebuCity');
  assert.equal(deductIncomingLotsAtLocation(data, 'OIL-1', 5, 'Warehouse 1').ok, false);
  assert.equal(warehouse.qty, 4);
  assert.equal(branch.qty, 9);
  assert.equal(deductIncomingLotsAtLocation(data, 'OIL-1', 2, 'CebuCity').ok, true);
  assert.equal(branch.qty, 7);
  assert.equal(branch.received_qty, 9);
  assert.equal(warehouse.qty, 4);
});

test('legacy receipt quantities are explicitly unknown; other transaction quantities are unchanged', () => {
  assert.equal(inventory.transactionQty({ transaction_type: 'restock', qty: 7 }), null);
  assert.equal(inventory.transactionQty({ transaction_type: 'stock', qty: 7, received_qty: '' }), null);
  assert.equal(inventory.transactionQty({ transaction_type: 'restock', qty: 0, received_qty: 0 }), 0);
  assert.equal(inventory.transactionQty({ transaction_type: 'sold', qty: 3 }), 3);
  assert.equal(inventory.transactionQty({ transaction_type: 'parts request', qty: 4 }), 4);
});

test('Parts Manager history includes old depleted receipts without changing daily views', () => {
  const data = {};
  const lot = receipt(data, 'r1', 10);
  deductIncomingLotsAtLocation(data, 'OIL-1', 10, 'Warehouse 1');
  const query = { now: new Date('2026-10-07T12:00:00Z') };
  assert.equal(inventory.getDashboardLogs(data, query).length, 0);
  const history = inventory.getDashboardLogs(data, { ...query, includeHistory: true });
  assert.equal(history.length, 1);
  assert.equal(inventory.transactionQty(history[0]), 10);
  assert.equal(lot.qty, 0);
});

test('database CSV round-trip keeps received and remaining quantities separate, including legacy unknowns', async () => {
  const data = {};
  receipt(data, 'r1', 10);
  deductIncomingLotsAtLocation(data, 'OIL-1', 3, 'Warehouse 1');
  data.parts_inventory.push({
    id: 'legacy', transaction_type: 'restock', qty: 2,
    part_number: 'LEGACY', part_name: 'Old part', present_location: 'Warehouse 1',
  });
  const exported = buildSortedDatabaseCsv(data);
  const rows = await parseCsvRows(exported.csv);
  const row = rows.find((entry) => entry.ID === 'r1');
  assert.equal(row.Qty, '7');
  assert.equal(row['Received Qty'], '10');
  const target = {};
  assert.equal((await importPartsCsv(target, exported.csv, 'replace', 'test')).ok, true);
  const restored = target.parts_inventory.find((entry) => entry.id === 'r1');
  assert.equal(restored.qty, 7);
  assert.equal(restored.received_qty, 10);
  assert.equal(restored.transaction_type, 'new');
  assert.equal(target.parts_inventory.find((entry) => entry.id === 'legacy').transaction_type, 'restock');
  assert.equal(inventory.getOnHand(target, 'OIL-1'), 7);
  assert.equal(inventory.transactionQty(target.parts_inventory.find((entry) => entry.id === 'legacy')), null);
});

test('lifecycle and database reports show original quantities, not remaining lot quantities', () => {
  const data = {};
  receipt(data, 'r1', 10);
  deductIncomingLotsAtLocation(data, 'OIL-1', 3, 'Warehouse 1');
  const report = buildGeneratedReport(data, { type: 'lifecycle', partNumber: 'OIL-1' });
  assert.equal(report.ok, true);
  assert.equal(report.tables[0].rows[0].qty, 10);
  assert.equal(report.tables[0].rows[0].on_hand, 7);
  assert.equal(report.tables[0].columns.find((col) => col.key === 'qty').header, 'TR Qty');
  const csv = buildGeneratedReport(data, { type: 'whole-database' }).csv;
  assert.match(csv, /TR Qty,Current On-Hand/);
  assert.match(csv, /,10,7,/);
});

test('invalid received quantities are rejected rather than imported as zero', async () => {
  const data = {};
  const result = await importPartsCsv(data,
    'Part Number,Part Name,Qty,Received Qty\nOIL-1,Engine oil,7,invalid\n',
    'replace', 'test');
  assert.equal(result.ok, false);
  assert.match(result.error, /CSV row 2: Received Qty/);
  assert.deepEqual(data, {});
});
