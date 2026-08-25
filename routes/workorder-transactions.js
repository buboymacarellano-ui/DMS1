const express = require('express');
const store = require('../data/store');
const { frontlineSessionBranch } = require('../lib/frontline-roles');
const { normalizeBranchKey } = require('../lib/branches');
const { normalizeWorkOrderStatus } = require('../lib/work-order-status');
const {
  buildTechnicianOperations,
  findTechnicianRow,
  toDashboardStats,
  statusLabelFromUpdate,
} = require('../lib/technician-activity');

const router = express.Router();

const TECHNICIAN_STATUS_TO_WO = {
  working: 'in-progress',
  waiting_parts: 'waiting-parts',
  break: 'break',
  on_other_priority: 'on-other-priority',
};

function normalizePhoneDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function toViberNumber(value) {
  const digits = normalizePhoneDigits(value);
  if (!digits) return '';

  if (digits.startsWith('63') && digits.length >= 12) {
    return `+${digits}`;
  }

  if (digits.startsWith('0') && digits.length >= 11) {
    return `+63${digits.slice(1)}`;
  }

  if (digits.length === 10 && digits.startsWith('9')) {
    return `+63${digits}`;
  }

  return `+${digits}`;
}

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase();
}

function filterBySessionBranch(req, records, accessor) {
  const user = req.session && req.session.user ? req.session.user : {};
  const branch = normalizeBranchKey(frontlineSessionBranch(user));
  if (!branch) return records;
  return (records || []).filter((record) => normalizeBranchKey(accessor(record)) === branch);
}

async function loadTechnicianBoard(req) {
  const [workOrders, vehicles, technicianUpdates, employees, customers] = await Promise.all([
    store.getAll('work_orders'),
    store.getAll('vehicles'),
    store.getAll('technician_updates'),
    store.getAll('employees'),
    store.getAll('customers'),
  ]);
  const scopedWorkOrders = filterBySessionBranch(req, workOrders, (wo) => wo.branch);
  const scopedEmployees = filterBySessionBranch(req, employees, (employee) => employee.work_location_branch_id);
  const technicians = buildTechnicianOperations(
    scopedWorkOrders,
    vehicles,
    technicianUpdates,
    scopedEmployees,
    customers
  );
  return { technicians, scopedWorkOrders, vehicles, technicianUpdates, scopedEmployees, customers };
}

async function syncWorkOrderStatusFromTechnicianAction(workOrderId, statusAction, req) {
  const nextStatus = TECHNICIAN_STATUS_TO_WO[statusAction];
  if (!workOrderId || !nextStatus) return;
  const workOrder = await store.getById('work_orders', workOrderId);
  if (!workOrder) return;
  const user = req.session && req.session.user ? req.session.user : {};
  if (frontlineSessionBranch(user) && normalizeBranchKey(workOrder.branch) !== normalizeBranchKey(user.branch)) {
    return;
  }
  const current = normalizeWorkOrderStatus(workOrder.status);
  if (current === 'closed' || current === 'deleted' || current === 'completed') return;
  await store.update('work_orders', workOrder.id, { status: nextStatus });
}

router.get('/', async (req, res) => {
  let customers = await store.getAll('customers');
  let vehicles = await store.getAll('vehicles');
  const workOrders = filterBySessionBranch(req, await store.getAll('work_orders'), (wo) => wo.branch);
  const user = req.session && req.session.user ? req.session.user : {};
  if (frontlineSessionBranch(user)) {
    const customerIds = new Set(workOrders.map((wo) => wo.customer_id).filter(Boolean));
    const vehicleIds = new Set(workOrders.map((wo) => wo.vehicle_id).filter(Boolean));
    const branch = normalizeBranchKey(user.branch);
    customers = customers.filter((customer) => customerIds.has(customer.id) || normalizeBranchKey(customer.branch) === branch);
    vehicles = vehicles.filter((vehicle) => vehicleIds.has(vehicle.id) || normalizeBranchKey(vehicle.branch) === branch);
  }
  const technicianUpdates = await store.getAll('technician_updates');
  const employees = filterBySessionBranch(req, await store.getAll('employees'), (employee) => employee.work_location_branch_id);
  const pricingRules = await store.getAll('pricing_rules');
  const technicianStats = toDashboardStats(
    buildTechnicianOperations(workOrders, vehicles, technicianUpdates, employees, customers)
  );
  const latestWorkOrderByCustomerId = new Map();

  (workOrders || []).forEach((wo) => {
    const customerId = String(wo.customer_id || '').trim();
    if (!customerId) return;

    const createdAtMs = new Date(wo.created_at || 0).getTime();
    const previous = latestWorkOrderByCustomerId.get(customerId);
    if (!previous || createdAtMs > previous.createdAtMs) {
      latestWorkOrderByCustomerId.set(customerId, {
        createdAtMs,
        createdAt: wo.created_at || '',
      });
    }
  });

  const customerContacts = (customers || [])
    .map((customer) => {
      const rawPhone = String(customer.phone || '').trim();
      const viberNumber = toViberNumber(rawPhone);
      const telDigits = normalizePhoneDigits(rawPhone);
      const latestWorkOrder = latestWorkOrderByCustomerId.get(String(customer.id || '').trim()) || null;
      return {
        id: customer.id,
        name: String(customer.name || '').trim() || 'Unknown Customer',
        rawPhone,
        viberNumber,
        viberLink: viberNumber ? `viber://chat?number=${encodeURIComponent(viberNumber)}` : '',
        callLink: telDigits ? `tel:${telDigits}` : '',
        latestWorkOrderCreatedAt: latestWorkOrder ? latestWorkOrder.createdAt : '',
        latestWorkOrderCreatedAtMs: latestWorkOrder ? latestWorkOrder.createdAtMs : 0,
      };
    })
    .filter((entry) => entry.rawPhone)
    .sort((a, b) => {
      if (b.latestWorkOrderCreatedAtMs !== a.latestWorkOrderCreatedAtMs) {
        return b.latestWorkOrderCreatedAtMs - a.latestWorkOrderCreatedAtMs;
      }
      return a.name.localeCompare(b.name);
    });

  res.render('workorder-transactions/index', {
    customersCount: customers.length,
    vehiclesCount: vehicles.length,
    workOrdersCount: workOrders.length,
    pricingCount: pricingRules.length,
    technicianStats,
    customerContacts,
  });
});

