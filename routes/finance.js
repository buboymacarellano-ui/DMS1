const express = require('express');
const store = require('../data/store');
const {
  PAYMENT_METHODS,
  todayKey,
  buildFinanceDashboard,
  buildEodReport,
  markInvoicePaid,
  isFinanceManagerRole,
} = require('../lib/finance-ledger');

const router = express.Router();
const apiRouter = express.Router();

function reportingDateFrom(req) {
  const raw = String((req.query && req.query.date) || (req.body && req.body.date) || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return todayKey();
}

function wantsJson(req) {
  const format = String((req.query && req.query.format) || '').toLowerCase();
  if (format === 'json') return true;
  const accept = String(req.get('accept') || '');
  return accept.includes('application/json') && !accept.includes('text/html');
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function money(value) {
  return Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function buildEodHtml(report) {
  const rows = (report.cashDrawer || []).map((row) => `
    <tr>
      <td>${escapeHtml(row.paymentMethod)}</td>
      <td class="num">${row.count}</td>
      <td class="num">P ${money(row.gross)}</td>
      <td class="num">P ${money(row.partsCostPrice)}</td>
      <td class="num">P ${money(row.laborCost)}</td>
      <td class="num">P ${money(row.taxAmount)}</td>
      <td class="num">P ${money(row.netProfit)}</td>
    </tr>`).join('');
  const receivableRows = (report.receivables || []).map((row) => `
    <tr>
      <td>${escapeHtml(row.customerName || '—')}</td>
      <td>${escapeHtml(row.plateNumber || '—')}</td>
      <td>${escapeHtml(row.invoice_number || '')}</td>
      <td class="num">P ${money(row.balanceDue)}</td>
    </tr>`).join('') || '<tr><td colspan="4">No unpaid invoices for this date.</td></tr>';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>EOD Cash Drawer ${escapeHtml(report.reportingDate)}</title>
  <style>
    body { font-family: Arial, sans-serif; color: #10202f; margin: 24px; }
    h1 { margin: 0 0 4px; font-size: 22px; }
    .meta { margin: 0 0 16px; color: #445; font-size: 13px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 18px; }
    th, td { border: 1px solid #ccd5df; padding: 8px 10px; text-align: left; }
    th { background: #eef4fb; }
    .num { text-align: right; white-space: nowrap; }
    .totals { font-weight: 700; }
    .actions { margin-top: 16px; }
    @media print { .actions { display: none; } body { margin: 12mm; } }
  </style>
</head>
<body>
  <h1>Cash Drawer Balance Summary</h1>
  <p class="meta">
    Reporting Date: ${escapeHtml(report.reportingDate)}<br />
    Generated: ${escapeHtml(report.generatedAt)}<br />
    Gross collected: P ${money(report.totals.gross)} · Outstanding (this date): P ${money((report.receivables || []).reduce((sum, row) => sum + Number(row.balanceDue || 0), 0))}
  </p>
  <table>
    <thead>
      <tr>
        <th>Payment Method</th>
        <th>Count</th>
        <th>Collected</th>
        <th>Parts Cost</th>
        <th>Labor Cost</th>
        <th>VAT 12%</th>
        <th>Net</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
      <tr class="totals">
        <td>Drawer total</td>
        <td class="num">${report.totals.count}</td>
        <td class="num">P ${money(report.totals.gross)}</td>
        <td class="num">P ${money(report.totals.partsCostPrice)}</td>
        <td class="num">P ${money(report.totals.laborCost)}</td>
        <td class="num">P ${money(report.totals.taxAmount)}</td>
        <td class="num">P ${money(report.totals.netProfit)}</td>
      </tr>
    </tbody>
  </table>
  <h2 style="font-size:16px;">Unpaid / Accounts Receivable (this date)</h2>
  <table>
    <thead>
      <tr><th>Customer</th><th>Plate</th><th>Invoice</th><th>Balance Due</th></tr>
    </thead>
    <tbody>${receivableRows}</tbody>
  </table>
  <div class="actions">
    <button type="button" onclick="window.print()">Print</button>
  </div>
</body>
</html>`;
}

async function handleEodReport(req, res) {
  const data = await store.getRawData();
  const report = buildEodReport(data, reportingDateFrom(req));
  if (wantsJson(req)) return res.json(report);
  return res.type('html').send(buildEodHtml(report));
}

async function handleMarkPaid(req, res) {
  const id = String((req.body && (req.body.id || req.body.work_order_id)) || '').trim();
  if (!id) return res.status(400).json({ error: 'Invoice id is required.' });

  const data = await store.getRawData();
  const result = markInvoicePaid(data, id, req.body && req.body.paymentMethod);
  if (!result.ok) return res.status(404).json({ error: result.error });

  await store.replaceData(data);
  const dashboard = buildFinanceDashboard(data, reportingDateFrom(req));
  return res.json({
    ok: true,
    invoice: result.invoice,
    metrics: dashboard.metrics,
    paymentMatrix: dashboard.paymentMatrix,
  });
}

router.get('/', async (req, res) => {
  const data = await store.getRawData();
  const reportingDate = reportingDateFrom(req);
  const dashboard = buildFinanceDashboard(data, reportingDate);
  return res.render('finance/index', {
    reportingDate,
    paymentMethods: PAYMENT_METHODS,
    metrics: dashboard.metrics,
    paymentMatrix: dashboard.paymentMatrix,
    dailyRows: dashboard.dailyRows,
    receivables: dashboard.receivables,
  });
});

router.get('/eod-report', handleEodReport);

apiRouter.get('/eod-report', handleEodReport);
apiRouter.post('/mark-paid', handleMarkPaid);

module.exports = router;
module.exports.apiRouter = apiRouter;
module.exports.isFinanceManagerRole = isFinanceManagerRole;
module.exports.handleEodReport = handleEodReport;
module.exports.handleMarkPaid = handleMarkPaid;
