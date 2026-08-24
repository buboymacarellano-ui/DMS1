const fs = require('fs').promises;
const path = require('path');
const { allocatePartsTransactionNumber } = require('./parts-transaction-number');

const APPROVED_RECEIPTS_DIR = path.join(__dirname, '..', 'Approved Parts Transactions');

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function formatMoney(value) {
  return toNumber(value).toFixed(2);
}

function sanitizeFilename(value) {
  return String(value || 'part')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'part';
}

async function ensureReceiptsDir() {
  await fs.mkdir(APPROVED_RECEIPTS_DIR, { recursive: true });
}

function buildApprovedTransactionRecord(source, resolver, data) {
  const qty = Math.max(1, toNumber(source.qty));
  const workOrderNumber = String(
    source.work_order_number || source.sold_to || source.work_order_id || ''
  ).trim();
  const sourceTxn = String(source.transaction_number || '').trim();

  return {
    transaction_date: new Date().toISOString().slice(0, 10),
    transaction_number: sourceTxn || allocatePartsTransactionNumber(data || {}),
    transaction_type: 'Sold',
    editor: String(resolver || '').trim(),
    part_number: String(source.part_number || '').trim(),
    part_name: String(source.part_name || '').trim(),
    sub_id: String(source.sub_id || '').trim(),
    generic: String(source.generic || source.notes || '').trim(),
    supplier: String(source.supplier || '').trim(),
    unit: String(source.unit || '').trim(),
    qty,
    cost_price: toNumber(source.cost_price),
    markup: toNumber(source.markup),
    retail_price: toNumber(source.retail_price),
    sold_to: workOrderNumber || 'Branch-Request',
    branch: String(source.branch || source.requesting_branch || '').trim(),
    requesting_branch: String(source.requesting_branch || source.branch || '').trim(),
    work_order_number: workOrderNumber,
    work_order_id: String(source.work_order_id || '').trim(),
    linked_request_id: String(source.id || '').trim(),
    approved_at: new Date().toISOString(),
    approved_by: String(resolver || '').trim(),
    original_transaction_type: 'Parts Request',
  };
}

function buildReceiptHtml(record, sourceRequest) {
  const approvedAt = new Date(record.approved_at || Date.now());
  const approvedLabel = approvedAt.toLocaleString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const lineTotal = toNumber(record.retail_price) * toNumber(record.qty);
  const authNumber = record.transaction_number || record.id || '-';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Approved Parts Transaction ${authNumber}</title>
  <style>
    body { font-family: Arial, sans-serif; color: #10202f; margin: 24px; }
    h1 { margin: 0 0 6px; font-size: 22px; }
    .meta { margin-bottom: 18px; color: #445; font-size: 13px; }
    .auth { font-size: 16px; font-weight: 700; color: #10202f; margin: 0 0 12px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { border: 1px solid #ccd5df; padding: 8px 10px; text-align: left; vertical-align: top; }
    th { background: #eef4fb; width: 28%; }
    .totals { margin-top: 16px; font-size: 14px; }
    .signatures { margin-top: 36px; display: grid; gap: 28px; max-width: 420px; }
    .signature-line { font-size: 14px; }
    .signature-line span { display: block; margin-bottom: 28px; border-bottom: 1px solid #10202f; }
    .actions { margin-top: 20px; }
    @media print { .actions { display: none; } body { margin: 12mm; } }
  </style>
</head>
<body>
  <h1>Approved Parts Transaction Receipt</h1>
  <p class="auth">Transaction Number (Auth): ${authNumber}</p>
  <p class="meta">
    Receipt ID: ${record.id || '-'}<br />
    Approved: ${approvedLabel}<br />
    Approved By: ${record.approved_by || record.editor || '-'}
  </p>
  <table>
    <tbody>
      <tr><th>Transaction Date</th><td>${record.transaction_date || ''}</td></tr>
      <tr><th>Transaction Number</th><td>${authNumber}</td></tr>
      <tr><th>Transaction Type</th><td>${record.transaction_type || ''}</td></tr>
      <tr><th>Original Request Type</th><td>${record.original_transaction_type || 'Parts Request'}</td></tr>
      <tr><th>Editor</th><td>${record.editor || ''}</td></tr>
      <tr><th>Part Number</th><td>${record.part_number || ''}</td></tr>
      <tr><th>Part Name</th><td>${record.part_name || ''}</td></tr>
      <tr><th>Sub-ID</th><td>${record.sub_id || ''}</td></tr>
      <tr><th>Generic</th><td>${record.generic || ''}</td></tr>
      <tr><th>Supplier</th><td>${record.supplier || ''}</td></tr>
      <tr><th>Unit</th><td>${record.unit || ''}</td></tr>
      <tr><th>Qty</th><td>${record.qty != null ? record.qty : ''}</td></tr>
      <tr><th>Cost Price</th><td>P ${formatMoney(record.cost_price)}</td></tr>
      <tr><th>Markup (%)</th><td>${record.markup != null ? record.markup : ''}</td></tr>
      <tr><th>Retail Price</th><td>P ${formatMoney(record.retail_price)}</td></tr>
      <tr><th>Line Total</th><td>P ${lineTotal.toFixed(2)}</td></tr>
      <tr><th>Sold To (WO#)</th><td>${record.sold_to || ''}</td></tr>
      <tr><th>Requesting Branch</th><td>${record.requesting_branch || ''}</td></tr>
      <tr><th>Fulfilling Branch</th><td>${record.branch || ''}</td></tr>
      <tr><th>Linked Request ID</th><td>${record.linked_request_id || ''}</td></tr>
      <tr><th>Requested By</th><td>${sourceRequest.requested_by || sourceRequest.editor || ''}</td></tr>
      <tr><th>Request Created</th><td>${sourceRequest.created_at || ''}</td></tr>
    </tbody>
  </table>
  <div class="signatures">
    <div class="signature-line">Recieved By:<span></span></div>
    <div class="signature-line">Deliver By:<span></span></div>
  </div>
  <div class="actions">
    <button type="button" onclick="window.print()">Print Receipt</button>
  </div>
</body>
</html>`;
}

async function saveApprovedReceipt(record, sourceRequest) {
  await ensureReceiptsDir();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const authPart = sanitizeFilename(record.transaction_number || record.id);
  const filename = `APT-${sanitizeFilename(record.part_number)}-${authPart}-${stamp}.html`;
  const filepath = path.join(APPROVED_RECEIPTS_DIR, filename);
  const html = buildReceiptHtml(record, sourceRequest);
  await fs.writeFile(filepath, html, 'utf8');
  return {
    filename,
    filepath,
    receiptUrl: `/parts-manager/approved-receipts/${encodeURIComponent(filename)}`,
  };
}

module.exports = {
  APPROVED_RECEIPTS_DIR,
  buildApprovedTransactionRecord,
  buildReceiptHtml,
  saveApprovedReceipt,
  ensureReceiptsDir,
};
