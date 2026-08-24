(function () {
  const dashboard = document.getElementById('pm-dashboard');
  if (!dashboard) return;

  const searchInput = document.getElementById('pm-global-search');
  const filterStatus = document.getElementById('pm-filter-status');
  const modal = document.getElementById('pm-stock-modal');
  const modalPartNumber = document.getElementById('pm-modal-part-number');
  const modalPartName = document.getElementById('pm-modal-part-name');
  const modalCurrentQty = document.getElementById('pm-modal-current-qty');
  const modalSupplier = document.getElementById('pm-modal-supplier');
  const modalError = document.getElementById('pm-modal-error');
  const stockDelta = document.getElementById('pm-stock-delta');
  const stockApply = document.getElementById('pm-stock-apply');
  const reviewModal = document.getElementById('pm-review-modal');

  let overview = window.__PM_OVERVIEW__ || {};
  let activePart = { part_number: '', part_name: '', supplier: '', qty: 0 };

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatWorkOrder(req) {
    const raw = String(req?.work_order_number || req?.work_order_id || '').trim();
    return raw || '—';
  }

  function formatDisplay(value, fallback = '-') {
    const raw = String(value ?? '').trim();
    return raw || fallback;
  }

  function getStockQty(partNumber) {
    const map = overview.stockByPart || {};
    return Number(map[partNumber] ?? 0);
  }

  function normalizeQuery(value) {
    return String(value || '').trim().toLowerCase();
  }

  function rowMatches(row, query) {
    if (!query) return true;
    const part = normalizeQuery(row.dataset.part);
    const supplier = normalizeQuery(row.dataset.supplier);
    return part.includes(query) || supplier.includes(query);
  }

  function applyFilter() {
    const query = normalizeQuery(searchInput && searchInput.value);
    let visible = 0;
    let total = 0;

    dashboard.querySelectorAll('.pm-data-row').forEach((row) => {
      total += 1;
      const show = rowMatches(row, query);
      row.hidden = !show;
      if (show) visible += 1;
    });

    dashboard.querySelectorAll('.pm-data-table tbody').forEach((tbody) => {
      const sectionRows = tbody.querySelectorAll('.pm-data-row');
      const hasVisible = Array.from(sectionRows).some((row) => !row.hidden);
      const emptyRow = tbody.querySelector('.pm-empty-row');
      if (emptyRow) emptyRow.hidden = hasVisible;
    });

    if (filterStatus) {
      filterStatus.textContent = query
        ? `Showing ${visible} of ${total} rows matching "${searchInput.value.trim()}".`
        : '';
    }
  }

  function updateCounts() {
    const setCount = (id, count) => {
      const el = document.getElementById(id);
      if (el) el.textContent = String(count);
    };
    setCount('pm-low-stock-count', (overview.lowStockAlerts || []).length);
    setCount('pm-pending-po-count', (overview.pendingPOs || []).length);
    setCount('pm-requests-count', (overview.pendingPartsRequests || []).length);
    setCount('pm-movements-count', (overview.recentMovements || []).length);
  }

  function renderRequestsTable() {
    const tbody = document.getElementById('pm-requests-body');
    if (!tbody) return;
    const rows = overview.pendingPartsRequests || [];
    if (!rows.length) {
      tbody.innerHTML = '<tr class="pm-empty-row"><td colspan="10">No pending branch requests.</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map((req) => {
      const woRaw = String(req.work_order_number || req.work_order_id || '').trim();
      const woDisplay = woRaw || '—';
      return (
      `<tr class="pm-data-row pm-request-row" data-request-id="${escapeHtml(req.id)}" data-part="${escapeHtml(req.part_number || '')}" data-supplier="${escapeHtml(req.supplier || '')}">
        <td>${escapeHtml(req.requesting_branch || req.branch || '-')}</td>
        <td class="pm-wo-cell${woRaw ? '' : ' pm-wo-cell--empty'}">${escapeHtml(woDisplay)}</td>
        <td>${escapeHtml(req.part_number || '-')}</td>
        <td>${escapeHtml(req.part_name || '-')}</td>
        <td>${escapeHtml(req.sub_id || '-')}</td>
        <td>${escapeHtml(req.supplier || '-')}</td>
        <td>${escapeHtml(req.qty ?? '-')}</td>
        <td>${escapeHtml(req.branch || '-')}</td>
        <td>${escapeHtml(req.requested_by || req.editor || '-')}</td>
        <td class="pm-action-cell">
          <button type="button" class="btn pm-btn-review" data-id="${escapeHtml(req.id)}">Review</button>
          <button type="button" class="btn pm-btn-approve" data-id="${escapeHtml(req.id)}">Approve</button>
          <button type="button" class="btn pm-btn-reject" data-id="${escapeHtml(req.id)}">Reject</button>
        </td>
      </tr>`
      );
    }).join('');
    applyFilter();
  }

  function refreshQtyCells() {
    dashboard.querySelectorAll('.pm-qty-cell').forEach((cell) => {
      const partNumber = cell.dataset.partQty;
      if (partNumber) cell.textContent = String(getStockQty(partNumber));
    });
    dashboard.querySelectorAll('.pm-btn-adjust').forEach((btn) => {
      const partNumber = btn.dataset.part;
      if (partNumber) btn.dataset.qty = String(getStockQty(partNumber));
    });
  }

  function openStockModal(part) {
    activePart = part;
    modalPartNumber.textContent = part.part_number;
    modalPartName.textContent = part.part_name || '-';
    modalCurrentQty.textContent = String(part.qty ?? getStockQty(part.part_number));
    modalSupplier.value = part.supplier || '';
    stockDelta.value = '1';
    modalError.hidden = true;
    modalError.textContent = '';
    const addRadio = modal.querySelector('input[value="add"]');
    if (addRadio) addRadio.checked = true;
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
  }

  function closeStockModal() {
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
  }

  function openReviewModal(id) {
    if (!reviewModal) return;
    const req = (overview.pendingPartsRequests || []).find((row) => String(row.id) === String(id));
    if (!req) return;

    const setText = (elementId, value) => {
      const el = document.getElementById(elementId);
      if (el) el.textContent = formatDisplay(value);
    };

    setText('pm-review-requesting-branch', req.requesting_branch || req.branch);
    document.getElementById('pm-review-work-order').textContent = formatWorkOrder(req);
    setText('pm-review-part-number', req.part_number);
    setText('pm-review-part-name', req.part_name);
    setText('pm-review-sub-id', req.sub_id);
    setText('pm-review-supplier', req.supplier);
    setText('pm-review-qty', req.qty != null ? req.qty : '');
    setText('pm-review-fulfilling-branch', req.branch);
    setText('pm-review-requested-by', req.requested_by || req.editor);

    reviewModal.hidden = false;
    reviewModal.setAttribute('aria-hidden', 'false');
  }

  function closeReviewModal() {
    if (!reviewModal) return;
    reviewModal.hidden = true;
    reviewModal.setAttribute('aria-hidden', 'true');
  }

  function getSignedDelta() {
    const magnitude = Math.max(1, Number(stockDelta.value) || 1);
    const direction = modal.querySelector('input[name="pm-adjust-direction"]:checked');
    return direction && direction.value === 'remove' ? -magnitude : magnitude;
  }

  async function applyStockAdjust() {
    const delta = getSignedDelta();
    modalError.hidden = true;
    stockApply.disabled = true;
    try {
      const res = await fetch('/parts-manager/api/stock-adjust', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          part_number: activePart.part_number,
          part_name: activePart.part_name,
          sub_id: activePart.sub_id || '',
          supplier: modalSupplier.value,
          delta,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Stock adjustment failed.');
      overview = data.overview || overview;
      updateCounts();
      refreshQtyCells();
      closeStockModal();
    } catch (error) {
      modalError.textContent = error.message;
      modalError.hidden = false;
    } finally {
      stockApply.disabled = false;
    }
  }

  async function resolveRequest(id, decision) {
    const row = dashboard.querySelector(`.pm-request-row[data-request-id="${id}"]`);
    if (row) {
      row.querySelectorAll('button').forEach((btn) => { btn.disabled = true; });
    }
    try {
      const res = await fetch(`/parts-manager/api/parts-requests/${encodeURIComponent(id)}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ decision }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request action failed.');
      overview = data.overview || overview;
      updateCounts();
      renderRequestsTable();
      refreshQtyCells();
      if (decision === 'approved' && data.receiptUrl) {
        window.open(data.receiptUrl, '_blank', 'noopener');
      }
    } catch (error) {
      if (row) row.querySelectorAll('button').forEach((btn) => { btn.disabled = false; });
      window.alert(error.message);
    }
  }

  if (searchInput) {
    searchInput.addEventListener('input', applyFilter);
  }

  dashboard.addEventListener('click', (event) => {
    const adjustBtn = event.target.closest('.pm-btn-adjust');
    if (adjustBtn) {
      openStockModal({
        part_number: adjustBtn.dataset.part || '',
        part_name: adjustBtn.dataset.name || '',
        sub_id: adjustBtn.dataset.subId || '',
        supplier: adjustBtn.dataset.supplier || '',
        qty: Number(adjustBtn.dataset.qty ?? getStockQty(adjustBtn.dataset.part)),
      });
      return;
    }

    const approveBtn = event.target.closest('.pm-btn-approve');
    if (approveBtn) {
      resolveRequest(approveBtn.dataset.id, 'approved');
      return;
    }

    const reviewBtn = event.target.closest('.pm-btn-review');
    if (reviewBtn) {
      openReviewModal(reviewBtn.dataset.id);
      return;
    }

    const rejectBtn = event.target.closest('.pm-btn-reject');
    if (rejectBtn) {
      resolveRequest(rejectBtn.dataset.id, 'rejected');
    }
  });

  modal.addEventListener('click', (event) => {
    if (event.target.closest('[data-pm-close-modal]')) closeStockModal();
  });

  reviewModal?.addEventListener('click', (event) => {
    if (event.target.closest('[data-pm-close-review]')) closeReviewModal();
  });

  document.getElementById('pm-stock-minus')?.addEventListener('click', () => {
    stockDelta.value = String(Math.max(1, (Number(stockDelta.value) || 1) - 1));
  });
  document.getElementById('pm-stock-plus')?.addEventListener('click', () => {
    stockDelta.value = String((Number(stockDelta.value) || 1) + 1);
  });
  stockApply?.addEventListener('click', applyStockAdjust);

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (modal && !modal.hidden) closeStockModal();
    if (reviewModal && !reviewModal.hidden) closeReviewModal();
  });

  applyFilter();
})();
