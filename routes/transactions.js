const express = require('express');
const store = require('../data/store');
const { frontlineSessionBranch } = require('../lib/frontline-roles');

const router = express.Router();
const VAT_RATE = 0.12;
const WORK_ORDER_NUMBER_PATTERN = /^\d{7}$/;

const serviceHeaders = Array.from({ length: 15 }, (_, i) => `Service${i + 1}`);
const serviceRequiredHeaders = Array.from({ length: 10 }, (_, i) => `Service Required${i + 1}`);
const laborHeaders = Array.from({ length: 15 }, (_, i) => `Labor${i + 1}`);
const partHeaders = Array.from({ length: 50 }, (_, i) => `Part${i + 1}`);
const partPriceHeaders = Array.from({ length: 50 }, (_, i) => `Parts Price${i + 1}`);
const serviceRequestReasonHeaders = Array.from({ length: 15 }, (_, i) => `Service Request and Reason${i + 1}`);

const csvColumns = [
  { header: 'Transaction date', key: 'Transaction date' },
  { header: 'Branch', key: 'Branch' },
  { header: 'work order Number', key: 'work order Number' },
  { header: 'Customer name', key: 'Customer name' },
  { header: 'Telephone number', key: 'Telephone number' },
  { header: 'Car Brand', key: 'Car Brand' },
  { header: 'Model', key: 'Model' },
  { header: 'Year', key: 'Year' },
  { header: 'SA', key: 'Service Advice Advisor' },
  { header: 'Tecnician', key: 'Tecnician' },
  ...serviceRequestReasonHeaders.map((header, index) => ({ header, key: `Service${index + 1}` })),
  ...serviceRequiredHeaders.map((header, index) => ({ header, key: `Service Required${index + 1}` })),
  ...laborHeaders.map(header => ({ header, key: header })),
  ...partHeaders.map(header => ({ header, key: header })),
  ...partPriceHeaders.map(header => ({ header, key: header })),
  { header: 'Total Labor', key: 'Total Labor' },
  { header: 'Total Parts', key: 'Total Parts' },
  { header: 'Grand Total', key: 'Grand Total' },
  { header: 'Vat', key: 'Vat' },
  { header: 'Totalwith Vat', key: 'Totalwith Vat' },
  { header: 'TimeIn', key: 'TimeIn' },
  { header: 'TimeOut', key: 'TimeOut' },
];

const csvHeaders = csvColumns.map(column => column.header);

