const po = require('./po-create');

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

function startOfMonth(dateKey) {
  const key = recordDateKey(dateKey) || todayKey();
  return key.slice(0, 8) + '01';
}

function endOfMonth(dateKey) {
  const key = recordDateKey(dateKey) || todayKey();
  const d = new Date(key + 'T00:00:00.000Z');
  if (Number.isNaN(d.getTime())) return key;
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  return end.toISOString().slice(0, 10);
}

function clampDateRange(startDate, endDate) {
  const start = recordDateKey(startDate);
  const end = recordDateKey(endDate);
  if (!start && !end) {
    const today = todayKey();
    return { start: startOfMonth(today), end: endOfMonth(today) };
  }
  if (start && !end) return { start, end: start };
  if (!start && end) return { start: end, end };
  if (start > end) return { start: end, end: start };
  return { start, end };
}

function withinRange(value, start, end) {
  const key = recordDateKey(value);
  if (!key) return false;
  return key >= start && key <= end;
}

function poDocDate(order) {
  return recordDateKey(order && (order.po_date || order.created_at || order.updated_at));
}

function computeOrderTotals(order) {
  const storedSubtotal = order && (order.subtotal != null ? order.subtotal : order.po_subtotal);
  const storedTax = order && (order.tax_total != null ? order.tax_total : order.po_tax);
  const storedGrand = order && (order.grand_total != null ? order.grand_total : order.po_grand_total);

  if (storedSubtotal != null && storedTax != null && storedGrand != null) {
    return {
      subtotal: roundMoney(storedSubtotal),
      tax_total: roundMoney(storedTax),
      grand_total: roundMoney(storedGrand),
    };
  }

  const lines = Array.isArray(order && order.lines) ? order.lines : [];
  const totals = po.computeTotals(lines);
  return {
    subtotal: roundMoney(totals.subtotal),
    tax_total: roundMoney(totals.tax_total),
    grand_total: roundMoney(totals.grand_total),
  };
}

function buildPurchasesReport(data, options = {}) {
  const { start, end } = clampDateRange(options.startDate, options.endDate);
  const orders = Array.isArray(data && data.po_orders) ? data.po_orders : [];

  let purchaseCount = 0;
  let purchasesExVat = 0;
  let inputVat = 0;
  let purchasesInclVat = 0;

  const detailed = [];

  orders.forEach((order) => {
    const docDate = poDocDate(order);
    if (!withinRange(docDate, start, end)) return;

    const totals = computeOrderTotals(order);
    purchaseCount += 1;
    purchasesExVat = roundMoney(purchasesExVat + totals.subtotal);
    inputVat = roundMoney(inputVat + totals.tax_total);
    purchasesInclVat = roundMoney(purchasesInclVat + totals.grand_total);

    detailed.push({
      id: order.id,
      po_number: order.po_number || order.id,
      po_date: docDate,
      supplier: String(order.supplier || '').trim(),
      department: String(order.department || '').trim(),
      requestor: String(order.requestor || order.created_by || '').trim(),
      status: order.status || '',
      currency: order.currency || 'PHP',
      reference_no: order.reference_no || '',
      subtotal: totals.subtotal,
      tax_total: totals.tax_total,
      grand_total: totals.grand_total,
      lines: Array.isArray(order.lines) ? order.lines.length : 0,
      delivery_date: order.delivery_date || '',
      payment_terms: order.payment_terms || '',
      remarks: order.remarks || '',
      created_by: order.created_by || '',
      created_at: order.created_at || '',
      submitted_at: order.submitted_at || '',
      approved_at: order.approved_at || '',
    });
  });

  detailed.sort((a, b) => String(b.po_date).localeCompare(String(a.po_date))
    || String(b.po_number).localeCompare(String(a.po_number)));

  return {
    startDate: start,
    endDate: end,
    currency: 'PHP',
    totals: {
      purchaseCount,
      purchasesExVat,
      inputVat,
      purchasesInclVat,
    },
    detailed,
  };
}

module.exports = {
  buildPurchasesReport,
};

