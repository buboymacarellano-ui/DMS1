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

function documentShell(title, serial, stampLabel, bodyHtml) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(title)} ${escapeHtml(serial)}</title>
  <style>
    body { font-family: Arial, sans-serif; color: #10202f; margin: 24px; }
    h1 { margin: 0 0 4px; font-size: 22px; }
    .serial { font-size: 16px; font-weight: 700; margin: 0 0 8px; }
    .meta { margin-bottom: 16px; color: #445; font-size: 13px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { border: 1px solid #ccd5df; padding: 8px 10px; text-align: left; vertical-align: top; }
    th { background: #eef4fb; }
    .signatures { margin-top: 36px; display: grid; grid-template-columns: 1fr 1fr; gap: 28px; }
    .signature-line span { display: block; margin-top: 28px; border-bottom: 1px solid #10202f; }
    .actions { margin-top: 20px; }
    @media print { .actions { display: none; } body { margin: 12mm; } }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <p class="serial">Serial: ${escapeHtml(serial || '—')}</p>
  <p class="meta">${escapeHtml(stampLabel || '')}</p>
  ${bodyHtml}
  <div class="signatures">
    <div class="signature-line">Prepared / Issued By:<span></span></div>
    <div class="signature-line">Received By:<span></span></div>
  </div>
  <div class="actions">
    <button type="button" onclick="window.print()">Print</button>
  </div>
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
  return documentShell('Transmittal List', serial, stamp, body);
}

function buildPurchaseOrderHtml(record) {
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
  return documentShell('Purchase Order', serial, stamp, body);
}

module.exports = {
  buildPackingListHtml,
  buildTransmittalHtml,
  buildPurchaseOrderHtml,
};
