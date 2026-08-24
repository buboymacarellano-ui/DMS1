const express = require('express');
const store = require('../data/store');
const { frontlineSessionBranch } = require('../lib/frontline-roles');

const router = express.Router();

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function parseTimeToday(value) {
  const text = String(value || '').trim();
  const match = text.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0);
}

function formatElapsed(fromDate, toDate) {
  if (!fromDate || !toDate) return '-';
  const diffMs = Math.max(0, toDate.getTime() - fromDate.getTime());
  const totalMinutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

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
  const branch = String(frontlineSessionBranch(user) || '').trim().toLowerCase();
  if (!branch) return records;
  return (records || []).filter(record => normalizeKey(accessor(record)) === branch);
}

function canonicalTechnicianName(value) {
  return String(value || '')
    .replace(/\s*\([^)]+\)\s*$/, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function employeeDisplayName(employee) {
  const name = [employee.first_name, employee.middle_name, employee.last_name]
    .map(value => String(value || '').trim())
    .filter(Boolean)
    .join(' ');
  const employeeId = String(employee.employee_id || '').trim();
  return name && employeeId ? `${name} (${employeeId})` : (name || employeeId);
}

function isTechnicianEmployee(employee) {
  return /(mechanic|aligner|toolkeeper|carwasher|technician)/i.test(String(employee.job_title || ''));
}

function statusLabel(update) {
  const action = normalizeKey(update && update.status_action);
  const labels = {
    working: 'Working',
    waiting_parts: 'Waiting for Parts',
    absent: 'Absent',
    training: 'Training',
    assigned_transfer: 'Assigned / Transfer Work Order',
    for_approval: 'For Approval',
    break: 'Break',
    done: 'Done',
    other: 'Other',
  };
  return labels[action] || resolveLiveStatus(update);
}

function elapsedHours(startValue, endValue) {
  const start = new Date(startValue || 0).getTime();
  const end = new Date(endValue || 0).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return (end - start) / 3600000;
}

function buildTechnicianOperations(workOrders, vehicles, technicianUpdates, employees) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const vehicleById = new Map(vehicles.map(vehicle => [vehicle.id, vehicle]));
  const roster = new Map();

  (employees || []).filter(employee => (
    isTechnicianEmployee(employee) && String(employee.employee_id || '').trim()
  )).forEach(employee => {
    const displayName = employeeDisplayName(employee);
    if (!displayName) return;
    roster.set(canonicalTechnicianName(displayName), {
      technician: displayName,
      employee_id: String(employee.employee_id || '').trim(),
      branch: String(employee.work_location_branch_id || '').trim(),
      job_title: String(employee.job_title || '').trim(),
    });
  });
  return Array.from(roster.entries()).map(([key, profile]) => {
    const assignedOrders = (workOrders || [])
      .filter(wo => canonicalTechnicianName(wo.technician) === key)
      .sort((a, b) => new Date(b.technician_assigned_at || b.created_at || 0) - new Date(a.technician_assigned_at || a.created_at || 0));
    const activeOrders = assignedOrders.filter(wo => ['open', 'in-progress'].includes(normalizeKey(wo.status)));
    const updates = (technicianUpdates || [])
      .filter(update => canonicalTechnicianName(update.technician_name) === key)
      .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    const latestGlobalUpdate = updates.find(update => !String(update.work_order_id || '').trim());
    const latestUpdateFor = workOrderId => updates.find(update => String(update.work_order_id || '').trim() === String(workOrderId || '').trim());
    const blockingActions = new Set(['waiting_parts', 'absent', 'training', 'for_approval', 'break']);
    const currentOrder = activeOrders.find(wo => {
      const action = normalizeKey((latestUpdateFor(wo.id) || latestGlobalUpdate || {}).status_action);
      return !blockingActions.has(action);
    }) || null;
    const pendingOrders = activeOrders.filter(wo => !currentOrder || wo.id !== currentOrder.id);
    const completedMtd = assignedOrders.filter(wo => {
      const completedAt = new Date(wo.invoice_date || wo.updated_at || wo.created_at || 0);
      return ['completed', 'closed'].includes(normalizeKey(wo.status)) && completedAt >= monthStart;
    });
        const laborMtd = assignedOrders.reduce((sum, wo) => {
      const createdAt = new Date(wo.created_at || 0);
      if (createdAt < monthStart) return sum;

      // 1. Calculate the base labor amount for this work order
      const baseLabor = (wo.service_items || []).reduce((lineSum, item) => {
        return lineSum + (toNumber(item.labor_price) * Math.max(1, toNumber(item.service_qty) || 1));
      }, 0);

      // 2. Identify if the work order or its services represent a "Back Job"
      const orderType = String(wo.job_type || wo.transaction_type || wo.status || '').toLowerCase();
      const isBackJob = orderType.includes('back job');

      // 3. Subtract the absolute amount if it's a Back Job, otherwise add it normally
      return sum + (isBackJob ? -Math.abs(baseLabor) : baseLabor);
    }, 0);
    const cycleHours = completedMtd
      .map(wo => elapsedHours(wo.technician_assigned_at || wo.created_at, wo.invoice_date || wo.updated_at))
      .filter(hours => hours > 0);
    const latestUpdate = updates[0] || null;
    const statusUpdate = latestUpdateFor(currentOrder && currentOrder.id) || latestGlobalUpdate || latestUpdate;
    const totalMtd = assignedOrders.filter(wo => new Date(wo.created_at || 0) >= monthStart).length;

    function orderDetail(wo) {
      const vehicle = vehicleById.get(wo.vehicle_id) || {};
      const update = latestUpdateFor(wo.id) || latestGlobalUpdate;
      const assignedAt = wo.technician_assigned_at || wo.created_at;
      return {
        id: wo.id,
        work_order_number: wo.work_order_number || wo.id,
        vehicle: [wo.car_brand || vehicle.make, wo.car_model || vehicle.model, wo.plate_number || vehicle.license_plate].filter(Boolean).join(' '),
        branch: wo.branch || profile.branch,
        assigned_at: assignedAt,
        hours_open: elapsedHours(assignedAt, now),
        reason: statusLabel(update),
        note: update ? String(update.message || '').trim() : '',
      };
    }

    return {
      ...profile,
      live_status: statusLabel(statusUpdate),
      current_order: currentOrder ? orderDetail(currentOrder) : null,
      pending_orders: pendingOrders.map(orderDetail),
      active_count: activeOrders.length,
      completed_mtd: completedMtd.length,
      labor_mtd: laborMtd,
      hours_active: activeOrders.reduce((sum, wo) => sum + elapsedHours(wo.technician_assigned_at || wo.created_at, now), 0),
      average_cycle_hours: cycleHours.length ? cycleHours.reduce((sum, hours) => sum + hours, 0) / cycleHours.length : 0,
      completion_rate: totalMtd ? (completedMtd.length / totalMtd) * 100 : 0,
      recent_updates: updates.slice(0, 8),
    };
  }).sort((a, b) => b.active_count - a.active_count || a.technician.localeCompare(b.technician));
}

