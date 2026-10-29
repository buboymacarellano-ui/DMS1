(function () {
  const root = document.getElementById('parts-receiving');
  if (!root) return;

  const canReceive = root.dataset.canReceive === '1';
  const body = document.getElementById('prc-body');
  const refInput = document.getElementById('prc-ref');
  const scanInput = document.getElementById('prc-scan');
  const loadStatus = document.getElementById('prc-load-status');
  const info = document.getElementById('prc-info');
  const status = document.getElementById('prc-status');
  const saveBtn = document.getElementById('prc-save');
  const allBtn = document.getElementById('prc-all-received');

  const STATUS = {
    in_transit: ['In Transit', '#d97706'],
    not_received: ['Not Received', '#c0392b'],
    received: ['Received', '#1f8f53'],
  };
  let shipment = null;

  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? '' : Number(v).toFixed(2));
  const cell = (v) => `<td><input type="text" value="${esc(v)}" readonly /></td>`;
  const setText = (el, text, color) => { if (el) { el.textContent = text; el.style.color = color || ''; } };

  function markup(line) {
    if (line.markup !== '' && line.markup != null) return line.markup;
    const cost = Number(line.cost_price);
    const retail = Number(line.retail_price);
    return cost > 0 && retail > 0 ? (((retail - cost) / cost) * 100).toFixed(2) : '';
  }

  function render() {
    if (!shipment) {
      body.innerHTML = '<tr><td colspan="14" style="text-align:center;color:#7f8c8d;padding:14px;">No stock transfer loaded.</td></tr>';
      info.innerHTML = '';
      return;
    }
    const when = (v) => (v ? new Date(v).toLocaleString('en-PH') : '');
    const facts = [
      ['PTN #', shipment.reference],
      ['Packing List #', shipment.packing_list_number],
      ['Transmittal #', shipment.transmittal_number],
      ['Type', shipment.kind],
      ['From', shipment.from],
      ['To', shipment.to],
      ['Requested By', shipment.requested_by],
      ['Approved By', [shipment.approved_by, when(shipment.approved_at)].filter(Boolean).join(' · ')],
      ['Sent By', [shipment.transmitted_by || shipment.sent_by, when(shipment.transmitted_at || shipment.sent_at)].filter(Boolean).join(' · ')],
      ['Transfer Status', shipment.transfer_status],
      ['Lines / Total Qty', `${shipment.rows.length} / ${shipment.total_qty != null ? shipment.total_qty : ''}`],
      ['Total Cost', money(shipment.total_cost)],
      ['Notes', shipment.notes],
    ].filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== '');
    info.innerHTML = `<div class="prc-facts">${facts.map(([k, v]) => `<div><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`).join('')}</div>`;
    body.innerHTML = shipment.rows.map((line, i) => {
      const [label, color] = STATUS[line.status] || [line.status, '#7f8c8d'];
      const open = line.status !== 'received';
      const decision = open && canReceive
        ? ['received', 'no_receive'].map((d) => `<button type="button" class="btn pm-decision-btn${line.decision === d ? ' pm-decision-btn--active' : ''}" data-index="${i}" data-decision="${d}">${d === 'received' ? 'Received' : 'No receive'}</button>`).join(' ')
        : `<span style="color:#7f8c8d;">${line.status === 'received' ? esc(line.received_by || '') : 'View only'}</span>`;
      return `<tr data-index="${i}">${cell(line.barcode)}${cell(line.part_number)}${cell(line.part_name)}${cell(line.sub_id)}${cell(line.generic)}${cell(line.supplier)}${cell(line.transaction_number)}${cell(line.unit)}${cell(line.qty)}${cell(money(line.cost_price))}${cell(markup(line))}${cell(money(line.retail_price))}`
        + `<td><span class="prc-tag" style="background:${color}">${label}</span></td><td style="white-space:nowrap;">${decision}</td></tr>`;
    }).join('');
  }

  async function load(ref) {
    const value = String(ref || refInput.value || '').trim();
    if (!value) { setText(loadStatus, 'Enter a PTN / packing list number first.', '#c0392b'); refInput.focus(); return; }
    setText(loadStatus, `Loading ${value}…`);
    setText(status, '');
    try {
      const res = await fetch(`/parts/api/receiving/lookup/${encodeURIComponent(value)}`, { headers: { Accept: 'application/json' } });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(json.error || 'Stock transfer not found.');
      shipment = json.shipment;
      shipment.rows.forEach((line) => { line.decision = ''; });
      refInput.value = shipment.reference;
      render();
      const open = shipment.rows.filter((l) => l.status !== 'received').length;
      setText(loadStatus, open
        ? `Loaded ${shipment.rows.length} line(s), ${open} to receive. Scan barcodes or mark each line Received / No receive, then Save.`
        : `Loaded ${shipment.rows.length} line(s). This stock transfer is fully received.`, '#1f8f53');
      if (canReceive && open) scanInput.focus();
    } catch (err) {
      shipment = null;
      render();
      setText(loadStatus, err.message, '#c0392b');
    }
  }

  function scan() {
    const code = scanInput.value.trim().toUpperCase();
    scanInput.value = '';
    if (!code) return;
    if (!shipment) { setText(loadStatus, 'Load a stock transfer before scanning.', '#c0392b'); return; }
    const index = shipment.rows.findIndex((l) => l.status !== 'received' && l.decision !== 'received'
      && [l.barcode, l.part_number].some((v) => String(v || '').trim().toUpperCase() === code));
    if (index < 0) {
      const already = shipment.rows.some((l) => [l.barcode, l.part_number].some((v) => String(v || '').trim().toUpperCase() === code));
      setText(loadStatus, already ? `${code} is already marked Received.` : `${code} is not on this stock transfer.`, '#c0392b');
      return;
    }
    if (canReceive) shipment.rows[index].decision = 'received';
    render();
    const row = body.querySelector(`tr[data-index="${index}"]`);
    if (row) { row.classList.add('prc-row--scanned'); row.scrollIntoView({ block: 'nearest' }); }
    setText(loadStatus, `Matched ${shipment.rows[index].part_number} — ${shipment.rows[index].part_name}${canReceive ? ' (marked Received)' : ''}.`, '#1f8f53');
  }

  async function save() {
    if (!shipment) { setText(status, 'Load a stock transfer first.', '#c0392b'); return; }
    const lines = shipment.rows.filter((l) => l.status !== 'received' && l.decision).map((l) => ({ id: l.id, decision: l.decision }));
    if (!lines.length) { setText(status, 'Mark at least one line Received or No receive.', '#c0392b'); return; }
    const pending = shipment.rows.filter((l) => l.status !== 'received' && !l.decision).length;
    if (pending && !window.confirm(`${pending} line(s) are not marked yet and will stay In Transit. Save anyway?`)) return;
    saveBtn.disabled = true;
    setText(status, 'Saving…');
    try {
      const res = await fetch('/parts/api/receiving/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ key: shipment.key, lines }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(json.error || 'Unable to save receiving.');
      const msg = json.message + (json.errors && json.errors.length ? ` Issues: ${json.errors.join(' ')}` : '');
      window.location.href = `/parts/receiving?${json.errors && json.errors.length ? 'error' : 'success'}=${encodeURIComponent(msg)}`
        + (json.closed ? '' : `&ref=${encodeURIComponent(shipment.key)}`);
    } catch (err) {
      setText(status, err.message, '#c0392b');
      saveBtn.disabled = false;
    }
  }

  body.addEventListener('click', (event) => {
    const btn = event.target.closest('.pm-decision-btn');
    if (!btn || !shipment) return;
    const line = shipment.rows[Number(btn.dataset.index)];
    line.decision = line.decision === btn.dataset.decision ? '' : btn.dataset.decision;
    render();
  });
  document.getElementById('prc-load').addEventListener('click', () => load());
  refInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(autoTimer); load(); } });
  // Auto-load as soon as a complete PTN / PL / TM number is typed, pasted or scanned.
  const FULL_REF = /^(PTN|PL|TM)-\d{8}-\d{6}$/i;
  let autoTimer = null;
  let lastAuto = '';
  const autoLoad = () => {
    clearTimeout(autoTimer);
    const value = refInput.value.trim().toUpperCase();
    if (!FULL_REF.test(value) || value === lastAuto) return;
    autoTimer = setTimeout(() => { lastAuto = value; load(value); }, 250);
  };
  refInput.addEventListener('input', () => {
    const caret = refInput.selectionStart;
    refInput.value = refInput.value.toUpperCase();
    try { refInput.setSelectionRange(caret, caret); } catch (_) { /* ignore */ }
    if (refInput.value.trim().toUpperCase() !== lastAuto) lastAuto = '';
    autoLoad();
  });
  refInput.addEventListener('change', autoLoad);
  scanInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); scan(); } });
  document.getElementById('prc-clear').addEventListener('click', () => {
    shipment = null;
    lastAuto = '';
    refInput.value = '';
    render();
    setText(loadStatus, 'Load a stock transfer, or click Load on one of the transfers listed under For Receiving.');
    setText(status, '');
  });
  if (allBtn) allBtn.addEventListener('click', () => {
    if (!shipment) { setText(loadStatus, 'Load a stock transfer first.', '#c0392b'); return; }
    shipment.rows.forEach((l) => { if (l.status !== 'received') l.decision = 'received'; });
    render();
  });
  if (saveBtn) saveBtn.addEventListener('click', save);
  document.querySelectorAll('.prc-load-row').forEach((btn) => btn.addEventListener('click', () => {
    load(btn.dataset.ref);
    root.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));

  if (root.dataset.preload) load(root.dataset.preload);
})();
