const express = require('express');
const store = require('../data/store');
const { buildPartsRequestInventoryPayload } = require('../lib/parts-request');
const { allocatePartsTransactionNumber } = require('../lib/parts-transaction-number');
const { isActiveWorkOrderStatus } = require('../lib/work-order-status');
const { technicianMatchKeys, keysOverlap } = require('../lib/technician-activity');

const router = express.Router();

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeEmployeeId(value) {
  return normalizeText(value).toUpperCase();
}

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function getLaborTotal(workOrder) {
  const items = Array.isArray(workOrder && workOrder.service_items) ? workOrder.service_items : [];
  return items.reduce((sum, item) => sum + (toNumber(item && item.labor_price) * Math.max(1, toNumber(item && item.service_qty) || 1)), 0);
}

function isSameDay(dateA, dateB) {
  return dateA.getFullYear() === dateB.getFullYear() &&
    dateA.getMonth() === dateB.getMonth() &&
    dateA.getDate() === dateB.getDate();
}

function isSameMonth(dateA, dateB) {
  return dateA.getFullYear() === dateB.getFullYear() && dateA.getMonth() === dateB.getMonth();
}

function getCurrentTimeHHMM() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function isActiveWorkOrder(status) {
  return isActiveWorkOrderStatus(status);
}

function buildVehicleLabel(workOrder, vehicle) {
  const model = normalizeText(workOrder.car_model || (vehicle && vehicle.model));
  const plate = normalizeText(workOrder.plate_number || (vehicle && vehicle.license_plate));
  const brand = normalizeText(workOrder.car_brand || (vehicle && vehicle.make));
  const modelLabel = model || [brand, model].filter(Boolean).join(' ').trim() || 'Unknown Vehicle';
  return plate ? `${modelLabel} - ${plate}` : modelLabel;
}

function buildServiceList(workOrder) {
  const rows = Array.isArray(workOrder.service_items) ? workOrder.service_items : [];
  const fromItems = rows
    .map((item) => normalizeText(item.description || item.reason || item.service_type))
    .filter(Boolean)
    .slice(0, 10);

  if (fromItems.length) return fromItems;

  const fallback = normalizeText(workOrder.description);
  return fallback ? [fallback] : [];
}

function toTimeLabel(isoValue) {
  const timestamp = new Date(isoValue || 0);
  if (Number.isNaN(timestamp.getTime())) return '-';
  return timestamp.toLocaleString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function matchesTechnician(workOrder, technicianName, technicianEmployeeId) {
  const workOrderTechnician = normalizeText(workOrder && workOrder.technician);
  if (!workOrderTechnician) return false;
  return keysOverlap(
    technicianMatchKeys(workOrderTechnician),
    technicianMatchKeys(technicianName, technicianEmployeeId)
  );
}

async function buildTechnicianDashboardData(sessionUser) {
  const technicianName = normalizeText(sessionUser.technician_name || sessionUser.username);
  const technicianEmployeeId = normalizeEmployeeId(sessionUser.technician_employee_id || '');
  const now = new Date();
  const [workOrders, customers, vehicles, updates] = await Promise.all([
    store.getAll('work_orders'),
    store.getAll('customers'),
    store.getAll('vehicles'),
    store.getAll('technician_updates'),
  ]);

  const customersById = new Map((customers || []).map((row) => [row.id, row]));
  const vehiclesById = new Map((vehicles || []).map((row) => [row.id, row]));

  const assigned = (workOrders || [])
    .filter((wo) => matchesTechnician(wo, technicianName, technicianEmployeeId))
    .map((wo) => {
      const customer = customersById.get(wo.customer_id) || {};
      const vehicle = vehiclesById.get(wo.vehicle_id) || {};
      const workOrderUpdates = (updates || [])
        .filter((entry) => normalizeText(entry.work_order_id) === normalizeText(wo.id))
        .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
        .slice(0, 5);

      return {
        id: wo.id,
        work_order_number: normalizeText(wo.work_order_number) || wo.id,
        customer_name: normalizeText(customer.name) || normalizeText(wo.customer_entry) || 'Unknown Customer',
        vehicle_label: buildVehicleLabel(wo, vehicle),
        services: buildServiceList(wo),
        status: normalizeText(wo.status) || 'open',
        branch: normalizeText(wo.branch),
        created_at: wo.created_at || '',
        technician_assigned_at: wo.technician_assigned_at || '',
        recent_updates: workOrderUpdates,
      };
    })
    .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());

  const assignedById = new Map(assigned.map((wo) => [normalizeText(wo.id), wo]));
  const assignedIds = new Set(assignedById.keys());
  const incomingNotifications = (updates || [])
    .filter((entry) => ['service_advisor', 'service_receptionist', 'senior_service_receptionist'].includes(normalizeText(entry.sender_role)))
    .filter((entry) => assignedIds.has(normalizeText(entry.work_order_id)))
    .map((entry) => {
      const order = assignedById.get(normalizeText(entry.work_order_id)) || {};
      return Object.assign({}, entry, {
        work_order_number: normalizeText(order.work_order_number) || normalizeText(entry.work_order_id),
      });
    })
    .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
    .slice(0, 12);

  const laborToday = assigned.reduce((sum, order) => {
    const createdAt = new Date(order.created_at || 0);
    if (Number.isNaN(createdAt.getTime())) return sum;
    return isSameDay(createdAt, now) ? (sum + getLaborTotal(order)) : sum;
  }, 0);

  const laborMtd = assigned.reduce((sum, order) => {
    const createdAt = new Date(order.created_at || 0);
    if (Number.isNaN(createdAt.getTime())) return sum;
    return isSameMonth(createdAt, now) ? (sum + getLaborTotal(order)) : sum;
  }, 0);

  return {
    technicianName,
    technicianEmployeeId,
    activeOrders: assigned.filter((wo) => isActiveWorkOrder(wo.status)),
    otherOrders: assigned.filter((wo) => !isActiveWorkOrder(wo.status)),
    incomingNotifications,
    laborToday,
    laborMtd,
    formatTime: toTimeLabel,
  };
}

