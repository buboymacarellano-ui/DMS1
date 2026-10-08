/**
 * Bulk-close ~3/4 of currently active work orders across all 7 operational branches.
 *
 * Mirrors the real "Final Print" billing-close flow in routes/workorders.js
 * (status -> closed, invoice number/date, finance fields, time_out, and a
 * transaction_records entry so the work orders also show up in Billing Queue).
 *
 * Usage:
 *   node scripts/close-bulk-active-work-orders.js --dry-run   (preview only)
 *   node scripts/close-bulk-active-work-orders.js             (apply changes)
 */
const store = require('../data/store');
const { canonicalizeBranchName, DEFAULT_OPERATIONAL_BRANCHES } = require('../lib/branches');
const { isActiveWorkOrderStatus } = require('../lib/work-order-status');
const {
  PAYMENT_STATUS,
  computeInvoiceEconomics,
  financeFieldsFromSnapshot,
  buildPartsCostIndex,
} = require('../lib/finance-ledger');

const DRY_RUN = process.argv.includes('--dry-run');
const CLOSE_FRACTION = 0.75;
const WORK_ORDER_NUMBER_PATTERN = /^\d{7}$/;

function normalizeText(value) {
  return String(value || '').trim();
}

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

function getPartsLineTotal(item) {
  const qtyRaw = Number(item && item.parts_qty);
  const qty = Number.isFinite(qtyRaw) && qtyRaw >= 0 ? qtyRaw : 0;
  const unitPrice = toNumber(item && item.parts_price);
  return qty * unitPrice;
}

function computeTotals(items) {
  const laborTotal = items.reduce((sum, item) => sum + (toNumber(item.labor_price) * Math.max(1, toNumber(item.service_qty) || 1)), 0);
  const partsTotal = items.reduce((sum, item) => sum + getPartsLineTotal(item), 0);
  const grandTotal = laborTotal + partsTotal;
  const vat = Number((grandTotal * 0.12).toFixed(2));
  const totalWithVat = Number((grandTotal + vat).toFixed(2));
  return { laborTotal, partsTotal, grandTotal, vat, totalWithVat };
}

function splitParts(text) {
  const raw = String(text || '').trim();
  if (!raw) return [];
  const values = raw.split(/[,;]+/).map(v => v.trim()).filter(Boolean);
  return values.length ? values : [raw];
}

function buildTransactionRecord(wo, customer, vehicle, partsIndex) {
  const items = wo.service_items || [];
  const totals = computeTotals(items);
  const parts = [];
  const partPrices = [];

  items.forEach(item => {
    const names = splitParts(item.parts);
    if (!names.length && getPartsLineTotal(item) > 0) names.push('');
    const qty = Math.max(0, Number(item.parts_qty) || 0);
    const qtyLabel = qty ? ` x${qty}` : '';
    const linePrice = getPartsLineTotal(item);
    names.forEach(name => {
      if (parts.length < 50) {
        parts.push(`${name || ''}${qtyLabel}`.trim());
        partPrices.push(asMoney(linePrice));
      }
    });
  });

  const record = {
    work_order_id: wo.id,
    transaction_action: 'billing-print',
    action_by: 'system-bulk-close',
    action_by_role: 'admin',
    'Transaction date': new Date().toISOString(),
    'Branch': canonicalizeBranchName(wo.branch || ''),
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
    ...financeFieldsFromSnapshot(computeInvoiceEconomics(wo, partsIndex), {
      paymentMethod: wo.paymentMethod || wo.payment_method || '',
      paymentStatus: PAYMENT_STATUS.UNPAID,
    }),
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

function getCurrentTimeHHMM() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

function sortOldestFirst(a, b) {
  const da = new Date(a.created_at || a.time_in || 0).getTime() || 0;
  const db = new Date(b.created_at || b.time_in || 0).getTime() || 0;
  return da - db;
}

async function main() {
  const [workOrders, customers, vehicles, partsInventory] = await Promise.all([
    store.getAll('work_orders'),
    store.getAll('customers'),
    store.getAll('vehicles'),
    store.getAll('parts_inventory'),
  ]);
  const partsIndex = buildPartsCostIndex(partsInventory);
  const customerById = new Map(customers.map(c => [c.id, c]));
  const vehicleById = new Map(vehicles.map(v => [v.id, v]));

  const report = [];
  let totalClosed = 0;

  for (const branch of DEFAULT_OPERATIONAL_BRANCHES) {
    const branchActive = workOrders
      .filter(wo => canonicalizeBranchName(wo.branch) === branch && isActiveWorkOrderStatus(wo.status))
      .sort(sortOldestFirst);
    const closeCount = Math.round(branchActive.length * CLOSE_FRACTION);
    const toClose = branchActive.slice(0, closeCount);

    for (const wo of toClose) {
      const customer = customerById.get(wo.customer_id) || {};
      const vehicle = vehicleById.get(wo.vehicle_id) || {};
      const finance = financeFieldsFromSnapshot(computeInvoiceEconomics(wo, partsIndex), {
        paymentMethod: wo.paymentMethod || wo.payment_method || '',
        paymentStatus: PAYMENT_STATUS.UNPAID,
      });
      const updates = {
        status: 'closed',
        invoice_number: normalizeText(wo.invoice_number) || normalizeWorkOrderNumber(wo.work_order_number, wo.id),
        invoice_date: normalizeText(wo.invoice_date) || new Date().toISOString(),
        ...finance,
      };
      if (!normalizeText(wo.time_out)) updates.time_out = getCurrentTimeHHMM();

      if (!DRY_RUN) {
        await store.update('work_orders', wo.id, updates);
        const record = buildTransactionRecord(Object.assign({}, wo, updates), customer, vehicle, partsIndex);
        await store.create('transaction_records', record);
      }
      totalClosed += 1;
    }

    report.push({
      branch,
      activeBefore: branchActive.length,
      closed: toClose.length,
      remainingActive: branchActive.length - toClose.length,
    });
  }

  console.log(DRY_RUN ? '[DRY RUN] No changes were written.\n' : 'Changes applied.\n');
  console.table(report);
  console.log(`Total work orders closed: ${totalClosed}`);
}

main().then(() => process.exit(0)).catch((error) => {
  console.error('Bulk close failed:', error);
  process.exit(1);
});
