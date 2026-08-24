const store = require('../data/store');

const VAT_RATE = 0.12;

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function asMoney(value) {
  return toNumber(value).toFixed(2);
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
    'work order Number': wo.work_order_number || wo.id,
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

async function run() {
  const workOrders = await store.getAll('work_orders');
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

  console.log(`Backfill completed. created=${created}, skipped=${skipped}`);
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
