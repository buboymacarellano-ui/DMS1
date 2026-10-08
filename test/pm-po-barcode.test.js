const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function grid() {
  const elements = new Map();
  const timers = new Map();
  const requests = [];
  const navigations = [];
  let confirmations = 0;
  let timerId = 0;
  const document = {
    activeElement: null,
    getElementById(id) { return elements.get(id); },
    addEventListener() {},
    createElement() { return makeRow(); },
  };
  function element(field, row) {
    return {
      value: '', dataset: field ? { field } : {}, style: {}, hidden: false,
      listeners: {},
      addEventListener(name, handler) { this.listeners[name] = handler; }, focus() { document.activeElement = this; },
      closest(selector) { return selector === 'tr' ? row : null; },
    };
  }
  function makeRow() {
    const fields = new Map();
    const extras = new Map();
    const row = {
      isConnected: false,
      set innerHTML(html) {
        for (const match of html.matchAll(/data-field="([^"]+)"/g)) {
          fields.set(match[1], element(match[1], row));
        }
      },
      querySelector(selector) {
        const match = selector.match(/\[data-field="([^"]+)"\]/);
        if (match) return fields.get(match[1]);
        if (!extras.has(selector)) extras.set(selector, element());
        return extras.get(selector);
      },
      querySelectorAll() { return [...fields.values()]; },
    };
    return row;
  }
  for (const id of [
    'pm-po-grid-root', 'pm-po-grid-total', 'pm-po-status', 'pm-po-date', 'pm-po-number',
    'pm-po-supplier', 'pm-po-branch', 'pm-po-notes', 'pm-po-editing',
    'pm-po-new', 'pm-po-add-line', 'pm-po-create', 'pm-po-save',
  ]) elements.set(id, element());
  elements.get('pm-po-branch').options = [{ defaultSelected: true, value: 'Warehouse 1' }];
  const body = {
    rows: [], listeners: {},
    set innerHTML(value) {
      assert.equal(value, '');
      this.rows.forEach((row) => { row.isConnected = false; });
      this.rows = [];
    },
    appendChild(row) { row.isConnected = true; this.rows.push(row); },
    addEventListener(name, handler) { this.listeners[name] = handler; },
  };
  elements.set('pm-po-grid-body', body);
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'pm-po-grid.js'), 'utf8'), {
    document, window: {
      confirm() { confirmations += 1; return true; },
      location: { assign(url) { navigations.push(url); } },
    },
    setTimeout(fn) { const id = ++timerId; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); },
    fetch(url, options) {
      return new Promise((resolve, reject) => { requests.push({ url, options, resolve, reject }); });
    },
  });
  const row = body.rows[0];
  const barcode = row.querySelector('[data-field="barcode"]');
  const field = (name) => row.querySelector('[data-field="' + name + '"]');
  return {
    body, row, barcode, requests, field,
    supplier: elements.get('pm-po-supplier'),
    status: elements.get('pm-po-status'),
    navigations,
    create: () => elements.get('pm-po-create').listeners.click(),
    save: () => elements.get('pm-po-save').listeners.click(),
    confirmations: () => confirmations,
    type(code) {
      barcode.focus();
      barcode.value = code;
      body.listeners.input({ target: barcode });
    },
    idle() {
      const callbacks = [...timers.values()];
      timers.clear();
      callbacks.forEach((fn) => fn());
    },
    key(key) {
      const event = { key, target: barcode, prevented: false, preventDefault() { this.prevented = true; } };
      return { event, done: body.listeners.keydown(event) };
    },
    change() { body.listeners.change({ target: barcode }); },
  };
}

const part = {
  found: true, part_number: 'pn000003', part_name: 'sweet blend',
  sub_id: 'OIL', generic: 'Engine oil', unit: 'bottle',
  cost_price: 100, markup: 0, supplier: 'Supplier A',
};
function respond(request, status = 200, payload = part) {
  request.resolve({ ok: status === 200, status, redirected: false, json: async () => payload });
}
const flush = () => new Promise((resolve) => setImmediate(resolve));