function resolveLiveStatus(update) {
  if (!update) return 'Working';
  const action = normalizeKey(update.status_action);
  if (action === 'break') return 'Break';
  if (action === 'waiting_parts') return 'Waiting Parts';
  if (action === 'done') return 'Done';

  const flags = update.status_flags || {};
  if (flags.done) return 'Done';
  if (flags.on_break) return 'Break';
  if (flags.waiting_parts) return 'Waiting Parts';
  return 'Working';
}

function buildTechnicianStats(workOrders, vehicles, technicianUpdates) {
  const byId = new Map(vehicles.map(vehicle => [vehicle.id, vehicle]));
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  const groups = new Map();
  const latestUpdateByTech = new Map();

  (technicianUpdates || []).forEach((entry) => {
    if (normalizeKey(entry.sender_role) !== 'technician') return;
    const techName = String(entry.technician_name || '').trim();
    if (!techName) return;
    const key = normalizeKey(techName);
    const createdAtMs = new Date(entry.created_at || 0).getTime();
    const previous = latestUpdateByTech.get(key);
    if (!previous || createdAtMs > previous.createdAtMs) {
      latestUpdateByTech.set(key, {
        createdAtMs,
        entry,
      });
    }
  });

  for (const wo of workOrders) {
    const techName = String(wo.technician || '').trim();
    if (!techName) continue;

    if (!groups.has(techName)) {
      groups.set(techName, {
        technician: techName,
        live_status: 'Working',
        current_car: '-',
        current_job_time: '-',
        total_labor_accumulated: 0,
        total_labor_mtd: 0,
        work_orders_mtd: 0,
        _activeSource: null,
      });
    }

    const group = groups.get(techName);
    const items = wo.service_items || [];
    const laborTotal = items.reduce((sum, item) => sum + (toNumber(item.labor_price) * Math.max(1, toNumber(item.service_qty) || 1)), 0);
    group.total_labor_accumulated += laborTotal;

    const created = new Date(wo.created_at || 0);
    const isCurrentMonth = created.getFullYear() === currentYear && created.getMonth() === currentMonth;
    if (isCurrentMonth) {
      group.total_labor_mtd += laborTotal;
      group.work_orders_mtd += 1;
    }

    const status = String(wo.status || '').toLowerCase();
    const isActive = status === 'open' || status === 'in-progress';
    if (!isActive) continue;

    const sourceTime = new Date(wo.created_at || 0).getTime();
    if (group._activeSource != null && sourceTime <= group._activeSource) continue;

    const vehicle = byId.get(wo.vehicle_id) || {};
    const brand = String(wo.car_brand || vehicle.make || '').trim();
    const model = String(wo.car_model || vehicle.model || '').trim();
    const plate = String(wo.plate_number || vehicle.license_plate || '').trim();
    const carLabel = [brand, model].filter(Boolean).join(' ') || '-';
    group.current_car = plate ? `${carLabel} (${plate})` : carLabel;

    const start = parseTimeToday(wo.time_in);
    const end = parseTimeToday(wo.time_out) || now;
    group.current_job_time = start ? formatElapsed(start, end) : '-';
    group._activeSource = sourceTime;
  }

  return Array.from(groups.values())
    .map(group => {
      const latestStatus = latestUpdateByTech.get(normalizeKey(group.technician));
      return {
        technician: group.technician,
        live_status: resolveLiveStatus(latestStatus && latestStatus.entry),
        current_car: group.current_car,
        current_job_time: group.current_job_time,
        total_labor_accumulated: group.total_labor_accumulated,
        total_labor_mtd: group.total_labor_mtd,
        work_orders_mtd: group.work_orders_mtd,
      };
    })
    .sort((a, b) => a.technician.localeCompare(b.technician));
}

