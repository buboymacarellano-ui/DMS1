(function () {
  const root = document.getElementById('pm-workspace');
  if (!root) return;

  const panels = Array.from(root.querySelectorAll('[data-pm-section]'));
  const buttons = Array.from(root.querySelectorAll('[data-pm-panel]'));
  const editForm = document.getElementById('pm-edit-form');
  const csvFile = document.getElementById('pm-csv-file');
  const csvText = document.getElementById('pm-csv-text');
  const csvForm = document.getElementById('pm-csv-form');

  function openPanel(name) {
    const target = String(name || '').trim();
    panels.forEach((panel) => {
      panel.hidden = panel.getAttribute('data-pm-section') !== target;
    });
    buttons.forEach((btn) => {
      btn.classList.toggle('pm-role-btn--active', btn.getAttribute('data-pm-panel') === target);
    });
    if (target) {
      const url = new URL(window.location.href);
      url.searchParams.set('panel', target);
      window.history.replaceState({}, '', url);
      
      // Refresh ordering grid when opening the ordering panel
      if (target === 'ordering' && typeof window.updateOrderingGridDisplay === 'function') {
        setTimeout(() => window.updateOrderingGridDisplay(), 50);
      }
    }
  }

  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const name = btn.getAttribute('data-pm-panel');
      const current = new URL(window.location.href).searchParams.get('panel');
      if (current === name && !document.getElementById('pm-panel-' + name).hidden) {
        openPanel('');
        const url = new URL(window.location.href);
        url.searchParams.delete('panel');
        window.history.replaceState({}, '', url);
        return;
      }
      openPanel(name);
    });
  });

  const initial = root.getAttribute('data-open-panel') || new URL(window.location.href).searchParams.get('panel') || '';
  if (initial) openPanel(initial);

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
    editForm.action = '/parts-manager/parts/' + encodeURIComponent(part.id) + '/edit';
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
    const editBtn = event.target.closest('[data-pm-edit]');
    if (editBtn) {
      event.preventDefault();
      loadPart(editBtn.getAttribute('data-pm-edit'));
      return;
    }
    const row = event.target.closest('.pm-db-row');
    if (row && !event.target.closest('a, button, form')) {
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

  if (editForm) {
    editForm.addEventListener('submit', (event) => {
      const id = document.getElementById('pm-edit-id').value;
      if (!id) {
        event.preventDefault();
        window.alert('Select a parts row from the database below first.');
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
      postJson('/parts-manager/api/purchase-orders/' + encodeURIComponent(receiveBtn.getAttribute('data-pm-receive-po')) + '/receive');
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
    const countDisplay = document.getElementById('pm-health-count');
    const modal = document.getElementById('pm-health-transfer-modal');
    const cancelTransferBtn = document.getElementById('pm-health-cancel-transfer');
    const confirmTransferBtn = document.getElementById('pm-health-confirm-transfer');
    const transferList = document.getElementById('pm-health-transfer-list');
    const transferCalcs = document.getElementById('pm-health-transfer-calcs');

    if (!selectAllCheckbox || !transferBtn || !modal) return;

    function updateCheckboxState() {
      const checked = rowCheckboxes.filter((cb) => cb.checked).length;
      const total = rowCheckboxes.length;

      selectAllCheckbox.checked = checked === total && total > 0;
      selectAllCheckbox.indeterminate = checked > 0 && checked < total;

      transferBtn.disabled = checked === 0;
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

    transferBtn.addEventListener('click', () => {
      const selected = rowCheckboxes.filter((cb) => cb.checked);
      if (selected.length === 0) return;

      const items = selected.map((cb) => {
        const row = cb.closest('tr');
        const partNum = row.getAttribute('data-part-num');
        const partName = row.querySelector('td:nth-child(3)').textContent;
        const currentStock = parseInt(row.querySelector('td:nth-child(5)').textContent) || 0;
        const safetyStock = parseInt(row.querySelector('td:nth-child(6)').textContent) || 5;

        return {
          id: cb.dataset.partId,
          part_number: partNum,
          part_name: partName,
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
          
          // Extract from cells: 0=checkbox, 1=Part#, 2=Name, 3=Supplier, 4=Stock, 5=Safety, 6=Status
          const partName = (cells[2] || {}).textContent?.trim() || '—';
          const supplier = (cells[3] || {}).textContent?.trim() || '—';
          const currentStockText = (cells[4] || {}).textContent?.trim() || '0';
          const safetyStockText = (cells[5] || {}).textContent?.trim() || '5';
          
          const currentStock = parseInt(currentStockText.replace(/[^\d-]/g, '')) || 0;
          const safetyStock = parseInt(safetyStockText.replace(/[^\d-]/g, '')) || 5;

          selectedRows.push({
            id: partId,
            part_number: partNum,
            part_name: partName,
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

    if (items.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:20px;color:#999;">No items in ordering queue. Transfer items from Health Monitor panel.</td></tr>';
      createPoBtn.disabled = true;
      sendSupplierBtn.disabled = true;
      return;
    }

    tbody.innerHTML = items.map((item, idx) => `
      <tr data-order-id="${item.id}">
        <td style="text-align:center;"><input type="checkbox" class="pm-ordering-check" data-order-id="${item.id}" /></td>
        <td><strong>${item.part_number || '—'}</strong></td>
        <td>${item.part_name || '—'}</td>
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
          <div style="color:#666;">Supplier: ${item.supplier || '(No supplier)'} | Qty: ${item.order_qty || 0}</div>
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
      <div style="background:white;border-radius:6px;max-width:800px;margin:20px auto;padding:40px;box-shadow:0 8px 32px rgba(0,0,0,0.2);font-family:Arial,sans-serif;">
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
              <div><strong>Status:</strong> <span style="background:#fff3cd;color:#856404;padding:4px 8px;border-radius:3px;display:inline-block;">PENDING APPROVAL</span></div>
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
                <div style="font-size:1em;"><span style="background:#27ae60;color:white;padding:3px 8px;border-radius:3px;font-size:0.9em;">✓ ${po.status || 'N/A'}</span></div>
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
