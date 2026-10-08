const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const store = require('../data/store');
const router = require('../routes/reports');
const ejs = require('ejs');
const path = require('node:path');
const { buildReportExcel } = require('../lib/parts-report-excel');

async function readWorkbook(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return workbook;
}

test('Excel workbook preserves text identifiers, numbers, metadata and separate sections', async () => {
  const report = {
    title: 'Test report', subtitle: 'Filtered records', generatedAt: '2026-10-07',
    meta: [{ label: 'Part Number', value: '00123' }],
    tables: [{
      heading: 'Invalid / Name',
      columns: [
        { key: 'part', header: 'Part Number' },
        { key: 'qty', header: 'TR Qty', numeric: true },
        { key: 'price', header: 'Cost', numeric: true, money: true },
        { key: 'editor', header: 'Editor' },
      ],
      rows: [{ part: '00123', qty: 5, price: '12.50', editor: '=SUM(A1:A2)' },
        { part: '<&>', qty: 'Unavailable', price: '', editor: '' }],
    }, { heading: 'Invalid / Name', columns: [{ key: 'part', header: 'Part' }], rows: [] }],
  };
  const buffer = await buildReportExcel(report);
  assert.equal(Buffer.from(buffer).subarray(0, 2).toString(), 'PK');
  const workbook = await readWorkbook(buffer);
  assert.equal(workbook.worksheets.length, 2);
  assert.notEqual(workbook.worksheets[0].name, workbook.worksheets[1].name);
  const sheet = workbook.worksheets[0];
  assert.equal(sheet.getCell('A1').value, 'Test report');
  assert.equal(sheet.getCell('B4').value, '00123');
  assert.equal(sheet.getCell('B7').value, '00123');
  assert.equal(sheet.getCell('C7').value, 5);
  assert.equal(sheet.getCell('D7').value, 12.5);
  assert.equal(sheet.getCell('D7').numFmt, '#,##0.00');
  assert.equal(sheet.getCell('E7').value, '=SUM(A1:A2)');
  assert.equal(sheet.getCell('E7').type, ExcelJS.ValueType.String);
  assert.equal(sheet.getCell('C8').value, 'Unavailable');
});

test('Excel route retains filters and session scope for Stock, New and Removed', async (t) => {
  const data = {
    parts_inventory: [
      { id: 'n', transaction_type: 'new', part_number: '00123', qty: 4, received_qty: 4,
        present_location: 'Carmen', transaction_date: '2026-10-01' },
      { id: 's', transaction_type: 'restock', part_number: '00123', qty: 2, received_qty: 2,
        present_location: 'Carmen', transaction_date: '2026-10-02' },
      { id: 'w', transaction_type: 'restock', part_number: 'SECRET', qty: 3, received_qty: 3,
        present_location: 'Warehouse 1', transaction_date: '2026-10-02' },
    ],
    transactions_made: [
      { id: 'r', kind: 'part', status: 'remove', recorded_at: '2026-10-03',
        snapshot: { id: 'original', part_number: '00123', qty: 1, present_location: 'Carmen' } },
      { id: 'other', kind: 'part', status: 'remove', recorded_at: '2026-10-03',
        snapshot: { id: 'warehouse', part_number: 'SECRET', qty: 1, present_location: 'Warehouse 1' } },
    ],
  };
  t.mock.method(store, 'getRawData', async () => structuredClone(data));
  const handler = router.stack.find((entry) => entry.route?.path === '/generate').route.stack[0].handle;
  for (const type of ['stock', 'new', 'removed']) {
    const headers = {};
    let buffer;
    await handler({
      query: { type, format: 'xlsx', month: '2026-10', warehouse: 'Carmen' },
      session: { user: { role: 'service_advisor', branch: 'Carmen' } },
    }, {
      setHeader(key, value) { headers[key] = value; },
      status(code) { assert.equal(code, 200); return this; },
      send(value) { buffer = value; },
    }, (error) => { throw error; });
    assert.match(headers['Content-Type'], /spreadsheetml.sheet/);
    assert.match(headers['Content-Disposition'], /\.xlsx"/);
    const workbook = await readWorkbook(buffer);
    const sheet = workbook.worksheets[0];
    assert.match(sheet.getCell('A2').value, /Carmen/);
    assert.match(sheet.getCell('A2').value, /2026-10/);
    const rows = [];
    sheet.eachRow((row) => rows.push(row.values));
    assert.match(JSON.stringify(rows), /00123/);
    assert.doesNotMatch(JSON.stringify(rows), /SECRET/);
    assert.equal(sheet.rowCount, 6);
  }
});

test('rendered Excel link preserves report criteria and is absent on errors', async (t) => {
  t.mock.method(store, 'getRawData', async () => ({}));
  const handler = router.stack.find((entry) => entry.route?.path === '/generate').route.stack[0].handle;
  let report;
  await handler({
    query: { type: 'stock', warehouse: 'Warehouse 1', startDate: '2026-10-01', scope: 'warehouse1' },
    session: { user: { role: 'parts_manager' } },
  }, { render(view, locals) { report = locals.report; } });
  const query = new URL(report.excelUrl, 'http://localhost').searchParams;
  assert.equal(query.get('format'), 'xlsx');
  assert.equal(query.get('warehouse'), 'Warehouse 1');
  assert.equal(query.get('startDate'), '2026-10-01');
  assert.equal(query.get('scope'), 'warehouse1');
  const template = path.join(__dirname, '..', 'views', 'reports', 'generate.ejs');
  const html = await ejs.renderFile(template, { report });
  assert.match(html, /Save as Excel \(.xlsx\)/);
  assert.match(html, /format=xlsx/);
  const errorHtml = await ejs.renderFile(template, { report: { ok: false, title: 'Error', tables: [] } });
  assert.doesNotMatch(errorHtml, /Save as Excel/);
});

test('Excel generation errors reach the Express error handler', async (t) => {
  t.mock.method(store, 'getRawData', async () => ({}));
  t.mock.method(ExcelJS.Workbook.prototype, 'addWorksheet', () => { throw new Error('Excel failed'); });
  const handler = router.stack.find((entry) => entry.route?.path === '/generate').route.stack[0].handle;
  let error;
  await handler({ query: { type: 'stock', format: 'xlsx' }, session: {} }, {}, (value) => { error = value; });
  assert.equal(error.message, 'Excel failed');
});
