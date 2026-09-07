const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const { allocatePartsTransactionNumber } = require('./parts-transaction-number');
const { PARTS_REQUEST_TYPE } = require('./parts-request');
const { WAREHOUSE_1 } = require('./parts-location-scope');

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
  await fsp.mkdir(APPROVED_RECEIPTS_DIR, { recursive: true });
}

function buildApprovedTransactionRecord(source, resolver, data, extras) {
  const qty = Math.max(1, toNumber(source.qty));
  const workOrderNumber = String(
    source.work_order_number || source.sold_to || source.work_order_id || ''
  ).trim();
  const sourceTxn = String(source.transaction_number || '').trim();
  const extra = extras && typeof extras === 'object' ? extras : {};
  const fromBranch = String(source.from_branch || extra.from_branch || '').trim();
  const toBranch = String(source.to_branch || source.requesting_branch || extra.to_branch || '').trim();
  const isTransfer = Boolean(
    extra.linked_transfer_id
    || source.linked_transfer_id
    || extra.original_transaction_type === 'Transfer Request'
    || source.original_transaction_type === 'Transfer Request'
  );
  const requester = String(extra.editor || source.requested_by || source.editor || resolver || '').trim();
  const presentLocation = String(
    extra.present_location || (isTransfer ? fromBranch : WAREHOUSE_1)
  ).trim();

  return {
    transaction_date: new Date().toISOString().slice(0, 10),
    transaction_number: sourceTxn || allocatePartsTransactionNumber(data || {}),
    transaction_type: extra.transaction_type || (isTransfer ? 'Sold' : PARTS_REQUEST_TYPE),
    editor: isTransfer ? String(resolver || requester).trim() : requester,
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
    sold_to: workOrderNumber || extra.sold_to || 'Branch-Request',
    present_location: presentLocation,
    branch: String(extra.branch || (isTransfer ? fromBranch : presentLocation) || source.branch || '').trim(),
    requesting_branch: String(source.requesting_branch || toBranch || source.branch || '').trim(),
    from_branch: fromBranch || (isTransfer ? '' : WAREHOUSE_1),
    to_branch: toBranch,
    packing_list_number: String(source.packing_list_number || extra.packing_list_number || '').trim(),
    transmittal_number: String(source.transmittal_number || extra.transmittal_number || '').trim(),
    work_order_number: workOrderNumber,
    work_order_id: String(source.work_order_id || '').trim(),
    linked_request_id: String(extra.linked_request_id != null ? extra.linked_request_id : (source.id || '')).trim(),
    linked_transfer_id: String(source.linked_transfer_id || extra.linked_transfer_id || '').trim(),
    sent_to: String(extra.sent_to || source.sent_to || '').trim(),
    warehouse_order_id: String(extra.warehouse_order_id || source.warehouse_order_id || '').trim(),
    request_status: extra.request_status || (isTransfer ? '' : 'approved'),
    fulfillment_status: extra.fulfillment_status || (isTransfer ? 'complete' : 'in_transit'),
    approved_at: extra.approved_at || new Date().toISOString(),
    approved_by: String(resolver || '').trim(),
    original_transaction_type: extra.original_transaction_type || source.original_transaction_type || 'Parts Request',
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
      <tr><th>Present Location</th><td>${record.present_location || record.branch || ''}</td></tr>
      <tr><th>Editor (Requester)</th><td>${record.editor || ''}</td></tr>
      <tr><th>Original Request Type</th><td>${record.original_transaction_type || 'Parts Request'}</td></tr>
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

function buildConsolidatedReceiptHtml(txnNumber, items, approver) {
  const approvedAt = new Date();
  const approvedLabel = approvedAt.toLocaleString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const authNumber = txnNumber || '—';

  const itemsHtml = (items || []).map((item) => {
    const lineTotal = toNumber(item.retail_price) * toNumber(item.qty);
    return `
    <tr>
      <td>${item.part_number || ''}</td>
      <td>${item.part_name || ''}</td>
      <td>${item.sub_id || ''}</td>
      <td>${item.generic || ''}</td>
      <td>${item.supplier || ''}</td>
      <td style="text-align:right;">${item.qty != null ? item.qty : ''}</td>
      <td>${item.unit || ''}</td>
      <td style="text-align:right;">P ${formatMoney(item.cost_price)}</td>
      <td style="text-align:right;">${item.markup != null ? item.markup : ''}</td>
      <td style="text-align:right;">P ${formatMoney(item.retail_price)}</td>
      <td style="text-align:right;">P ${lineTotal.toFixed(2)}</td>
      <td>${item.sold_to || item.work_order_number || ''}</td>
    </tr>`;
  }).join('');

  const totalQty = (items || []).reduce((sum, item) => sum + toNumber(item.qty), 0);
  const totalRetail = (items || []).reduce((sum, item) => sum + (toNumber(item.retail_price) * toNumber(item.qty)), 0);

  const firstItem = items && items.length > 0 ? items[0] : {};
  const requestingBranch = String(firstItem.requesting_branch || firstItem.to_branch || '').trim();

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Approved Parts Delivery Receipt ${authNumber}</title>
  <style>
    body { font-family: Arial, sans-serif; color: #10202f; margin: 24px; }
    h1 { margin: 0 0 6px; font-size: 22px; }
    .meta { margin-bottom: 18px; color: #445; font-size: 13px; }
    .auth { font-size: 16px; font-weight: 700; color: #10202f; margin: 0 0 12px; }
    .header-row { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 16px; }
    .header-box { border: 1px solid #ccd5df; padding: 10px; }
    .header-box strong { display: block; margin-bottom: 4px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 16px; }
    th, td { border: 1px solid #ccd5df; padding: 6px 8px; text-align: left; vertical-align: top; }
    th { background: #eef4fb; font-weight: bold; }
    .totals-row { background: #f9f9f9; font-weight: bold; }
    .signatures { margin-top: 36px; display: grid; grid-template-columns: 1fr 1fr; gap: 28px; }
    .signature-line { font-size: 12px; }
    .signature-line span { display: block; margin-bottom: 28px; border-bottom: 1px solid #10202f; }
    .actions { margin-top: 20px; }
    @media print { .actions { display: none; } body { margin: 12mm; } }
  </style>
</head>
<body>
  <h1>Approved Parts Delivery Receipt</h1>
  <p class="auth">Transaction Number (Auth): ${authNumber}</p>
  <p class="meta">
    Approved: ${approvedLabel}<br />
    Approved By: ${approver || '—'}<br />
    Total Items: ${items.length}
  </p>

  <div class="header-row">
    <div class="header-box">
      <strong>Delivery To (Branch):</strong>
      ${requestingBranch || '—'}
    </div>
    <div class="header-box">
      <strong>Source:</strong>
      Warehouse 1
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Part Number</th>
        <th>Part Name</th>
        <th>Sub-ID</th>
        <th>Generic</th>
        <th>Supplier</th>
        <th>Qty</th>
        <th>Unit</th>
        <th>Cost Price</th>
        <th>Markup (%)</th>
        <th>Retail Price</th>
        <th>Line Total</th>
        <th>WO#</th>
      </tr>
    </thead>
    <tbody>
      ${itemsHtml}
      <tr class="totals-row">
        <td colspan="5" style="text-align:right;">TOTALS:</td>
        <td style="text-align:right;">${totalQty.toFixed(2)}</td>
        <td colspan="3"></td>
        <td></td>
        <td style="text-align:right;">P ${totalRetail.toFixed(2)}</td>
        <td></td>
      </tr>
    </tbody>
  </table>

  <div class="signatures">
    <div class="signature-line">Recieved By (Branch):<span></span></div>
    <div class="signature-line">Delivered By (Warehouse):<span></span></div>
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
  await fsp.writeFile(filepath, html, 'utf8');
  return {
    filename,
    filepath,
    receiptUrl: `/parts-manager/approved-receipts/${encodeURIComponent(filename)}`,
  };
}

async function saveConsolidatedReceipt(txnNumber, items, approver) {
  await ensureReceiptsDir();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const authPart = sanitizeFilename(txnNumber);
  const filename = `APT-CONSOLIDATED-${authPart}-${stamp}.html`;
  const filepath = path.join(APPROVED_RECEIPTS_DIR, filename);
  const html = buildConsolidatedReceiptHtml(txnNumber, items, approver);
  await fsp.writeFile(filepath, html, 'utf8');
  return {
    filename,
    filepath,
    receiptUrl: `/parts-manager/approved-receipts/${encodeURIComponent(filename)}`,
  };
}

function buildTransitReceiptHtml(txnNumber, items, approver) {
  const approvedAt = new Date();
  const approvedLabel = approvedAt.toLocaleString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  const itemsHtml = (items || []).map((item, idx) => {
    const lineTotal = toNumber(item.retail_price) * toNumber(item.qty);
    return `
    <tr>
      <td>${idx + 1}</td>
      <td><strong>${item.part_number || ''}</strong></td>
      <td>${item.part_name || ''}</td>
      <td style="text-align:center;">${item.qty || ''}</td>
      <td>${item.unit || ''}</td>
      <td style="text-align:right;">P ${formatMoney(item.retail_price)}</td>
      <td style="text-align:right;">P ${lineTotal.toFixed(2)}</td>
      <td>${item.work_order_number || item.sold_to || ''}</td>
    </tr>`;
  }).join('');

  const totalQty = (items || []).reduce((sum, item) => sum + toNumber(item.qty), 0);
  const totalRetail = (items || []).reduce((sum, item) => sum + (toNumber(item.retail_price) * toNumber(item.qty)), 0);

  const firstItem = items && items.length > 0 ? items[0] : {};
  const requestingBranch = String(firstItem.requesting_branch || firstItem.to_branch || firstItem.branch || '').trim();

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Transit Receipt ${txnNumber}</title>
  <style>
    * { box-sizing: border-box; }
    body { 
      font-family: Arial, sans-serif; 
      color: #10202f; 
      margin: 0;
      padding: 12mm;
      background: #fff;
    }
    .container { max-width: 210mm; margin: 0 auto; }
    .header { 
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      margin-bottom: 20px;
      border-bottom: 2px solid #10202f;
      padding-bottom: 12px;
    }
    .header-left h1 { 
      margin: 0 0 8px 0; 
      font-size: 24px; 
      font-weight: bold;
      color: #10202f;
    }
    .header-left p { 
      margin: 4px 0; 
      font-size: 13px; 
      color: #445;
    }
    .header-right { 
      text-align: right; 
      display: flex;
      flex-direction: column;
      justify-content: flex-start;
    }
    .txn-number { 
      font-size: 16px; 
      font-weight: bold; 
      color: #d9534f;
      margin-bottom: 8px;
    }
    .meta-info { 
      font-size: 11px; 
      color: #666;
      line-height: 1.4;
    }
    .delivery-info {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      margin-bottom: 18px;
      font-size: 12px;
    }
    .info-box {
      border: 1px solid #ccd5df;
      padding: 8px;
      background: #f9f9f9;
    }
    .info-box strong { 
      display: block; 
      margin-bottom: 4px; 
      font-size: 11px;
      text-transform: uppercase;
      color: #445;
    }
    .info-box span { 
      display: block; 
      font-size: 13px;
      color: #10202f;
    }
    table { 
      width: 100%; 
      border-collapse: collapse; 
      font-size: 11px; 
      margin-top: 12px;
    }
    th, td { 
      border: 1px solid #ccd5df; 
      padding: 6px 6px; 
      text-align: left;
      vertical-align: middle;
    }
    th { 
      background: #10202f; 
      color: white;
      font-weight: bold;
      height: 24px;
    }
    td { 
      height: 18px; 
    }
    .number { text-align: center; }
    .qty { text-align: center; }
    .price { text-align: right; }
    .totals-row { 
      background: #eef4fb; 
      font-weight: bold; 
    }
    .signatures { 
      margin-top: 24px; 
      display: grid; 
      grid-template-columns: 1fr 1fr 1fr; 
      gap: 20px; 
      font-size: 11px;
    }
    .sig-box { 
      display: flex;
      flex-direction: column;
    }
    .sig-space { 
      border-bottom: 1px solid #10202f; 
      height: 40px;
      margin-bottom: 4px;
    }
    .sig-label { 
      font-size: 10px; 
      font-weight: bold;
      text-align: center;
    }
    .print-note {
      margin-top: 16px;
      font-size: 10px;
      color: #999;
      text-align: center;
    }
    @media print {
      body { margin: 0; padding: 10mm; }
      .print-note { display: none; }
      .container { max-width: 100%; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="header-left">
        <h1>TRANSIT RECEIPT</h1>
        <p>Proof of Delivery • Parts Transfer Authorization</p>
      </div>
      <div class="header-right">
        <div class="txn-number">${txnNumber}</div>
        <div class="meta-info">
          <strong>Approved:</strong> ${approvedLabel}<br>
          <strong>By:</strong> ${approver || '—'}<br>
          <strong>Items:</strong> ${items.length}
        </div>
      </div>
    </div>

    <div class="delivery-info">
      <div class="info-box">
        <strong>Delivered To (Branch)</strong>
        <span>${requestingBranch || '—'}</span>
      </div>
      <div class="info-box">
        <strong>Shipped From</strong>
        <span>Warehouse 1</span>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th class="number">#</th>
          <th>Part Number</th>
          <th>Part Name</th>
          <th class="qty">Qty</th>
          <th>Unit</th>
          <th class="price">Unit Price</th>
          <th class="price">Line Total</th>
          <th>WO#</th>
        </tr>
      </thead>
      <tbody>
        ${itemsHtml}
        <tr class="totals-row">
          <td colspan="2" style="text-align:right; font-weight:bold;">TOTALS:</td>
          <td></td>
          <td class="qty"><strong>${totalQty.toFixed(2)}</strong></td>
          <td colspan="2"></td>
          <td class="price"><strong>P ${totalRetail.toFixed(2)}</strong></td>
          <td></td>
        </tr>
      </tbody>
    </table>

    <div class="signatures">
      <div class="sig-box">
        <div class="sig-space"></div>
        <div class="sig-label">Received By<br>(Branch)</div>
      </div>
      <div class="sig-box">
        <div class="sig-space"></div>
        <div class="sig-label">Delivered By<br>(Warehouse)</div>
      </div>
      <div class="sig-box">
        <div class="sig-space"></div>
        <div class="sig-label">Verified By<br>(Branch Manager)</div>
      </div>
    </div>

    <div class="print-note">
      Use Ctrl+P or Cmd+P to print. This receipt consolidates ${items.length} approved transfer items on a single page.
    </div>
  </div>
</body>
</html>`;
}

async function saveTransitReceipt(txnNumber, items, approver) {
  await ensureReceiptsDir();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const authPart = sanitizeFilename(txnNumber);
  const filename = `TRANSIT-${authPart}-${stamp}.html`;
  const filepath = path.join(APPROVED_RECEIPTS_DIR, filename);

  const html = buildTransitReceiptHtml(txnNumber, items, approver);
  await fsp.writeFile(filepath, html, 'utf8');
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
  buildConsolidatedReceiptHtml,
  buildTransitReceiptHtml,
  saveApprovedReceipt,
  saveConsolidatedReceipt,
  saveTransitReceipt,
  ensureReceiptsDir,
};