router.get('/technicians', async (req, res) => {
  const { technicians } = await loadTechnicianBoard(req);
  res.render('workorder-transactions/technicians', {
    technicians,
    summary: {
      roster: technicians.length,
      working: technicians.filter((item) => item.board_status && item.board_status.tone === 'ongoing').length,
      activeOrders: technicians.reduce((sum, item) => sum + item.active_count, 0),
      pendingOrders: technicians.reduce((sum, item) => sum + item.pending_orders.length, 0),
      laborMtd: technicians.reduce((sum, item) => sum + item.labor_mtd, 0),
      laborAccumulated: technicians.reduce((sum, item) => sum + item.labor_accumulated, 0),
    },
    success: req.query.success || '',
    error: req.query.error || '',
  });
});

router.get('/technicians/:technicianName', async (req, res) => {
  const { technicians } = await loadTechnicianBoard(req);
  const technician = findTechnicianRow(technicians, req.params.technicianName);
  if (!technician) return res.status(404).send('Technician not found');

  return res.render('workorder-transactions/technician-detail', {
    technician,
    success: req.query.success || '',
    error: req.query.error || '',
  });
});

router.post('/technicians/status', async (req, res) => {
  const technicianName = String(req.body.technician_name || '').trim();
  const statusAction = normalizeKey(req.body.status_action);
  let workOrderId = String(req.body.work_order_id || '').trim();
  const note = String(req.body.note || '').trim();
  const returnTo = String(req.body.return_to || '').trim();
  const redirectTarget = returnTo.startsWith('/work-order-transactions/technicians/')
    ? returnTo
    : '/work-order-transactions/technicians';
  const allowed = new Set([
    'working',
    'waiting_parts',
    'absent',
    'training',
    'day_off',
    'assigned_transfer',
    'for_approval',
    'break',
    'on_other_priority',
    'other',
  ]);
  if (!technicianName || !allowed.has(statusAction)) {
    return res.redirect(`${redirectTarget}?error=Technician+and+valid+status+are+required.`);
  }
  if (!workOrderId && TECHNICIAN_STATUS_TO_WO[statusAction]) {
    const { technicians } = await loadTechnicianBoard(req);
    const row = findTechnicianRow(technicians, technicianName);
    workOrderId = String((row && row.current_order && row.current_order.id) || '').trim();
  }
  if (workOrderId && !await store.getById('work_orders', workOrderId)) {
    return res.redirect(`${redirectTarget}?error=Selected+work+order+was+not+found.`);
  }
  if (workOrderId) {
    const selectedWorkOrder = await store.getById('work_orders', workOrderId);
    const user = req.session && req.session.user ? req.session.user : {};
    if (frontlineSessionBranch(user) && normalizeBranchKey(selectedWorkOrder.branch) !== normalizeBranchKey(user.branch)) {
      return res.status(403).send('This work order belongs to another branch.');
    }
  }
  await store.create('technician_updates', {
    work_order_id: workOrderId,
    sender_role: String((req.session && req.session.user && req.session.user.role) || 'service_receptionist').trim().toLowerCase() || 'service_receptionist',
    sender_username: String((req.session && req.session.user && req.session.user.username) || '').trim(),
    technician_name: technicianName,
    status_action: statusAction,
    status_flags: {
      on_break: statusAction === 'break',
      waiting_parts: statusAction === 'waiting_parts',
      done: false,
    },
    message: note || statusLabelFromUpdate({ status_action: statusAction }),
  });
  await syncWorkOrderStatusFromTechnicianAction(workOrderId, statusAction, req);
  return res.redirect(`${redirectTarget}?success=Technician+activity+updated.`);
});

module.exports = router;
