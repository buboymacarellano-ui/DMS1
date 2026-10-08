const test = require('node:test');
const assert = require('node:assert/strict');
const ejs = require('ejs');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const inventory = require('../lib/parts-inventory-controller');
const { recordPartOperation, buildDatabaseRecords } = require('../lib/pm-database-records');
const { buildGeneratedReport } = require('../lib/parts-reports');

function fixture() {
  const data = {};
  const first = inventory.applyRestock(data, {
    id: 'first', part_number: 'A', part_name: 'Part A', qty: 10,
    present_location: 'Warehouse 1', transaction_date: '2026-09-01',
  }).transaction;
  inventory.applyRestock(data, {
    id: 'restock', part_number: 'A', part_name: 'Part A', qty: 5,
    present_location: 'Warehouse 1', transaction_date: '2026-10-01',
  });
  const branch = inventory.applyRestock(data, {
    id: 'branch', part_number: 'B', part_name: 'Part B', qty: 3,
    present_location: 'Carmen', transaction_date: '2026-10-02',
  }).transaction;
  recordPartOperation(data, first, 'edit', 'Editor');
  recordPartOperation(data, first, 'remove', 'Remover');
  recordPartOperation(data, branch, 'remove', 'Branch remover');
  data.transactions_made.forEach((row) => { row.recorded_at = '2026-10-03T12:00:00Z'; });
  data.transactions_made.push({
    id: 'transfer-removal', kind: 'transfer', status: 'remove',
    recorded_at: '2026-10-04T12:00:00Z', recorded_by: 'Transfer remover',
    from_branch: 'Warehouse 1', reference_number: 'PTN-1',
    lines: [{ part_number: 'C', part_name: 'Transferred part', qty: 2 }],
  });
  return data;
}

test('Stock, New and Removed reports match the database categories without duplicates', () => {
  const data = fixture();
  const database = buildDatabaseRecords(data);
  for (const [type, category] of [['stock', 'restock'], ['new', 'new'], ['removed', 'removed']]) {
    const report = buildGeneratedReport(data, { type });
    assert.equal(report.ok, true);
    const expected = database.filter((row) => row.database_type === category);
    assert.equal(report.tables[0].rows.length, expected.length);
    assert.ok(report.tables[0].rows.every((row) => row.transaction_type === report.title));
  }
  const removed = buildGeneratedReport(data, { type: 'removed' }).tables[0].rows;
  assert.equal(removed.length, 3);
  assert.equal(removed.find((row) => row.part_number === 'A').editor, 'Remover');
  assert.equal(removed.find((row) => row.part_number === 'A').qty, 10);
  assert.equal(removed.find((row) => row.part_number === 'C').editor, 'Transfer remover');
  assert.equal(inventory.getOnHand(data, 'A'), 15);
});

test('operation reports support optional date and location filters and empty results', () => {
  const data = fixture();
  const stock = buildGeneratedReport(data, { type: 'stock', month: '2026-10', warehouse: 'warehouse1' });
  assert.equal(stock.tables[0].rows.length, 1);
  assert.equal(stock.tables[0].rows[0].qty, 5);
  const removed = buildGeneratedReport(data, {
    type: 'removed', startDate: '2026-10-04', endDate: '2026-10-04', warehouse: 'Warehouse 1',
  });
  assert.equal(removed.tables[0].rows.length, 1);
  assert.equal(removed.tables[0].rows[0].part_number, 'C');
  const empty = buildGeneratedReport(data, { type: 'new', month: '2026-11' });
  assert.equal(empty.ok, true);
  assert.deepEqual(empty.tables[0].rows, []);
});

test('authorized location also restricts removal snapshots and transfer lines', () => {
  const data = fixture();
  const scoped = buildGeneratedReport(data, { type: 'removed' }, { location: 'Carmen' });
  assert.deepEqual(scoped.tables[0].rows.map((row) => row.part_number), ['B']);
  const conflicting = buildGeneratedReport(data, { type: 'removed', warehouse: 'Warehouse 1' }, { location: 'Carmen' });
  assert.deepEqual(conflicting.tables[0].rows, []);
});

