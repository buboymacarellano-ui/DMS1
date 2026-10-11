// Parts Manager POs become receivable once View > Proceed marks them purchased (executed is the legacy name).
const RECEIVABLE_PM_STATUSES = ['purchased', 'executed'];

function text(value) {
  return String(value == null ? '' : value).trim();
}

function numberOf(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizePoNumber(value) {
  return text(value).toUpperCase();
}

function samePoNumber(a, b) {
  const left = normalizePoNumber(a);
  return Boolean(left) && left === normalizePoNumber(b);
}

// Latest known catalog details for a part, used to fill grid columns the PO does not carry.
function catalogDefaults(data, partNumber) {
  const key = text(partNumber).toUpperCase();
  if (!key) return {};
  let latest = null;
  (data.parts_inventory || []).forEach((row) => {
    if (text(row.part_number).toUpperCase() !== key) return;
    if (!latest || text(row.created_at) > text(latest.created_at)) latest = row;
  });
  if (!latest) return {};
  return {
    sub_id: text(latest.sub_id),
    generic: text(latest.generic),
    unit: text(latest.unit),
    markup: numberOf(latest.markup),
    retail_price: numberOf(latest.retail_price),
    cost_price: numberOf(latest.cost_price),
  };
}

function gridLine(data, supplier, raw) {
  const partNumber = text(raw.part_number || raw.item_code);
  const defaults = catalogDefaults(data, partNumber);
  const cost = numberOf(raw.cost_price != null && raw.cost_price !== '' ? raw.cost_price : raw.unit_price) || defaults.cost_price || 0;
  const markup = raw.markup != null && raw.markup !== '' ? numberOf(raw.markup) : (defaults.markup || 0);
  let retail = raw.retail_price != null && raw.retail_price !== '' ? numberOf(raw.retail_price) : (defaults.retail_price || 0);
  if (!retail && cost > 0 && markup > 0) retail = Math.round((cost + cost * (markup / 100)) * 100) / 100;
  return {
    part_number: partNumber,
    part_name: text(raw.part_name || raw.description),
    sub_id: text(raw.sub_id) || defaults.sub_id || '',
    generic: text(raw.generic) || defaults.generic || '',
    supplier: text(raw.supplier) || supplier,
    unit: text(raw.unit || raw.uom) || defaults.unit || '',
    qty: numberOf(raw.qty),
    cost_price: cost,
    markup,
    retail_price: retail,
    barcode: text(raw.barcode),
    transaction_type: text(raw.transaction_type),
    initial_receipt_id: text(raw.initial_receipt_id),
  };
}

// A line stays open (still to receive) until it is actually Received; "No receive" lines can
// arrive later or be removed from the PO by the Parts Manager.
function isOpenLine(line) {
  return text(line && line.receive_status) !== 'received';
}

function lineSources(po) {
  if (Array.isArray(po.lines) && po.lines.length) return po.lines;
  if (po.part_number) return [{ part_number: po.part_number, part_name: po.part_name, qty: po.qty, supplier: po.supplier }];
  return [];
}

// Looks a PO number up in both PO systems and returns grid-ready lines only for approved POs.
function findReceivablePo(data, poNumber) {
  const number = normalizePoNumber(poNumber);
  if (!number) return { ok: false, error: 'Enter a PO number.' };

  // A PTN (transaction number) stamped on the PO is accepted as well as the PO serial.
  const pmOrders = (data.parts_purchase_orders || []).filter((row) => (
    samePoNumber(row.po_number, number) || samePoNumber(row.transaction_number, number)
  ));
  const createdOrders = (data.po_orders || []).filter((row) => samePoNumber(row.po_number, number));
  if (!pmOrders.length && !createdOrders.length) {
    const transfer = (data.parts_transfers || []).find((row) => samePoNumber(row.transaction_number, number));
    if (transfer) {
      return {
        ok: false,
        error: `${number} is a stock transfer (${text(transfer.from_branch)} to ${text(transfer.to_branch)}), not a purchase order. Transfers are received by the destination branch, so enter a PO number (PO-...) here.`,
      };
    }
    return { ok: false, error: `PO ${number} was not found.` };
  }

  const closed = pmOrders.find((row) => ['closed', 'received'].includes(text(row.status).toLowerCase()));
  if (closed) return { ok: false, error: `PO ${number} is already closed.` };

  // Purchased POs, and POs still being received (pending), can be loaded; only lines not yet received come back.
  const pmOrder = pmOrders.find((row) => {
    const status = text(row.status).toLowerCase();
    return RECEIVABLE_PM_STATUSES.includes(status) || (status === 'pending' && row.receipt_entry_by);
  });
  if (pmOrder) {
    const openLines = lineSources(pmOrder).filter(isOpenLine);
    if (!openLines.length) return { ok: false, error: `PO ${number} has no open lines left.` };
    return {
      ok: true,
      source: 'parts_purchase_orders',
      po: pmOrder,
      supplier: text(pmOrder.supplier),
      lines: openLines.map((line) => gridLine(data, text(pmOrder.supplier), line)),
    };
  }
  const awaitingPurchase = pmOrders.find((row) => text(row.status).toLowerCase() === 'approved');
  if (awaitingPurchase && !createdOrders.some((row) => text(row.status).toLowerCase() === 'approved')) {
    return { ok: false, error: `PO ${number} is approved but not purchased yet. Open it under Approved Purchase Orders, then View > Proceed to print it first.` };
  }

  const createdOrder = createdOrders.find((row) => text(row.status).toLowerCase() === 'approved');
  if (createdOrder) {
    return {
      ok: true,
      source: 'po_orders',
      po: createdOrder,
      supplier: text(createdOrder.supplier),
      lines: lineSources(createdOrder).map((line) => gridLine(data, text(createdOrder.supplier), line)),
    };
  }

  return { ok: false, error: `PO ${number} is not approved yet, so it cannot be received.` };
}

module.exports = { isOpenLine, findReceivablePo, normalizePoNumber, samePoNumber, RECEIVABLE_PM_STATUSES };
