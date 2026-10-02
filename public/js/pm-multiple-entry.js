(function () {
  const root = document.getElementById('pm-multiple-entry');
  if (!root) return;

  const body = document.getElementById('pm-multiple-entry-body');
  const addLineButton = document.getElementById('pm-multiple-add-line');
  const saveButton = document.getElementById('pm-multiple-save');
  const statusText = document.getElementById('pm-multiple-status');
  const defaultLocation = root.getAttribute('data-default-location') || 'Warehouse 1';

  if (!body || !addLineButton || !saveButton) return;

  function setStatus(message, isError) {
    if (!statusText) return;
    statusText.textContent = message || '';
    statusText.className = isError ? 'error' : 'dashboard-note';
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
      if (!(Number(entry.qty) > 0)) errors.push('Row ' + entry.rowNumber + ': Qty must be greater than 0.');
    });
    return errors;
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

  body.addEventListener('click', (event) => {
    const removeButton = event.target.closest('.pm-multiple-remove-line');
    if (!removeButton) return;
    if (rows().length === 1) {
      rows()[0].querySelectorAll('input').forEach((input) => {
        if (input.type !== 'hidden') input.value = '';
      });
      setStatus('', false);
      return;
    }
    removeButton.closest('tr').remove();
  });

  // Barcode scanners act as keyboards: they type the code then send Enter.
  // Jump to Part # once a scan lands so the clerk can keep filling the row.
  body.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    const input = event.target.closest('[data-field="barcode"]');
    if (!input) return;
    event.preventDefault();
    const row = input.closest('tr');
    const next = row && row.querySelector('[data-field="part_number"]');
    if (next) next.focus();
  });

  addLineButton.addEventListener('click', () => addLine());

  saveButton.addEventListener('click', async () => {
    const entries = readEntries();
    if (!entries.length) {
      setStatus('Add at least one receiving entry before saving.', true);
      return;
    }

    const errors = validate(entries);
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
        body: JSON.stringify({ entries }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || 'Could not save receiving entries.');
      }

      const warnings = Array.isArray(payload.errors) && payload.errors.length ? ' Warnings: ' + payload.errors.join(' ') : '';
      setStatus((payload.message || ('Saved ' + payload.created + ' entries.')) + warnings, false);
      body.innerHTML = '';
      addLine();
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
