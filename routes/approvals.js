const express = require('express');
const store = require('../data/store');
const workOrdersRouter = require('./workorders');
const { isFrontlineRole } = require('../lib/frontline-roles');
const { recordGmApproval, TYPES: GM_TXN_TYPES } = require('../lib/gm-transaction-log');
const approvalControls = require('../lib/approval-controls');

const router = express.Router();
const APPROVER_ROLES = new Set(['admin', 'hr', 'general_manager', 'service_technical_manager']);
const REQUEST_TYPES = new Set(['CBD', 'RWO']);

function normalize(value) {
  return String(value || '').trim();
}

function activeUser(req) {
  return req.session && req.session.user ? req.session.user : {};
}

function isApprover(req) {
  return APPROVER_ROLES.has(normalize(activeUser(req).role).toLowerCase());
}

function requireApprover(req, res, next) {
  if (isApprover(req)) return next();
  return res.status(403).send('Approval access is restricted to authorized managers.');
}

function requesterEmployeeId(user) {
  return normalize(user.receptionist_employee_id || user.technician_employee_id || user.employee_id);
}

// Applies an approved CBD request; returns an error message or ''.
async function applyCbd(request) {
  const employees = await store.getAll('employees');
  const employee = employees.find(item => normalize(item.employee_id) === normalize(request.employee_id));
  if (!employee) return 'Employee record not found.';
  await store.update('employees', employee.id, {
    work_location_branch_id: request.target_branch,
    updated_at: new Date().toISOString(),
  });
  const users = await store.getAll('users');
  const linkedUsers = users.filter(user => (
    normalize(user.receptionist_employee_id || user.technician_employee_id || user.employee_id) === normalize(request.employee_id)
  ));
  await Promise.all(linkedUsers.map(user => store.update('users', user.id, { branch: request.target_branch })));
  return '';
}

// Applies an approved RWO request; returns an error message or ''.
async function applyRwo(request, actor) {
  const removed = await workOrdersRouter.removeWorkOrder(request.work_order_id, actor);
  return removed ? '' : 'Work order no longer exists.';
}

function autoResolvedFields() {
  return {
    status: 'approved',
    resolved_at: new Date().toISOString(),
    resolved_by: approvalControls.AUTO_APPROVER,
    resolved_by_role: 'system',
    auto_approved: true,
  };
}

router.get('/', async (req, res) => {
  const user = activeUser(req);
  const approver = isApprover(req);
  const [allRequests, employees, workOrders, purchaseOrders, partsTransfers, gmTransactionRecords] = await Promise.all([
    store.getAll('approval_requests'),
    store.getAll('employees'),
    store.getAll('work_orders'),
    store.getAll('parts_purchase_orders'),
    store.getAll('parts_transfers'),
    store.getAll('gm_transaction_records'),
  ]);
  const requests = allRequests
    .filter(request => approver || request.requested_by_user_id === user.id)
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  const branches = Array.from(new Set(employees.map(employee => normalize(employee.work_location_branch_id)).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b));

  // Get PO approvals for GM only
  const pendingPOs = approver
    ? (purchaseOrders || [])
        .filter(po => String(po.status || '').trim().toLowerCase() === 'pending_approval')
        .sort((a, b) => new Date(b.sent_for_approval_at || 0) - new Date(a.sent_for_approval_at || 0))
    : [];

  // Get approved POs for history
  const approvedPOs = (purchaseOrders || [])
    .filter(po => String(po.status || '').trim().toLowerCase() === 'approved')
    .sort((a, b) => new Date(b.approved_at || 0) - new Date(a.approved_at || 0));

  const pendingStockTransfers = approver
    ? (partsTransfers || [])
      .filter((transfer) => String(transfer.status || '').trim().toLowerCase() === 'pending')
      .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
    : [];

  // My Transactions Records: footprint of GM-approved PO / Stock Transfer / Facilities Request
  const myTransactionRecords = approver
    ? [...(gmTransactionRecords || [])].sort((a, b) => new Date(b.approved_at || 0) - new Date(a.approved_at || 0))
    : [];

  res.render('approvals/index', {
    approver,
    requests,
    branches,
    workOrders,
    pendingPOs,
    approvedPOs,
    pendingStockTransfers,
    myTransactionRecords,
    employeeId: requesterEmployeeId(user),
    success: normalize(req.query.success),
    error: normalize(req.query.error),
  });
});

router.post('/request/cbd', async (req, res) => {
  const user = activeUser(req);
  const employeeId = requesterEmployeeId(user) || normalize(req.body.employee_id);
  const targetBranch = normalize(req.body.target_branch);
  if (!employeeId || !targetBranch) {
    return res.redirect('/approvals?error=Employee+ID+and+target+branch+are+required.');
  }

  const employee = (await store.getAll('employees')).find(item => normalize(item.employee_id) === employeeId);
  if (!employee) return res.redirect('/approvals?error=Employee+record+not+found.');

  const request = await store.create('approval_requests', {
    type: 'CBD',
    status: 'pending',
    requested_by_user_id: user.id || '',
    requested_by: normalize(user.username) || employeeId,
    requested_by_role: normalize(user.role),
    employee_id: employeeId,
    employee_name: [employee.first_name, employee.middle_name, employee.last_name].map(normalize).filter(Boolean).join(' '),
    current_branch: normalize(employee.work_location_branch_id),
    target_branch: targetBranch,
    reason: normalize(req.body.reason),
  });
  if (!(await approvalControls.requires(store, 'cbd_approval'))) {
    const failure = await applyCbd(request);
    if (failure) return res.redirect('/approvals?error=' + encodeURIComponent(failure));
    await store.update('approval_requests', request.id, autoResolvedFields());
    return res.redirect('/approvals?success=' + encodeURIComponent('Branch change applied (approval is off in the GM Control Panel).'));
  }
  return res.redirect('/approvals?success=CBD+request+submitted.');
});

