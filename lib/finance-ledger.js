const { normalizePartNumberKey } = require('./parts-inventory-controller');

const VAT_RATE = 0.12;
const PAYMENT_METHODS = ['Cash', 'GCash', 'Maya', 'Credit Card', 'Bank Transfer'];
const PAYMENT_STATUS = {
  PAID: 'Paid',
  PARTIAL: 'Partial',
  UNPAID: 'Unpaid/Account Receivable',
};
const ROLE_FINANCE_MANAGER = 'finance_manager';

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function roundMoney(value) {
  return Number(toNumber(value).toFixed(2));
}

function todayKey(date = new Date()) {
  const safe = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  const tz = new Date(safe.getTime() - (safe.getTimezoneOffset() * 60000));
  return tz.toISOString().slice(0, 10);
}

function recordDateKey(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return todayKey(parsed);
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  return '';
}

function normalizePaymentMethod(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const match = PAYMENT_METHODS.find((method) => method.toLowerCase() === raw.toLowerCase());
  return match || '';
}

function normalizePaymentStatus(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  if (raw === 'paid' || raw === 'collected' || raw === 'settled') return PAYMENT_STATUS.PAID;
  if (raw === 'partial' || raw === 'partially paid') return PAYMENT_STATUS.PARTIAL;
  if (raw.includes('unpaid') || raw.includes('receivable') || raw === 'open' || raw === 'owing') {
    return PAYMENT_STATUS.UNPAID;
  }
  return '';
}

function buildPartsCostIndex(partsInventory) {
  const index = new Map();
  (partsInventory || []).forEach((row) => {
    const key = normalizePartNumberKey(row && row.part_number);
    if (!key) return;
    const cost = toNumber(row.cost_price);
    if (cost > 0) index.set(key, cost);
  });
  return index;
}

function computeInvoiceEconomics(workOrder, partsIndex) {
  const items = Array.isArray(workOrder && workOrder.service_items) ? workOrder.service_items : [];
  let laborCost = 0;
  let partsSellingPrice = 0;
  let partsCostPrice = 0;

  items.forEach((item) => {
    const serviceQty = Math.max(1, toNumber(item.service_qty) || 1);
    laborCost += toNumber(item.labor_price) * serviceQty;

    const partsQty = Math.max(0, toNumber(item.parts_qty));
    const selling = toNumber(item.parts_price);
    partsSellingPrice += partsQty > 0 ? partsQty * selling : selling;

    const lookupCost = partsIndex ? partsIndex.get(normalizePartNumberKey(item.part_number)) : 0;
    const unitCost = toNumber(item.cost_price) || toNumber(item.parts_cost_price) || toNumber(lookupCost);
    partsCostPrice += partsQty > 0 ? partsQty * unitCost : unitCost;
  });

  laborCost = roundMoney(workOrder && workOrder.laborCost != null && workOrder.laborCost !== ''
    ? workOrder.laborCost
    : laborCost);
  partsSellingPrice = roundMoney(workOrder && workOrder.partsSellingPrice != null && workOrder.partsSellingPrice !== ''
    ? workOrder.partsSellingPrice
    : partsSellingPrice);
  partsCostPrice = roundMoney(workOrder && workOrder.partsCostPrice != null && workOrder.partsCostPrice !== ''
    ? workOrder.partsCostPrice
    : partsCostPrice);

  const subtotal = roundMoney(laborCost + partsSellingPrice);
  const taxAmount = roundMoney(workOrder && workOrder.taxAmount != null && workOrder.taxAmount !== ''
    ? workOrder.taxAmount
    : subtotal * VAT_RATE);
  const grandTotal = roundMoney(subtotal + taxAmount);

  return {
    laborCost,
    partsSellingPrice,
    partsCostPrice,
    taxAmount,
    subtotal,
    grandTotal,
  };
}

function isClosedInvoice(workOrder) {
  const status = String((workOrder && workOrder.status) || '').trim().toLowerCase();
  return status === 'closed' || Boolean(workOrder && workOrder.invoice_number);
}