router.get('/', async (req, res) => {
  let customers = await store.getAll('customers');
  let vehicles = await store.getAll('vehicles');
  const workOrders = filterBySessionBranch(req, await store.getAll('work_orders'), wo => wo.branch);
  const user = req.session && req.session.user ? req.session.user : {};
  if (frontlineSessionBranch(user)) {
    const customerIds = new Set(workOrders.map(wo => wo.customer_id).filter(Boolean));
    const vehicleIds = new Set(workOrders.map(wo => wo.vehicle_id).filter(Boolean));
    const branch = normalizeKey(user.branch);
    customers = customers.filter(customer => customerIds.has(customer.id) || normalizeKey(customer.branch) === branch);
    vehicles = vehicles.filter(vehicle => vehicleIds.has(vehicle.id) || normalizeKey(vehicle.branch) === branch);
  }
  const technicianUpdates = await store.getAll('technician_updates');
  const pricingRules = await store.getAll('pricing_rules');
  const technicianStats = buildTechnicianStats(workOrders, vehicles, technicianUpdates);
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
  const [workOrders, vehicles, technicianUpdates, employees] = await Promise.all([
    store.getAll('work_orders'),
    store.getAll('vehicles'),
    store.getAll('technician_updates'),
    store.getAll('employees'),
  ]);
  const scopedWorkOrders = filterBySessionBranch(req, workOrders, wo => wo.branch);
  const scopedEmployees = filterBySessionBranch(req, employees, employee => employee.work_location_branch_id);
  const technicians = buildTechnicianOperations(scopedWorkOrders, vehicles, technicianUpdates, scopedEmployees);
  res.render('workorder-transactions/technicians', {
    technicians,
    summary: {
      roster: technicians.length,
      working: technicians.filter(item => item.current_order).length,
      activeOrders: technicians.reduce((sum, item) => sum + item.active_count, 0),
      pendingOrders: technicians.reduce((sum, item) => sum + item.pending_orders.length, 0),
      laborMtd: technicians.reduce((sum, item) => sum + item.labor_mtd, 0),
    },
    success: req.query.success || '',
    error: req.query.error || '',
  });
});

