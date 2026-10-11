function text(value) {
  return String(value == null ? '' : value).trim();
}

function timestamp(row) {
  return Date.parse(row.updated_at || row.created_at || row.transaction_date || '') || 0;
}

function findPartByBarcode(data, barcode) {
  const key = text(barcode).toUpperCase();
  if (!key) return null;
  const matches = (row) => text(row.barcode).toUpperCase() === key && text(row.part_number);
  const stock = (data.parts_inventory || [])
    .filter(matches)
    .sort((a, b) => timestamp(b) - timestamp(a))[0];
  if (stock) return stock;

  const orders = (data.parts_purchase_orders || [])
    .filter((po) => !['removed', 'cancelled', 'canceled', 'rejected'].includes(text(po.status).toLowerCase()))
    .sort((a, b) => timestamp(b) - timestamp(a));
  for (const po of orders) {
    const line = (Array.isArray(po.lines) ? po.lines : []).find(matches);
    if (line) return Object.assign({}, line, { supplier: text(line.supplier) || text(po.supplier) });
  }
  return null;
}

module.exports = { findPartByBarcode };
