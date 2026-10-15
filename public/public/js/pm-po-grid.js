(function () {
  const root = document.getElementById('pm-po-grid-root');
  if (!root) return;

  const body = document.getElementById('pm-po-grid-body');
  const totalCell = document.getElementById('pm-po-grid-total');
  const statusEl = document.getElementById('pm-po-status');
  const dateInput = document.getElementById('pm-po-date');
  const numberInput = document.getElementById('pm-po-number');
  const supplierInput = document.getElementById('pm-po-supplier');
  const branchSelect = document.getElementById('pm-po-branch');
  const notesInput = document.getElementById('pm-po-notes');
  const editingLabel = document.getElementById('pm-po-editing');
  const newBtn = document.getElementById('pm-po-new');
  const addBtn = document.getElementById('pm-po-add-line');
  const createBtn = document.getElementById('pm-po-create');
  const saveBtn = document.getElementById('pm-po-save');
  const AUTO_NUMBER = 'Auto on save';
  const START_LINES = 5;
  const BARCODE_LOOKUP_DELAY = 250;
  const barcodeLookups = new WeakMap();
  let editingId = '';

  function money(value) {
    return '₱' + Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function num(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function todayKey() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
  }

  function setStatus(message, isError) {
    statusEl.textContent = message || '';
    statusEl.style.color = isError ? '#c0392b' : '';
    statusEl.style.fontWeight = message ? '700' : '';
  }

  function cell(field, type, extra) {
    return '<td><input data-field="' + field + '" type="' + (type || 'text') + '"' + (extra || '') + ' autocomplete="off" /></td>';
  }

  const NOTE_OPTIONS = ['Out Of Stock', 'Low Stock', 'Fast Moving', 'Other'];

  // Notes is a preset dropdown; "Other" reveals a text box for a custom note.
  function notesCell() {
    return '<td class="pm-po-notes-cell"><select data-field="notes" class="pm-po-notes">'
      + '<option value="">—</option>'
      + NOTE_OPTIONS.map((opt) => '<option value="' + opt + '">' + opt + '</option>').join('')
      + '</select>'
      + '<input type="text" class="pm-po-notes-other" placeholder="Type note" autocomplete="off" hidden /></td>';
  }

  function setNotes(row, value) {
    const select = row.querySelector('[data-field="notes"]');
    const other = row.querySelector('.pm-po-notes-other');
    const text = String(value == null ? '' : value).trim();
    const preset = NOTE_OPTIONS.find((opt) => opt !== 'Other' && opt.toLowerCase() === text.toLowerCase());
    if (!text) {
      select.value = '';
      other.value = '';
    } else if (preset) {
      select.value = preset;
      other.value = '';
    } else {
      select.value = 'Other';
      other.value = /^other$/i.test(text) ? '' : text.replace(/^other:\s*/i, '');
    }
    other.hidden = select.value !== 'Other';
  }

  function readNotes(row) {
    const select = row.querySelector('[data-field="notes"]');
    if (select.value !== 'Other') return select.value;
    const custom = row.querySelector('.pm-po-notes-other').value.trim();
    return custom ? 'Other: ' + custom : 'Other';
  }

  function addLine(values) {
    const row = document.createElement('tr');
    row.innerHTML = '<td class="pm-po-index"></td>'
      + cell('barcode', 'text', ' class="pm-barcode-input" placeholder="Scan barcode"')
      + cell('part_number')
      + cell('part_name')
      + cell('sub_id')
      + cell('generic')
      + cell('unit')
      + cell('qty', 'number', ' class="pm-po-qty" min="0" step="any"')
      + cell('cost_price', 'number', ' class="pm-po-cost" min="0" step="0.01"')
      + cell('markup', 'number', ' class="pm-po-markup" min="0" step="0.01"')
      + cell('retail_price', 'number', ' readonly tabindex="-1"')
      + '<td class="pm-po-line-total" style="text-align:right;white-space:nowrap;">' + money(0) + '</td>'
      + notesCell()
      + '<td><button type="button" class="btn" data-pm-po-remove title="Remove line" style="background:#c0392b;color:#fff;padding:3px 8px;">&times;</button></td>';
    body.appendChild(row);
    if (values) {
      Object.keys(values).forEach((key) => {
        if (key === 'notes') return;
        const input = row.querySelector('[data-field="' + key + '"]');
        if (input && values[key] != null && values[key] !== 0) input.value = values[key];
      });
      setNotes(row, values.notes);
    }
    recalcRow(row);
    renumber();
    return row;
  }

  function renumber() {
    Array.from(body.rows).forEach((row, index) => {
      row.querySelector('.pm-po-index').textContent = String(index + 1);
    });
  }

  function recalcRow(row) {
    const qty = num(row.querySelector('[data-field="qty"]').value);
    const cost = num(row.querySelector('[data-field="cost_price"]').value);
    const markup = num(row.querySelector('[data-field="markup"]').value);
    const retail = Number((cost + cost * (markup / 100)).toFixed(2));
    row.querySelector('[data-field="retail_price"]').value = cost || markup ? retail.toFixed(2) : '';
    row.querySelector('.pm-po-line-total').textContent = money(qty * cost);
    recalcTotal();
  }

  function recalcTotal() {
    const total = Array.from(body.rows).reduce((sum, row) => (
      sum + num(row.querySelector('[data-field="qty"]').value) * num(row.querySelector('[data-field="cost_price"]').value)
    ), 0);
    totalCell.textContent = money(total);
  }

  function collectLines() {
    return Array.from(body.rows).map((row) => {
      const line = {};
      row.querySelectorAll('[data-field]').forEach((input) => { line[input.dataset.field] = input.value; });
      line.notes = readNotes(row);
      return line;
    }).filter((line) => String(line.part_number || '').trim() || num(line.qty) > 0);
  }

  function resetForm() {
    editingId = '';
    dateInput.value = todayKey();
    numberInput.value = AUTO_NUMBER;
    supplierInput.value = '';
    notesInput.value = '';
    branchSelect.selectedIndex = Math.max(0, Array.from(branchSelect.options).findIndex((opt) => opt.defaultSelected));
    body.innerHTML = '';
    for (let i = 0; i < START_LINES; i += 1) addLine();
    editingLabel.hidden = true;
    newBtn.hidden = true;
    recalcTotal();
  }

  function loadPo(po) {
    editingId = po.id;
    dateInput.value = po.po_date || String(po.created_at || '').slice(0, 10) || todayKey();
    numberInput.value = po.po_number || AUTO_NUMBER;
    supplierInput.value = po.supplier || '';
    notesInput.value = po.notes || '';
    const wanted = po.branch || po.present_location || '';
    const option = Array.from(branchSelect.options).find((opt) => opt.value === wanted);
    if (option) branchSelect.value = option.value;
    body.innerHTML = '';
    const lines = Array.isArray(po.lines) && po.lines.length ? po.lines : [{ part_number: po.part_number, part_name: po.part_name, qty: po.qty }];
    lines.forEach((line) => addLine(line));
    while (body.rows.length < START_LINES) addLine();
    editingLabel.textContent = 'Editing ' + (po.po_number || '') + (po.status === 'rejected' ? ' (rejected by GM — revise and send again)' : ' (saved draft)');
    editingLabel.hidden = false;
    newBtn.hidden = false;
    recalcTotal();
    root.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function submit(action) {
    const lines = collectLines();
    if (!supplierInput.value.trim()) {
      setStatus('Supplier is required.', true);
      supplierInput.focus();
      return;
    }
    if (!lines.some((line) => String(line.part_number || '').trim() && num(line.qty) > 0)) {
      setStatus('Add at least one line with a Part # and a Qty above zero.', true);
      return;
    }
    if (action === 'create' && !window.confirm('Send this PO to the GM for approval?')) return;

    [createBtn, saveBtn, addBtn].forEach((btn) => { btn.disabled = true; });
    setStatus(action === 'create' ? 'Sending to GM...' : 'Saving...', false);
    try {
      const res = await fetch('/parts-manager/api/purchase-orders-grid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          action,
          id: editingId,
          po_date: dateInput.value,
          supplier: supplierInput.value,
          branch: branchSelect.value,
          notes: notesInput.value,
          lines,
        }),
      });
      const payload = await res.json().catch(() => ({ error: 'Unexpected server response.' }));
      if (!res.ok || !payload.ok) {
        setStatus(payload.error || 'Unable to save the purchase order.', true);
        return;
      }
      window.location.assign('/parts-manager?panel=proc-purchasing&success=' + encodeURIComponent(payload.message));
    } catch (error) {
      setStatus(error.message || 'Unable to save the purchase order.', true);
    } finally {
      [createBtn, saveBtn, addBtn].forEach((btn) => { btn.disabled = false; });
    }
  }

  async function fillFromCatalog(row) {
    const partNumber = row.querySelector('[data-field="part_number"]').value.trim();
    if (!partNumber) return;
    try {
      const res = await fetch('/parts-manager/api/parts/find-by-number/' + encodeURIComponent(partNumber), { credentials: 'same-origin' });
      if (!res.ok) return;
      const part = await res.json();
      if (!part || !part.found) return;
      const fill = (field, value) => {
        const input = row.querySelector('[data-field="' + field + '"]');
        if (input && !input.value && value) input.value = value;
      };
      fill('part_name', part.part_name);
      fill('unit', part.unit);
      fill('cost_price', part.cost_price);
      fill('markup', part.markup);
      recalcRow(row);
    } catch (_) {
      // Lookup is a convenience only.
    }
  }

  function barcodeState(input) {
    if (!barcodeLookups.has(input)) {
      barcodeLookups.set(input, { timer: null, requestId: 0, pendingCode: '', pending: null, matchedCode: '' });
    }
    return barcodeLookups.get(input);
  }

  function fillFromBarcode(row) {
    const input = row.querySelector('[data-field="barcode"]');
    const state = barcodeState(input);
    clearTimeout(state.timer);
    const code = input.value.trim();
    if (!code || !row.isConnected) return Promise.resolve(false);
    if (state.matchedCode === code) return Promise.resolve(true);
    if (state.pending && state.pendingCode === code) return state.pending;

    const requestId = ++state.requestId;
    const isCurrent = () => state.requestId === requestId && input.value.trim() === code && row.isConnected;
    state.pendingCode = code;
    setStatus('Looking up barcode ' + code + '...', false);
    state.pending = (async () => {
      try {
        const res = await fetch('/parts-manager/api/parts/find-by-barcode/' + encodeURIComponent(code), {
          credentials: 'same-origin',
          headers: { Accept: 'application/json' },
        });
        if (!isCurrent()) return false;
        if (res.status === 404) {
          setStatus('Barcode ' + code + ' is not saved in the parts database or a purchase order. Enter the Part # and details, then Save or Create PO to retain this barcode.', true);
          return false;
        }
        if (res.redirected) throw new Error('Your session has expired. Sign in again to look up this barcode.');
        const part = await res.json();
        if (!isCurrent()) return false;
        if (!res.ok || !part || !part.found || !part.part_number) {
          throw new Error((part && part.error) || 'Barcode lookup failed (HTTP ' + res.status + ').');
        }
        ['part_number', 'part_name', 'sub_id', 'generic', 'unit', 'cost_price', 'markup'].forEach((field) => {
          const fieldInput = row.querySelector('[data-field="' + field + '"]');
          if (fieldInput) fieldInput.value = part[field] == null ? '' : part[field];
        });
        if (!supplierInput.value.trim() && part.supplier) supplierInput.value = part.supplier;
        recalcRow(row);
        state.matchedCode = code;
        setStatus('Barcode ' + code + ' matched ' + part.part_number + ' — ' + part.part_name + '. Enter the order Qty.', false);
        return true;
      } catch (error) {
        if (isCurrent()) setStatus('Unable to look up barcode ' + code + ': ' + error.message, true);
        return false;
      } finally {
        if (state.requestId === requestId) {
          state.pending = null;
          state.pendingCode = '';
        }
      }
    })();
    return state.pending;
  }

  async function lookupBarcodeInput(input, moveFocus) {
    const row = input.closest('tr');
    const code = input.value.trim();
    const pending = fillFromBarcode(row);
    const requestId = barcodeState(input).requestId;
    const found = await pending;
    if (!moveFocus || !code || barcodeState(input).requestId !== requestId
      || input.value.trim() !== code || !row.isConnected || document.activeElement !== input) return;
    const next = row.querySelector(found ? '[data-field="qty"]' : '[data-field="part_number"]');
    if (next) next.focus();
  }

  body.addEventListener('keydown', async (event) => {
    if (event.target.dataset.field !== 'barcode') return;
    if (event.key === 'Enter') {
      event.preventDefault();
      await lookupBarcodeInput(event.target, true);
    } else if (event.key === 'Tab') {
      await lookupBarcodeInput(event.target, false);
    }
  });
  body.addEventListener('input', (event) => {
    const row = event.target.closest('tr');
    if (row && event.target.dataset.field === 'barcode') {
      const input = event.target;
      const state = barcodeState(input);
      clearTimeout(state.timer);
      state.requestId += 1;
      state.pending = null;
      state.pendingCode = '';
      state.matchedCode = '';
      if (input.value.trim()) {
        state.timer = setTimeout(() => lookupBarcodeInput(input, true), BARCODE_LOOKUP_DELAY);
      }
    }
    if (row && /^(qty|cost_price|markup)$/.test(event.target.dataset.field || '')) recalcRow(row);
  });
  body.addEventListener('change', (event) => {
    if (event.target.dataset.field === 'notes') {
      const other = event.target.closest('td').querySelector('.pm-po-notes-other');
      other.hidden = event.target.value !== 'Other';
      if (!other.hidden) other.focus();
      else other.value = '';
      return;
    }
    if (event.target.dataset.field === 'part_number') fillFromCatalog(event.target.closest('tr'));
    if (event.target.dataset.field === 'barcode') lookupBarcodeInput(event.target, false);
  });
  body.addEventListener('click', (event) => {
    const removeBtn = event.target.closest('[data-pm-po-remove]');
    if (!removeBtn) return;
    const row = removeBtn.closest('tr');
    if (body.rows.length <= 1) {
      row.querySelectorAll('input').forEach((input) => { if (!input.readOnly) input.value = ''; });
      setNotes(row, '');
      recalcRow(row);
      return;
    }
    row.remove();
    renumber();
    recalcTotal();
  });

  addBtn.addEventListener('click', () => {
    const row = addLine();
    row.querySelector('[data-field="part_number"]').focus();
  });
  createBtn.addEventListener('click', () => submit('create'));
  saveBtn.addEventListener('click', () => submit('save'));
  newBtn.addEventListener('click', () => { resetForm(); setStatus('', false); });

  document.addEventListener('click', async (event) => {
    const gotoLink = event.target.closest('[data-pm-goto-panel]');
    if (gotoLink && typeof window.pmOpenPanel === 'function') {
      event.preventDefault();
      window.pmOpenPanel(gotoLink.getAttribute('data-pm-goto-panel'));
      return;
    }
    const editBtn = event.target.closest('[data-pm-edit-po]');
    if (!editBtn) return;
    editBtn.disabled = true;
    // The PO is edited in the Purchase grid, so switch there from PO Records.
    if (typeof window.pmOpenPanel === 'function') window.pmOpenPanel('proc-purchasing');
    try {
      const res = await fetch('/parts-manager/api/purchase-orders/' + encodeURIComponent(editBtn.getAttribute('data-pm-edit-po')), {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || !payload.po) {
        setStatus(payload.error || 'Unable to load the purchase order.', true);
        return;
      }
      loadPo(payload.po);
      setStatus('Loaded ' + (payload.po.po_number || 'PO') + '. Edit the grid, then Save or Create PO.', false);
    } catch (error) {
      setStatus(error.message || 'Unable to load the purchase order.', true);
    } finally {
      editBtn.disabled = false;
    }
  });

  resetForm();
})();