test('generate route renders all three reports and enforces session scope', async (t) => {
  const store = require('../data/store');
  const router = require('../routes/reports');
  t.mock.method(store, 'getRawData', async () => fixture());
  const handler = router.stack.find((entry) => entry.route?.path === '/generate').route.stack[0].handle;
  async function generate(query, user) {
    let report;
    await handler({ query, session: { user } }, {
      render(view, locals) {
        assert.equal(view, 'reports/generate');
        report = locals.report;
      },
    });
    return report;
  }
  for (const type of ['stock', 'new', 'removed']) {
    const report = await generate({ type }, { role: 'parts_manager' });
    assert.equal(report.ok, true);
    assert.ok(report.tables[0].rows.length);
  }
  const branch = await generate({ type: 'removed' }, { role: 'service_advisor', branch: 'Carmen' });
  assert.deepEqual(branch.tables[0].rows.map((row) => row.part_number), ['B']);
  const warehouse = await generate({ type: 'removed', scope: 'warehouse1' }, {
    role: 'service_advisor', branch: 'Carmen',
  });
  assert.deepEqual(warehouse.tables[0].rows.map((row) => row.part_number), ['A', 'C']);
});

test('modal exposes each new report with optional date and location criteria', async () => {
  const html = await ejs.renderFile(path.join(__dirname, '..', 'views', 'partials', 'parts-report-modal.ejs'), {});
  for (const type of ['stock', 'new', 'removed']) {
    assert.match(html, new RegExp(`<option value="${type}">`));
  }
  assert.match(html, /data-for="date-range audit stock new removed"/);
  assert.match(html, /data-for="warehouse stock new removed"/);
  const reportHtml = await ejs.renderFile(path.join(__dirname, '..', 'views', 'reports', 'generate.ejs'), {
    report: buildGeneratedReport(fixture(), { type: 'removed' }),
  });
  assert.match(reportHtml, /<h1>Removed<\/h1>/);
  assert.match(reportHtml, /Transfer remover/);
  assert.match(reportHtml, /Print \/ Save as PDF/);
});

test('modal sends visible filters only when switching report types', () => {
  const listeners = {};
  const elements = {
    'parts-report-btn': { addEventListener() {} },
    'parts-report-modal': { querySelectorAll() { return []; } },
    'parts-report-form': {
      addEventListener(event, handler) { listeners[event] = handler; },
      getAttribute() { return ''; },
    },
    'report-type': { value: 'stock', addEventListener() {} },
    'report-type-hint': {},
  };
  for (const [id, value, hidden] of [
    ['report-part-number', 'STALE-PART', true],
    ['report-start-date', '2026-10-01', false],
    ['report-end-date', '2026-10-07', false],
    ['report-month', '', false],
    ['report-supplier', 'Stale Supplier', true],
    ['report-warehouse', 'Warehouse 1', false],
    ['report-threshold', '99', true],
  ]) {
    elements[id] = { value, closest() { return { hidden }; } };
  }
  let opened;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'parts-report-modal.js'), 'utf8'), {
    document: { getElementById(id) { return elements[id]; }, addEventListener() {} },
    window: { open(url) { opened = url; } },
    URLSearchParams,
  });
  listeners.submit({ preventDefault() {} });
  const query = new URL(opened, 'http://localhost').searchParams;
  assert.equal(query.get('type'), 'stock');
  assert.equal(query.get('warehouse'), 'Warehouse 1');
  assert.equal(query.get('startDate'), '2026-10-01');
  assert.equal(query.has('supplier'), false);
  assert.equal(query.has('partNumber'), false);
  assert.equal(query.has('threshold'), false);
});
