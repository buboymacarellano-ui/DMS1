const store = require('../data/store');

const VAT_RATE = 0.12;
const WORK_ORDER_NUMBER_PATTERN = /^\d{7}$/;

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function asMoney(value) {
  return toNumber(value).toFixed(2);
}

function normalizeWorkOrderNumber(value, fallbackDigits) {
  const candidate = String(value || '').trim();
  const digits = candidate.replace(/\D/g, '');
  if (WORK_ORDER_NUMBER_PATTERN.test(candidate)) return candidate;
  if (digits) return digits.slice(-7).padStart(7, '0');
  return String(fallbackDigits || 0).replace(/\D/g, '').slice(-7).padStart(7, '0');
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
    if (!names.length && toNumber(item.parts_price) > 0) names.push('');
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
    'work order Number': normalizeWorkOrderNumber(wo.work_order_number),
    'Customer name': customer.name || '',
    'Telephone number': wo.telephone_number || customer.phone || '',
    'Car Brand': wo.car_brand || vehicle.make || '',
    'Model': wo.car_model || vehicle.model || '',
    'Year': wo.car_year || vehicle.year || '',
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

  for (let i = 1; i <= 50; i += 1) {
    record[`Part${i}`] = parts[i - 1] || '';
    record[`Parts Price${i}`] = partPrices[i - 1] || '';
  }

  return record;
}

async function run() {
  const workOrders = await store.getAll('work_orders');
  if (!workOrders.length) {
    console.log('No work orders found.');
    return;
  }

  const customers = await store.getAll('customers');
  const vehicles = await store.getAll('vehicles');
  const latest = workOrders[workOrders.length - 1];
  const customer = customers.find(c => c.id === latest.customer_id) || {};
  const vehicle = vehicles.find(v => v.id === latest.vehicle_id) || {};
  const record = buildTransactionRecord(latest, customer, vehicle, 'refreshed');
  await store.create('transaction_records', record);
  console.log(`Created refreshed transaction snapshot for work order ${latest.work_order_number || latest.id}`);
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