function resolvePaymentStatus(workOrder, economics) {
  const explicit = normalizePaymentStatus(workOrder && (workOrder.paymentStatus || workOrder.payment_status));
  if (explicit) return explicit;
  if (!isClosedInvoice(workOrder) || economics.grandTotal <= 0) return '';
  if (normalizePaymentMethod(workOrder && (workOrder.paymentMethod || workOrder.payment_method))) {
    return PAYMENT_STATUS.PAID;
  }
  // Newly billed jobs without a collected tender stay on the receivables ledger.
  if (workOrder && workOrder.invoice_date && !workOrder.paid_at && !workOrder.paidAt) {
    const invoiceDay = recordDateKey(workOrder.invoice_date);
    if (invoiceDay && invoiceDay === todayKey()) return PAYMENT_STATUS.UNPAID;
  }
  return PAYMENT_STATUS.PAID;
}

function balanceDueFor(status, grandTotal, recordedBalance) {
  if (status === PAYMENT_STATUS.PAID) return 0;
  if (recordedBalance != null && recordedBalance !== '') return roundMoney(recordedBalance);
  if (status === PAYMENT_STATUS.PARTIAL) return roundMoney(grandTotal);
  return roundMoney(grandTotal);
}

function plateOf(workOrder, vehicle) {
  return String(
    (workOrder && (workOrder.plate_number || workOrder.license_plate))
    || (vehicle && vehicle.license_plate)
    || ''
  ).trim();
}

function customerNameOf(workOrder, customer) {
  return String(
    (workOrder && workOrder.customer_name)
    || (customer && customer.name)
    || ''
  ).trim();
}

function buildFinanceInvoice(workOrder, extras = {}) {
  const economics = extras.economics || computeInvoiceEconomics(workOrder, extras.partsIndex);
  const paymentStatus = resolvePaymentStatus(workOrder, economics);
  if (!paymentStatus) return null;

  const paymentMethod = normalizePaymentMethod(workOrder && (workOrder.paymentMethod || workOrder.payment_method));
  const invoiceDate = recordDateKey(
    workOrder.invoice_date || workOrder.paidAt || workOrder.paid_at || workOrder.updated_at || workOrder.created_at
  );
  const grandTotal = economics.grandTotal;
  const balanceDue = balanceDueFor(paymentStatus, grandTotal, workOrder.balanceDue != null ? workOrder.balanceDue : workOrder.balance_due);
  const collected = paymentStatus === PAYMENT_STATUS.PAID
    ? grandTotal
    : roundMoney(Math.max(0, grandTotal - balanceDue));

  return {
    id: workOrder.id,
    work_order_id: workOrder.id,
    work_order_number: workOrder.work_order_number || '',
    invoice_number: workOrder.invoice_number || workOrder.work_order_number || workOrder.id,
    invoice_date: invoiceDate,
    branch: workOrder.branch || '',
    customerName: customerNameOf(workOrder, extras.customer),
    plateNumber: plateOf(workOrder, extras.vehicle),
    technician: workOrder.technician || '',
    paymentMethod: paymentMethod || (paymentStatus === PAYMENT_STATUS.PAID ? 'Cash' : ''),
    paymentStatus,
    partsCostPrice: economics.partsCostPrice,
    partsSellingPrice: economics.partsSellingPrice,
    laborCost: economics.laborCost,
    taxAmount: economics.taxAmount,
    grandTotal,
    collected,
    balanceDue,
    paidAt: workOrder.paidAt || workOrder.paid_at || '',
  };
}

function financeFieldsFromSnapshot(snapshot, extras = {}) {
  const economics = snapshot || {};
  return {
    paymentMethod: extras.paymentMethod || '',
    partsCostPrice: economics.partsCostPrice || 0,
    partsSellingPrice: economics.partsSellingPrice || 0,
    laborCost: economics.laborCost || 0,
    taxAmount: economics.taxAmount || 0,
    paymentStatus: extras.paymentStatus || PAYMENT_STATUS.UNPAID,
    balanceDue: extras.balanceDue != null ? extras.balanceDue : economics.grandTotal || 0,
  };
}

function emptyMethodBucket() {
  return PAYMENT_METHODS.reduce((acc, method) => {
    acc[method] = { paymentMethod: method, count: 0, gross: 0, partsCostPrice: 0, laborCost: 0, taxAmount: 0, netProfit: 0 };
    return acc;
  }, {});
}

