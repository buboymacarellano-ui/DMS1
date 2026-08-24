const express = require('express');
const store = require('../data/store');
const workOrdersRouter = require('./workorders');
const { isFrontlineRole } = require('../lib/frontline-roles');

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

router.get('/', async (req, res) => {
  const user = activeUser(req);
  const approver = isApprover(req);
  const [allRequests, employees, workOrders] = await Promise.all([
    store.getAll('approval_requests'),
    store.getAll('employees'),
    store.getAll('work_orders'),
  ]);
  const requests = allRequests
    .filter(request => approver || request.requested_by_user_id === user.id)
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  const branches = Array.from(new Set(employees.map(employee => normalize(employee.work_location_branch_id)).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b));

  res.render('approvals/index', {
    approver,
    requests,
    branches,
    workOrders,
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

  await store.create('approval_requests', {
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
    await store.create('approval_requests', {
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
    const employees = await store.getAll('employees');
    const employee = employees.find(item => normalize(item.employee_id) === normalize(request.employee_id));
    if (!employee) return res.redirect('/approvals?error=Employee+record+not+found.');
    await store.update('employees', employee.id, {
      work_location_branch_id: request.target_branch,
      updated_at: new Date().toISOString(),
    });
    const users = await store.getAll('users');
    const linkedUsers = users.filter(user => (
      normalize(user.receptionist_employee_id || user.technician_employee_id || user.employee_id) === normalize(request.employee_id)
    ));
    await Promise.all(linkedUsers.map(user => store.update('users', user.id, { branch: request.target_branch })));
  }

  if (decision === 'approved' && request.type === 'RWO') {
    const removed = await workOrdersRouter.removeWorkOrder(request.work_order_id, activeUser(req));
    if (!removed) return res.redirect('/approvals?error=Work+order+no+longer+exists.');
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

module.exports = router;