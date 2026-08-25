const express = require('express');
const store = require('../data/store');
const { isFrontlineRole } = require('../lib/frontline-roles');

const router = express.Router();

const ASSIGN_DEADLINE_MS = 10 * 60 * 1000; // 10 minutes

function isOpen(wo) {
  const s = String(wo.status || '').trim().toLowerCase();
  return s === 'open' || s === 'in-progress' || s === 'waiting-parts' || s === 'break' || s === 'on-other-priority';
}

function branchScopedWorkOrders(req, workOrders) {
  const user = req.session && req.session.user ? req.session.user : {};
  if (!isFrontlineRole(user.role)) return workOrders;
  const branch = String(user.branch || '').trim().toLowerCase();
  return (workOrders || []).filter(wo => String(wo.branch || '').trim().toLowerCase() === branch);
}

// GET /api/kpi/unassigned — returns open WOs with no technician created >10min ago
router.get('/unassigned', async (req, res) => {
  const workOrders = branchScopedWorkOrders(req, await store.getAll('work_orders'));
  const customers = await store.getAll('customers');
  const vehicles = await store.getAll('vehicles');

  const customerById = new Map(customers.map(c => [c.id, c]));
  const vehicleById = new Map(vehicles.map(v => [v.id, v]));

  const now = Date.now();
  const overdue = workOrders
    .filter(wo => {
      if (!isOpen(wo)) return false;
      if (String(wo.technician || '').trim()) return false;
      const age = now - new Date(wo.created_at || 0).getTime();
      return age >= ASSIGN_DEADLINE_MS;
    })
    .map(wo => {
      const customer = customerById.get(wo.customer_id) || {};
      const vehicle = vehicleById.get(wo.vehicle_id) || {};
      return {
        id: wo.id,
        work_order_number: wo.work_order_number || wo.id,
        customer_name: customer.name || wo.customer_entry || '—',
        plate_number: wo.plate_number || vehicle.license_plate || '—',
      };
    });

  res.json(overdue);
});

// GET /kpi/export.csv — KPI record for every work order
router.get('/export.csv', async (req, res) => {
  const workOrders = branchScopedWorkOrders(req, await store.getAll('work_orders'));
  const customers = await store.getAll('customers');
  const vehicles = await store.getAll('vehicles');

  const customerById = new Map(customers.map(c => [c.id, c]));
  const vehicleById = new Map(vehicles.map(v => [v.id, v]));

  const headers = [
    'WO Number',
    'Branch',
    'Customer Name',
    'Plate Number',
    'Car Brand',
    'Model',
    'Year',
    'SR',
    'Technician',
    'Status',
    'Created At',
    'Technician Assigned',
    'Minutes To Assign',
    'Within 10 Min Target',
    'Time In',
    'Time Out',
    ...Array.from({ length: 10 }, (_, i) => `Service Required${i + 1}`),
  ];

  function csvVal(v) {
    const s = String(v == null ? '' : v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  const lines = [headers.map(csvVal).join(',')];

  for (const wo of workOrders) {
    const customer = customerById.get(wo.customer_id) || {};
    const vehicle = vehicleById.get(wo.vehicle_id) || {};
    const createdAt = new Date(wo.created_at || 0);
    const technicianAssigned = String(wo.technician || '').trim() ? (wo.technician_assigned_at || '') : '';
    let minutesToAssign = '';
    let withinTarget = '';

    if (technicianAssigned) {
      const diffMs = new Date(technicianAssigned).getTime() - createdAt.getTime();
      if (diffMs >= 0) {
        minutesToAssign = (diffMs / 60000).toFixed(1);
        withinTarget = diffMs <= ASSIGN_DEADLINE_MS ? 'YES' : 'NO';
      }
    } else if (String(wo.technician || '').trim()) {
      minutesToAssign = 'N/A';
      withinTarget = 'N/A';
    }

    const items = Array.isArray(wo.service_items) ? wo.service_items : [];
    const serviceRequired = Array.from({ length: 10 }, (_, i) => {
      const item = items[i] || {};
      return item.description || '';
    });

    lines.push([
      wo.work_order_number || wo.id,
      wo.branch || '',
      customer.name || wo.customer_entry || '',
      wo.plate_number || vehicle.license_plate || '',
      wo.car_brand || vehicle.make || '',
      wo.car_model || vehicle.model || '',
      wo.car_year || vehicle.year || '',
      wo.service_advisor || '',
      wo.technician || '',
      wo.status || '',
      createdAt.toISOString(),
      technicianAssigned,
      minutesToAssign,
      withinTarget,
      wo.time_in || '',
      wo.time_out || '',
      ...serviceRequired,
    ].map(csvVal).join(','));
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="kpi-report.csv"');
  res.send(lines.join('\n'));
});

module.exports = router;