router.post('/request/rwo', async (req, res) => {
  const user = activeUser(req);
  const workOrderId = normalize(req.body.work_order_id);
  const workOrder = await store.getById('work_orders', workOrderId);
  if (!workOrder) return res.redirect('/work-orders');
  const role = normalize(user.role).toLowerCase();
  if (isFrontlineRole(role) && normalize(workOrder.branch).toLowerCase() !== normalize(user.branch).toLowerCase()) {
    return res.status(403).send('This work order belongs to another branch.');
  }
  if (role === 'technician' && normalize(workOrder.technician).toLowerCase() !== normalize(user.technician_name || user.username).toLowerCase()) {
    return res.status(403).send('This work order is assigned to another technician.');
  }

  const existing = (await store.getAll('approval_requests')).some(request => (
    request.type === 'RWO' && request.status === 'pending' && request.work_order_id === workOrderId
  ));
  if (!existing) {
    const request = await store.create('approval_requests', {
      type: 'RWO',
      status: 'pending',
      requested_by_user_id: user.id || '',
      requested_by: normalize(user.username),
      requested_by_role: normalize(user.role),
      work_order_id: workOrderId,
      work_order_number: normalize(workOrder.work_order_number) || workOrderId,
      branch: normalize(workOrder.branch),
      reason: normalize(req.body.reason),
    });
    if (!(await approvalControls.requires(store, 'rwo_approval'))) {
      const failure = await applyRwo(request, user);
      if (!failure) await store.update('approval_requests', request.id, autoResolvedFields());
    }
  }
  return res.redirect('/work-orders');
});

router.post('/:id/resolve', requireApprover, async (req, res) => {
  const request = await store.getById('approval_requests', req.params.id);
  const decision = normalize(req.body.decision).toLowerCase();
  if (!request || request.status !== 'pending' || !['approved', 'rejected'].includes(decision)) {
    return res.redirect('/approvals?error=Request+cannot+be+resolved.');
  }
  if (!REQUEST_TYPES.has(request.type)) return res.redirect('/approvals?error=Unknown+request+type.');

  if (decision === 'approved' && request.type === 'CBD') {
    const failure = await applyCbd(request);
    if (failure) return res.redirect('/approvals?error=' + encodeURIComponent(failure));
  }

  if (decision === 'approved' && request.type === 'RWO') {
    const failure = await applyRwo(request, activeUser(req));
    if (failure) return res.redirect('/approvals?error=' + encodeURIComponent(failure));
  }

  const resolver = activeUser(req);
  await store.update('approval_requests', request.id, {
    status: decision,
    resolved_at: new Date().toISOString(),
    resolved_by: normalize(resolver.username),
    resolved_by_role: normalize(resolver.role),
  });
  return res.redirect(`/approvals?success=Request+${decision}.`);
});

// Purchase Order Approval Endpoints
router.post('/purchase-order/:id/approve', requireApprover, async (req, res) => {
  try {
    const poId = req.params.id;
    const po = await store.getById('parts_purchase_orders', poId);
    
    if (!po) {
      return res.status(404).json({ error: 'Purchase order not found' });
    }
    
    if (String(po.status || '').trim().toLowerCase() !== 'pending_approval') {
      return res.status(400).json({ error: 'PO is not in pending approval status' });
    }

    const user = activeUser(req);
    const approvedAt = new Date().toISOString();
    await store.update('parts_purchase_orders', poId, {
      status: 'approved',
      approved_by: normalize(user.username) || user.id,
      approved_at: approvedAt,
    });

    const lineTotal = (po.lines || []).reduce((sum, line) => sum + (Number(line.qty) || 0) * (Number(line.cost_price) || 0), 0);
    await store.create('gm_transaction_records', {
      transaction_number: po.transaction_number || po.po_number || poId,
      type: GM_TXN_TYPES.PO,
      requester_name: po.created_by || po.sent_for_approval_by || '',
      requested_at: po.sent_for_approval_at || po.created_at || '',
      amount: lineTotal,
      approved_at: approvedAt,
      approved_by: normalize(user.username) || user.id,
    });

    return res.redirect('/approvals?success=Purchase+order+approved.');
  } catch (err) {
    console.error('Error approving PO:', err);
    return res.redirect('/approvals?error=Failed+to+approve+purchase+order.');
  }
});

router.post('/purchase-order/:id/reject', requireApprover, async (req, res) => {
  try {
    const poId = req.params.id;
    const po = await store.getById('parts_purchase_orders', poId);
    
    if (!po) {
      return res.status(404).json({ error: 'Purchase order not found' });
    }
    
    if (String(po.status || '').trim().toLowerCase() !== 'pending_approval') {
      return res.status(400).json({ error: 'PO is not in pending approval status' });
    }

    const user = activeUser(req);
    const rejectionReason = normalize(req.body.reason || 'No reason provided');

    await store.update('parts_purchase_orders', poId, {
      status: 'rejected',
      rejected_by: normalize(user.username) || user.id,
      rejected_at: new Date().toISOString(),
      rejection_reason: rejectionReason,
    });

    return res.redirect('/approvals?success=Purchase+order+rejected.');
  } catch (err) {
    console.error('Error rejecting PO:', err);
    return res.redirect('/approvals?error=Failed+to+reject+purchase+order.');
  }
});

module.exports = router;