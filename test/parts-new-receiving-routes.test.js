const test = require('node:test');
const assert = require('node:assert/strict');
const store = require('../data/store');
const router = require('../routes/parts-manager');
const partsRouter = require('../routes/parts');
const inventory = require('../lib/parts-inventory-controller');
const { buildPurchaseOrderDetailsHtml } = require('../lib/pm-documents');
const { receiveApprovedPartsTransfer } = require('../lib/parts-transfer-receive');

test('receiving routes, PO logs, filters and branch receipt use New / Restock consistently', async (t) => {
  const data = {
    parts_inventory: [], transactions: [], parts: [], parts_purchase_orders: [],
    parts_documents: [], approval_controls: {}, branches: [],
  };
  t.mock.method(store, 'getRawData', async () => data);
  let saves = 0;
  t.mock.method(store, 'replaceData', async () => { saves += 1; });
  async function invoke(path, body, params = {}, target = router) {
    const layer = target.stack.find((entry) => entry.route?.path === path && entry.route.methods.post);
    assert.ok(layer, path);
    const response = {
      statusCode: 200, payload: null,
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.payload = payload; return this; },
      redirect(url) { this.redirectUrl = url; return this; },
    };
    await layer.route.stack[0].handle({
      body, params, session: { user: { role: 'parts_manager', username: 'Test PM', branch: 'Carmen' } },
    }, response);
    assert.equal(response.statusCode, 200, JSON.stringify(response.payload));
    return response;
  }
  const entries = [
    { part_number: 'A', part_name: 'Part A', qty: 10, present_location: 'Warehouse 1', barcode: '48036214' },
    { part_number: 'A', part_name: 'Part A', qty: 5, present_location: 'Warehouse 1' },
    { part_number: 'B', part_name: 'Part B', qty: 3, present_location: 'Warehouse 1' },
  ];
  const received = await invoke('/api/parts/receiving-entry', { entries });
  assert.equal(received.payload.created, 3);
  assert.deepEqual(data.parts_inventory.map((row) => row.transaction_type), ['new', 'restock', 'new']);
  const firstA = data.parts_inventory[0];
  assert.equal(data.parts_inventory[1].initial_receipt_id, firstA.id);
  assert.equal(data.transactions[0].transaction_type, 'new');

  const csv = await invoke('/api/parts/csv-batch-add', {
    csv: 'Part Number,Part Name,Qty,Location\nCSV-PART,CSV item,3,Warehouse 1\nCSV-PART,CSV item,2,Warehouse 1\n',
  });
  assert.equal(csv.payload.ok, true);
  const csvRows = data.parts_inventory.filter((row) => row.part_number === 'CSV-PART');
  assert.deepEqual(csvRows.map((row) => row.transaction_type), ['new', 'restock']);
  assert.equal(csvRows[1].initial_receipt_id, csvRows[0].id);

  const saved = await invoke('/api/purchase-orders-grid', {
    action: 'save', supplier: 'Supplier', branch: 'Warehouse 1',
    lines: [{ ...entries[0], qty: 2 }, { part_number: 'C', part_name: 'Part C', qty: 4 }],
  });
  const po = saved.payload.po;
  assert.deepEqual(po.lines.map((line) => line.transaction_type), ['restock', 'new']);
  assert.equal(po.lines[0].barcode, '48036214');
  assert.equal(inventory.getOnHand(data, 'A'), 15);
  const response = await invoke('/api/purchase-orders/:id/receive', {}, { id: po.id });
  assert.equal(response.payload.ok, true);
  assert.equal(po.lines[1].transaction_type, 'new');
  assert.ok(po.lines[1].receipt_id);
  assert.equal(po.lines[1].initial_receipt_id, po.lines[1].receipt_id);
  assert.equal(inventory.getOnHand(data, 'C'), 4);
  const document = buildPurchaseOrderDetailsHtml(po);
  assert.match(document, /<th>Type<\/th>/);
  assert.match(document, /<th>Initial Receipt ID<\/th>/);
  assert.match(document, /<td>New<\/td>/);
  assert.match(document, /<td>Stock<\/td>/);

  data.parts_inventory.push({
    id: 'transfer', part_number: 'A', part_name: 'Part A', qty: 2,
    transaction_type: 'parts request', requesting_branch: 'Carmen', request_status: 'approved',
    fulfillment_status: 'in_transit', approved_at: '2026-10-07T00:00:00Z',
    present_location: 'Warehouse 1',
  });
  const branchReceipt = receiveApprovedPartsTransfer(data, 'transfer', { receiver: 'Test SA', branch: 'Carmen' });
  assert.equal(branchReceipt.ok, true);
  assert.equal(branchReceipt.restock.transaction_type, 'restock');
  assert.equal(branchReceipt.restock.initial_receipt_id, firstA.id);

  await invoke('/create', { part_number: 'D', part_name: 'Part D', qty: 3, created_branch: 'Carmen' }, {}, partsRouter);
  const created = data.parts_inventory.find((row) => row.part_number === 'D' && !row.activity_log);
  assert.equal(created.transaction_type, 'new');
  const log = data.parts_inventory.find((row) => row.source_part_id === created.id);
  assert.equal(log.transaction_type, 'new');
  assert.equal(log.initial_receipt_id, created.id);
  assert.equal(inventory.getOnHand(data, 'D'), 3);

  const getLayer = router.stack.find((entry) => entry.route?.path === '/' && entry.route.methods.get);
  let locals;
  await getLayer.route.stack[0].handle({ query: { type: 'new', location: 'Warehouse 1' } }, {
    render(view, values) { locals = values; },
  });
  assert.ok(locals.transactionTypes.includes('new'));
  assert.ok(locals.parts.length > 0);
  assert.ok(locals.parts.every((row) => row.transaction_type === 'new'));
  assert.ok(saves >= 4);
});
