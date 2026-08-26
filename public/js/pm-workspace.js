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
})();
