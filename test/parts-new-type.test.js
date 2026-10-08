const test = require('node:test');
const assert = require('node:assert/strict');
const inventory = require('../lib/parts-inventory-controller');
const request = require('../lib/parts-request');
const { stockByLocation, currentPartStocks } = require('../lib/parts-location-scope');
const { deductIncomingLotsAtLocation } = require('../lib/parts-transfer-receive');
const { buildGeneratedReport } = require('../lib/parts-reports');
const { buildSortedDatabaseCsv, importPartsCsv } = require('../lib/parts-csv-sync');

function receive(data, id, partNumber, qty, location = 'Warehouse 1') {
  const result = inventory.applyRestock(data, {
    id, part_number: partNumber, part_name: 'Test part', qty,
    present_location: location, branch: location,
    transaction_date: '2026-10-07', created_at: '2026-10-07T00:00:00Z',
  });
  assert.equal(result.ok, true);
  return result.transaction;
}

test('New is a valid distinct stock-increasing type and legacy aliases keep their meaning', () => {
  assert.ok(request.VALID_PARTS_TRANSACTION_TYPES.includes('new'));
  assert.equal(request.normalizePartsTransactionType('New'), 'new');
  assert.equal(request.displayPartsTransactionType('new'), 'New');
  assert.equal(request.isIncomingStockType('New'), true);
  assert.equal(request.affectsStock('New', {}), 'increase');
  assert.equal(request.affectsStock('New', { activity_log: true }), 'none');
  assert.equal(request.normalizePartsTransactionType('newentry'), 'restock');
});

test('first receipt is New and later receipts system-wide link to it as Restock', () => {
  const data = {};
  const first = receive(data, 'first', 'PN000003', 10);
  assert.equal(first.transaction_type, 'new');
  assert.equal(first.initial_receipt_id, 'first');
  const second = receive(data, 'second', ' pn000003 ', 5, 'Carmen');
  assert.equal(second.transaction_type, 'restock');
  assert.equal(second.initial_receipt_id, 'first');
  const third = receive(data, 'third', 'PN000003', 2, 'Bogo');
  assert.equal(third.initial_receipt_id, 'first');
  assert.equal(inventory.getOnHand(data, 'PN000003'), 17);
  assert.equal(stockByLocation(inventory.allAuditRows(data), 'Warehouse 1').get('PN000003'), 10);
  assert.equal(currentPartStocks(inventory.allAuditRows(data), 'PN000003', [])
    .find((stock) => stock.location === 'Carmen').qty, 5);
  assert.equal(data.transactions.find((row) => row.id === 'first').transaction_type, 'new');
});

test('zero stock never makes an existing part New again and received quantity is retained', () => {
  const data = {};
  receive(data, 'first', 'A', 10);
  assert.equal(deductIncomingLotsAtLocation(data, 'A', 10, 'Warehouse 1').ok, true);
  const next = receive(data, 'next', 'A', 4);
  assert.equal(next.transaction_type, 'restock');
  assert.equal(next.initial_receipt_id, 'first');
  const original = data.parts_inventory.find((row) => row.id === 'first');
  assert.equal(original.qty, 0);
  assert.equal(original.received_qty, 10);
  assert.equal(inventory.getOnHand(data, 'A'), 4);
});

test('legacy stock is recognized without relabeling history; activity logs do not establish stock', () => {
  const legacy = { id: 'old', part_number: '00042', qty: 0, transaction_type: 'stock' };
  const data = { parts_inventory: [legacy] };
  const result = receive(data, 'next', '42', 5);
  assert.equal(result.transaction_type, 'restock');
  assert.equal(result.initial_receipt_id, 'old');
  assert.equal(legacy.transaction_type, 'stock');
  data.parts_inventory.push({ id: 'log', part_number: 'B', qty: 10, transaction_type: 'new', activity_log: true });
  assert.equal(receive(data, 'b', 'B', 2).transaction_type, 'new');
});

test('purchase lines carry expected types without adding stock; actual receipt determines final type', () => {
  const data = {};
  const lines = [{ part_number: 'A', qty: 2 }, { part_number: 'B', qty: 3 }];
  assert.equal(inventory.preparePurchaseLines(data, lines)[0].transaction_type, 'new');
  assert.equal(data.parts_inventory.length, 0);
  receive(data, 'a', 'A', 10);
  const planned = inventory.preparePurchaseLines(data, lines);
  assert.equal(planned[0].transaction_type, 'restock');
  assert.equal(planned[0].initial_receipt_id, 'a');
  assert.equal(planned[1].transaction_type, 'new');
  assert.equal(inventory.getOnHand(data, 'A'), 10);
});

test('New participates in audit reports and CSV preserves type, quantities and initial reference', async () => {
  const data = {};
  receive(data, 'first', 'A', 10);
  receive(data, 'second', 'A', 3);
  const report = buildGeneratedReport(data, { type: 'audit' });
  assert.equal(report.tables[0].rows.length, 2);
  assert.deepEqual(report.tables[0].rows.map((row) => row.transaction_type), ['New', 'Stock']);
  const target = {};
  assert.equal((await importPartsCsv(target, buildSortedDatabaseCsv(data).csv, 'replace', 'test')).ok, true);
  assert.equal(target.parts_inventory.find((row) => row.id === 'first').transaction_type, 'new');
  assert.equal(target.parts_inventory.find((row) => row.id === 'second').initial_receipt_id, 'first');
  assert.equal(inventory.getOnHand(target, 'A'), 13);
});
