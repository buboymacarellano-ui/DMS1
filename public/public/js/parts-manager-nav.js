(function () {
  const reportHost = document.getElementById('pm-branch-report');
  if (reportHost) {
    const branch = reportHost.dataset.branch || '';
    fetch(`/parts-manager/api/branch-reports?branch=${encodeURIComponent(branch)}`)
      .then((res) => res.json())
      .then((data) => {
        const rows = Array.isArray(data.rows) ? data.rows : [];
        if (!rows.length) {
          reportHost.innerHTML = '<p class="dashboard-note admin-note">No records for this branch.</p>';
          return;
        }
        const body = rows.map((row) => (
          `<tr><td>${row.transaction_date || ''}</td><td>${row.part_number || ''}</td><td>${row.part_name || ''}</td><td>${row.sub_id || ''}</td><td>${row.qty ?? ''}</td></tr>`
        )).join('');
        reportHost.innerHTML = `<table class="list"><thead><tr><th>Date</th><th>Part #</th><th>Name</th><th>Sub-ID</th><th>Qty</th></tr></thead><tbody>${body}</tbody></table>`;
      })
      .catch(() => {
        reportHost.innerHTML = '<p class="error">Failed to load branch report.</p>';
      });
  }

  const billingHost = document.getElementById('pm-billing-history');
  if (billingHost) {
    fetch('/parts-manager/api/suppliers')
      .then((res) => res.json())
      .then((data) => {
        const rows = Array.isArray(data.billingHistory) ? data.billingHistory : [];
        if (!rows.length) {
          billingHost.innerHTML = '<p class="dashboard-note admin-note">No billing transactions yet.</p>';
          return;
        }
        const body = rows.map((row) => (
          `<tr><td>${row.transaction_date || ''}</td><td>${row.supplier || ''}</td><td>${row.part_number || ''}</td><td>${row.qty ?? ''}</td><td>${row.cost_price ?? ''}</td></tr>`
        )).join('');
        billingHost.innerHTML = `<table class="list"><thead><tr><th>Date</th><th>Supplier</th><th>Part #</th><th>Qty</th><th>Cost</th></tr></thead><tbody>${body}</tbody></table>`;
      })
      .catch(() => {
        billingHost.innerHTML = '<p class="error">Failed to load billing history.</p>';
      });
  }
})();