function addToBucket(bucket, invoice, amount) {
  bucket.count += 1;
  bucket.gross = roundMoney(bucket.gross + amount);
  bucket.partsCostPrice = roundMoney(bucket.partsCostPrice + invoice.partsCostPrice);
  bucket.laborCost = roundMoney(bucket.laborCost + invoice.laborCost);
  bucket.taxAmount = roundMoney(bucket.taxAmount + invoice.taxAmount);
  bucket.netProfit = roundMoney(bucket.gross - bucket.partsCostPrice - bucket.laborCost);
}

function collectionDateKey(invoice) {
  if (!invoice) return '';
  if (invoice.paymentStatus === PAYMENT_STATUS.PAID || invoice.paymentStatus === PAYMENT_STATUS.PARTIAL) {
    return recordDateKey(invoice.paidAt) || invoice.invoice_date || '';
  }
  return '';
}

function buildFinanceDashboard(data, reportingDate) {
  const dateKey = recordDateKey(reportingDate) || todayKey();
  const workOrders = Array.isArray(data && data.work_orders) ? data.work_orders : [];
  const customers = Array.isArray(data && data.customers) ? data.customers : [];
  const vehicles = Array.isArray(data && data.vehicles) ? data.vehicles : [];
  const partsIndex = buildPartsCostIndex(data && data.parts_inventory);
  const customerById = new Map(customers.map((row) => [row.id, row]));
  const vehicleById = new Map(vehicles.map((row) => [row.id, row]));

  const invoices = workOrders
    .map((wo) => buildFinanceInvoice(wo, {
      partsIndex,
      customer: customerById.get(wo.customer_id),
      vehicle: vehicleById.get(wo.vehicle_id),
    }))
    .filter(Boolean);

  let grossRevenue = 0;
  let partsCostPaid = 0;
  let laborPaid = 0;
  let outstandingReceivables = 0;
  const methodBuckets = emptyMethodBucket();
  const dailyRows = [];
  const receivables = [];

  invoices.forEach((invoice) => {
    if (invoice.paymentStatus === PAYMENT_STATUS.PAID || invoice.paymentStatus === PAYMENT_STATUS.PARTIAL) {
      grossRevenue += invoice.collected;
      if (invoice.paymentStatus === PAYMENT_STATUS.PAID) {
        partsCostPaid += invoice.partsCostPrice;
        laborPaid += invoice.laborCost;
      }
    }
    if (invoice.balanceDue > 0 && (invoice.paymentStatus === PAYMENT_STATUS.UNPAID || invoice.paymentStatus === PAYMENT_STATUS.PARTIAL)) {
      outstandingReceivables += invoice.balanceDue;
      receivables.push(invoice);
    }
    const collectedOn = collectionDateKey(invoice);
    if (invoice.invoice_date === dateKey || collectedOn === dateKey) {
      dailyRows.push(invoice);
    }
    if (collectedOn === dateKey && invoice.collected > 0) {
      const method = invoice.paymentMethod || 'Cash';
      if (!methodBuckets[method]) {
        methodBuckets[method] = {
          paymentMethod: method,
          count: 0,
          gross: 0,
          partsCostPrice: 0,
          laborCost: 0,
          taxAmount: 0,
          netProfit: 0,
        };
      }
      addToBucket(methodBuckets[method], invoice, invoice.collected);
    }
  });

  const paymentMatrix = Object.values(methodBuckets)
    .filter((row) => row.count > 0 || PAYMENT_METHODS.includes(row.paymentMethod))
    .sort((a, b) => String(a.paymentMethod).localeCompare(String(b.paymentMethod)));

  receivables.sort((a, b) => String(b.invoice_date).localeCompare(String(a.invoice_date)));

  return {
    reportingDate: dateKey,
    paymentMethods: PAYMENT_METHODS,
    metrics: {
      grossRevenue: roundMoney(grossRevenue),
      netProfit: roundMoney(grossRevenue - partsCostPaid - laborPaid),
      outstandingReceivables: roundMoney(outstandingReceivables),
      invoiceCount: invoices.length,
      paidCount: invoices.filter((row) => row.paymentStatus === PAYMENT_STATUS.PAID).length,
      receivableCount: receivables.length,
    },
    paymentMatrix,
    dailyRows: dailyRows.sort((a, b) => String(b.invoice_number).localeCompare(String(a.invoice_number))),
    receivables,
    invoices,
  };
}

