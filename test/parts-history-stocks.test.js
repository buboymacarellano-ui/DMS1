const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');
const { currentPartStocks } = require('../lib/parts-location-scope');
const { DEFAULT_OPERATIONAL_BRANCHES } = require('../lib/branches');
const inventory = require('../lib/parts-inventory-controller');
const { displayPartsTransactionType } = require('../lib/parts-request');

test('current stocks include Warehouse 1 and all seven branches, including zero stock', () => {
  const rows = [
    { id: 'w1', part_number: 'pn000003', transaction_type: 'restock', present_location: 'Warehouse 1', qty: 7, received_qty: 10 },
    { id: 'w2', part_number: 'PN000003', transaction_type: 'stock', present_location: 'Warehouse 1', qty: 2.5 },
    { id: 'b1', part_number: 'PN000003', transaction_type: 'restock', branch: 'Escario', qty: 4 },
    { id: 'sold', part_number: 'PN000003', transaction_type: 'sold', branch: 'CebuCity', qty: 3 },
    { id: 'log', part_number: 'PN000003', transaction_type: 'restock', branch: 'CebuCity', qty: 99, activity_log: true },
    { id: 'other', part_number: 'OTHER', transaction_type: 'restock', branch: 'Carmen', qty: 10 },
    { id: 'empty', part_number: 'PN000003', transaction_type: 'restock', branch: 'Bogo', qty: 0 },
  ];
  const data = { parts_inventory: rows, transactions: rows.map((row) => ({ ...row })) };
  const stocks = currentPartStocks(inventory.allAuditRows(data), ' pn000003 ', []);
  assert.deepEqual(stocks.map((stock) => stock.location), ['Warehouse 1', ...DEFAULT_OPERATIONAL_BRANCHES]);
  assert.equal(stocks.find((stock) => stock.location === 'Warehouse 1').qty, 9.5);
  assert.equal(stocks.find((stock) => stock.location === 'CebuCity').qty, 4);
  assert.equal(stocks.find((stock) => stock.location === 'Carmen').qty, 0);
  assert.equal(stocks.find((stock) => stock.location === 'Bogo').qty, 0);
  assert.equal(rows[2].branch, 'Escario');
});

test('frontline stock summary remains scoped to the permitted location', () => {
  const rows = [
    { part_number: 'A', transaction_type: 'restock', branch: 'CebuCity', qty: 3 },
    { part_number: 'A', transaction_type: 'restock', branch: 'Warehouse 1', qty: 9 },
  ];
  assert.deepEqual(currentPartStocks(rows, 'A', [], 'CebuCity'), [{ location: 'CebuCity', qty: 3 }]);
  assert.deepEqual(currentPartStocks(rows, 'A', [], 'Warehouse 1'), [{ location: 'Warehouse 1', qty: 9 }]);
});

test('history template renders compact stock grid separately from date-filtered history', () => {
  const filename = path.join(__dirname, '..', 'views', 'parts', 'history.ejs');
  const stocks = currentPartStocks([
    { part_number: 'pn000003', transaction_type: 'restock', branch: 'Warehouse 1', qty: 7 },
  ], 'pn000003', []);
  const html = ejs.render(fs.readFileSync(filename, 'utf8'), {
    partNumber: 'pn000003', onHand: 7, part: { part_name: 'Oil' },
    currentStocks: stocks, history: [], grouped: [],
    startDate: '2026-01-01', endDate: '2026-01-02', groupBy: '', sort: 'asc',
    partsView: { scope: 'all' }, displayPartsTransactionType,
    transactionQty: inventory.transactionQty,
  }, { filename, includer: () => ({ template: ' ' }) });
  assert.match(html, /Current stocks of this item/);
  assert.match(html, /<th scope="col">Warehouse 1<\/th>/);
  assert.match(html, /<td class="stock-qty">7<\/td>/);
  for (const branch of DEFAULT_OPERATIONAL_BRANCHES) assert.ok(html.includes(`<th scope="col">${branch}</th>`));
  assert.match(html, /No history in this range/);
  assert.match(html, /not limited by the history date filter/);
  assert.match(html, /part-history-stock-scroll \{ overflow-x:auto; \}/);
  assert.ok(html.indexOf('Current on-hand:') < html.indexOf('<aside'));
  assert.ok(html.indexOf('<aside') < html.indexOf('<form'));
  const grid = html.slice(html.indexOf('<aside'), html.indexOf('</aside>'));
  assert.equal((grid.match(/<tr>/g) || []).length, 2);
});
