const store = require('../data/store');

function normalizeText(value) { return String(value || '').trim().toLowerCase().replace(/\s+/g, ' '); }
function toNumber(value) { const n = Number(value); return Number.isFinite(n) ? n : 0; }
function asMoney(value) { const n = Number(value); return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0; }
function splitParts(value) { return String(value || '').split(/[,;]/).map(s => s.trim()).filter(Boolean); }
function computeTotals(items) {
  let laborTotal = 0, partsTotal = 0, grandTotal = 0;
  (items || []).forEach(item => {
    const labor = toNumber(item.labor_price);
    const qty = Math.max(1, toNumber(item.service_qty) || 1);
    const partsPrice = toNumber(item.parts_price);
    const partsQty = Math.max(0, toNumber(item.parts_qty) || 0);
    laborTotal += labor * qty;
    partsTotal += partsPrice * (partsQty > 0 ? partsQty : 1);
  });
  grandTotal = laborTotal + partsTotal;
  const vat = grandTotal * 0.12;
  const totalWithVat = grandTotal + vat;
  return { laborTotal, partsTotal, grandTotal, vat, totalWithVat };
}
function normalizeWorkOrderNumber(woNum, id) {
  const n = String(woNum || '').trim();
  if (n) return n;
  return String(id || '').slice(-7);
}

(async () => {
  const workOrders = await store.getAll('work_orders');
  const customers = await store.getAll('customers');
  const vehicles = await store.getAll('vehicles');
  const existingRecords = await store.getAll('transaction_records');
  const existingWoIds = new Set(existingRecords.map(r => r.work_order_id).filter(Boolean));

  const customerMap = new Map(customers.map(c => [c.id, c]));
  const vehicleMap = new Map(vehicles.map(v => [v.id, v]));

  let created = 0, skipped = 0;
  for (const wo of workOrders) {
    if (String(wo.status || '').trim().toLowerCase() !== 'closed') { skipped++; continue; }
    if (existingWoIds.has(wo.id)) { skipped++; continue; }
    const customer = customerMap.get(wo.customer_id) || {};
    const vehicle = vehicleMap.get(wo.vehicle_id) || {};
    const items = wo.service_items || [];
    const totals = computeTotals(items);
    const parts = [];
    const partPrices = [];
    items.forEach(item => {
      const names = splitParts(item.parts);
      if (!names.length && toNumber(item.parts_price) > 0) names.push('');
      names.forEach(name => {
        if (parts.length < 50) { parts.push(name); partPrices.push(asMoney(item.parts_price)); }
      });
    });
    const record = {
      work_order_id: wo.id,
      transaction_action: 'backfill',
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
    await store.create('transaction_records', record);
    created++;
  }
  console.log(`Created ${created} transaction records, skipped ${skipped}.`);
})();
