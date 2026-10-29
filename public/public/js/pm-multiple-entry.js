(function () {
  const root = document.getElementById('pm-multiple-entry');
  if (!root) return;

  const body = document.getElementById('pm-multiple-entry-body');
  const addLineButton = document.getElementById('pm-multiple-add-line');
  const saveButton = document.getElementById('pm-multiple-save');
  const statusText = document.getElementById('pm-multiple-status');
  const poInput = document.getElementById('pm-multiple-po');
  const poLoadButton = document.getElementById('pm-multiple-po-load');
  const poClearButton = document.getElementById('pm-multiple-po-clear');
  const poAllButton = document.getElementById('pm-multiple-po-all-received');
  const poStatus = document.getElementById('pm-multiple-po-status');
  const defaultLocation = root.getAttribute('data-default-location') || 'Warehouse 1';

  if (!body || !addLineButton || !saveButton) return;

  function setStatus(message, isError) {
    if (!statusText) return;
    statusText.textContent = message || '';
    statusText.className = isError ? 'error' : 'dashboard-note';
  }

  function setPoStatus(message, isError) {
    if (!poStatus) return;
    poStatus.textContent = message || '';
    poStatus.className = isError ? 'error' : 'dashboard-note';
  }

  function escapeAttr(value) {
    return String(value || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  function makeLocationOptions() {
    const locations = Array.isArray(window.pmMultipleEntryLocations) ? window.pmMultipleEntryLocations : [];
    const unique = Array.from(new Set([defaultLocation].concat(locations).filter(Boolean)));
    return unique.map((name) => '<option value="' + escapeAttr(name) + '"' + (name === defaultLocation ? ' selected' : '') + '>' + escapeAttr(name) + '</option>').join('');
  }

  function addLine(seed) {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td><input data-field="barcode" class="pm-barcode-input" placeholder="Scan barcode" value="${escapeAttr(seed && seed.barcode)}" autocomplete="off" /></td>
      <td><input data-field="part_number" value="${escapeAttr(seed && seed.part_number)}" required /></td>
      <td><input data-field="part_name" value="${escapeAttr(seed && seed.part_name)}" required /></td>
      <td><input data-field="sub_id" value="${escapeAttr(seed && seed.sub_id)}" /></td>
      <td><input data-field="generic" value="${escapeAttr(seed && seed.generic)}" /></td>
      <td><input data-field="supplier" value="${escapeAttr(seed && seed.supplier)}" /></td>
      <td><input data-field="receiving_receipt_number" value="${escapeAttr(seed && seed.receiving_receipt_number)}" /></td>
      <td><input data-field="unit" value="${escapeAttr(seed && seed.unit)}" /></td>
      <td><input data-field="qty" type="number" min="0" step="any" value="${escapeAttr(seed && seed.qty)}" required /></td>
      <td><input data-field="cost_price" type="number" min="0" step="0.01" value="${escapeAttr(seed && seed.cost_price)}" /></td>
      <td><input data-field="markup" type="number" min="0" step="0.01" value="${escapeAttr(seed && seed.markup)}" /></td>
      <td><input data-field="retail_price" type="number" min="0" step="0.01" value="${escapeAttr(seed && seed.retail_price)}" /></td>
      <td style="white-space:nowrap;">
        <input data-field="receive_decision" type="hidden" value="" />
        <button type="button" class="btn pm-decision-btn" data-decision="received">Received</button>
        <button type="button" class="btn pm-decision-btn" data-decision="no_receive">No receive</button>
      </td>
      <td>
        <input data-field="present_location" type="hidden" value="${escapeAttr(defaultLocation)}" />
        <button type="button" class="btn pm-multiple-remove-line">Remove</button>
      </td>
    `;
    body.appendChild(row);
    row.querySelector('[data-field="barcode"]').focus();
  }

  function rows() {
    return Array.from(body.querySelectorAll('tr'));
  }

  function readEntries() {
    return rows().map((row, index) => {
      const entry = { rowNumber: index + 1, present_location: defaultLocation };
      row.querySelectorAll('[data-field]').forEach((input) => {
        entry[input.getAttribute('data-field')] = input.value;
      });
      return entry;
    }).filter((entry) => {
      return Object.keys(entry).some((key) => key !== 'rowNumber' && key !== 'present_location' && String(entry[key] || '').trim());
    });
  }

  function validate(entries) {
    const errors = [];
    entries.forEach((entry) => {
      if (!String(entry.part_number || '').trim()) errors.push('Row ' + entry.rowNumber + ': Part # is required.');
      if (!String(entry.part_name || '').trim()) errors.push('Row ' + entry.rowNumber + ': Part Name is required.');
      if (entry.receive_decision !== 'no_receive' && !(Number(entry.qty) > 0)) errors.push('Row ' + entry.rowNumber + ': Qty must be greater than 0.');
    });
    return errors;
  }

  let loadedPo = '';
  let loadedAt = '';

  // Fills the grid with every line carried by an approved PO number.
  async function loadPo() {
    const number = String((poInput && poInput.value) || '').trim();
    if (!number || number.toUpperCase() === loadedPo) return;
    setPoStatus('Looking up PO ' + number + '...', false);
    try {
      const response = await fetch('/parts-manager/api/po-lookup/' + encodeURIComponent(number), {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || ('PO lookup failed (HTTP ' + response.status + '). If this persists, restart the app so the latest update is loaded.'));
      body.innerHTML = '';
      payload.lines.forEach((line) => addLine(line));
      if (!payload.lines.length) addLine();
      poInput.value = payload.po_number;
      loadedPo = String(payload.po_number).toUpperCase();
      loadedAt = payload.retrieved_at || '';
      setPoStatus('PO ' + payload.po_number + ' (' + (payload.supplier || 'no supplier') + ') loaded with ' + payload.lines.length + ' line(s). Mark each line Received or No receive, then Save. The PO stays Receiving until every line is received; lines marked No receive come back next time you load the PO, or can be removed under PO Records > Edit.', false);
    } catch (error) {
      loadedPo = '';
      setPoStatus(String(error.message || error), true);
    }
  }

  function clearPo() {
    if (poInput) poInput.value = '';
    loadedPo = '';
    loadedAt = '';
    setPoStatus('Enter a purchased PO number to auto-fill every line. Mark each line Received or No receive, then Save to record it.', false);
  }

  function resetGrid() {
    body.innerHTML = '';
    addLine();
    setStatus('', false);
  }

  body.addEventListener('input', (event) => {
    const input = event.target.closest('[data-field="cost_price"], [data-field="markup"]');
    if (!input) return;
    const row = input.closest('tr');
    const cost = Number((row.querySelector('[data-field="cost_price"]') || {}).value) || 0;
    const markup = Number((row.querySelector('[data-field="markup"]') || {}).value) || 0;
    const retailInput = row.querySelector('[data-field="retail_price"]');
    if (retailInput && cost > 0) retailInput.value = (cost + cost * (markup / 100)).toFixed(2);
  });

  function setDecision(row, decision) {
    const hidden = row.querySelector('[data-field="receive_decision"]');
    if (hidden) hidden.value = decision || '';
    row.querySelectorAll('.pm-decision-btn').forEach((button) => {
      const active = button.getAttribute('data-decision') === decision;
      button.classList.toggle('pm-decision-btn--active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  body.addEventListener('click', (event) => {
    const decisionButton = event.target.closest('.pm-decision-btn');
    if (decisionButton) {
      const row = decisionButton.closest('tr');
      const choice = decisionButton.getAttribute('data-decision');
      const hidden = row.querySelector('[data-field="receive_decision"]');
      setDecision(row, hidden && hidden.value === choice ? '' : choice);
      return;
    }
    const removeButton = event.target.closest('.pm-multiple-remove-line');
    if (!removeButton) return;
    if (rows().length === 1) {
      rows()[0].querySelectorAll('input').forEach((input) => {
        if (input.type !== 'hidden') input.value = '';
      });
      setDecision(rows()[0], '');
      setStatus('', false);
      return;
    }
    removeButton.closest('tr').remove();
  });

  // Barcode scanners act as keyboards: they type the code then send Enter.
  // A known barcode fills the row's blank fields from the latest saved record.
  async function fillRowFromBarcode(row, code) {
    const key = String(code || '').trim();
    if (!row || !key) return;
    try {
      const response = await fetch('/parts-manager/api/parts/find-by-barcode/' + encodeURIComponent(key), {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      if (response.status === 404) {
        setStatus('New barcode ' + key + ' — fill in the part details for this row.', false);
        return false;
      }
      const part = await response.json().catch(() => ({}));
      if (!response.ok || !part.found) throw new Error(part.error || 'Barcode lookup failed.');
      ['part_number', 'part_name', 'sub_id', 'generic', 'supplier', 'unit', 'cost_price', 'markup', 'retail_price'].forEach((field) => {
        const input = row.querySelector('[data-field="' + field + '"]');
        if (input && !String(input.value || '').trim() && part[field] != null && part[field] !== '' && part[field] !== 0) {
          input.value = part[field];
        }
      });
      setStatus('Barcode ' + key + ' matched ' + part.part_number + ' — ' + part.part_name + '.', false);
      return true;
    } catch (error) {
      setStatus(String(error.message || error), true);
      return false;
    }
  }

  body.addEventListener('keydown', async (event) => {
    if (event.key !== 'Enter') return;
    const input = event.target.closest('[data-field="barcode"]');
    if (!input) return;
    event.preventDefault();
    const row = input.closest('tr');
    const found = await fillRowFromBarcode(row, input.value);
    const next = row && row.querySelector(found ? '[data-field="qty"]' : '[data-field="part_number"]');
    if (next) next.focus();
  });

  addLineButton.addEventListener('click', () => addLine());

  if (poInput) {
    poInput.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      loadPo();
    });
    poInput.addEventListener('change', loadPo);
  }
  if (poLoadButton) poLoadButton.addEventListener('click', loadPo);
  if (poAllButton) {
    poAllButton.addEventListener('click', () => rows().forEach((row) => setDecision(row, 'received')));
  }
  if (poClearButton) {
    poClearButton.addEventListener('click', () => {
      clearPo();
      resetGrid();
    });
  }

  saveButton.addEventListener('click', async () => {
    const entries = readEntries();
    if (!entries.length) {
      setStatus('Add at least one receiving entry before saving.', true);
      return;
    }

    const errors = validate(entries);
    if (!String((poInput && poInput.value) || '').trim() && entries.some((entry) => entry.receive_decision)) {
      errors.push('Received / No receive only applies to a PO. Enter a PO number or clear the buttons.');
    }
    if (errors.length) {
      setStatus(errors.join(' '), true);
      return;
    }

    saveButton.disabled = true;
    saveButton.textContent = 'Saving...';
    setStatus('Saving entries to Parts-DB-All...', false);

    try {
      const response = await fetch('/parts-manager/api/parts/receiving-entry', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ entries, po_number: String((poInput && poInput.value) || '').trim(), po_retrieved_at: loadedAt }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || 'Could not save receiving entries.');
      }

      const warnings = Array.isArray(payload.errors) && payload.errors.length ? ' Warnings: ' + payload.errors.join(' ') : '';
      setStatus((payload.message || ('Saved ' + payload.created + ' entries.')) + warnings, false);
      body.innerHTML = '';
      addLine();
      if (payload.po_processed) {
        const number = String((poInput && poInput.value) || '').trim();
        if (payload.po_closed) {
          clearPo();
        } else {
          loadedPo = '';
          if (poInput) poInput.value = number;
          loadPo();
        }
      }
    } catch (error) {
      setStatus(String(error.message || error), true);
    } finally {
      saveButton.disabled = false;
      saveButton.textContent = 'Save';
    }
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      window.location.href = '/parts-manager?panel=edit';
    }
  });

  resetGrid();
})();
