const { isActiveWorkOrderStatus, isHoldStatus, normalizeWorkOrderStatus, formatWorkOrderStatusLabel } = require('./work-order-status');

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase();
}

function compactKey(value) {
  return normalizeKey(value).replace(/[^a-z0-9]+/g, '');
}

function canonicalTechnicianName(value) {
  return String(value || '')
    .replace(/\s*\([^)]+\)\s*$/, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function employeeDisplayName(employee) {
  const name = [employee && employee.first_name, employee && employee.middle_name, employee && employee.last_name]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(' ');
  const employeeId = String((employee && employee.employee_id) || '').trim();
  return name && employeeId ? `${name} (${employeeId})` : (name || employeeId);
}

function isTechnicianEmployee(employee) {
  return /(mechanic|aligner|toolkeeper|carwasher|technician)/i.test(String((employee && (employee.job_title || employee.job_code)) || ''));
}

function technicianMatchKeys(value, extraId) {
  const keys = new Set();
  const raw = String(value || '').trim();
  const id = String(extraId || '').trim();
  if (raw) {
    keys.add(normalizeKey(raw));
    keys.add(compactKey(raw));
    keys.add(canonicalTechnicianName(raw));
    const paren = raw.match(/\(([^)]+)\)\s*$/);
    if (paren && paren[1]) {
      keys.add(normalizeKey(paren[1]));
      keys.add(compactKey(paren[1]));
    }
  }
  if (id) {
    keys.add(normalizeKey(id));
    keys.add(compactKey(id));
  }
  keys.delete('');
  return keys;
}

function asKeySet(value) {
  if (value instanceof Set) return value;
  if (Array.isArray(value)) return new Set(value.filter(Boolean));
  return new Set();
}

function keysOverlap(left, right) {
  const leftKeys = asKeySet(left);
  const rightKeys = asKeySet(right);
  for (const key of leftKeys) {
    if (key && rightKeys.has(key)) return true;
  }
  return false;
}

function elapsedHours(startValue, endValue) {
  const start = new Date(startValue || 0).getTime();
  const end = new Date(endValue || 0).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return (end - start) / 3600000;
}

function workOrderLabor(wo) {
  return (Array.isArray(wo && wo.service_items) ? wo.service_items : []).reduce((sum, item) => {
    const labor = toNumber(item && item.labor_price) * Math.max(1, toNumber(item && item.service_qty) || 1);
    return sum + labor;
  }, 0);
}

function workOrderParts(wo) {
  return (Array.isArray(wo && wo.service_items) ? wo.service_items : []).reduce((sum, item) => {
    const qtyRaw = Number(item && item.parts_qty);
    const qty = Number.isFinite(qtyRaw) && qtyRaw > 0 ? qtyRaw : 0;
    return sum + (qty * toNumber(item && item.parts_price));
  }, 0);
}

function workOrderTotal(wo) {
  const items = Array.isArray(wo && wo.service_items) ? wo.service_items : [];
  const fromLines = items.reduce((sum, item) => {
    const labor = toNumber(item && item.labor_price) * Math.max(1, toNumber(item && item.service_qty) || 1);
    const qtyRaw = Number(item && item.parts_qty);
    const qty = Number.isFinite(qtyRaw) && qtyRaw > 0 ? qtyRaw : 0;
    const fallback = labor + (qty * toNumber(item && item.parts_price));
    const lineTotal = Number(item && item.total_price);
    return sum + (Number.isFinite(lineTotal) && lineTotal > 0 ? lineTotal : fallback);
  }, 0);
  return fromLines;
}

function isBackJob(wo) {
  const orderType = String((wo && (wo.job_type || wo.transaction_type)) || '').toLowerCase();
  if (orderType.includes('back job')) return true;
  return (Array.isArray(wo && wo.service_items) ? wo.service_items : []).some((item) => (
    String((item && (item.reason || item.service_type)) || '').toLowerCase().includes('back job')
  ));
}

function signedLabor(wo) {
  const labor = workOrderLabor(wo);
  return isBackJob(wo) ? -Math.abs(labor) : labor;
}

function statusLabelFromUpdate(update) {
  const action = normalizeKey(update && update.status_action);
  const labels = {
    working: 'On-Going',
    idle: 'Idle',
    waiting_parts: 'Waiting for Parts',
    absent: 'Absent',
    training: 'Day off',
    day_off: 'Day off',
    assigned_transfer: 'Idle',
    for_approval: 'Idle',
    break: 'On Break',
    on_other_priority: 'On Other Priority',
    done: 'Idle',
    other: 'Idle',
  };
  if (labels[action]) return labels[action];
  const flags = (update && update.status_flags) || {};
  if (flags.on_break) return 'On Break';
  if (flags.waiting_parts) return 'Waiting for Parts';
  if (flags.done) return 'Idle';
  return '';
}

