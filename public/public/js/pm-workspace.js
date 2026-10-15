(function () {
  const root = document.getElementById('pm-workspace');
  if (!root) return;

  const panels = Array.from(root.querySelectorAll('[data-pm-section]'));
  const buttons = Array.from(document.querySelectorAll('#pm-sidebar [data-pm-panel]'));
  const editForm = document.getElementById('pm-edit-form');
  const editDeleteForm = document.getElementById('pm-edit-delete-form');
  const editCancelBtn = document.getElementById('pm-edit-cancel-btn');
  const editRemoveBtn = document.getElementById('pm-edit-remove-btn');
  const csvFile = document.getElementById('pm-csv-file');
  const csvText = document.getElementById('pm-csv-text');
  const csvForm = document.getElementById('pm-csv-form');
  const transitForm = document.getElementById('pm-transit-form');
  const transitInput = document.getElementById('pm-transit-input');
  const transitButton = document.getElementById('pm-transit-generate-btn');
  const transitResult = document.getElementById('pm-transit-result');
  const transactionTable = document.getElementById('pm-transaction-records-table');
  const transactionPrint = document.getElementById('pm-transaction-print');
  const transactionSort = document.getElementById('pm-transaction-sort');
  const transactionEdit = document.getElementById('pm-transaction-edit');
  const transactionActivate = document.getElementById('pm-transaction-activate');
  const transactionSave = document.getElementById('pm-transaction-save');
  const transactionRemove = document.getElementById('pm-transaction-remove');
  const transactionStatus = document.getElementById('pm-transaction-action-status');
  let selectedTransactionRow = null;

  // Grids persist in localStorage until the user pushes an action (create PO / file transfer) or clears them.
  const GRID_KEYS = { order: 'pmOrderingGrid:v1', transfer: 'pmTransferGrid:v1' };
  function loadGrid(key) {
    try {
      const data = JSON.parse(localStorage.getItem(key) || '[]');
      return Array.isArray(data) ? data : [];
    } catch (e) { return []; }
  }
  function saveGrid(key, rows) {
    try {
      if (rows && rows.length) localStorage.setItem(key, JSON.stringify(rows));
      else localStorage.removeItem(key);
    } catch (e) { /* storage unavailable */ }
  }
  window.orderingGridItems = loadGrid(GRID_KEYS.order);

  function gridToast(message) {
    let el = document.getElementById('pm-grid-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'pm-grid-toast';
      el.style.cssText = 'position:fixed;right:20px;bottom:20px;background:#2c3e50;color:#fff;padding:10px 16px;border-radius:4px;font-size:13px;z-index:4000;box-shadow:0 2px 8px rgba(0,0,0,.3);transition:opacity .3s;';
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.style.opacity = '1';
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.style.opacity = '0'; }, 2200);
  }

  function openPanel(name) {
    const target = String(name || '').trim();
    panels.forEach((panel) => {
      panel.hidden = !(panel.getAttribute('data-pm-section') || '').split(/\s+/).includes(target);
    });
    const single = target.indexOf('proc-') === 0;
    root.classList.toggle('pm-proc-single', single);
    root.querySelectorAll('[data-pm-process]').forEach((el) => {
      el.hidden = single && el.getAttribute('data-pm-process') !== target;
    });
    buttons.forEach((btn) => {
      btn.classList.toggle('pm-sidebar__link--active', btn.getAttribute('data-pm-panel') === target);
    });
    if (target) {
      const url = new URL(window.location.href);
      url.searchParams.set('panel', target);
      window.history.replaceState({}, '', url);
      
      // Refresh ordering grid when opening the ordering panel
      if ((target === 'ordering' || target === 'order-grid') && typeof window.updateOrderingGridDisplay === 'function') {
        setTimeout(() => window.updateOrderingGridDisplay(), 50);
      }
    }
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>'"]/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
    }[char]));
  }

  window.pmOpenPanel = openPanel;

  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const name = btn.getAttribute('data-pm-panel');
      openPanel(name);
    });
  });

  const initial = root.getAttribute('data-open-panel') || new URL(window.location.href).searchParams.get('panel') || '';
  openPanel(initial || 'edit');

  if (csvFile && csvText) {
    csvFile.addEventListener('change', () => {
      const file = csvFile.files && csvFile.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        csvText.value = String(reader.result || '');
      };
      reader.readAsText(file);
    });
  }

  if (csvForm) {
    csvForm.addEventListener('submit', (event) => {
      const mode = String((csvForm.querySelector('[name="import_mode"]') || {}).value || '');
      if (mode === 'replace') {
        const ok = window.confirm('Replace the entire Parts Database with this CSV? A backup will be saved first.');
        if (!ok) event.preventDefault();
      }
    });
  }

  async function generateTransitReceipt() {
    if (!transitInput || !transitButton) return;
    const transactionNumber = String(transitInput.value || '').trim();
    if (!transactionNumber) {
      transitInput.focus();
      if (transitResult) transitResult.innerHTML = '<p class="error">Enter a transaction number first.</p>';
      return;
    }

    transitButton.disabled = true;
    const originalText = transitButton.textContent;
    transitButton.textContent = 'Generating...';
    if (transitResult) transitResult.innerHTML = '<p class="dashboard-note">Generating transit receipt...</p>';

    try {
      const response = await fetch('/parts-manager/api/transit-receipt/' + encodeURIComponent(transactionNumber), {
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || 'Could not generate transit receipt.');
      }

      const receiptUrl = String(payload.receiptUrl || '');
      const itemCount = Number(payload.itemCount || 0);
      if (transitResult) {
        transitResult.innerHTML = '<p class="success">Transit receipt generated for ' + itemCount + ' item' + (itemCount === 1 ? '' : 's') + '. <a class="btn" href="' + receiptUrl + '" target="_blank" rel="noopener">Open Receipt</a></p>';
      }
      if (receiptUrl) window.open(receiptUrl, '_blank', 'noopener');
    } catch (error) {
      if (transitResult) transitResult.innerHTML = '<p class="error">' + String(error.message || error) + '</p>';
    } finally {
      transitButton.disabled = false;
      transitButton.textContent = originalText || 'Generate Transit Receipt';
    }
  }

  if (transitForm) {
    transitForm.addEventListener('submit', (event) => {
      event.preventDefault();
      generateTransitReceipt();
    });
  }
  if (transitButton) {
    transitButton.addEventListener('click', generateTransitReceipt);
  }

  function selectedTransactionId() {
    return selectedTransactionRow && selectedTransactionRow.getAttribute('data-transaction-id');
  }

  function updateTransactionActions() {
    const active = Boolean(selectedTransactionId());
    [transactionPrint, transactionEdit, transactionActivate, transactionSave, transactionRemove]
      .forEach((button) => { if (button) button.disabled = !active; });
    if (transactionStatus) transactionStatus.textContent = active
      ? 'Selected: ' + (selectedTransactionRow.getAttribute('data-transaction-number') || selectedTransactionId())
      : 'Select a transaction row.';
  }

  if (transactionTable) {
    transactionTable.addEventListener('click', (event) => {
      const row = event.target.closest('.pm-transaction-row');
      if (!row) return;
      if (selectedTransactionRow) selectedTransactionRow.classList.remove('pm-transaction-row--active');
      selectedTransactionRow = row;
      row.classList.add('pm-transaction-row--active');
      updateTransactionActions();
    });
  }

  if (transactionSort && transactionTable) {
    transactionSort.addEventListener('change', () => {
      const body = transactionTable.tBodies[0];
      const rows = Array.from(body.querySelectorAll('.pm-transaction-row'));
      const mode = transactionSort.value;
      const text = (row, key) => String(row.dataset[key] || '').trim().toLowerCase();
      const number = (row, key) => Number(row.dataset[key] || 0) || 0;
      const date = (row) => {
        const stamp = Date.parse(row.dataset.transactionDate || '');
        return Number.isNaN(stamp) ? 0 : stamp;
      };
      rows.sort((left, right) => {
        if (mode === 'date-asc') return date(left) - date(right);
        if (mode === 'username-asc') return text(left, 'transactionUsername').localeCompare(text(right, 'transactionUsername'));
        if (mode === 'qty-desc') return number(right, 'transactionQty') - number(left, 'transactionQty');
        if (mode === 'price-desc') return number(right, 'transactionPrice') - number(left, 'transactionPrice');
        return date(right) - date(left);
      });
      rows.forEach((row) => body.appendChild(row));
      if (transactionStatus) transactionStatus.textContent = transactionSort.options[transactionSort.selectedIndex].text + '.';
    });
  }

  if (transactionPrint) transactionPrint.addEventListener('click', () => {
    const id = selectedTransactionId();
    if (id) window.open('/parts-manager/print/transaction/' + encodeURIComponent(id), '_blank', 'noopener');
  });

  if (transactionEdit) transactionEdit.addEventListener('click', () => {
    const id = selectedTransactionId();
    if (id) loadPart(id);
  });

  if (transactionSave) transactionSave.addEventListener('click', async () => {
    if (editForm && selectedTransactionId()) {
      await loadPart(selectedTransactionId());
      if (document.getElementById('pm-edit-id').value === selectedTransactionId()) editForm.requestSubmit();
    }
  });

  if (transactionRemove) transactionRemove.addEventListener('click', () => {
    if (!editDeleteForm || !selectedTransactionId()) return;
    if (window.confirm('Remove all information for this transaction number?')) {
      editDeleteForm.action = '/parts-manager/transactions/' + encodeURIComponent(selectedTransactionId()) + '/delete';
      editDeleteForm.submit();
    }
  });

  if (transactionActivate) transactionActivate.addEventListener('click', async () => {
    const id = selectedTransactionId();
    if (!id) return;
    transactionActivate.disabled = true;
    try {
      const response = await fetch('/parts-manager/transactions/' + encodeURIComponent(id) + '/activate-number', { method: 'POST', headers: { Accept: 'application/json' } });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'Could not activate transaction number.');
      selectedTransactionRow.setAttribute('data-transaction-number', payload.transaction_number);
      selectedTransactionRow.cells[1].textContent = payload.transaction_number;
      updateTransactionActions();
    } catch (error) {
      window.alert(error.message || error);
      transactionActivate.disabled = false;
    }
  });

  function fillEdit(part) {
    if (!editForm || !part) return;
    document.getElementById('pm-edit-id').value = part.id || '';
    document.getElementById('pm-edit-date').value = String(part.transaction_date || '').slice(0, 10);
    document.getElementById('pm-edit-txn').value = part.transaction_number || 'Auto-assigned on save';
    document.getElementById('pm-edit-type').value = String(part.transaction_type || 'stock').toLowerCase();
    const location = part.present_location || part.branch || part.requesting_branch || '';
    const locationSelect = document.getElementById('pm-edit-location');
    if (location && locationSelect) {
      const has = Array.from(locationSelect.options).some((opt) => opt.value === location);
      if (!has && location) {
        const option = document.createElement('option');
        option.value = location;
        option.textContent = location;
        locationSelect.appendChild(option);
      }
      locationSelect.value = location;
    }
    document.getElementById('pm-edit-part-number').value = part.part_number || '';
    document.getElementById('pm-edit-part-name').value = part.part_name || '';
    document.getElementById('pm-edit-sub-id').value = part.sub_id || '';
    document.getElementById('pm-edit-generic').value = part.generic || '';
    document.getElementById('pm-edit-supplier').value = part.supplier || '';
    document.getElementById('pm-edit-unit').value = part.unit || '';
    document.getElementById('pm-edit-qty').value = part.qty != null ? part.qty : '';
    document.getElementById('pm-edit-cost').value = part.cost_price != null ? part.cost_price : '';
    document.getElementById('pm-edit-markup').value = part.markup != null ? part.markup : '';
    document.getElementById('pm-edit-retail').value = part.retail_price != null ? part.retail_price : '';
    document.getElementById('pm-edit-sold-to').value = part.sold_to || '';
    document.getElementById('pm-edit-receiving-receipt').value = part.receiving_receipt_number || '';
    const barcodeInput = document.getElementById('pm-edit-barcode');
    if (barcodeInput) {
      barcodeInput.value = part.barcode || '';
      barcodeInput.dataset.lookedUp = String(part.barcode || '').trim().toUpperCase();
    }
    setBarcodeStatus('', false);
    editForm.action = '/parts-manager/parts/' + encodeURIComponent(part.id) + '/edit';
    if (editDeleteForm) editDeleteForm.action = '/parts-manager/parts/' + encodeURIComponent(part.id) + '/delete';
    if (editRemoveBtn) editRemoveBtn.disabled = false;
    openPanel('edit');
    editForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function loadPart(id) {
    const res = await fetch('/parts-manager/api/parts/' + encodeURIComponent(id), {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return;
    const part = await res.json();
    if (part && part.locked) {
      window.alert(part.lockReason || 'A part that has been sold cannot be edited or erased.');
      return;
    }
    fillEdit(part);
    root.querySelectorAll('.pm-db-row').forEach((row) => {
      row.classList.toggle('pm-db-row--active', row.getAttribute('data-id') === String(id));
    });
  }

  root.addEventListener('click', (event) => {
    const orderBtn = event.target.closest('[data-pm-order-grid]');
    if (orderBtn) {
      event.preventDefault();
      const partNumber = orderBtn.getAttribute('data-part-number');
      if (!partNumber) return;
      const location = orderBtn.getAttribute('data-location') || '';
      if (!window.orderingGridItems) window.orderingGridItems = [];
      const existing = window.orderingGridItems.find((item) => item.part_number === partNumber && (item.location || '') === location);
      if (existing) {
        existing.order_qty = (Number(existing.order_qty) || 0) + 1;
      } else {
        window.orderingGridItems.push({
          id: 'item_' + Date.now() + '_' + Math.random().toString(36).slice(2, 11),
          part_number: partNumber,
          part_name: orderBtn.getAttribute('data-part-name') || '',
          supplier: orderBtn.getAttribute('data-supplier') || '',
          location,
          current_stock: Number(orderBtn.getAttribute('data-on-hand')) || 0,
          order_qty: 1,
        });
      }
      if (typeof window.updateOrderingGridDisplay === 'function') window.updateOrderingGridDisplay();
      else saveGrid(GRID_KEYS.order, window.orderingGridItems);
      gridToast('Added ' + partNumber + ' to Ordering Grid (' + window.orderingGridItems.length + ' item(s) queued)');
      return;
    }
    const transferBtn = event.target.closest('[data-pm-transfer-grid]');
    if (transferBtn) {
      event.preventDefault();
      if (typeof window.addToStockTransferGrid !== 'function') return;
      window.addToStockTransferGrid({
        source: transferBtn.getAttribute('data-location') || 'Warehouse 1',
        part_number: transferBtn.getAttribute('data-part-number') || '',
        part_name: transferBtn.getAttribute('data-part-name') || '',
        sub_id: transferBtn.getAttribute('data-sub-id') || '',
        unit: transferBtn.getAttribute('data-unit') || '',
      });
      return;
    }    const editBtn = event.target.closest('[data-pm-edit]');
    if (editBtn) {
      event.preventDefault();
      loadPart(editBtn.getAttribute('data-pm-edit'));
      return;
    }
    const row = event.target.closest('.pm-db-row');
    if (row && !row.closest('#pm-panel-database') && !event.target.closest('a, button, form')) {
      if (row.getAttribute('data-sold') === '1') {
        window.alert('A part that has been sold cannot be edited or erased.');
        return;
      }
      loadPart(row.getAttribute('data-id'));
    }
  });

  function computeRetail() {
    const cost = parseFloat(document.getElementById('pm-edit-cost').value) || 0;
    const markup = parseFloat(document.getElementById('pm-edit-markup').value) || 0;
    const retail = cost + cost * (markup / 100);
    document.getElementById('pm-edit-retail').value = retail > 0 ? retail.toFixed(2) : '';
  }

  ['pm-edit-cost', 'pm-edit-markup'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', computeRetail);
  });

  function setBarcodeStatus(message, isError) {
    const el = document.getElementById('pm-edit-barcode-status');
    if (!el) return;
    el.textContent = message || '';
    el.style.color = isError ? '#c0392b' : '';
  }

  // Scanning a barcode that was saved before fills the part details from the latest matching record.
  async function lookupEditBarcode() {
    const input = document.getElementById('pm-edit-barcode');
    if (!input) return;
    const code = String(input.value || '').trim();
    const key = code.toUpperCase();
    if (!code) { setBarcodeStatus('', false); input.dataset.lookedUp = ''; return; }
    if (input.dataset.lookedUp === key) return;
    input.dataset.lookedUp = key;
    setBarcodeStatus('Looking up barcode...', false);
    try {
      const res = await fetch('/parts-manager/api/parts/find-by-barcode/' + encodeURIComponent(code), {
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
      });
      if (res.status === 404) {
        setBarcodeStatus('New barcode — fill in the part details; it will be saved with this entry.', false);
        document.getElementById('pm-edit-part-number').focus();
        return;
      }
      const part = await res.json().catch(() => ({}));
      if (!res.ok || !part.found) throw new Error(part.error || 'Barcode lookup failed.');
      const set = (id, value) => { const el = document.getElementById(id); if (el) el.value = value == null ? '' : value; };
      set('pm-edit-part-number', part.part_number);
      set('pm-edit-part-name', part.part_name);
      set('pm-edit-sub-id', part.sub_id);
      set('pm-edit-generic', part.generic);
      set('pm-edit-supplier', part.supplier);
      set('pm-edit-unit', part.unit);
      set('pm-edit-cost', part.cost_price || '');
      set('pm-edit-markup', part.markup || '');
      set('pm-edit-retail', part.retail_price || '');
      setBarcodeStatus('Barcode found: ' + part.part_number + ' — ' + part.part_name + '. Enter the Qty and Receipt #.', false);
      document.getElementById('pm-edit-qty').focus();
    } catch (error) {
      input.dataset.lookedUp = '';
      setBarcodeStatus(String(error.message || error), true);
    }
  }

  const editBarcodeInput = document.getElementById('pm-edit-barcode');
  if (editBarcodeInput) {
    // Barcode scanners type the code then send Enter; don't let that submit the form.
    editBarcodeInput.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      lookupEditBarcode();
    });
    editBarcodeInput.addEventListener('change', lookupEditBarcode);
  }

  const editDateInput = document.getElementById('pm-edit-date');
  if (editDateInput && !editDateInput.value) editDateInput.value = new Date().toISOString().slice(0, 10);

  async function saveNewReceivingEntry() {
    const val = (id) => String((document.getElementById(id) || {}).value || '').trim();
    const entry = {
      barcode: val('pm-edit-barcode'),
      transaction_date: val('pm-edit-date'),
      present_location: val('pm-edit-location'),
      part_number: val('pm-edit-part-number'),
      part_name: val('pm-edit-part-name'),
      sub_id: val('pm-edit-sub-id'),
      generic: val('pm-edit-generic'),
      supplier: val('pm-edit-supplier'),
      receiving_receipt_number: val('pm-edit-receiving-receipt'),
      unit: val('pm-edit-unit'),
      qty: val('pm-edit-qty'),
      cost_price: val('pm-edit-cost'),
      markup: val('pm-edit-markup'),
      retail_price: val('pm-edit-retail'),
    };
    if (!(Number(entry.qty) > 0)) {
      window.alert('Qty must be greater than 0.');
      return;
    }
    const saveBtn = document.getElementById('pm-edit-save-btn');
    if (saveBtn) saveBtn.disabled = true;
    try {
      const res = await fetch('/parts-manager/api/parts/receiving-entry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ entries: [entry] }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || !payload.ok || !payload.created) {
        throw new Error((payload.errors && payload.errors.join('\n')) || payload.error || 'Could not save receiving entry.');
      }
      const record = payload.records[0] || {};
      const url = new URL(window.location.href);
      url.searchParams.set('panel', 'edit');
      url.searchParams.delete('error');
      url.searchParams.set('success', (record.transaction_type === 'new' ? 'New' : 'Stock') + ' received: ' + entry.part_number + ' (' + (record.transaction_number || 'new entry') + ') at ' + (record.present_location || entry.present_location) + '.');
      window.location.href = url.toString();
    } catch (error) {
      window.alert(error.message || error);
      if (saveBtn) saveBtn.disabled = false;
    }
  }

  if (editForm) {
    editForm.addEventListener('submit', (event) => {
      const id = document.getElementById('pm-edit-id').value;
      if (!id) {
        event.preventDefault();
        saveNewReceivingEntry();
      }
    });
  }

  if (editCancelBtn) {
    editCancelBtn.addEventListener('click', () => {
      openPanel('health');
    });
  }

  if (editDeleteForm) {
    editDeleteForm.addEventListener('submit', (event) => {
      if (!document.getElementById('pm-edit-id').value) {
        event.preventDefault();
        return;
      }
      if (!window.confirm('Remove this part from the Parts Database? Audit history will be kept.')) {
        event.preventDefault();
      }
    });
  }

  async function postJson(url) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: '{}',
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => ({ error: 'Request failed.' }));
      window.alert(payload.error || 'Request failed.');
      return;
    }
    window.location.reload();
  }

  root.addEventListener('click', (event) => {
    const resolveBtn = event.target.closest('[data-pm-resolve]');
    if (resolveBtn) {
      const id = resolveBtn.getAttribute('data-pm-resolve');
      const decision = resolveBtn.getAttribute('data-decision');
      fetch('/parts-manager/api/parts-requests/' + encodeURIComponent(id) + '/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ decision }),
      }).then(async (res) => {
        if (!res.ok) {
          const payload = await res.json().catch(() => ({ error: 'Could not resolve request.' }));
          window.alert(payload.error || 'Could not resolve request.');
          return;
        }
        window.location.reload();
      });
      return;
    }
    const completeBtn = event.target.closest('[data-pm-complete-transfer]');
    if (completeBtn) {
      postJson('/parts-manager/api/transfers/' + encodeURIComponent(completeBtn.getAttribute('data-pm-complete-transfer')) + '/complete');
      return;
    }
    const receiveBtn = event.target.closest('[data-pm-receive-po]');
    if (receiveBtn) {
      if (!window.confirm('Receive every line still to receive on this PO? Stock will be added for all of them.')) return;
      postJson('/parts-manager/api/purchase-orders/' + encodeURIComponent(receiveBtn.getAttribute('data-pm-receive-po')) + '/receive');
      return;
    }
    const toggleLinesBtn = event.target.closest('[data-pm-toggle-po-lines]');
    if (toggleLinesBtn) {
      const id = toggleLinesBtn.getAttribute('data-pm-toggle-po-lines');
      const linesRow = Array.from(root.querySelectorAll('[data-pm-po-lines-for]')).find((el) => el.getAttribute('data-pm-po-lines-for') === id);
      if (linesRow) linesRow.hidden = !linesRow.hidden;
      return;
    }
    const removeLinesBtn = event.target.closest('[data-pm-remove-po-lines]');
    if (removeLinesBtn) {
      const id = removeLinesBtn.getAttribute('data-pm-remove-po-lines');
      const box = removeLinesBtn.closest('.pm-po-lines-box');
      const picked = Array.from(box.querySelectorAll('[data-pm-po-line]:checked')).map((el) => Number(el.getAttribute('data-pm-po-line')));
      if (!picked.length) {
        window.alert('Tick the lines confirmed as not arriving first.');
        return;
      }
      if (!window.confirm('Remove ' + picked.length + ' line(s) from this PO? The PO closes once every remaining line is received.')) return;
      removeLinesBtn.disabled = true;
      fetch('/parts-manager/api/purchase-orders/' + encodeURIComponent(id) + '/remove-lines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ lines: picked }),
      }).then(async (res) => {
        const payload = await res.json().catch(() => ({}));
        if (!res.ok || !payload.ok) throw new Error(payload.error || 'Could not remove the lines.');
        const url = new URL(window.location.href);
        url.searchParams.set('panel', 'proc-po-records');
        url.searchParams.delete('error');
        url.searchParams.set('success', payload.message);
        window.location.href = url.toString();
      }).catch((error) => {
        window.alert(error.message || error);
        removeLinesBtn.disabled = false;
      });
      return;
    }
    const copyBtn = event.target.closest('[data-pm-copy-po]');
    if (copyBtn) {
      const number = copyBtn.getAttribute('data-pm-copy-po');
      const done = () => {
        copyBtn.textContent = 'Copied';
        setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(number).then(done, () => window.prompt('Copy the PO number:', number));
      } else {
        window.prompt('Copy the PO number:', number);
      }
    }
  });

  (function bindPartRequestPopup() {
    const overlay = document.getElementById('pm-request-popup');
    const list = document.getElementById('pm-request-popup-list');
    const okBtn = document.getElementById('pm-request-popup-ok');
    if (!overlay || !list || !okBtn) return;
    const seenKey = 'pm_part_request_popup_seen';

    function seenIds() {
      try {
        return JSON.parse(sessionStorage.getItem(seenKey) || '[]');
      } catch (error) {
        return [];
      }
    }

    function markSeen(ids) {
      const next = Array.from(new Set(seenIds().concat(ids)));
      sessionStorage.setItem(seenKey, JSON.stringify(next));
    }

    function hide() {
      overlay.hidden = true;
    }

    function show(items) {
      const unseen = (items || []).filter((row) => row && row.id && seenIds().indexOf(row.id) === -1);
      if (!unseen.length) return;
      list.innerHTML = unseen.map((row) => (
        '<li>' + String(row.message || ('Branch ' + (row.branch || '') + ' requesting a Parts- Part#' + (row.part_number || ''))).replace(/</g, '&lt;') + '</li>'
      )).join('');
      overlay.hidden = false;
      overlay.dataset.seenIds = unseen.map((row) => row.id).join(',');
      okBtn.focus();
    }

    function parseInitial() {
      try {
        return JSON.parse(decodeURIComponent(root.getAttribute('data-pending-requests') || '%5B%5D'));
      } catch (error) {
        return [];
      }
    }

    okBtn.addEventListener('click', function () {
      const ids = String(overlay.dataset.seenIds || '').split(',').filter(Boolean);
      markSeen(ids);
      hide();
    });
    overlay.addEventListener('click', function (event) {
      if (event.target === overlay) okBtn.click();
    });

    show(parseInitial());
    setInterval(function () {
      if (!overlay.hidden) return;
      fetch('/parts-manager/api/part-request-popups', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
        .then(function (res) { return res.json(); })
        .then(function (data) { show(data && data.items ? data.items : []); })
        .catch(function () { /* keep the workspace usable if the popup poll fails */ });
    }, 15000);
  })();

  // Parts DB Health Monitoring Panel
  (function () {
    const selectAllCheckbox = document.getElementById('pm-health-select-all');
    const rowCheckboxes = Array.from(document.querySelectorAll('.pm-health-row-check'));
    const transferBtn = document.getElementById('pm-health-transfer-btn');
    const stockTransferBtn = document.getElementById('pm-health-stock-transfer-btn');
    const editSelectedBtn = document.getElementById('pm-health-edit-btn');
    const countDisplay = document.getElementById('pm-health-count');
    const modal = document.getElementById('pm-health-transfer-modal');
    const cancelTransferBtn = document.getElementById('pm-health-cancel-transfer');
    const confirmTransferBtn = document.getElementById('pm-health-confirm-transfer');
    const transferList = document.getElementById('pm-health-transfer-list');
    const transferCalcs = document.getElementById('pm-health-transfer-calcs');

    if (!selectAllCheckbox || !transferBtn || !stockTransferBtn || !editSelectedBtn || !modal) return;

    function updateCheckboxState() {
      const checked = rowCheckboxes.filter((cb) => cb.checked).length;
      const total = rowCheckboxes.length;

      selectAllCheckbox.checked = checked === total && total > 0;
      selectAllCheckbox.indeterminate = checked > 0 && checked < total;

      transferBtn.disabled = checked === 0;
      stockTransferBtn.disabled = checked === 0;
      editSelectedBtn.disabled = checked !== 1;
      countDisplay.textContent = checked > 0 ? `${checked} item${checked !== 1 ? 's' : ''} selected` : '';
    }

    selectAllCheckbox.addEventListener('change', () => {
      rowCheckboxes.forEach((cb) => {
        cb.checked = selectAllCheckbox.checked;
      });
      updateCheckboxState();
    });

    rowCheckboxes.forEach((cb) => {
      cb.addEventListener('change', updateCheckboxState);
    });

    editSelectedBtn.addEventListener('click', () => {
      const selected = rowCheckboxes.filter((cb) => cb.checked);
      if (selected.length !== 1) return;
      loadPart(selected[0].dataset.partId);
    });

    stockTransferBtn.addEventListener('click', () => {
      const selected = rowCheckboxes.filter((cb) => cb.checked);
      if (!selected.length || typeof window.stageHealthRowsForStockTransfer !== 'function') return;
      const items = selected.map((cb) => {
        const row = cb.closest('tr');
        const cells = row ? row.querySelectorAll('td') : [];
        return {
          id: cb.dataset.partId,
          part_number: row ? row.getAttribute('data-part-num') : '',
          part_name: cells[2] ? cells[2].textContent.trim() : '',
          location: cells[3] ? cells[3].textContent.trim() : 'Unassigned',
          source_location: row ? (row.getAttribute('data-source-location') || 'Warehouse 1') : 'Warehouse 1',
          current_stock: cells[5] ? Number.parseInt(cells[5].textContent, 10) || 0 : 0,
          safety_stock: cells[6] ? Number.parseInt(cells[6].textContent, 10) || 5 : 5,
          suggested_qty: cells[6] && cells[5]
            ? Math.max(1, (Number.parseInt(cells[6].textContent, 10) || 5) - (Number.parseInt(cells[5].textContent, 10) || 0))
            : 1,
        };
      });
      window.stageHealthRowsForStockTransfer(items);
    });

    transferBtn.addEventListener('click', () => {
      const selected = rowCheckboxes.filter((cb) => cb.checked);
      if (selected.length === 0) return;

      const items = selected.map((cb) => {
        const row = cb.closest('tr');
        const partNum = row.getAttribute('data-part-num');
        const partName = row.querySelector('td:nth-child(3)').textContent;
        const location = row.querySelector('td:nth-child(4)').textContent.trim();
        const currentStock = parseInt(row.querySelector('td:nth-child(6)').textContent) || 0;
        const safetyStock = parseInt(row.querySelector('td:nth-child(7)').textContent) || 5;

        return {
          id: cb.dataset.partId,
          part_number: partNum,
          part_name: partName,
          location,
          current_stock: currentStock,
          safety_stock: safetyStock,
          suggested_qty: Math.max(0, safetyStock - currentStock),
        };
      });

      // Populate modal
      transferList.innerHTML = items.map((item) => `
        <div style="background:#f8f9fa;padding:8px;margin-bottom:8px;border-radius:3px;">
          <div style="font-weight:bold;font-size:12px;">${item.part_number}</div>
          <div style="font-size:11px;color:#555;margin:4px 0;">
            <div>Location: <strong>${item.location || 'Unassigned'}</strong></div>
            <div>Current Stock: <strong>${item.current_stock}</strong></div>
            <div>Safety Stock: <strong>${item.safety_stock}</strong></div>
          </div>
          <div style="font-size:11px;">
            <label>Suggested Order Qty:
              <input type="number" class="pm-health-order-qty" data-part-id="${item.id}" value="${item.suggested_qty}" min="0" step="1" style="width:60px;padding:2px;border:1px solid #ccc;border-radius:2px;" />
            </label>
          </div>
        </div>
      `).join('');

      transferCalcs.innerHTML = items.map((item) => `
        <div>${item.part_number}: Safety (${item.safety_stock}) - Current (${item.current_stock}) = <strong>${item.suggested_qty}</strong></div>
      `).join('');

      modal.style.display = 'block';
    });

    cancelTransferBtn.addEventListener('click', () => {
      modal.style.display = 'none';
    });

    confirmTransferBtn.addEventListener('click', async () => {
      const qtyInputs = transferList.querySelectorAll('.pm-health-order-qty');
      const transferData = [];
      const selectedRows = [];

      qtyInputs.forEach((input) => {
        const qty = parseInt(input.value) || 0;
        const partId = input.dataset.partId;
        const row = document.querySelector(`tr[data-part-id="${partId}"]`);
        
        if (qty > 0 && row) {
          const partNum = row.getAttribute('data-part-num');
          const cells = Array.from(row.querySelectorAll('td'));
          
          // Extract from cells: 0=checkbox, 1=Part#, 2=Name, 3=Location, 4=Supplier, 5=Stock, 6=Safety, 7=Status
          const partName = (cells[2] || {}).textContent?.trim() || '—';
          const location = (cells[3] || {}).textContent?.trim() || 'Unassigned';
          const supplier = (cells[4] || {}).textContent?.trim() || '—';
          const currentStockText = (cells[5] || {}).textContent?.trim() || '0';
          const safetyStockText = (cells[6] || {}).textContent?.trim() || '5';
          
          const currentStock = parseInt(currentStockText.replace(/[^\d-]/g, '')) || 0;
          const safetyStock = parseInt(safetyStockText.replace(/[^\d-]/g, '')) || 5;

          selectedRows.push({
            id: partId,
            part_number: partNum,
            part_name: partName,
            location: location,
            supplier: supplier,
            current_stock: currentStock,
            safety_stock: safetyStock,
            order_qty: qty
          });

          transferData.push({ part_id: partId, order_qty: qty });
        }
      });

      if (selectedRows.length === 0) {
        alert('Please enter at least one order quantity greater than 0.');
        return;
      }

      confirmTransferBtn.disabled = true;
      confirmTransferBtn.textContent = 'Transferring...';

      try {
        // Send items to Ordering Grid
        window.orderingGridItems = window.orderingGridItems || [];
        selectedRows.forEach((item) => {
          // Check if item already in grid
          const exists = window.orderingGridItems.some((i) => i.id === item.id);
          if (!exists) {
            window.orderingGridItems.push(item);
          }
        });

        // Update ordering grid display
        if (typeof window.updateOrderingGridDisplay === 'function') {
          window.updateOrderingGridDisplay();
        }

        // Clear health monitor selections
        rowCheckboxes.forEach((cb) => {
          if (cb.checked) {
            cb.checked = false;
          }
        });

        selectAllCheckbox.checked = false;
        updateCheckboxState();
        modal.style.display = 'none';

        alert(`✓ Successfully transferred ${selectedRows.length} item${selectedRows.length !== 1 ? 's' : ''} to ordering grid!\n\nClick "Panel 7: Ordering Grid" to view and manage.`);
      } catch (err) {
        alert('Error transferring items: ' + err.message);
        console.error('Transfer error:', err);
      } finally {
        confirmTransferBtn.disabled = false;
        confirmTransferBtn.textContent = '✓ Confirm & Send to Ordering Grid';
      }
    });

    // Close modal on background click
    modal.addEventListener('click', (event) => {
      if (event.target === modal) {
        modal.style.display = 'none';
      }
    });

    updateCheckboxState();
  })();

  // Stage selected health rows in the existing pending stock-transfer workflow.
  (function () {
    const transferGridBody = document.getElementById('pm-health-stock-transfer-body');
    const transferGridSubmit = document.getElementById('pm-health-stock-transfer-submit');
    const transferGridCancel = document.getElementById('pm-health-stock-transfer-cancel');
    const transferGridStatus = document.getElementById('pm-health-stock-transfer-status');
    const locations = JSON.parse(decodeURIComponent(root.getAttribute('data-transfer-locations') || '%5B%5D'));
    let stagedRows = loadGrid(GRID_KEYS.transfer);

    if (!transferGridBody || !transferGridSubmit || !transferGridCancel) return;
    const fillDest = document.getElementById('pm-health-transfer-fill-dest');
    const splitLabel = document.getElementById('pm-health-transfer-split');
    const resultBox = document.getElementById('pm-health-transfer-result');
    if (fillDest) {
      fillDest.innerHTML = '<option value="">—</option>' + locations.map((location) => `<option value="${escapeHtml(location)}">${escapeHtml(location)}</option>`).join('');
      fillDest.addEventListener('change', () => {
        const value = fillDest.value;
        if (!value) return;
        stagedRows.forEach((row) => { if (!row.destination && row.source !== value) row.destination = value; });
        fillDest.value = '';
        renderTransferGrid();
      });
    }

    // One PTN per source -> destination pair.
    function splitGroups() {
      const groups = new Map();
      stagedRows.forEach((item, index) => {
        const key = item.destination ? item.source + '|' + item.destination : '|unassigned';
        if (!groups.has(key)) groups.set(key, { source: item.source, destination: item.destination, indexes: [] });
        groups.get(key).indexes.push(index);
      });
      return Array.from(groups.values()).sort((a, b) => (!a.destination) - (!b.destination) || String(a.destination).localeCompare(String(b.destination)));
    }

    function renderTransferGrid() {
      saveGrid(GRID_KEYS.transfer, stagedRows);
      transferGridSubmit.disabled = stagedRows.length === 0;
      if (!stagedRows.length) {
        transferGridBody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:16px;color:#666;">Select critical rows in Health Monitoring first.</td></tr>';
        if (splitLabel) splitLabel.textContent = '';
        return;
      }
      const groups = splitGroups();
      const ready = groups.filter((g) => g.destination);
      const unassigned = groups.find((g) => !g.destination);
      if (splitLabel) {
        splitLabel.textContent = `${stagedRows.length} line(s) → ${ready.length} PTN(s)`
          + (ready.length ? ' [' + ready.map((g) => g.destination + ': ' + g.indexes.length).join(', ') + ']' : '')
          + (unassigned ? ` — ${unassigned.indexes.length} line(s) still need a destination` : '');
      }
      transferGridSubmit.textContent = ready.length > 1 ? `File ${ready.length} Stock Transfer Requests (${ready.length} PTNs)` : 'File Stock Transfer Request';
      let ptn = 0;
      transferGridBody.innerHTML = groups.map((group) => {
        const header = group.destination
          ? `PTN ${++ptn} of ${ready.length} — ${escapeHtml(group.source)} → ${escapeHtml(group.destination)} (${group.indexes.length} line${group.indexes.length === 1 ? '' : 's'}, qty ${group.indexes.reduce((s, i) => s + (Number(stagedRows[i].qty) || 0), 0)})`
          : `No destination yet (${group.indexes.length} line${group.indexes.length === 1 ? '' : 's'}) — choose a destination branch`;
        const head = `<tr class="pm-transfer-split-head"><td colspan="6" style="background:${group.destination ? '#f4ecf7' : '#fdecea'};font-weight:700;color:${group.destination ? '#6c3483' : '#c0392b'};">${header}</td></tr>`;
        return head + group.indexes.map((index) => {
          const item = stagedRows[index];
          return `
        <tr data-transfer-index="${index}">
          <td>${escapeHtml(item.source)}</td>
          <td><select class="pm-health-transfer-destination" data-index="${index}">
            <option value="">Select destination</option>
            ${locations.filter((location) => location !== item.source).map((location) => `<option value="${escapeHtml(location)}"${location === item.destination ? ' selected' : ''}>${escapeHtml(location)}</option>`).join('')}
          </select></td>
          <td>${escapeHtml(item.part_number)}</td>
          <td>${escapeHtml(item.part_name || '—')}</td>
          <td><input type="number" class="pm-health-transfer-qty" data-index="${index}" value="${item.qty}" min="1" step="1" style="width:70px;" /></td>
          <td><button type="button" class="btn pm-health-transfer-remove" data-index="${index}">Remove</button></td>
        </tr>`;
        }).join('');
      }).join('');
    }

    transferGridBody.addEventListener('change', (event) => {
      const index = Number(event.target.dataset.index);
      if (!Number.isInteger(index) || !stagedRows[index]) return;
      if (event.target.classList.contains('pm-health-transfer-destination')) {
        stagedRows[index].destination = event.target.value;
        renderTransferGrid();
        return;
      }
      if (event.target.classList.contains('pm-health-transfer-qty')) stagedRows[index].qty = Math.max(1, Number(event.target.value) || 1);
      saveGrid(GRID_KEYS.transfer, stagedRows);
      renderTransferGrid();
    });

    transferGridBody.addEventListener('click', (event) => {
      const button = event.target.closest('.pm-health-transfer-remove');
      if (!button) return;
      stagedRows.splice(Number(button.dataset.index), 1);
      renderTransferGrid();
    });

    transferGridCancel.addEventListener('click', () => {
      stagedRows = [];
      renderTransferGrid();
      openPanel('health');
    });

    transferGridSubmit.addEventListener('click', async () => {
      if (stagedRows.some((item) => !item.destination || item.destination === item.source || item.qty < 1)) {
        transferGridStatus.textContent = 'Choose a different destination and valid quantity for every row.';
        return;
      }
      const groups = splitGroups();
      if (!window.confirm(`File ${groups.length} stock transfer request(s)?\n\n` + groups.map((g, i) => `PTN ${i + 1}: ${g.source} → ${g.destination} (${g.indexes.length} line(s))`).join('\n'))) return;
      transferGridSubmit.disabled = true;
      transferGridStatus.textContent = `Filing ${groups.length} stock transfer request(s)...`;
      try {
        const lines = stagedRows.map((item) => ({ from_branch: item.source, to_branch: item.destination, part_number: item.part_number, part_name: item.part_name, sub_id: item.sub_id, qty: item.qty, unit: item.unit || '' }));
        const response = await fetch('/parts-manager/transfers/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ lines }),
          credentials: 'same-origin',
        });
        const json = await response.json().catch(() => ({}));
        if (!response.ok || !json.ok) throw new Error(json.error || 'Transfer filing failed.');
        stagedRows = [];
        saveGrid(GRID_KEYS.transfer, stagedRows);
        renderTransferGrid();
        transferGridStatus.textContent = '';
        if (resultBox) {
          resultBox.style.display = '';
          resultBox.innerHTML = `<strong>${escapeHtml(json.message)}</strong><table class="list" style="margin-top:8px;font-size:12px;"><thead><tr><th>PTN #</th><th>Packing List</th><th>Transmittal</th><th>Route</th><th>Lines</th><th>Qty</th><th>Status</th></tr></thead><tbody>`
            + json.transfers.map((t) => `<tr><td><strong>${escapeHtml(t.transaction_number)}</strong></td>`
              + `<td><a href="/parts-manager/print/packing/${encodeURIComponent(t.id)}" target="_blank" rel="noopener">${escapeHtml(t.packing_list_number)}</a></td>`
              + `<td><a href="/parts-manager/print/transmittal/${encodeURIComponent(t.id)}" target="_blank" rel="noopener">${escapeHtml(t.transmittal_number)}</a></td>`
              + `<td>${escapeHtml(t.from_branch)} → ${escapeHtml(t.to_branch)}</td><td>${t.lines}</td><td>${t.qty}</td><td>${t.auto_approved ? 'Auto-approved' : 'Pending GM approval'}</td></tr>`).join('')
            + '</tbody></table><a class="btn" href="/parts-manager?panel=approvals#pending-transfers" style="margin-top:8px;display:inline-block;">Go to Approvals</a>';
        }
      } catch (error) {
        transferGridStatus.textContent = error.message || 'Transfer filing failed.';
        transferGridSubmit.disabled = false;
      }
    });

    // Accumulates only while every staged row shares the same source branch; a different branch starts a new batch.
    window.addToStockTransferGrid = function (item) {
      const source = item.source || 'Warehouse 1';
      if (stagedRows.length && stagedRows[0].source !== source) {
        const ok = window.confirm('The Stock Transfer Grid holds parts from ' + stagedRows[0].source + '. Parts from ' + source + ' cannot be combined with it.\n\nClear the grid and start a new transfer from ' + source + '?');
        if (!ok) return false;
        stagedRows = [];
      }
      const existing = stagedRows.find((row) => row.part_number === item.part_number && row.sub_id === (item.sub_id || ''));
      if (existing) {
        existing.qty += 1;
      } else {
        stagedRows.push({ source, part_number: item.part_number, part_name: item.part_name || '', sub_id: item.sub_id || '', qty: 1, unit: item.unit || '', destination: '' });
      }
      renderTransferGrid();
      gridToast('Added ' + item.part_number + ' to Stock Transfer Grid (' + stagedRows.length + ' item(s) queued)');
      return true;
    };
    renderTransferGrid();
    window.stageHealthRowsForStockTransfer = function (items) {
      if (resultBox) resultBox.style.display = 'none';
      stagedRows = (items || []).map((item) => {
        const source = item.source_location || 'Warehouse 1';
        const location = String(item.location || '').trim();
        const destination = locations.includes(location) && location !== source ? location : '';
        return { source, part_number: item.part_number, part_name: item.part_name, sub_id: item.sub_id || '', qty: Math.max(1, Number(item.suggested_qty || 1)), unit: item.unit || '', destination };
      });
      renderTransferGrid();
      openPanel('health-transfer');
    };
  })();

  // Ordering Grid Panel
  function updateOrderingGridDisplay() {
    const items = window.orderingGridItems || [];
    const tbody = document.getElementById('pm-ordering-body');
    const countDisplay = document.getElementById('pm-ordering-count');
    const selectionCount = document.getElementById('pm-ordering-selection-count');
    const createPoBtn = document.getElementById('pm-ordering-create-po');
    const sendSupplierBtn = document.getElementById('pm-ordering-send-supplier');

    if (!tbody) return;

    countDisplay.textContent = items.length;
    saveGrid(GRID_KEYS.order, items);

    if (items.length === 0) {
      tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:20px;color:#999;">No items in ordering queue. Transfer items from Health Monitor panel.</td></tr>';
      createPoBtn.disabled = true;
      sendSupplierBtn.disabled = true;
      return;
    }

    tbody.innerHTML = items.map((item, idx) => `
      <tr data-order-id="${item.id}">
        <td style="text-align:center;"><input type="checkbox" class="pm-ordering-check" data-order-id="${item.id}" /></td>
        <td><strong>${item.part_number || '—'}</strong></td>
        <td>${item.part_name || '—'}</td>
        <td>${item.location || 'Unassigned'}</td>
        <td>${item.supplier || '—'}</td>
        <td style="text-align:right;">${item.current_stock || 0}</td>
        <td style="text-align:right;">${item.safety_stock || 5}</td>
        <td style="text-align:right;">${item.order_qty || 0}</td>
        <td style="text-align:right;">
          <input type="number" class="pm-ordering-qty-input" data-order-id="${item.id}" value="${item.order_qty || 0}" min="0" step="1" style="width:70px;padding:4px;border:1px solid #ccc;border-radius:2px;" />
        </td>
        <td style="text-align:center;">
          <button type="button" class="pm-ordering-remove" data-order-id="${item.id}" style="background:#e74c3c;color:white;border:none;padding:4px 8px;border-radius:2px;cursor:pointer;font-size:11px;">Remove</button>
        </td>
      </tr>
    `).join('');

    // Attach qty input listeners
    tbody.querySelectorAll('.pm-ordering-qty-input').forEach((input) => {
      input.addEventListener('change', (e) => {
        const orderId = e.target.dataset.orderId;
        const newQty = parseInt(e.target.value) || 0;
        const item = items.find((i) => i.id === orderId);
        if (item) item.order_qty = newQty;
        saveGrid(GRID_KEYS.order, items);
      });
    });

    // Attach remove listeners
    tbody.querySelectorAll('.pm-ordering-remove').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const orderId = e.currentTarget.dataset.orderId;
        window.orderingGridItems = items.filter((i) => i.id !== orderId);
        updateOrderingGridDisplay();
      });
    });

    // Update button state
    const checked = tbody.querySelectorAll('.pm-ordering-check:checked').length;
    selectionCount.textContent = checked > 0 ? `${checked} item${checked !== 1 ? 's' : ''} selected` : '';
    createPoBtn.disabled = checked === 0;
    sendSupplierBtn.disabled = checked === 0;

    // Attach checkbox listeners
    tbody.querySelectorAll('.pm-ordering-check').forEach((cb) => {
      cb.addEventListener('change', () => {
        const checked = tbody.querySelectorAll('.pm-ordering-check:checked').length;
        selectionCount.textContent = checked > 0 ? `${checked} item${checked !== 1 ? 's' : ''} selected` : '';
        createPoBtn.disabled = checked === 0;
        sendSupplierBtn.disabled = checked === 0;
      });
    });
  }

  // Expose to window so it can be called from openPanel
  window.updateOrderingGridDisplay = updateOrderingGridDisplay;

  // Ordering Grid Button Handlers
  (function () {
    const createPoBtn = document.getElementById('pm-ordering-create-po');
    const sendSupplierBtn = document.getElementById('pm-ordering-send-supplier');
    const clearBtn = document.getElementById('pm-ordering-clear');
    const poModal = document.getElementById('pm-ordering-po-modal');
    const poCancelBtn = document.getElementById('pm-ordering-po-cancel');
    const poConfirmBtn = document.getElementById('pm-ordering-po-confirm');
    const supplierInput = document.getElementById('pm-ordering-supplier-input');
    const locationSelect = document.getElementById('pm-ordering-location-select');
    const poPreview = document.getElementById('pm-ordering-po-preview');
    const tbody = document.getElementById('pm-ordering-body');

    if (!createPoBtn || !poModal || !tbody) return;

    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        if (window.confirm('Clear all items from ordering queue?')) {
          window.orderingGridItems = [];
          updateOrderingGridDisplay();
        }
      });
    }

    createPoBtn.addEventListener('click', () => {
      const checked = Array.from(tbody.querySelectorAll('.pm-ordering-check:checked'));
      if (checked.length === 0) {
        alert('Select at least one item.');
        return;
      }

      const items = window.orderingGridItems || [];
      const selectedIds = checked.map((cb) => cb.dataset.orderId);
      const selectedItems = items.filter((i) => selectedIds.includes(i.id));

      // Store selected items for PO creation
      window.selectedItemsForPO = selectedItems;

      poPreview.innerHTML = selectedItems.map((item) => `
        <div style="margin-bottom:6px;padding:6px;background:white;border-radius:2px;">
          <div><strong>${item.part_number}</strong> - ${item.part_name}</div>
          <div style="color:#666;">Location: ${item.location || 'Unassigned'} | Supplier: ${item.supplier || '(No supplier)'} | Qty: ${item.order_qty || 0}</div>
        </div>
      `).join('');

      poModal.style.display = 'block';
    });

    poCancelBtn.addEventListener('click', () => {
      poModal.style.display = 'none';
      supplierInput.value = '';
      locationSelect.value = '';
      window.selectedItemsForPO = null;
    });

    poConfirmBtn.addEventListener('click', async () => {
      const supplier = supplierInput.value.trim();
      const location = locationSelect.value.trim();

      if (!supplier) {
        alert('Enter supplier name.');
        return;
      }
      if (!location) {
        alert('Select delivery location.');
        return;
      }

      if (!window.selectedItemsForPO || window.selectedItemsForPO.length === 0) {
        alert('No items selected.');
        return;
      }

      poConfirmBtn.disabled = true;
      poConfirmBtn.textContent = 'Creating PO...';

      try {
        // Call backend to create PO
        const poData = {
          supplier: supplier,
          location: location,
          items: window.selectedItemsForPO.map((item) => ({
            part_number: item.part_number,
            part_name: item.part_name,
            supplier: item.supplier,
            qty: item.order_qty,
            unit: 'pcs',
          })),
        };

        const res = await fetch('/parts-manager/api/purchase-orders-create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify(poData),
        });

        const data = await res.json();

        if (!res.ok || !data.ok) {
          alert('Error creating PO: ' + (data.error || 'Unknown error'));
          poConfirmBtn.disabled = false;
          poConfirmBtn.textContent = '✓ Create PO';
          return;
        }

        // Show formatted PO
        showFormattedPO(data.po, supplier, location, window.selectedItemsForPO);

        // Clear modal and form
        poModal.style.display = 'none';
        supplierInput.value = '';
        locationSelect.value = '';

        // Store PO for approval workflow
        window.currentPOForApproval = data.po;
      } catch (err) {
        alert('Network error: ' + err.message);
        console.error('PO creation error:', err);
      } finally {
        poConfirmBtn.disabled = false;
        poConfirmBtn.textContent = '✓ Create PO';
      }
    });

    // Close modal on background click
    poModal.addEventListener('click', (event) => {
      if (event.target === poModal) {
        poModal.style.display = 'none';
      }
    });

    // Initial display
    updateOrderingGridDisplay();
  })();

  // Formatted PO Display Function
  function showFormattedPO(po, supplier, location, items) {
    // Create PO display container if doesn't exist
    let poDisplay = document.getElementById('pm-po-formatted-display');
    if (!poDisplay) {
      poDisplay = document.createElement('div');
      poDisplay.id = 'pm-po-formatted-display';
      poDisplay.style.cssText = 'display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);z-index:3000;overflow-y:auto;padding:20px;';
      document.body.appendChild(poDisplay);
    }

    const totalQty = items.reduce((sum, item) => sum + (item.order_qty || 0), 0);
    const totalValue = items.reduce((sum, item) => sum + (item.order_qty * 100), 0); // Placeholder, use actual pricing

    const poHTML = `
      <div style="background:white;border-radius:6px;max-width:800px;margin:20px auto;padding:40px;box-shadow:0 8px 32px rgba(0,0,0,0.2);font-family:'Inter','Segoe UI',Roboto,Arial,sans-serif;">
        <!-- PO Header -->
        <div style="border-bottom:3px solid #1a6bbf;padding-bottom:20px;margin-bottom:30px;">
          <div style="display:grid;grid-template-columns:2fr 1fr;gap:20px;">
            <div>
              <h1 style="margin:0;color:#1a6bbf;font-size:32px;">PURCHASE ORDER</h1>
              <div style="color:#666;font-size:13px;margin-top:8px;">
                <div>PO #: <strong>${po.po_number || 'DRAFT'}</strong></div>
                <div>Date: <strong>${po.stamped_label || new Date().toLocaleDateString()}</strong></div>
              </div>
            </div>
            <div style="text-align:right;font-size:13px;color:#555;">
              <div><strong>Status:</strong> <span style="background:#fff3cd;color:#856404;padding:4px 8px;border-radius:0;display:inline-block;">PENDING APPROVAL</span></div>
              <div style="margin-top:8px;">Transaction #: <strong>${po.transaction_number || 'N/A'}</strong></div>
            </div>
          </div>
        </div>

        <!-- Supplier & Delivery Info -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:30px;margin-bottom:30px;font-size:13px;">
          <div>
            <div style="font-weight:bold;color:#1a6bbf;margin-bottom:8px;">SUPPLIER</div>
            <div style="line-height:1.8;">
              <strong>${supplier}</strong><br/>
              <span style="color:#666;">Contact: (To be updated)</span><br/>
              <span style="color:#666;">Address: (To be updated)</span>
            </div>
          </div>
          <div>
            <div style="font-weight:bold;color:#1a6bbf;margin-bottom:8px;">DELIVERY TO</div>
            <div style="line-height:1.8;">
              <strong>${location}</strong><br/>
              <span style="color:#666;">Warehouse Address</span><br/>
              <span style="color:#666;">Contact: PM Warehouse</span>
            </div>
          </div>
        </div>

        <!-- Items Table -->
        <div style="margin-bottom:30px;">
          <table style="width:100%;border-collapse:collapse;font-size:12px;">
            <thead>
              <tr style="background:#f0f0f0;border-bottom:2px solid #1a6bbf;">
                <th style="padding:10px;text-align:left;">Part Number</th>
                <th style="padding:10px;text-align:left;">Description</th>
                <th style="padding:10px;text-align:center;">Qty</th>
                <th style="padding:10px;text-align:center;">Unit</th>
                <th style="padding:10px;text-align:right;">Supplier</th>
              </tr>
            </thead>
            <tbody>
              ${items.map((item, idx) => `
                <tr style="border-bottom:1px solid #ddd;">
                  <td style="padding:10px;"><strong>${item.part_number || '—'}</strong></td>
                  <td style="padding:10px;">${item.part_name || '—'}</td>
                  <td style="padding:10px;text-align:center;"><strong>${item.order_qty || 0}</strong></td>
                  <td style="padding:10px;text-align:center;">pcs</td>
                  <td style="padding:10px;text-align:right;">${item.supplier || '—'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>

        <!-- Summary -->
        <div style="background:#f9f9f9;padding:16px;border-radius:3px;margin-bottom:30px;font-size:13px;">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:40px;">
            <div>
              <div style="color:#666;margin-bottom:4px;">Total Items:</div>
              <div style="font-size:20px;font-weight:bold;color:#1a6bbf;">${totalQty} units</div>
            </div>
            <div>
              <div style="color:#666;margin-bottom:4px;">PO Status:</div>
              <div style="font-size:16px;font-weight:bold;color:#f39c12;">⏳ Awaiting GM Approval</div>
            </div>
          </div>
        </div>

        <!-- Action Buttons -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px;">
          <button type="button" id="pm-po-print-btn" class="btn" style="background:#3498db;color:white;padding:12px 20px;border:none;border-radius:3px;cursor:pointer;font-weight:bold;">
            🖨 Print PO
          </button>
          <button type="button" id="pm-po-send-approval-btn" class="btn" style="background:#27ae60;color:white;padding:12px 20px;border:none;border-radius:3px;cursor:pointer;font-weight:bold;">
            📤 Send for Approval
          </button>
        </div>

        <div style="text-align:center;">
          <button type="button" id="pm-po-close-btn" class="btn" style="background:#95a5a6;color:white;padding:8px 16px;border:none;border-radius:3px;cursor:pointer;">
            Close
          </button>
        </div>
      </div>
    `;

    poDisplay.innerHTML = poHTML;
    poDisplay.style.display = 'block';

    // Attach event listeners
    document.getElementById('pm-po-print-btn').addEventListener('click', () => {
      window.print();
    });

    document.getElementById('pm-po-close-btn').addEventListener('click', () => {
      poDisplay.style.display = 'none';
    });

    document.getElementById('pm-po-send-approval-btn').addEventListener('click', async () => {
      if (!window.currentPOForApproval) {
        alert('PO data not found.');
        return;
      }

      const sendBtn = document.getElementById('pm-po-send-approval-btn');
      sendBtn.disabled = true;
      sendBtn.textContent = '⏳ Sending...';

      try {
        const res = await fetch('/parts-manager/api/purchase-orders-send-approval', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({
            po_id: window.currentPOForApproval.id,
            po_number: window.currentPOForApproval.po_number,
          }),
        });

        const data = await res.json();

        if (!res.ok || !data.ok) {
          alert('Error: ' + (data.error || 'Failed to send for approval'));
          sendBtn.disabled = false;
          sendBtn.textContent = '📤 Send for Approval';
          return;
        }

        alert(`✓ PO ${window.currentPOForApproval.po_number} sent to GM for approval!\n\nStatus: Pending GM Review`);

        // Clear selected items from ordering grid
        const selectedIds = (window.selectedItemsForPO || []).map((i) => i.id);
        window.orderingGridItems = (window.orderingGridItems || []).filter((i) => !selectedIds.includes(i.id));
        window.updateOrderingGridDisplay();

        // Close display
        poDisplay.style.display = 'none';
        window.currentPOForApproval = null;
        window.selectedItemsForPO = null;
      } catch (err) {
        alert('Network error: ' + err.message);
        console.error('Approval send error:', err);
        sendBtn.disabled = false;
        sendBtn.textContent = '📤 Send for Approval';
      }
    });

    // Close on background click
    poDisplay.addEventListener('click', (event) => {
      if (event.target === poDisplay) {
        poDisplay.style.display = 'none';
      }
    });
  }

  // Parts Database Search and Filter
  (function bindPartsDatabase() {
    const searchInput = document.getElementById('pm-parts-db-search');
    const locationFilter = document.getElementById('pm-parts-db-location-filter');
    const clearBtn = document.getElementById('pm-parts-db-clear-filters');
    const tableBody = document.getElementById('pm-parts-db-body');
    const totalSpan = document.getElementById('pm-parts-db-total');

    if (!searchInput || !tableBody) return;

    function filterTable() {
      const searchTerm = String(searchInput.value || '').trim().toLowerCase();
      const locationTerm = String((locationFilter && locationFilter.value) || '').trim().toLowerCase();
      let visibleCount = 0;

      const rows = Array.from(tableBody.querySelectorAll('.pm-parts-db-row'));
      rows.forEach((row) => {
        const partNumber = String(row.getAttribute('data-part-number') || '').toLowerCase();
        const partName = String(row.getAttribute('data-part-name') || '').toLowerCase();
        const location = String(row.getAttribute('data-location') || '').toLowerCase();

        const matchesSearch = !searchTerm || partNumber.includes(searchTerm) || partName.includes(searchTerm);
        const matchesLocation = !locationTerm || location === locationTerm;
        const shouldShow = matchesSearch && matchesLocation;

        row.style.display = shouldShow ? '' : 'none';
        if (shouldShow) visibleCount++;
      });

      if (totalSpan) totalSpan.textContent = visibleCount;
    }

    if (searchInput) {
      searchInput.addEventListener('input', filterTable);
    }

    if (locationFilter) {
      locationFilter.addEventListener('change', filterTable);
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        if (searchInput) searchInput.value = '';
        if (locationFilter) locationFilter.value = '';
        filterTable();
      });
    }

    // Add to ordering grid from database
    const addBtns = Array.from(tableBody.querySelectorAll('.pm-parts-db-add-btn'));
    addBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const partNumber = btn.getAttribute('data-part-number');
        const partName = btn.getAttribute('data-part-name');
        const supplier = btn.getAttribute('data-supplier');

        if (!partNumber) {
          alert('Part number is required');
          return;
        }

        // Initialize ordering grid items if needed
        if (!window.orderingGridItems) window.orderingGridItems = [];

        // Check if already in grid
        const exists = window.orderingGridItems.some((item) => item.part_number === partNumber);
        if (exists) {
          alert(`Part ${partNumber} is already in the ordering grid`);
          return;
        }

        // Add to ordering grid
        const newItem = {
          id: 'item_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
          part_number: partNumber,
          part_name: partName,
          supplier: supplier,
          order_qty: 1,
        };

        window.orderingGridItems.push(newItem);

        // Refresh the ordering grid display
        if (typeof window.updateOrderingGridDisplay === 'function') {
          window.updateOrderingGridDisplay();
        }

        // Switch to ordering panel
        openPanel('ordering');

        // Visual feedback
        alert(`✓ ${partNumber} added to ordering grid!`);
      });
    });

    // Initialize counts
    filterTable();
  })();

  // Approved PO Viewer
  (function bindApprovedPOViewer() {
    const viewBtns = Array.from(document.querySelectorAll('.pm-approved-po-view-btn'));
    
    viewBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const poJson = btn.getAttribute('data-po-json');
        if (!poJson) {
          alert('Error: PO data not found');
          return;
        }

        try {
          // Parse JSON and unescape HTML entities
          const poStr = poJson.replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
          const po = JSON.parse(poStr);

          // Create modal overlay
          const modal = document.createElement('div');
          modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:2000;display:flex;justify-content:center;align-items:center;';

          const content = document.createElement('div');
          content.style.cssText = 'background:white;border-radius:8px;padding:20px;max-width:700px;width:90%;max-height:80vh;overflow-y:auto;box-shadow:0 4px 20px rgba(0,0,0,0.3);';

          let html = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;border-bottom:2px solid #ecf0f1;padding-bottom:12px;">
              <h3 style="margin:0;">Purchase Order Details</h3>
              <button type="button" style="background:none;border:none;font-size:24px;cursor:pointer;color:#999;">&times;</button>
            </div>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:15px;margin-bottom:20px;">
              <div>
                <div style="font-weight:bold;color:#666;font-size:0.9em;">PO Number</div>
                <div style="font-size:1.1em;"><strong>${po.po_number || po.id || 'N/A'}</strong></div>
              </div>
              <div>
                <div style="font-weight:bold;color:#666;font-size:0.9em;">Status</div>
                <div style="font-size:1em;"><span style="background:#27ae60;color:white;padding:3px 8px;border-radius:0;font-size:0.9em;">✓ ${po.status || 'N/A'}</span></div>
              </div>
              <div>
                <div style="font-weight:bold;color:#666;font-size:0.9em;">Supplier</div>
                <div>${po.supplier || '-'}</div>
              </div>
              <div>
                <div style="font-weight:bold;color:#666;font-size:0.9em;">Location</div>
                <div>${po.branch || '-'}</div>
              </div>
              <div>
                <div style="font-weight:bold;color:#666;font-size:0.9em;">Created By (PM)</div>
                <div>${po.created_by || po.sent_for_approval_by || '-'}</div>
              </div>
              <div>
                <div style="font-weight:bold;color:#666;font-size:0.9em;">Approved By (GM)</div>
                <div>${po.approved_by || '-'}</div>
              </div>
              <div>
                <div style="font-weight:bold;color:#666;font-size:0.9em;">Created Date</div>
                <div style="font-size:0.9em;">${po.created_at ? new Date(po.created_at).toLocaleString('en-PH') : '-'}</div>
              </div>
              <div>
                <div style="font-weight:bold;color:#666;font-size:0.9em;">Approval Date</div>
                <div style="font-size:0.9em;">${po.approved_at ? new Date(po.approved_at).toLocaleString('en-PH') : '-'}</div>
              </div>
            </div>
          `;

          // Add line items table
          if (po.lines && po.lines.length > 0) {
            html += `
              <div style="margin-top:20px;">
                <h4 style="margin-top:0;margin-bottom:12px;color:#2c3e50;">Line Items</h4>
                <div style="overflow-x:auto;">
                  <table style="width:100%;border-collapse:collapse;font-size:0.95em;">
                    <thead>
                      <tr style="background:#ecf0f1;">
                        <th style="padding:8px;text-align:left;border-bottom:1px solid #ddd;">Part #</th>
                        <th style="padding:8px;text-align:left;border-bottom:1px solid #ddd;">Description</th>
                        <th style="padding:8px;text-align:right;border-bottom:1px solid #ddd;">Qty</th>
                        <th style="padding:8px;text-align:left;border-bottom:1px solid #ddd;">Unit</th>
                      </tr>
                    </thead>
                    <tbody>
            `;

            po.lines.forEach(line => {
              html += `
                      <tr style="border-bottom:1px solid #eee;">
                        <td style="padding:8px;"><strong>${line.part_number || '-'}</strong></td>
                        <td style="padding:8px;">${line.part_name || '-'}</td>
                        <td style="padding:8px;text-align:right;">${line.qty || 0}</td>
                        <td style="padding:8px;">${line.unit || '-'}</td>
                      </tr>
              `;
            });

            html += `
                    </tbody>
                  </table>
                </div>
              </div>
            `;
          }

          html += `
            <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:20px;padding-top:16px;border-top:1px solid #ecf0f1;">
              <button type="button" class="pm-po-close-btn btn" style="background:#95a5a6;color:white;padding:8px 16px;">Close</button>
              <button type="button" class="pm-po-print-btn btn" style="background:#2980b9;color:white;padding:8px 16px;">🖨 Print</button>
            </div>
          `;

          content.innerHTML = html;
          modal.appendChild(content);

          // Close button handler
          const closeBtn = content.querySelector('.pm-po-close-btn');
          if (closeBtn) {
            closeBtn.addEventListener('click', () => modal.remove());
          }

          // Print button handler
          const printBtn = content.querySelector('.pm-po-print-btn');
          if (printBtn) {
            printBtn.addEventListener('click', () => {
              window.print();
            });
          }

          // Modal close on background click
          modal.addEventListener('click', (event) => {
            if (event.target === modal) {
              modal.remove();
            }
          });

          document.body.appendChild(modal);
        } catch (err) {
          console.error('Error parsing PO:', err);
          alert('Error loading PO details');
        }
      });
    });
  })();
})();
