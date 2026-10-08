// Builds the "Sales Report" database table shown on the Service Receptionist
// dashboard: one row per CLOSED work order (i.e. a work order that has been
// invoiced/converted into a sale), with comprehensive columns covering the
// customer, vehicle, staff, services, parts, and finance details.
const { canonicalizeBranchName } = require('./branches');

const VAT_RATE = 0.12;

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function money(value) {
  return Number(toNumber(value).toFixed(2));
}

function text(value) {
  return String(value == null ? '' : value).trim();
}

function isClosedWorkOrder(wo) {
  return text(wo && wo.status).toLowerCase() === 'closed';
}

function isInvoicedSale(wo) {
  return isClosedWorkOrder(wo) || Boolean(wo && wo.invoice_number);
}

function formatDateKey(value) {
  const raw = text(value);
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function serviceLabel(item) {
  return text(item.reason) || text(item.service_type) || text(item.description) || '';
}

function servicesRenderedList(items) {
  return items
    .map((item) => {
      const label = serviceLabel(item);
      if (!label) return '';
      const qty = Math.max(1, toNumber(item.service_qty) || 1);
      return qty > 1 ? `${label} x${qty}` : label;
    })
    .filter(Boolean);
}

function partsUsedList(items) {
  const names = [];
  items.forEach((item) => {
    const raw = text(item.parts);
    if (!raw) return;
    const qty = Math.max(0, toNumber(item.parts_qty));
    const qtyLabel = qty ? ` x${qty}` : '';
    raw.split(/[,;]+/).map((v) => v.trim()).filter(Boolean).forEach((name) => {
      names.push(`${name}${qtyLabel}`.trim());
    });
  });
  return names;
}

function computeTotals(items) {
  const laborTotal = items.reduce((sum, item) => (
    sum + (toNumber(item.labor_price) * Math.max(1, toNumber(item.service_qty) || 1))
  ), 0);
  const partsTotal = items.reduce((sum, item) => {
    const qty = Math.max(0, toNumber(item.parts_qty));
    const unitPrice = toNumber(item.parts_price);
    return sum + (qty > 0 ? qty * unitPrice : unitPrice);
  }, 0);
  const subtotal = laborTotal + partsTotal;
  const vat = subtotal * VAT_RATE;
  return {
    laborTotal: money(laborTotal),
    partsTotal: money(partsTotal),
    subtotal: money(subtotal),
    vat: money(vat),
    grandTotal: money(subtotal + vat),
  };
}

function buildSalesReportRow(wo, customer = {}, vehicle = {}) {
  const items = Array.isArray(wo.service_items) ? wo.service_items : [];
  const totals = computeTotals(items);
  const services = servicesRenderedList(items);
  const parts = partsUsedList(items);
  const invoiceDate = formatDateKey(wo.invoice_date || wo.updated_at || wo.created_at);

  return {
    id: wo.id,
    invoice_number: text(wo.invoice_number) || text(wo.work_order_number) || text(wo.id),
    invoice_date: invoiceDate,
    branch: canonicalizeBranchName(wo.branch || ''),
    work_order_number: text(wo.work_order_number),
    customer_name: text(wo.customer_name) || text(customer.name),
    telephone_number: text(wo.telephone_number) || text(customer.phone),
    car_brand: text(wo.car_brand) || text(vehicle.make),
    car_model: text(wo.car_model) || text(vehicle.model),
    car_year: text(wo.car_year) || text(vehicle.year),
    plate_number: text(wo.plate_number) || text(vehicle.license_plate),
    odometer: text(wo.odometer),
    service_advisor: text(wo.service_advisor),
    technician: text(wo.technician),
    date_opened: formatDateKey(wo.created_at),
    time_in: text(wo.time_in),
    time_out: text(wo.time_out),
    services_rendered: services.join('; '),
    services_count: services.length,
    parts_used: parts.join('; '),
    parts_count: parts.length,
    labor_total: totals.laborTotal,
    parts_total: totals.partsTotal,
    subtotal: totals.subtotal,
    vat: totals.vat,
    grand_total: totals.grandTotal,
    payment_method: text(wo.paymentMethod || wo.payment_method),
    payment_status: text(wo.paymentStatus || wo.payment_status) || 'Unpaid/Account Receivable',
    balance_due: wo.balanceDue != null || wo.balance_due != null
      ? money(wo.balanceDue != null ? wo.balanceDue : wo.balance_due)
      : totals.grandTotal,
  };
}

/**
 * @param {Array} workOrders - work orders already scoped (e.g. by branch).
 * @param {Array} customers - customers used to resolve names/phone numbers.
 * @param {Array} vehicles - vehicles used to resolve make/model/plate.
 * @returns {Array} sales report rows, most recently invoiced first.
 */
function buildSalesReportRows(workOrders, customers = [], vehicles = []) {
  const customersById = new Map((customers || []).map((c) => [c.id, c]));
  const vehiclesById = new Map((vehicles || []).map((v) => [v.id, v]));

  return (workOrders || [])
    .filter(isInvoicedSale)
    .map((wo) => buildSalesReportRow(
      wo,
      customersById.get(wo.customer_id) || {},
      vehiclesById.get(wo.vehicle_id) || {}
    ))
    .sort((a, b) => String(b.invoice_date).localeCompare(String(a.invoice_date))
      || String(b.invoice_number).localeCompare(String(a.invoice_number)));
}

function summarizeSalesReportRows(rows) {
  return (rows || []).reduce((acc, row) => {
    acc.count += 1;
    acc.laborTotal = money(acc.laborTotal + row.labor_total);
    acc.partsTotal = money(acc.partsTotal + row.parts_total);
    acc.grandTotal = money(acc.grandTotal + row.grand_total);
    return acc;
  }, { count: 0, laborTotal: 0, partsTotal: 0, grandTotal: 0 });
}

module.exports = {
  isInvoicedSale,
  buildSalesReportRows,
  summarizeSalesReportRows,
};