function buildEodReport(data, reportingDate) {
  const dashboard = buildFinanceDashboard(data, reportingDate);
  const cashDrawer = PAYMENT_METHODS.map((method) => {
    const row = dashboard.paymentMatrix.find((entry) => entry.paymentMethod === method) || {
      paymentMethod: method,
      count: 0,
      gross: 0,
      partsCostPrice: 0,
      laborCost: 0,
      taxAmount: 0,
      netProfit: 0,
    };
    return row;
  });
  const totals = cashDrawer.reduce((acc, row) => {
    acc.count += row.count;
    acc.gross = roundMoney(acc.gross + row.gross);
    acc.partsCostPrice = roundMoney(acc.partsCostPrice + row.partsCostPrice);
    acc.laborCost = roundMoney(acc.laborCost + row.laborCost);
    acc.taxAmount = roundMoney(acc.taxAmount + row.taxAmount);
    acc.netProfit = roundMoney(acc.gross - acc.partsCostPrice - acc.laborCost);
    return acc;
  }, { count: 0, gross: 0, partsCostPrice: 0, laborCost: 0, taxAmount: 0, netProfit: 0 });

  return {
    reportingDate: dashboard.reportingDate,
    generatedAt: new Date().toISOString(),
    cashDrawer,
    totals,
    receivables: dashboard.receivables.filter((row) => row.invoice_date === dashboard.reportingDate),
    metrics: dashboard.metrics,
  };
}

function markInvoicePaid(data, workOrderId, paymentMethod) {
  if (!data || !Array.isArray(data.work_orders)) {
    return { ok: false, error: 'Work order ledger is unavailable.' };
  }
  const idx = data.work_orders.findIndex((row) => String(row.id) === String(workOrderId));
  if (idx === -1) return { ok: false, error: 'Invoice not found.' };

  const method = normalizePaymentMethod(paymentMethod) || 'Cash';
  const stamp = new Date().toISOString();
  const partsIndex = buildPartsCostIndex(data.parts_inventory);
  const economics = computeInvoiceEconomics(data.work_orders[idx], partsIndex);

  data.work_orders[idx] = Object.assign({}, data.work_orders[idx], financeFieldsFromSnapshot(economics, {
    paymentMethod: method,
    paymentStatus: PAYMENT_STATUS.PAID,
    balanceDue: 0,
  }), {
    paidAt: stamp,
    paid_at: stamp,
    paymentMethod: method,
    payment_method: method,
    paymentStatus: PAYMENT_STATUS.PAID,
    payment_status: PAYMENT_STATUS.PAID,
    balanceDue: 0,
  });

  if (Array.isArray(data.transaction_records)) {
    data.transaction_records.forEach((row) => {
      if (String(row.work_order_id) !== String(workOrderId)) return;
      row.paymentMethod = method;
      row.paymentStatus = PAYMENT_STATUS.PAID;
      row.partsCostPrice = economics.partsCostPrice;
      row.partsSellingPrice = economics.partsSellingPrice;
      row.laborCost = economics.laborCost;
      row.taxAmount = economics.taxAmount;
      row.paidAt = stamp;
    });
  }

  const invoice = buildFinanceInvoice(data.work_orders[idx], { economics });
  return { ok: true, invoice };
}

function isFinanceManagerRole(role) {
  const normalized = String(role || '').trim().toLowerCase();
  return normalized === ROLE_FINANCE_MANAGER
    || normalized === 'fm'
    || normalized === 'accounting';
}

module.exports = {
  VAT_RATE,
  PAYMENT_METHODS,
  PAYMENT_STATUS,
  ROLE_FINANCE_MANAGER,
  todayKey,
  computeInvoiceEconomics,
  financeFieldsFromSnapshot,
  buildFinanceInvoice,
  buildFinanceDashboard,
  buildEodReport,
  markInvoicePaid,
  isFinanceManagerRole,
  buildPartsCostIndex,
};
