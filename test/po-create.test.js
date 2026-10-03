const test = require('node:test');
const assert = require('node:assert');
const po = require('../lib/po-create');

const header = {
  po_date: '2026-10-03', supplier: 'Acme', department: 'parts', requestor: 'X',
  delivery_date: '2026-10-10', payment_terms: 'Net 30', currency: 'PHP',
};

test('totals apply discount then tax', () => {
  const lines = po.normalizeLines([{ item_code: 'A', description: 'd', uom: 'pc', qty: '2', unit_price: '100', discount_pct: '10', tax_pct: '12' }]);
  assert.deepStrictEqual(po.computeTotals(lines), { subtotal: 180, tax_total: 21.6, grand_total: 201.6 });
});

test('submit validation requires lines, qty and price > 0', () => {
  assert.ok(po.validatePo(header, [], { submit: true }).general.length);
  const lines = po.normalizeLines([{ item_code: 'A', description: 'd', uom: 'pc', qty: '0', unit_price: '-1' }]);
  const errors = po.validatePo(header, lines, { submit: true });
  assert.ok(errors.lines[0].qty && errors.lines[0].unit_price);
});

test('duplicate item codes are not blocking', () => {
  const row = { item_code: 'A', description: 'd', uom: 'pc', qty: '1', unit_price: '5' };
  assert.strictEqual(po.hasErrors(po.validatePo(header, po.normalizeLines([row, row]), { submit: true })), false);
});

test('PO numbers are sequential', () => {
  const d = new Date('2026-10-03T00:00:00Z');
  assert.strictEqual(po.allocatePoNumber([], d), 'PO-20261003-000001');
  assert.strictEqual(po.allocatePoNumber([{ po_number: 'PO-20261003-000007' }], d), 'PO-20261003-000008');
});

test('po.create permission: GM always, others by role or user id', () => {
  const settings = { creator_roles: ['parts_clerk'], creator_user_ids: ['u9'] };
  assert.ok(po.canCreatePo({ role: 'general_manager' }, {}));
  assert.ok(po.canCreatePo({ role: 'parts_clerk', id: 'a' }, settings));
  assert.ok(po.canCreatePo({ role: 'technician', id: 'u9' }, settings));
  assert.ok(!po.canCreatePo({ role: 'technician', id: 'a' }, settings));
  assert.ok(!po.canManagePoSettings({ role: 'admin' }));
});

test('approver chain is routed by department, amount and level; excludes requestor', () => {
  const settings = { approvers: [
    { department: 'parts', min_amount: '', max_amount: '1000', level: 1, approver_user_id: 'a1', approver_name: 'A1' },
    { department: 'parts', min_amount: '1000.01', max_amount: '', level: 2, approver_user_id: 'a2', approver_name: 'A2' },
    { department: '*', level: 1, approver_user_id: 'req' },
  ] };
  assert.deepStrictEqual(po.resolveApprovalChain(settings, 'parts', 500, 'req').map((l) => l.approvers[0].user_id), ['a1']);
  assert.deepStrictEqual(po.resolveApprovalChain(settings, 'parts', 5000, 'req').map((l) => l.approvers[0].user_id), ['a2']);
  assert.deepStrictEqual(po.resolveApprovalChain(settings, 'hr', 500, 'x').map((l) => l.approvers[0].user_id), ['req']);
  assert.strictEqual(po.resolveApprovalChain({}, 'parts', 5, 'x').length, 0);
});

test('approval advances levels, then approves; rejection ends the flow', () => {
  const user = { id: 'a1', username: 'A1' };
  const order = {
    status: po.STATUS.pending, current_level_index: 0, history: [],
    approval_chain: [
      { level: 1, approvers: [{ user_id: 'a1' }] },
      { level: 2, approvers: [{ user_id: 'a2' }] },
    ],
  };
  assert.ok(po.isAssignedApprover(order, user));
  assert.ok(!po.isAssignedApprover(order, { id: 'a2' }));
  const step1 = po.applyDecision(order, 'approved', user, 'ok');
  assert.strictEqual(step1.current_level_index, 1);
  assert.strictEqual(step1.status, undefined);
  const next = Object.assign({}, order, step1);
  assert.ok(po.isAssignedApprover(next, { id: 'a2' }));
  const final = po.applyDecision(next, 'approved', { id: 'a2', username: 'A2' }, '');
  assert.strictEqual(final.status, po.STATUS.approved);
  assert.strictEqual(final.history.length, 2);
  const rejected = po.applyDecision(order, 'rejected', user, 'no');
  assert.strictEqual(rejected.status, po.STATUS.rejected);
  assert.strictEqual(rejected.history[0].remarks, 'no');
});

test('draft only requires a supplier', () => {
  assert.strictEqual(po.hasErrors(po.validatePo({ supplier: 'Acme' }, [], { submit: false })), false);
  assert.ok(po.validatePo({}, [], { submit: false }).header.supplier);
});
