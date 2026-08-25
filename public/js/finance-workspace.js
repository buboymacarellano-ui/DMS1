(function () {
  const root = document.getElementById('fm-workspace');
  if (!root) return;

  function money(value) {
    return '₱' + Number(value || 0).toLocaleString('en-PH', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  function setMetric(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = money(value);
  }

  function renderMatrix(rows) {
    const tbody = document.querySelector('#fm-payment-matrix tbody');
    if (!tbody || !Array.isArray(rows)) return;
    if (!rows.length) {
      tbody.innerHTML = '<tr class="fm-empty"><td colspan="7">No payment activity for this date.</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map((row) => (
      '<tr data-method="' + String(row.paymentMethod || '') + '">'
      + '<td>' + String(row.paymentMethod || '') + '</td>'
      + '<td style="text-align:right;">' + Number(row.count || 0) + '</td>'
      + '<td style="text-align:right;">' + money(row.gross) + '</td>'
      + '<td style="text-align:right;">' + money(row.partsCostPrice) + '</td>'
      + '<td style="text-align:right;">' + money(row.laborCost) + '</td>'
      + '<td style="text-align:right;">' + money(row.taxAmount) + '</td>'
      + '<td style="text-align:right;">' + money(row.netProfit) + '</td>'
      + '</tr>'
    )).join('');
  }

  async function markPaid(id, button) {
    if (!id) return;
    if (button) button.disabled = true;
    try {
      const date = root.getAttribute('data-reporting-date') || '';
      const res = await fetch('/api/finance/mark-paid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ id, paymentMethod: 'Cash', date }),
      });
      const payload = await res.json().catch(() => ({ error: 'Unable to update invoice.' }));
      if (!res.ok || !payload.ok) {
        window.alert(payload.error || 'Unable to mark invoice as paid.');
        if (button) button.disabled = false;
        return;
      }
      const row = root.querySelector('.fm-ar-row[data-id="' + id + '"]');
      if (row) row.remove();
      const tbody = document.querySelector('#fm-receivables tbody');
      if (tbody && !tbody.querySelector('.fm-ar-row')) {
        tbody.innerHTML = '<tr class="fm-empty" id="fm-ar-empty"><td colspan="5">No outstanding receivables.</td></tr>';
      }
      if (payload.metrics) {
        setMetric('fm-gross-revenue', payload.metrics.grossRevenue);
        setMetric('fm-net-profit', payload.metrics.netProfit);
        setMetric('fm-receivables-total', payload.metrics.outstandingReceivables);
      }
      if (payload.paymentMatrix) renderMatrix(payload.paymentMatrix);
    } catch (error) {
      window.alert(error.message || 'Unable to mark invoice as paid.');
      if (button) button.disabled = false;
    }
  }

  root.addEventListener('click', (event) => {
    const button = event.target.closest('.fm-mark-paid');
    if (!button) return;
    event.preventDefault();
    markPaid(button.getAttribute('data-id'), button);
  });
})();
