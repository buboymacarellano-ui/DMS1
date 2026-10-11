const { displayPartsTransactionType } = require('./parts-request');

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function money(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(2) : '0.00';
}

function documentShell(title, serial, stampLabel, bodyHtml, extraActionsHtml, signaturesHtml, autoPrint) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(title)} ${escapeHtml(serial)}</title>
  <link rel="stylesheet" href="/fonts/inter.css">
  <style>
    body { font-family: "Inter", "Segoe UI", Roboto, Arial, sans-serif; color: #10202f; margin: 24px; }
    h1 { margin: 0 0 4px; font-size: 22px; }
    .serial { font-size: 16px; font-weight: 700; margin: 0 0 8px; }
    .meta { margin-bottom: 16px; color: #445; font-size: 13px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { border: 1px solid #ccd5df; padding: 8px 10px; text-align: left; vertical-align: top; }
    th { background: #eef4fb; }
    .signatures { margin-top: 36px; display: grid; grid-template-columns: 1fr 1fr; gap: 28px; }
    .signature-line span { display: block; margin-top: 28px; border-bottom: 1px solid #10202f; }
    .executable-note { margin-top: 24px; padding: 8px 12px; border: 2px solid #1e7a3c; color: #1e7a3c; font-weight: 700; text-align: center; }
    .actions { margin-top: 20px; }
    @media print { .actions { display: none; } body { margin: 12mm; } }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <p class="serial">Serial: ${escapeHtml(serial || '—')}</p>
  <p class="meta">${escapeHtml(stampLabel || '')}</p>
  ${bodyHtml}
  ${signaturesHtml || `<div class="signatures">
    <div class="signature-line">Prepared / Issued By:<span></span></div>
    <div class="signature-line">Received By:<span></span></div>
  </div>`}
  <div class="actions">
    <button type="button" onclick="window.print()">Print</button>
    ${extraActionsHtml || ''}
  </div>
  ${autoPrint ? '<script>window.addEventListener("load", function () { window.print(); });</script>' : ''}
</body>
</html>`;
}

function linesFromRecord(record) {
  if (Array.isArray(record && record.lines) && record.lines.length) return record.lines;
  return [{
    part_number: record.part_number,
    part_name: record.part_name,
    sub_id: record.sub_id,
    qty: record.qty,
    unit: record.unit,
    cost_price: record.cost_price,
    retail_price: record.retail_price,
    supplier: record.supplier,
  }];
}

function lineTable(lines) {
  const rows = lines.map((line, index) => `
    <tr>
      <td>${index + 1}</td>
      <td>${escapeHtml(line.part_number || '')}</td>
      <td>${escapeHtml(line.part_name || '')}</td>
      <td>${escapeHtml(line.sub_id || '')}</td>
      <td>${escapeHtml(line.qty != null ? line.qty : '')}</td>
      <td>${escapeHtml(line.unit || '')}</td>
    </tr>`).join('');
  return `<table>
    <thead>
      <tr><th>#</th><th>Part Number</th><th>Part Name</th><th>Sub-ID</th><th>Qty</th><th>Unit</th></tr>
    </thead>
    <tbody>${rows || '<tr><td colspan="6">No lines.</td></tr>'}</tbody>
  </table>`;
}

function buildPackingListHtml(record) {
  const serial = record.packing_list_number || record.serial || '';
  const stamp = record.stamped_label || record.stamped_at || record.created_at || '';
  const body = `
    <p class="meta">
      Transaction Number: ${escapeHtml(record.transaction_number || '—')}<br />
      From: ${escapeHtml(record.from_branch || record.present_location || '—')}<br />
      To: ${escapeHtml(record.to_branch || record.requesting_branch || '—')}<br />
      Status: ${escapeHtml(record.status || '')}<br />
      Editor: ${escapeHtml(record.editor || record.created_by || '')}
    </p>
    ${lineTable(linesFromRecord(record))}`;
  return documentShell('Packing List', serial, stamp, body);
}

function buildTransmittalHtml(record) {
  const serial = record.transmittal_number || record.serial || '';
  const stamp = record.stamped_label || record.stamped_at || record.created_at || '';
  const body = `
    <p class="meta">
      Transaction Number: ${escapeHtml(record.transaction_number || '—')}<br />
      Packing List: ${escapeHtml(record.packing_list_number || '—')}<br />
      From: ${escapeHtml(record.from_branch || '—')}<br />
      To: ${escapeHtml(record.to_branch || '—')}<br />
      Status: ${escapeHtml(record.status || '')}<br />
      Issued By: ${escapeHtml(record.editor || record.created_by || '')}
    </p>
    ${lineTable(linesFromRecord(record))}`;
  const transmitAction = `
    <form method="post" action="/parts-manager/transfers/${escapeHtml(record.id)}/transmit" style="display:inline-block;margin-left:8px;">
      <button type="submit">Transmit</button>
    </form>`;
  return documentShell('Transmittal List', serial, stamp, body, transmitAction);
}

function buildPurchaseOrderHtml(record, options) {
  const serial = record.po_number || record.serial || '';
  const stamp = record.stamped_label || record.stamped_at || record.created_at || '';
  const lines = linesFromRecord(record);
  const total = lines.reduce((sum, line) => sum + Number(line.qty || 0) * Number(line.cost_price || 0), 0);
  const body = `
    <p class="meta">
      Transaction Number: ${escapeHtml(record.transaction_number || '—')}<br />
      Supplier: ${escapeHtml(record.supplier || '—')}<br />
      Deliver To: ${escapeHtml(record.branch || record.present_location || 'Warehouse 1')}<br />
      Status: ${escapeHtml(record.status || '')}<br />
      Created By: ${escapeHtml(record.created_by || record.editor || '')}<br />
      Notes: ${escapeHtml(record.notes || '')}
    </p>
    ${lineTable(lines)}
    <p class="meta">Estimated cost total: P ${money(total)}</p>`;
  const opts = options || {};
  const signatures = `
  <p class="executable-note">EXECUTABLE PURCHASE ORDER &mdash; approved and ready to be sent to the supplier.</p>
  <div class="signatures">
    <div class="signature-line">Approving Signatory 1 (Signature over Printed Name / Date):<span></span></div>
    <div class="signature-line">Approving Signatory 2 (Signature over Printed Name / Date):<span></span></div>
  </div>`;
  return documentShell('Purchase Order', serial, stamp, body, opts.actionsHtml || '', signatures, opts.autoPrint);
}

function formatWhen(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('en-PH', { timeZone: 'Asia/Manila', year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

const LINE_STATUS_LABELS = { received: 'Received', not_received: 'No receive' };
const PO_STATUS_LABELS = {
  approved: 'Approved', purchased: 'Purchased', executed: 'Purchased', pending: 'Pending Receipt',
  received: 'Received', closed: 'Closed PO', removed: 'Removed', rejected: 'Rejected',
};

// Read-only page with every recorded detail of a PO: approval, purchase, retrieval log, closing and each line outcome.
function buildPurchaseOrderDetailsHtml(record, options) {
  const opts = options || {};
  const serial = record.po_number || record.serial || '';
  const lines = linesFromRecord(record);
  const status = String(record.status || '').trim().toLowerCase();
  const total = lines.reduce((sum, line) => sum + Number(line.qty || 0) * Number(line.cost_price || 0), 0);
  const lineRows = lines.map((line, index) => `
    <tr>
      <td>${index + 1}</td>
      <td>${escapeHtml(line.part_number || '')}</td>
      <td>${escapeHtml(line.part_name || '')}</td>
      <td>${escapeHtml(line.sub_id || '')}</td>
      <td>${escapeHtml(line.supplier || record.supplier || '')}</td>
      <td>${escapeHtml(displayPartsTransactionType(line.transaction_type))}</td>
      <td>${escapeHtml(line.initial_receipt_id || '')}</td>
      <td>${escapeHtml(line.receiving_receipt_number || '')}</td>
      <td>${escapeHtml(line.qty != null ? line.qty : '')} ${escapeHtml(line.unit || '')}</td>
      <td>P ${money(line.cost_price)}</td>
      <td>P ${money(line.retail_price)}</td>
      <td><strong>${escapeHtml(LINE_STATUS_LABELS[line.receive_status] || (line.receive_status ? line.receive_status : 'Open'))}</strong></td>
      <td>${escapeHtml(line.decided_by || '')}<br />${escapeHtml(line.decided_at ? formatWhen(line.decided_at) : '')}</td>
    </tr>`).join('');
  const logRows = (Array.isArray(record.retrieval_log) ? record.retrieval_log : []).map((entry) => `
    <tr>
      <td>${escapeHtml(formatWhen(entry.retrieved_at))}</td>
      <td>${escapeHtml(formatWhen(entry.saved_at))}</td>
      <td>${escapeHtml(entry.by || '')}</td>
      <td>${escapeHtml(entry.received != null ? entry.received : '')}</td>
      <td>${escapeHtml(entry.not_received != null ? entry.not_received : '')}</td>
    </tr>`).join('');
  const body = `
    <p class="meta">
      <strong>Status: ${escapeHtml(PO_STATUS_LABELS[status] || record.status || '—')}</strong><br />
      Transaction Number (PTN): ${escapeHtml(record.transaction_number || '—')}<br />
      Supplier: ${escapeHtml(record.supplier || '—')}<br />
      Deliver To: ${escapeHtml(record.branch || record.present_location || 'Warehouse 1')}<br />
      Created By: ${escapeHtml(record.created_by || record.editor || '—')} (${escapeHtml(formatWhen(record.created_at))})<br />
      Approved By: ${escapeHtml(record.approved_by || '—')} (${escapeHtml(formatWhen(record.approved_at))})<br />
      Purchased: ${escapeHtml(record.purchased_by || record.executed_by || '—')} (${escapeHtml(formatWhen(record.purchased_at || record.executed_at))})<br />
      Last retrieved in receiving grid: ${escapeHtml(record.retrieved_by || '—')} (${escapeHtml(formatWhen(record.retrieved_at))})<br />
      Closed: ${escapeHtml(record.closed_by || record.received_by || '—')} (${escapeHtml(formatWhen(record.closed_at || record.received_at))})<br />
      Notes: ${escapeHtml(record.notes || '')}
    </p>
    <table>
      <thead>
        <tr><th>#</th><th>Part Number</th><th>Part Name</th><th>Sub-ID</th><th>Supplier</th><th>Type</th><th>Initial Receipt ID</th><th>Receipt #</th><th>Qty</th><th>Cost</th><th>Retail</th><th>Result</th><th>Decided</th></tr>
      </thead>
      <tbody>${lineRows || '<tr><td colspan="13">No lines.</td></tr>'}</tbody>
    </table>
    <p class="meta">Estimated cost total: P ${money(total)}</p>
    <h3>Retrieval / receiving history</h3>
    <table>
      <thead><tr><th>PO retrieved</th><th>Saved</th><th>By</th><th>Lines received</th><th>Lines not received</th></tr></thead>
      <tbody>${logRows || '<tr><td colspan="5">No receiving entries recorded.</td></tr>'}</tbody>
    </table>`;
  const back = `<a href="${escapeHtml(opts.backHref || '/parts-manager?panel=approvals')}" style="margin-left:8px;">Back</a>`;
  return documentShell('Purchase Order Details', serial, record.stamped_label || '', body, back, '<span></span>');
}

module.exports = {
  buildPurchaseOrderDetailsHtml,
  buildPackingListHtml,
  buildTransmittalHtml,
  buildPurchaseOrderHtml,
};