test('scan without a suffix auto-fills all item details, preserves Qty, and recalculates prices', async () => {
  const g = grid();
  g.field('qty').value = '4';
  g.type(' 12345 ');
  assert.equal(g.requests.length, 0);
  g.idle();
  assert.equal(g.requests.length, 1);
  assert.match(g.requests[0].url, /find-by-barcode\/12345$/);
  respond(g.requests[0]);
  await flush();
  for (const name of ['part_number', 'part_name', 'sub_id', 'generic', 'unit', 'cost_price', 'markup']) {
    assert.equal(String(g.field(name).value), String(part[name]));
  }
  assert.equal(g.field('retail_price').value, '100.00');
  assert.equal(g.field('qty').value, '4');
  assert.equal(g.supplier.value, 'Supplier A');
  assert.match(g.status.textContent, /matched pn000003/);
});

test('Enter triggers immediate lookup and change/idle events do not duplicate it', async () => {
  const g = grid();
  g.type('12345');
  const enter = g.key('Enter');
  assert.equal(enter.event.prevented, true);
  g.change();
  g.idle();
  assert.equal(g.requests.length, 1);
  respond(g.requests[0]);
  await enter.done;
  await flush();
  assert.equal(g.field('part_number').value, 'pn000003');
  g.change();
  assert.equal(g.requests.length, 1);
});

test('Tab scans fill details without interrupting focus or replacing an existing supplier', async () => {
  const g = grid();
  g.supplier.value = 'Chosen supplier';
  g.type('12345');
  const tab = g.key('Tab');
  assert.equal(tab.event.prevented, false);
  g.field('part_number').focus();
  respond(g.requests[0]);
  await tab.done;
  assert.equal(g.field('part_number').value, 'pn000003');
  assert.equal(g.supplier.value, 'Chosen supplier');
});

test('late responses cannot overwrite a newer scan', async () => {
  const g = grid();
  g.type('OLD');
  g.idle();
  g.type('NEW');
  g.idle();
  respond(g.requests[1], 200, { ...part, part_number: 'NEW-PART' });
  await flush();
  respond(g.requests[0], 200, { ...part, part_number: 'OLD-PART' });
  await flush();
  assert.equal(g.field('part_number').value, 'NEW-PART');
  assert.match(g.status.textContent, /NEW-PART/);
});

test('network and server failures are visible and the same barcode can be retried', async () => {
  const g = grid();
  g.type('12345');
  g.idle();
  g.requests[0].reject(new Error('Network unavailable'));
  await flush();
  assert.match(g.status.textContent, /Network unavailable/);
  const retry = g.key('Enter');
  assert.equal(g.requests.length, 2);
  respond(g.requests[1], 500, { error: 'Storage unavailable' });
  await retry.done;
  assert.match(g.status.textContent, /Storage unavailable/);
  g.barcode.focus();
  const success = g.key('Enter');
  assert.equal(g.requests.length, 3);
  respond(g.requests[2]);
  await success.done;
  assert.equal(g.field('part_number').value, 'pn000003');
});

test('unknown barcodes show actionable feedback without inventing part details', async () => {
  const g = grid();
  g.type('UNKNOWN');
  g.idle();
  respond(g.requests[0], 404, { found: false });
  await flush();
  assert.match(g.status.textContent, /not saved in the parts database/);
  assert.equal(g.status.style.color, '#c0392b');
  assert.equal(g.field('part_number').value, '');
});

test('removing a line before its lookup completes prevents stale updates', async () => {
  const g = grid();
  g.type('12345');
  g.idle();
  g.row.isConnected = false;
  respond(g.requests[0]);
  await flush();
  assert.equal(g.field('part_number').value, '');
  assert.equal(g.supplier.value, '');
});

test('Create PO submits barcode and order lines after confirmation and navigates on success', async () => {
  const g = grid();
  g.supplier.value = 'Supplier A';
  g.field('barcode').value = '48036214';
  g.field('part_number').value = 'pn000003';
  g.field('part_name').value = 'sweet blend';
  g.field('qty').value = '70';
  g.create();
  assert.equal(g.confirmations(), 1);
  assert.equal(g.requests.length, 1);
  assert.equal(g.status.textContent, 'Sending to GM...');
  const request = g.requests[0];
  assert.equal(request.url, '/parts-manager/api/purchase-orders-grid');
  const payload = JSON.parse(request.options.body);
  assert.equal(payload.action, 'create');
  assert.equal(payload.lines[0].barcode, '48036214');
  respond(request, 200, { ok: true, message: 'PO sent to GM' });
  await flush();
  assert.equal(g.navigations.length, 1);
});
