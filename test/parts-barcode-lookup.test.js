const test = require('node:test');
const assert = require('node:assert/strict');
const { findPartByBarcode } = require('../lib/parts-barcode-lookup');

test('saved purchase barcode is available before stock receipt without mutating stock', () => {
  const data = {
    parts_inventory: [],
    parts_purchase_orders: [{
      status: 'draft', supplier: 'Supplier A', created_at: '2026-10-07',
      lines: [{ barcode: '48036214', part_number: 'pn000003', part_name: 'sweet blend', qty: 70 }],
    }],
  };
  const before = JSON.stringify(data);
  const part = findPartByBarcode(data, ' 48036214 ');
  assert.equal(part.part_number, 'pn000003');
  assert.equal(part.barcode, '48036214');
  assert.equal(part.supplier, 'Supplier A');
  assert.equal(JSON.stringify(data), before);
});

test('latest received stock details take precedence over purchase drafts', () => {
  const older = { barcode: 'ABC', part_number: 'A', cost_price: 10, created_at: '2026-10-01' };
  const newer = { ...older, cost_price: 20, updated_at: '2026-10-06' };
  assert.equal(findPartByBarcode({
    parts_inventory: [older, newer],
    parts_purchase_orders: [{ status: 'draft', updated_at: '2026-10-07', lines: [{ ...older, cost_price: 30 }] }],
  }, 'abc'), newer);
});

test('latest eligible PO is used and cancelled, rejected, removed POs are excluded', () => {
  const line = { barcode: '48036214', part_number: 'A', supplier: 'Line supplier' };
  const data = { parts_purchase_orders: [
    { status: 'draft', created_at: '2026-10-01', lines: [{ ...line, part_number: 'OLD' }] },
    { status: 'pending_approval', created_at: '2026-10-02', lines: [line] },
    ...['removed', 'cancelled', 'canceled', 'rejected'].map((status) => ({
      status, created_at: '2026-10-07', lines: [{ ...line, part_number: 'EXCLUDED' }],
    })),
  ] };
  assert.equal(findPartByBarcode(data, line.barcode).part_number, 'A');
  assert.equal(findPartByBarcode(data, line.barcode).supplier, 'Line supplier');
});

test('blank and unknown barcodes do not match', () => {
  assert.equal(findPartByBarcode({}, ''), null);
  assert.equal(findPartByBarcode({ parts_inventory: [{ barcode: '', part_number: 'A' }] }, '48036214'), null);
  assert.equal(findPartByBarcode({ parts_purchase_orders: [{ lines: [{ barcode: '48036214', part_number: '' }] }] }, '48036214'), null);
});