function boardStatusFromWorkOrder(wo, liveStatus) {
  if (wo) {
    const status = normalizeWorkOrderStatus(wo.status);
    if (status === 'waiting-parts') return { label: 'Waiting for Parts', tone: 'waiting-parts' };
    if (status === 'break') return { label: 'On Break', tone: 'break' };
    if (status === 'on-other-priority') return { label: 'On Other Priority', tone: 'waiting-parts' };
    if (status === 'in-progress' || status === 'open') return { label: 'On-Going', tone: 'ongoing' };
  }
  const raw = compactKey(liveStatus);
  if (raw === 'waitingforparts' || raw === 'waitingparts') return { label: 'Waiting for Parts', tone: 'waiting-parts' };
  if (raw === 'break' || raw === 'onbreak') return { label: 'On Break', tone: 'break' };
  if (raw === 'dayoff' || raw === 'training') return { label: 'Day off', tone: 'day-off' };
  if (raw === 'absent') return { label: 'Absent', tone: 'absent' };
  return { label: 'Idle', tone: 'idle' };
}

function vehicleLabel(wo, vehicle) {
  const make = String((wo && wo.car_brand) || (vehicle && vehicle.make) || '').trim();
  const model = String((wo && wo.car_model) || (vehicle && vehicle.model) || '').trim();
  const plate = String((wo && wo.plate_number) || (vehicle && vehicle.license_plate) || '').trim();
  return [make, model, plate].filter(Boolean).join(' ') || '—';
}

function serviceSummary(wo) {
  return (Array.isArray(wo && wo.service_items) ? wo.service_items : [])
    .map((item) => String((item && (item.description || item.service_type || item.reason)) || '').trim())
    .filter(Boolean)
    .slice(0, 4);
}

function buildTechnicianOperations(workOrders, vehicles, technicianUpdates, employees, customers) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const vehicleById = new Map((vehicles || []).map((vehicle) => [vehicle.id, vehicle]));
  const customerById = new Map((customers || []).map((customer) => [customer.id, customer]));
  const roster = [];

  function addProfile(profile) {
    const existing = roster.find((item) => keysOverlap(item.match_keys, profile.match_keys));
    if (existing) {
      profile.match_keys.forEach((key) => existing.match_keys.add(key));
      if (!existing.employee_id && profile.employee_id) existing.employee_id = profile.employee_id;
      if (!existing.job_title && profile.job_title) existing.job_title = profile.job_title;
      if (!existing.branch && profile.branch) existing.branch = profile.branch;
      return existing;
    }
    roster.push(profile);
    return profile;
  }

  (employees || []).filter((employee) => String((employee && employee.employee_id) || '').trim()).forEach((employee) => {
    if (!isTechnicianEmployee(employee)) return;
    const displayName = employeeDisplayName(employee);
    if (!displayName) return;
    addProfile({
      technician: displayName,
      employee_id: String(employee.employee_id || '').trim(),
      branch: String(employee.work_location_branch_id || '').trim(),
      job_title: String(employee.job_title || '').trim(),
      match_keys: technicianMatchKeys(displayName, employee.employee_id),
    });
  });

  (workOrders || []).forEach((wo) => {
    const name = String(wo && wo.technician || '').trim();
    if (!name) return;
    addProfile({
      technician: name,
      employee_id: '',
      branch: String(wo.branch || '').trim(),
      job_title: 'Technician',
      match_keys: technicianMatchKeys(name),
    });
  });

  return roster.map((profile) => {
    const assignedOrders = (workOrders || [])
      .filter((wo) => keysOverlap(profile.match_keys, technicianMatchKeys(wo.technician)))
      .sort((a, b) => new Date(b.technician_assigned_at || b.created_at || 0) - new Date(a.technician_assigned_at || a.created_at || 0));
    const activeOrders = assignedOrders.filter((wo) => isActiveWorkOrderStatus(wo.status));
    const updates = (technicianUpdates || [])
      .filter((update) => keysOverlap(profile.match_keys, technicianMatchKeys(update.technician_name)))
      .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    const latestGlobalUpdate = updates.find((update) => !String(update.work_order_id || '').trim());
    const latestUpdateFor = (workOrderId) => updates.find((update) => String(update.work_order_id || '').trim() === String(workOrderId || '').trim());

    const currentOrder = activeOrders.find((wo) => !isHoldStatus(wo.status) && ['in-progress', 'open'].includes(normalizeWorkOrderStatus(wo.status)))
      || activeOrders[0]
      || null;
    const pendingOrders = activeOrders.filter((wo) => !currentOrder || wo.id !== currentOrder.id);

    const completedMtd = assignedOrders.filter((wo) => {
      const completedAt = new Date(wo.invoice_date || wo.updated_at || wo.created_at || 0);
      const status = normalizeWorkOrderStatus(wo.status);
      return (status === 'completed' || status === 'closed') && completedAt >= monthStart;
    });
    const assignedMtd = assignedOrders.filter((wo) => new Date(wo.created_at || 0) >= monthStart);
    const laborAccumulated = assignedOrders.reduce((sum, wo) => sum + signedLabor(wo), 0);
    const laborMtd = assignedMtd.reduce((sum, wo) => sum + signedLabor(wo), 0);
    const partsAccumulated = assignedOrders.reduce((sum, wo) => sum + workOrderParts(wo), 0);
    const cycleHours = completedMtd
      .map((wo) => elapsedHours(wo.technician_assigned_at || wo.created_at, wo.invoice_date || wo.updated_at))
      .filter((hours) => hours > 0);
    const statusUpdate = latestUpdateFor(currentOrder && currentOrder.id) || latestGlobalUpdate || updates[0] || null;
    const liveStatus = statusLabelFromUpdate(statusUpdate) || (currentOrder ? formatWorkOrderStatusLabel(currentOrder.status) : 'Idle');

    function orderDetail(wo) {
      const vehicle = vehicleById.get(wo.vehicle_id) || {};
      const customer = customerById.get(wo.customer_id) || {};
      const update = latestUpdateFor(wo.id) || latestGlobalUpdate;
      const assignedAt = wo.technician_assigned_at || wo.created_at;
      const labor = workOrderLabor(wo);
      const parts = workOrderParts(wo);
      return {
        id: wo.id,
        work_order_number: wo.work_order_number || wo.id,
        vehicle: vehicleLabel(wo, vehicle),
        customer: String(customer.name || '').trim() || '—',
        branch: wo.branch || profile.branch,
        assigned_at: assignedAt,
        time_in: wo.time_in || '',
        hours_open: elapsedHours(assignedAt, now),
        status: wo.status || '',
        status_label: formatWorkOrderStatusLabel(wo.status),
        reason: statusLabelFromUpdate(update) || formatWorkOrderStatusLabel(wo.status),
        note: update ? String(update.message || '').trim() : '',
        labor,
        parts,
        total: workOrderTotal(wo),
        services: serviceSummary(wo),
      };
    }

    const currentDetail = currentOrder ? orderDetail(currentOrder) : null;
    return {
      technician: profile.technician,
      employee_id: profile.employee_id,
      branch: profile.branch,
      job_title: profile.job_title,
      match_keys: Array.from(profile.match_keys),
      live_status: liveStatus,
      current_order: currentDetail,
      pending_orders: pendingOrders.map(orderDetail),
      assigned_orders: assignedOrders.map(orderDetail),
      active_count: activeOrders.length,
      assigned_count: assignedOrders.length,
      completed_mtd: completedMtd.length,
      work_orders_mtd: assignedMtd.length,
      labor_mtd: laborMtd,
      labor_accumulated: laborAccumulated,
      labor_present: currentDetail ? currentDetail.labor : 0,
      parts_accumulated: partsAccumulated,
      hours_active: activeOrders.reduce((sum, wo) => sum + elapsedHours(wo.technician_assigned_at || wo.created_at, now), 0),
      average_cycle_hours: cycleHours.length ? cycleHours.reduce((sum, hours) => sum + hours, 0) / cycleHours.length : 0,
      completion_rate: assignedMtd.length ? (completedMtd.length / assignedMtd.length) * 100 : 0,
      recent_updates: updates.slice(0, 10),
      board_status: boardStatusFromWorkOrder(currentOrder, liveStatus),
    };
  }).sort((a, b) => b.active_count - a.active_count || a.technician.localeCompare(b.technician));
}

