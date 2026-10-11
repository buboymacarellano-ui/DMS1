const test = require('node:test');
const assert = require('node:assert/strict');
const store = require('../data/store');
const router = require('../routes/parts-manager');
const inventory = require('../lib/parts-inventory-controller');
const { DATABASE_TYPES, recordPartOperation, buildDatabaseRecords } = require('../lib/pm-database-records');

test('database selections are exactly the five requested operation types', () => {
  assert.deepEqual(DATABASE_TYPES.map((row) => row.label), ['New', 'Stock', 'Stock Transfer', 'Edited', 'Removed']);
});

test('edit and removal snapshots are independent, immutable and never affect stock', () => {
  const data = {};
  const result = inventory.applyRestock(data, {
    id: 'receipt', part_number: 'A', part_name: 'Part A', qty: 10,
    present_location: 'Warehouse 1',
  });
  recordPartOperation(data, result.transaction, 'edit', 'Editor');
  recordPartOperation(data, result.transaction, 'remove', 'Remover');
  result.transaction.part_name = 'Changed later';
  const rows = buildDatabaseRecords(data);
  assert.equal(rows.find((row) => row.database_type === 'edited').part_name, 'Part A');
  assert.equal(rows.find((row) => row.database_type === 'removed').editor, 'Remover');
  assert.ok(rows.filter((row) => ['edited', 'removed'].includes(row.database_type)).every((row) => row.activity_log));
  assert.equal(inventory.getOnHand(data, 'A'), 10);
  assert.equal(data.parts_inventory.length, 1);
});

test('transfer records include each item and removal log, excluding linked request duplicates', () => {
  const data = {
    parts_inventory: [{ id: 'request', linked_transfer_id: 't1', transaction_type: 'transfer request', part_number: 'A' }],
    parts_transfers: [{
      id: 't1', from_branch: 'Warehouse 1', to_branch: 'Carmen', created_at: '2026-10-07',
      transaction_number: 'PTN-1', lines: [{ part_number: 'A', qty: 2 }, { part_number: 'B', qty: 3 }],
    }],
    transactions_made: [{
      id: 'log1', kind: 'transfer', status: 'remove', recorded_at: '2026-10-07',
      from_branch: 'Warehouse 1', reference_number: 'PTN-1', lines: [{ part_number: 'A', qty: 2 }],
    }],
  };
  const rows = buildDatabaseRecords(data);
  assert.equal(rows.filter((row) => row.database_type === 'stock-transfer').length, 2);
  assert.equal(rows.find((row) => row.database_type === 'stock-transfer').present_location, 'Warehouse 1');
  assert.equal(rows.filter((row) => row.database_type === 'removed').length, 1);
});

test('each operation filter works with location and date filters in the actual workspace route', async (t) => {
  const data = { parts_inventory: [], transactions: [], parts: [], parts_documents: [], parts_purchase_orders: [] };
  const first = inventory.applyRestock(data, { id: 'n', part_number: 'A', qty: 10, present_location: 'Warehouse 1' }).transaction;
  inventory.applyRestock(data, { id: 'r', part_number: 'A', qty: 2, present_location: 'Warehouse 1' });
  recordPartOperation(data, first, 'edit', 'Editor');
  recordPartOperation(data, first, 'remove', 'Remover');
  data.parts_transfers = [{
    id: 't', created_at: new Date().toISOString(), from_branch: 'Warehouse 1',
    to_branch: 'Bogo', lines: [{ part_number: 'A', qty: 1 }],
  }];
  t.mock.method(store, 'getRawData', async () => data);
  const handler = router.stack.find((entry) => entry.route?.path === '/' && entry.route.methods.get).route.stack[0].handle;
  const today = new Date().toISOString().slice(0, 10);
  for (const type of DATABASE_TYPES) {
    let locals;
    await handler({ query: { type: type.value, location: 'Warehouse 1', date_from: today, date_to: today } }, {
      render(view, payload) { locals = payload; },
    });
    assert.ok(locals.parts.length, type.label);
    assert.ok(locals.parts.every((row) => row.database_type === type.value));
    assert.equal(locals.databaseTypes.length, 5);
  }
  assert.equal(inventory.getOnHand(data, 'A'), 12);
});

test('Parts Manager edit and removal routes persist snapshots for operation filters', async (t) => {
  const data = {};
  inventory.applyRestock(data, {
    id: 'n', part_number: 'A', part_name: 'Original', qty: 10,
    present_location: 'Warehouse 1', branch: 'Warehouse 1',
  });
  t.mock.method(store, 'getRawData', async () => data);
  let saves = 0;
  t.mock.method(store, 'replaceData', async () => { saves += 1; });
  async function invoke(path, body) {
    const handler = router.stack.find((entry) => entry.route?.path === path).route.stack[0].handle;
    await handler({
      params: { id: 'n' }, body,
      session: { user: { username: 'PM editor', role: 'parts_manager' } },
    }, { redirect() {} });
  }
  await invoke('/parts/:id/edit', {
    part_number: 'A', part_name: 'Edited name', qty: '10',
    transaction_type: 'new', present_location: 'Warehouse 1',
  });
  assert.equal(data.transactions_made[0].status, 'edit');
  assert.equal(data.transactions_made[0].snapshot.part_name, 'Edited name');
  await invoke('/parts/:id/delete', {});
  assert.equal(data.transactions_made[1].status, 'remove');
  assert.equal(data.parts_inventory.length, 0);
  assert.equal(saves, 2);
  const rows = buildDatabaseRecords(data);
  assert.equal(rows.find((row) => row.database_type === 'removed').part_name, 'Edited name');
  assert.equal(rows.find((row) => row.database_type === 'edited').editor, 'PM editor');
});