router.get('/', async (req, res) => {
  const user = (req.session && req.session.user) || {};
  const data = await buildTechnicianDashboardData(user);
  res.render('technician/index', {
    ...data,
    success: req.query.success || '',
    error: req.query.error || '',
  });
});

router.post('/updates', async (req, res) => {
  const user = (req.session && req.session.user) || {};
  const technicianName = normalizeText(user.technician_name || user.username);
  const technicianEmployeeId = normalizeEmployeeId(user.technician_employee_id || '');
  const workOrderId = normalizeText(req.body.work_order_id);
  const note = normalizeText(req.body.note);
  const statusAction = normalizeText(req.body.status_action).toLowerCase();
  const onBreak = Boolean(req.body.on_break);
  const waitingParts = Boolean(req.body.waiting_parts);

  if (!workOrderId) {
    return res.redirect('/technician?error=Work%20order%20is%20required.');
  }

  const hasStatusAction = statusAction === 'break' || statusAction === 'waiting_parts' || statusAction === 'done';

  if (!note && !onBreak && !waitingParts && !hasStatusAction) {
    return res.redirect('/technician?error=Provide%20a%20note%20or%20status%20checkbox%20first.');
  }

  const workOrder = await store.getById('work_orders', workOrderId);
  if (!workOrder || !matchesTechnician(workOrder, technicianName, technicianEmployeeId)) {
    return res.redirect('/technician?error=You%20can%20only%20update%20your%20assigned%20work%20orders.');
  }

  let nextFlags = {
    on_break: onBreak,
    waiting_parts: waitingParts,
    done: false,
  };
  let message = note;

  if (statusAction === 'break') {
    nextFlags = { on_break: true, waiting_parts: false, done: false };
    if (!message) message = 'Technician is on break.';
    await store.update('work_orders', workOrder.id, { status: 'break' });
  } else if (statusAction === 'waiting_parts') {
    nextFlags = { on_break: false, waiting_parts: true, done: false };
    if (!message) message = 'Technician is waiting for parts.';
    await store.update('work_orders', workOrder.id, { status: 'waiting-parts' });
  } else if (statusAction === 'done') {
    nextFlags = { on_break: false, waiting_parts: false, done: true };
    if (!message) message = 'Technician marked this job as done.';
    const updatePayload = { status: 'completed' };
    if (!normalizeText(workOrder.time_out)) {
      updatePayload.time_out = getCurrentTimeHHMM();
    }
    await store.update('work_orders', workOrder.id, updatePayload);
  }

  await store.create('technician_updates', {
    work_order_id: workOrder.id,
    sender_role: 'technician',
    sender_username: normalizeText(user.username),
    technician_name: technicianName,
    status_flags: nextFlags,
    status_action: statusAction || '',
    message,
  });

  return res.redirect('/technician?success=Update%20sent%20to%20Service%20Advisor.');
});

router.post('/parts-request', async (req, res) => {
  const user = (req.session && req.session.user) || {};
  const technicianName = normalizeText(user.technician_name || user.username);
  const technicianEmployeeId = normalizeEmployeeId(user.technician_employee_id || '');
  const workOrderId = normalizeText(req.body.work_order_id);
  const partNumber = normalizeText(req.body.part_number);
  const qty = toNumber(req.body.qty);

  if (!workOrderId || !partNumber || qty <= 0) {
    return res.redirect('/technician?error=Work%20order%2C%20part%20number%2C%20and%20quantity%20are%20required.');
  }

  const workOrder = await store.getById('work_orders', workOrderId);
  if (!workOrder || !matchesTechnician(workOrder, technicianName, technicianEmployeeId)) {
    return res.redirect('/technician?error=You%20can%20only%20request%20parts%20for%20your%20assigned%20work%20orders.');
  }

  const workOrderNumber = normalizeText(workOrder.work_order_number) || workOrder.id;
  const branch = normalizeText(workOrder.branch);

  const data = await store.getRawData();
  await store.create('parts_inventory', Object.assign(
    { transaction_number: allocatePartsTransactionNumber(data) },
    buildPartsRequestInventoryPayload({
      partNumber,
      partName: normalizeText(req.body.part_name),
      subId: normalizeText(req.body.sub_id),
      unit: normalizeText(req.body.unit),
      qty,
      supplier: normalizeText(req.body.supplier),
      generic: normalizeText(req.body.notes),
      costPrice: toNumber(req.body.cost_price),
      markup: toNumber(req.body.markup),
      retailPrice: toNumber(req.body.retail_price),
      editor: normalizeText(user.username),
      requestingBranch: branch,
      branch,
      workOrderNumber,
      workOrderId: workOrder.id,
    })
  ));

  return res.redirect('/technician?success=Parts%20request%20sent%20to%20Parts%20Manager.');
});

module.exports = router;