router.get('/technicians/:technicianName', async (req, res) => {
  const [workOrders, vehicles, technicianUpdates, employees] = await Promise.all([
    store.getAll('work_orders'),
    store.getAll('vehicles'),
    store.getAll('technician_updates'),
    store.getAll('employees'),
  ]);
  const technicianKey = canonicalTechnicianName(req.params.technicianName);
  const scopedWorkOrders = filterBySessionBranch(req, workOrders, wo => wo.branch);
  const scopedEmployees = filterBySessionBranch(req, employees, employee => employee.work_location_branch_id);
  const technician = buildTechnicianOperations(scopedWorkOrders, vehicles, technicianUpdates, scopedEmployees)
    .find(item => canonicalTechnicianName(item.technician) === technicianKey);
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
  const workOrderId = String(req.body.work_order_id || '').trim();
  const note = String(req.body.note || '').trim();
  const returnTo = String(req.body.return_to || '').trim();
  const redirectTarget = returnTo.startsWith('/work-order-transactions/technicians/')
    ? returnTo
    : '/work-order-transactions/technicians';
  const allowed = new Set(['working', 'waiting_parts', 'absent', 'training', 'assigned_transfer', 'for_approval', 'break', 'other']);
  if (!technicianName || !allowed.has(statusAction)) {
    return res.redirect(`${redirectTarget}?error=Technician+and+valid+status+are+required.`);
  }
  if (workOrderId && !await store.getById('work_orders', workOrderId)) {
    return res.redirect(`${redirectTarget}?error=Selected+work+order+was+not+found.`);
  }
  if (workOrderId) {
    const selectedWorkOrder = await store.getById('work_orders', workOrderId);
    const user = req.session && req.session.user ? req.session.user : {};
    if (frontlineSessionBranch(user) && normalizeKey(selectedWorkOrder.branch) !== normalizeKey(user.branch)) {
      return res.status(403).send('This work order belongs to another branch.');
    }
  }
  await store.create('technician_updates', {
    work_order_id: workOrderId,
    sender_role: String(req.session && req.session.user && req.session.user.role || 'service_receptionist').trim().toLowerCase() || 'service_receptionist',
    sender_username: String(req.session && req.session.user && req.session.user.username || '').trim(),
    technician_name: technicianName,
    status_action: statusAction,
    status_flags: {
      on_break: statusAction === 'break',
      waiting_parts: statusAction === 'waiting_parts',
      done: false,
    },
    message: note || statusLabel({ status_action: statusAction }),
  });
  return res.redirect(`${redirectTarget}?success=Technician+activity+updated.`);
});

module.exports = router;
