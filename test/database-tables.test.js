const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const script = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'database-tables.js'), 'utf8');

function classes(initial = []) {
  const values = new Set(initial);
  return {
    contains: (value) => values.has(value),
    add: (value) => values.add(value),
    remove: (value) => values.delete(value),
    toggle(value, enabled) { if (enabled) values.add(value); else values.delete(value); },
  };
}

function cell(text, options = {}) {
  return {
    textContent: text, colSpan: options.colSpan || 1, rowSpan: 1,
    firstChild: null,
    children: [],
    querySelector() { return this.children[0] || null; },
    appendChild(child) { this.children.push(child); },
    dataset: {}, style: options.style || {}, classList: classes(options.classes),
    getBoundingClientRect: () => ({ width: options.width || 100 }),
  };
}

function row(cells) {
  const result = { cells };
  cells.forEach((value, index) => { value.parentElement = result; value.cellIndex = index; });
  return result;
}

function table(headers, records, options = {}) {
  const head = row(headers.map((value) => cell(value)));
  const body = { rows: records.map((values) => row(values.map((value) => cell(value)))) };
  return {
    tHead: { rows: [head] }, tBodies: [body], rows: [head, ...body.rows],
    classList: classes(), parentElement: { matches: () => true },
    querySelector(selector) {
      if (selector === 'table') return options.nested || null;
      return options.editable || null;
    },
    matches(selector) {
      if (selector === '.transaction-table') return !!options.transaction;
      return !!options.manual;
    },
    querySelectorAll() {
      return this.rows.flatMap((value) => value.cells.filter((item) => item.classList.contains('sticky-col')));
    },
  };
}

function run(tables) {
  let mutation;
  let resize;
  const frames = [];
  vm.runInNewContext(script, {
    document: {
      querySelector: () => ({ querySelectorAll: () => tables }),
      createElement: () => ({ classList: classes(), appendChild() {} }),
    },
    MutationObserver: class { constructor(callback) { mutation = callback; } observe() {} },
    ResizeObserver: class { constructor(callback) { resize = callback; } observe() {} },
    requestAnimationFrame: (callback) => frames.push(callback),
  });
  return {
    mutate() { mutation(); while (frames.length) frames.shift()(); },
    resize(target) { resize([{ target }]); },
  };
}

test('database numeric columns align right without treating identifiers as numbers', () => {
  const list = table(
    ['Part Number', 'Barcode', 'Telephone number', 'Qty', 'Cost Price', 'Markup (%)', 'Current On-Hand'],
    [['000003', '48036214', '09123456789', '70', '12.00', '20', '8']],
  );
  run([list]);
  assert.equal(list.classList.contains('database-table-fit'), true);
  for (const record of list.rows) {
    assert.deepEqual(record.cells.map((value) => value.classList.contains('database-cell-number')),
      [false, false, false, true, true, true, true]);
  }
});

test('editable grids, nested layouts, and manual summaries retain their layout', () => {
  const lists = [
    table(['Qty'], [['1']], { editable: true }),
    table(['Qty'], [['1']], { nested: true }),
    table(['Qty'], [['1']], { manual: true }),
  ];
  run(lists);
  lists.forEach((list) => assert.equal(list.classList.contains('database-table-fit'), false));
});

test('existing numeric annotations and new rows retain alignment; colspan notices are ignored', () => {
  const list = table(['Item', 'Unit Value'], [['Long description', '12.00']]);
  list.tBodies[0].rows[0].cells[1].style.textAlign = 'right';
  const harness = run([list]);
  const added = row([cell('Short'), cell('5.00')]);
  const notice = row([cell('No more records', { colSpan: 2 })]);
  list.tBodies[0].rows.push(added, notice);
  list.rows.push(added, notice);
  harness.mutate();
  assert.equal(added.cells[0].classList.contains('database-cell-number'), false);
  assert.equal(added.cells[1].classList.contains('database-cell-number'), true);
  assert.equal(notice.cells[0].classList.contains('database-cell-number'), false);
});

test('sticky offsets follow actual column widths rather than fixed 180px offsets', () => {
  const list = table(['Date', 'WO'], [['2026-10-07', '000123']]);
  const first = list.tHead.rows[0].cells[0];
  const second = list.tHead.rows[0].cells[1];
  first.classList.add('sticky-col');
  second.classList.add('sticky-col');
  first.getBoundingClientRect = () => ({ width: 137 });
  const harness = run([list]);
  assert.equal(second.style.left, '137px');
  first.getBoundingClientRect = () => ({ width: 216 });
  harness.resize(list);
  assert.equal(second.style.left, '216px');
});

test('services/parts are counts only in the transaction database, not descriptive columns elsewhere', () => {
  const descriptive = table(['Services', 'Parts'], [['Change oil', 'Oil filter']]);
  const transaction = table(['Services', 'Parts'], [['1', '2']], { transaction: true });
  run([descriptive, transaction]);
  assert.equal(descriptive.rows[1].cells[0].classList.contains('database-cell-number'), false);
  assert.equal(transaction.rows[1].cells[0].classList.contains('database-cell-number'), true);
});

test('headers defer width to populated data cells and retain header sizing for empty columns', () => {
  const list = table(['TR Qty', 'Part Name', 'Empty'], [['7', 'Oil filter', '']]);
  const harness = run([list]);
  const headers = list.tHead.rows[0].cells;
  assert.deepEqual(headers.map((header) => header.children[0].classList.contains('database-header-data-width')),
    [true, true, false]);
  list.tBodies[0].rows[0].cells[2].textContent = 'Now populated';
  harness.mutate();
  assert.equal(headers[2].children[0].classList.contains('database-header-data-width'), true);
  headers.forEach((header) => assert.equal(header.children.length, 1));
  list.tBodies[0].rows.length = 0;
  harness.mutate();
  headers.forEach((header) => assert.equal(header.children[0].classList.contains('database-header-data-width'), false));
});
