const express = require('express');
const store = require('../data/store');
const { frontlineSessionBranch } = require('../lib/frontline-roles');

const router = express.Router();
const ALLOWED_SORT_MODES = new Set(['relevance', 'date_desc', 'date_asc', 'az', 'za']);

function includesQuery(value, query) {
  return String(value || '').toLowerCase().includes(query);
}

function sessionBranch(req) {
  const user = req.session && req.session.user ? req.session.user : {};
  return String(frontlineSessionBranch(user) || '').trim().toLowerCase();
}

function normalizeSortMode(value) {
  const candidate = String(value || '').trim().toLowerCase();
  return ALLOWED_SORT_MODES.has(candidate) ? candidate : 'relevance';
}

function toDateValue(value) {
  const ms = new Date(value || 0).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function compareTextAsc(a, b) {
  return String(a || '').localeCompare(String(b || ''), undefined, { sensitivity: 'base' });
}

function sortRows(rows, sortMode, options) {
  const list = rows.slice();
  const textAccessor = options.textAccessor || (() => '');
  const dateAccessor = options.dateAccessor || (() => 0);

  if (sortMode === 'az') {
    return list.sort((a, b) => compareTextAsc(textAccessor(a), textAccessor(b)));
  }

  if (sortMode === 'za') {
    return list.sort((a, b) => compareTextAsc(textAccessor(b), textAccessor(a)));
  }

  if (sortMode === 'date_desc' || sortMode === 'date_asc') {
    return list.sort((a, b) => {
      const aDate = toDateValue(dateAccessor(a));
      const bDate = toDateValue(dateAccessor(b));
      if (aDate !== bDate) {
        return sortMode === 'date_desc' ? bDate - aDate : aDate - bDate;
      }
      return compareTextAsc(textAccessor(a), textAccessor(b));
    });
  }

  return list;
}

router.get('/', async (req, res) => {
  const q = String(req.query.q || '').trim();
  const query = q.toLowerCase();
  const sortBy = normalizeSortMode(req.query.sort_by);

  const allCustomers = await store.getAll('customers');
  const allVehicles = await store.getAll('vehicles');
  const branch = sessionBranch(req);
  const workOrders = branch
    ? (await store.getAll('work_orders')).filter(wo => String(wo.branch || '').trim().toLowerCase() === branch)
    : await store.getAll('work_orders');
  const customerIds = new Set(workOrders.map(wo => wo.customer_id).filter(Boolean));
  const vehicleIds = new Set(workOrders.map(wo => wo.vehicle_id).filter(Boolean));
  const customers = branch ? allCustomers.filter(customer => customerIds.has(customer.id)) : allCustomers;
  const vehicles = branch ? allVehicles.filter(vehicle => vehicleIds.has(vehicle.id)) : allVehicles;
  const pricingRules = await store.getAll('pricing_rules');
  const transactionRecords = branch
    ? (await store.getAll('transaction_records')).filter(record => String(record.Branch || '').trim().toLowerCase() === branch)
    : await store.getAll('transaction_records');

  let customerResults = [];
  let vehicleResults = [];
  let workOrderResults = [];
  let pricingResults = [];
  let partResults = [];
  let technicianResults = [];
  let transactionResults = [];

  if (query) {
    customerResults = customers.filter(customer =>
      includesQuery(customer.name, query) ||
      includesQuery(customer.phone, query) ||
      includesQuery(customer.email, query) ||
      includesQuery(customer.address, query)
    );

    vehicleResults = vehicles.filter(vehicle =>
      includesQuery(vehicle.make, query) ||
      includesQuery(vehicle.model, query) ||
      includesQuery(vehicle.license_plate, query) ||
      includesQuery(vehicle.vin, query) ||
      includesQuery(vehicle.vehicle_type, query)
    );

    workOrderResults = workOrders.filter(wo =>
      includesQuery(wo.work_order_number, query) ||
      includesQuery(wo.description, query) ||
      includesQuery(wo.branch, query) ||
      includesQuery(wo.status, query) ||
      includesQuery(wo.service_advisor, query) ||
      includesQuery(wo.technician, query)
    );

    pricingResults = pricingRules.filter(rule =>
      includesQuery(rule.vehicle_type, query) ||
      includesQuery(rule.service_type, query) ||
      includesQuery(rule.price, query)
    );

    partResults = workOrders.flatMap(wo =>
      (wo.service_items || [])
        .filter(item => includesQuery(item.parts, query))
        .map(item => ({
          work_order_number: wo.work_order_number || wo.id,
          part_name: item.parts || '',
          part_price: item.parts_price || 0,
          service_type: item.reason || item.service_type || item.description || '',
          created_at: wo.updated_at || wo.created_at || '',
        }))
    );

    technicianResults = workOrders
      .filter(wo => includesQuery(wo.technician, query) || includesQuery(wo.service_advisor, query))
      .map(wo => ({
        work_order_number: wo.work_order_number || wo.id,
        technician: wo.technician || '',
        service_advisor: wo.service_advisor || '',
        branch: wo.branch || '',
        created_at: wo.updated_at || wo.created_at || '',
      }));

    transactionResults = transactionRecords.filter(record =>
      includesQuery(record['work order Number'], query) ||
      includesQuery(record['Customer name'], query) ||
      includesQuery(record['Car Brand'], query) ||
      includesQuery(record['Model'], query) ||
      includesQuery(record['Tecnician'], query) ||
      includesQuery(record['Service Advice Advisor'], query)
    );

    customerResults = sortRows(customerResults, sortBy, {
      textAccessor: item => item.name,
      dateAccessor: item => item.created_at,
    });

    vehicleResults = sortRows(vehicleResults, sortBy, {
      textAccessor: item => `${item.make || ''} ${item.model || ''} ${item.license_plate || ''}`,
      dateAccessor: item => item.created_at,
    });

    workOrderResults = sortRows(workOrderResults, sortBy, {
      textAccessor: item => item.work_order_number || item.id,
      dateAccessor: item => item.updated_at || item.created_at,
    });

    pricingResults = sortRows(pricingResults, sortBy, {
      textAccessor: item => `${item.vehicle_type || ''} ${item.service_type || ''}`,
      dateAccessor: item => item.created_at,
    });

    partResults = sortRows(partResults, sortBy, {
      textAccessor: item => `${item.part_name || ''} ${item.work_order_number || ''}`,
      dateAccessor: item => item.created_at,
    });

    technicianResults = sortRows(technicianResults, sortBy, {
      textAccessor: item => `${item.technician || ''} ${item.service_advisor || ''}`,
      dateAccessor: item => item.created_at,
    });

    transactionResults = sortRows(transactionResults, sortBy, {
      textAccessor: item => `${item['Customer name'] || ''} ${item['work order Number'] || ''}`,
      dateAccessor: item => item['Transaction date'] || item.created_at,
    });
  }

  res.render('helper/index', {
    q,
    sortBy,
    customerResults,
    vehicleResults,
    workOrderResults,
    pricingResults,
    partResults,
    technicianResults,
    transactionResults,
  });
});

module.exports = router;