function asCsvValue(value) {
  const str = String(value == null ? '' : value);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function asMoney(value) {
  return toNumber(value).toFixed(2);
}

function normalizeWorkOrderNumber(value, fallbackId) {
  const candidate = String(value || '').trim();
  const digits = candidate.replace(/\D/g, '');
  if (candidate && WORK_ORDER_NUMBER_PATTERN.test(candidate)) {
    return candidate;
  }
  if (digits) {
    return digits.slice(-7).padStart(7, '0');
  }
  return String(fallbackId || 0).replace(/\D/g, '').slice(-7).padStart(7, '0');
}

function computeTotals(items) {
  const laborTotal = items.reduce((sum, item) => sum + (toNumber(item.labor_price) * Math.max(1, toNumber(item.service_qty) || 1)), 0);
  const partsTotal = items.reduce((sum, item) => sum + toNumber(item.parts_price), 0);
  const grandTotal = laborTotal + partsTotal;
  const vat = Number((grandTotal * VAT_RATE).toFixed(2));
  const totalWithVat = Number((grandTotal + vat).toFixed(2));
  return { laborTotal, partsTotal, grandTotal, vat, totalWithVat };
}

function splitParts(text) {
  const raw = String(text || '').trim();
  if (!raw) return [];
  const values = raw.split(/[,;]+/).map(v => v.trim()).filter(Boolean);
  return values.length ? values : [raw];
}

function buildTransactionRecord(wo, customer, vehicle, action) {
  const items = wo.service_items || [];
  const totals = computeTotals(items);
  const parts = [];
  const partPrices = [];

  items.forEach(item => {
    const names = splitParts(item.parts);
    if (!names.length && toNumber(item.parts_price) > 0) {
      names.push('');
    }
    names.forEach(name => {
      if (parts.length < 50) {
        parts.push(name);
        partPrices.push(asMoney(item.parts_price));
      }
    });
  });

  const record = {
    work_order_id: wo.id,
    transaction_action: action,
    'Transaction date': new Date().toISOString(),
    'Branch': wo.branch || '',
    'work order Number': normalizeWorkOrderNumber(wo.work_order_number, wo.id),
    'Customer name': customer.name || '',
    'Telephone number': customer.phone || '',
    'Car Brand': vehicle.make || '',
    'Model': vehicle.model || '',
    'Year': vehicle.year || '',
    'Service Advice Advisor': wo.service_advisor || '',
    'Tecnician': wo.technician || '',
    'Total Labor': asMoney(totals.laborTotal),
    'Total Parts': asMoney(totals.partsTotal),
    'Grand Total': asMoney(totals.grandTotal),
    'Vat': asMoney(totals.vat),
    'Totalwith Vat': asMoney(totals.totalWithVat),
    'TimeIn': wo.time_in || '',
    'TimeOut': wo.time_out || '',
  };

  for (let i = 1; i <= 15; i += 1) {
    const item = items[i - 1] || {};
    record[`Service${i}`] = item.reason || item.service_type || item.description || '';
    record[`Labor${i}`] = item.labor_price != null && item.labor_price !== '' ? asMoney(item.labor_price) : '';
  }

  for (let i = 1; i <= 10; i += 1) {
    const item = items[i - 1] || {};
    record[`Service Required${i}`] = item.description || '';
  }

  for (let i = 1; i <= 50; i += 1) {
    record[`Part${i}`] = parts[i - 1] || '';
    record[`Parts Price${i}`] = partPrices[i - 1] || '';
  }

  return record;
}

function buildTransactionSections(record) {
  const headerFields = [
    ['Transaction date', record['Transaction date'] || ''],
    ['Branch', record['Branch'] || ''],
    ['work order Number', record['work order Number'] || ''],
    ['Customer name', record['Customer name'] || ''],
    ['Telephone number', record['Telephone number'] || ''],
    ['Car Brand', record['Car Brand'] || ''],
    ['Model', record['Model'] || ''],
    ['Year', record['Year'] || ''],
    ['SA', record['Service Advice Advisor'] || ''],
    ['Tecnician', record['Tecnician'] || ''],
    ['TimeIn', record['TimeIn'] || ''],
    ['TimeOut', record['TimeOut'] || ''],
    ['Total Labor', record['Total Labor'] || ''],
    ['Total Parts', record['Total Parts'] || ''],
    ['Grand Total', record['Grand Total'] || ''],
    ['Vat', record['Vat'] || ''],
    ['Totalwith Vat', record['Totalwith Vat'] || ''],
  ];

  const services = serviceHeaders.map((header, index) => ({
    line: index + 1,
    service: record[header] || '',
    labor: record[laborHeaders[index]] || '',
  })).filter(item => item.service || item.labor);

  const parts = partHeaders.map((header, index) => ({
    line: index + 1,
    part: record[header] || '',
    price: record[partPriceHeaders[index]] || '',
  })).filter(item => item.part || item.price);

  return { headerFields, services, parts };
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function sessionBranch(req) {
  const user = req.session && req.session.user ? req.session.user : {};
  return normalizeText(frontlineSessionBranch(user));
}

function filterRecordsByBranch(req, records) {
  const branch = sessionBranch(req);
  return branch ? (records || []).filter(record => normalizeText(record.Branch) === branch) : records;
}

function isClosedWorkOrder(wo) {
  return normalizeText(wo && wo.status) === 'closed';
}

function buildSearchHaystack(wo, customer, vehicle) {
  const workOrderNumber = normalizeWorkOrderNumber(wo.work_order_number, wo.id);
  const make = String(wo.car_brand || vehicle.make || '').trim();
  const model = String(wo.car_model || vehicle.model || '').trim();
  const vehicleLabel = [make, model].filter(Boolean).join(' ');

  return {
    workOrderNumber,
    customerName: String(customer.name || '').trim(),
    plateNumber: String(wo.plate_number || vehicle.license_plate || '').trim(),
    vehicleLabel,
  };
}

router.get('/', async (req, res) => {
  const records = filterRecordsByBranch(req, await store.getAll('transaction_records'));
  const sorted = records.slice().sort((a, b) => {
    const da = new Date(a['Transaction date'] || a.created_at || 0).getTime();
    const db = new Date(b['Transaction date'] || b.created_at || 0).getTime();
    return db - da;
  });
  res.render('transactions/index', {
    records: sorted,
    headers: csvHeaders,
    searchError: req.query.searchError || '',
    searchQuery: req.query.searchQuery || '',
  });
});

router.get('/closed-work-order-search', async (req, res) => {
  const rawQuery = String(req.query.q || '').trim();
  if (!rawQuery) {
    return res.redirect('/transactions?searchError=Please%20enter%20a%20search%20value.&searchQuery=');
  }

  const branch = sessionBranch(req);
  const workOrders = branch
    ? (await store.getAll('work_orders')).filter(wo => normalizeText(wo.branch) === branch)
    : await store.getAll('work_orders');
  const customers = await store.getAll('customers');
  const vehicles = await store.getAll('vehicles');
  const customerById = new Map(customers.map(customer => [customer.id, customer]));
  const vehicleById = new Map(vehicles.map(vehicle => [vehicle.id, vehicle]));
  const normalizedQuery = normalizeText(rawQuery);

  const closedCandidates = workOrders
    .filter(isClosedWorkOrder)
    .map(wo => {
      const customer = customerById.get(wo.customer_id) || {};
      const vehicle = vehicleById.get(wo.vehicle_id) || {};
      const fields = buildSearchHaystack(wo, customer, vehicle);
      return {
        wo,
        fields,
        sortDate: new Date(wo.updated_at || wo.created_at || 0).getTime() || 0,
      };
    });

  const exact = closedCandidates.find(candidate => normalizeText(candidate.fields.workOrderNumber) === normalizedQuery);
  if (exact) {
    return res.redirect(`/work-orders/${exact.wo.id}/billing`);
  }

  const matches = closedCandidates
    .filter(candidate => {
      return [
        candidate.fields.workOrderNumber,
        candidate.fields.customerName,
        candidate.fields.plateNumber,
        candidate.fields.vehicleLabel,
      ].some(value => normalizeText(value).includes(normalizedQuery));
    })
    .sort((a, b) => b.sortDate - a.sortDate);

  if (!matches.length) {
    const encodedQuery = encodeURIComponent(rawQuery);
    return res.redirect(`/transactions?searchError=No%20closed%20work%20order%20found.&searchQuery=${encodedQuery}`);
  }

  return res.redirect(`/work-orders/${matches[0].wo.id}/billing`);
});

router.get('/export.csv', async (req, res) => {
  const records = filterRecordsByBranch(req, await store.getAll('transaction_records'));
  const lines = [csvHeaders.join(',')];

  for (const record of records) {
    const row = csvColumns.map(column => asCsvValue(record[column.key]));
    lines.push(row.join(','));
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="workorder-transactions.csv"');
  res.send(lines.join('\n'));
});

router.get('/:id', async (req, res) => {
  const record = await store.getById('transaction_records', req.params.id);
  if (!record) return res.redirect('/transactions');
  if (sessionBranch(req) && normalizeText(record.Branch) !== sessionBranch(req)) {
    return res.status(403).send('This transaction belongs to another branch.');
  }

  const sections = buildTransactionSections(record);
  res.render('transactions/show', {
    record,
    headerFields: sections.headerFields,
    services: sections.services,
    parts: sections.parts,
  });
});

router.post('/backfill', async (req, res) => {
  const branch = sessionBranch(req);
  const workOrders = branch
    ? (await store.getAll('work_orders')).filter(wo => normalizeText(wo.branch) === branch)
    : await store.getAll('work_orders');
  const customers = await store.getAll('customers');
  const vehicles = await store.getAll('vehicles');
  const existingRecords = await store.getAll('transaction_records');

  const existingBackfilled = new Set(
    existingRecords
      .filter(record => record.transaction_action === 'backfill')
      .map(record => record.work_order_id)
      .filter(Boolean)
  );

  const customerMap = new Map(customers.map(customer => [customer.id, customer]));
  const vehicleMap = new Map(vehicles.map(vehicle => [vehicle.id, vehicle]));

  let created = 0;
  let skipped = 0;

  for (const wo of workOrders) {
    if (existingBackfilled.has(wo.id)) {
      skipped += 1;
      continue;
    }

    const customer = customerMap.get(wo.customer_id) || {};
    const vehicle = vehicleMap.get(wo.vehicle_id) || {};
    const record = buildTransactionRecord(wo, customer, vehicle, 'backfill');
    await store.create('transaction_records', record);
    created += 1;
  }

  res.redirect(`/transactions?backfilled=${created}&skipped=${skipped}`);
});

module.exports = router;