function findTechnicianRow(technicians, nameParam) {
  let decoded = String(nameParam || '');
  try {
    decoded = decodeURIComponent(decoded);
  } catch (_error) {
    decoded = String(nameParam || '');
  }
  const keys = technicianMatchKeys(decoded);
  return (technicians || []).find((item) => keysOverlap(item.match_keys || technicianMatchKeys(item.technician, item.employee_id), keys));
}

function technicianPortalPath(name) {
  return `/work-order-transactions/technicians/${encodeURIComponent(String(name || '').trim())}`;
}

function toDashboardStats(technicians) {
  return (technicians || [])
    .filter((item) => item.assigned_count > 0 || item.current_order)
    .map((item) => ({
      technician: item.technician,
      live_status: (item.board_status && item.board_status.label) || item.live_status,
      present_wo: item.current_order ? item.current_order.work_order_number : '-',
      present_wo_id: item.current_order ? item.current_order.id : '',
      current_car: item.current_order ? item.current_order.vehicle : '-',
      current_job_time: item.current_order ? `${Number(item.current_order.hours_open || 0).toFixed(1)}h` : '-',
      total_labor_accumulated: item.labor_accumulated,
      total_labor_mtd: item.labor_mtd,
      work_orders_mtd: item.work_orders_mtd,
      active_count: item.active_count,
    }));
}

module.exports = {
  canonicalTechnicianName,
  employeeDisplayName,
  technicianMatchKeys,
  keysOverlap,
  workOrderLabor,
  statusLabelFromUpdate,
  buildTechnicianOperations,
  findTechnicianRow,
  technicianPortalPath,
  toDashboardStats,
};
