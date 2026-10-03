(function () {
  var form = document.getElementById('po-form');
  if (!form) return;
  var body = document.getElementById('po-lines');
  var FIELDS = ['item_code', 'description', 'uom', 'qty', 'unit_price', 'discount_pct', 'tax_pct'];
  var busy = false;
  var lookupTimer = null;

  function money(n) { return (Math.round((n + Number.EPSILON) * 100) / 100).toFixed(2); }
  function num(v) { var n = parseFloat(String(v).replace(/,/g, '')); return isFinite(n) ? n : 0; }

  function makeInput(name, value, attrs) {
    var td = document.createElement('td');
    var input = document.createElement('input');
    input.name = name;
    input.value = value == null ? '' : value;
    Object.keys(attrs || {}).forEach(function (k) { input.setAttribute(k, attrs[k]); });
    var err = document.createElement('small');
    err.className = 'error';
    err.setAttribute('data-line-error', name);
    td.appendChild(input);
    td.appendChild(err);
    return td;
  }

  function addRow(data, after) {
    var d = data || {};
    var tr = document.createElement('tr');
    var idx = document.createElement('td');
    idx.className = 'po-idx';
    tr.appendChild(idx);
    tr.appendChild(makeInput('item_code', d.item_code, { list: 'po-items', autocomplete: 'off' }));
    tr.appendChild(makeInput('description', d.description));
    tr.appendChild(makeInput('uom', d.uom, { size: 6 }));
    tr.appendChild(makeInput('qty', d.qty, { type: 'number', min: '0', step: 'any' }));
    tr.appendChild(makeInput('unit_price', d.unit_price, { type: 'number', min: '0', step: 'any' }));
    tr.appendChild(makeInput('discount_pct', d.discount_pct || 0, { type: 'number', min: '0', max: '100', step: 'any' }));
    tr.appendChild(makeInput('tax_pct', d.tax_pct || 0, { type: 'number', min: '0', max: '100', step: 'any' }));
    var total = document.createElement('td');
    total.className = 'po-line-total';
    total.textContent = '0.00';
    tr.appendChild(total);
    var actions = document.createElement('td');
    [['dup', 'Duplicate'], ['del', 'Remove']].forEach(function (pair) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn btn-secondary';
      b.setAttribute('data-row-action', pair[0]);
      b.textContent = pair[1];
      actions.appendChild(b);
    });
    tr.appendChild(actions);
    if (after && after.parentNode === body) body.insertBefore(tr, after.nextSibling);
    else body.appendChild(tr);
    renumber();
    recalc();
    return tr;
  }

  function rowValues(tr) {
    var out = {};
    FIELDS.forEach(function (f) { out[f] = tr.querySelector('[name="' + f + '"]').value; });
    return out;
  }

  function renumber() {
    Array.prototype.forEach.call(body.rows, function (tr, i) { tr.querySelector('.po-idx').textContent = i + 1; });
  }

  function recalc() {
    var sub = 0; var tax = 0; var codes = {}; var dup = false;
    Array.prototype.forEach.call(body.rows, function (tr) {
      var v = rowValues(tr);
      var net = num(v.qty) * num(v.unit_price) * (1 - num(v.discount_pct) / 100);
      net = Math.round(net * 100) / 100;
      tr.querySelector('.po-line-total').textContent = money(net);
      sub += net;
      tax += Math.round(net * num(v.tax_pct)) / 100;
      var code = v.item_code.trim().toLowerCase();
      if (code) { if (codes[code]) dup = true; codes[code] = true; }
    });
    document.getElementById('po-subtotal').textContent = money(sub);
    document.getElementById('po-tax').textContent = money(tax);
    document.getElementById('po-grand').textContent = money(sub + tax);
    document.getElementById('po-dup-warning').hidden = !dup;
  }

  function clearErrors() {
    Array.prototype.forEach.call(form.querySelectorAll('[data-error-for], [data-line-error]'), function (el) { el.textContent = ''; });
    ['po-form-error', 'po-lines-error'].forEach(function (id) { var el = document.getElementById(id); el.hidden = true; el.textContent = ''; });
  }

  function showError(id, msg) { var el = document.getElementById(id); el.textContent = msg; el.hidden = false; }

  function showErrors(errors) {
    Object.keys(errors.header || {}).forEach(function (f) {
      var el = form.querySelector('[data-error-for="' + f + '"]');
      if (el) el.textContent = errors.header[f];
    });
    Object.keys(errors.lines || {}).forEach(function (i) {
      var tr = body.rows[Number(i)];
      if (!tr) return;
      Object.keys(errors.lines[i]).forEach(function (f) {
        var el = tr.querySelector('[data-line-error="' + f + '"]');
        if (el) el.textContent = errors.lines[i][f];
      });
    });
    if ((errors.general || []).length) showError('po-lines-error', errors.general.join(' '));
    showError('po-form-error', 'Please fix the highlighted fields.');
    var first = form.querySelector('.error:not([hidden])');
    if (first && first.textContent) first.scrollIntoView({ block: 'center' });
  }

  function submit(action) {
    if (busy) return;
    busy = true;
    clearErrors();
    var header = {};
    ['po_date', 'supplier', 'department', 'requestor', 'delivery_date', 'payment_terms', 'currency', 'reference_no', 'remarks']
      .forEach(function (f) { header[f] = form.elements[f].value; });
    var lines = Array.prototype.map.call(body.rows, rowValues);
    fetch('/po/save', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: form.getAttribute('data-id') || '', action: action, header: header, lines: lines })
    }).then(function (res) {
      return res.json().then(function (data) { return { status: res.status, data: data }; });
    }).then(function (r) {
      busy = false;
      if (r.data && r.data.ok) { window.location.href = r.data.redirect + '?success=' + encodeURIComponent(action === 'submit' ? 'PO submitted for approval.' : 'Draft saved.'); return; }
      if (r.data && r.data.errors) return showErrors(r.data.errors);
      showError('po-form-error', (r.data && r.data.error) || 'Unable to save the PO.');
    }).catch(function () {
      busy = false;
      showError('po-form-error', 'Network error. Please try again.');
    });
  }

  function lookup(input) {
    clearTimeout(lookupTimer);
    lookupTimer = setTimeout(function () {
      fetch('/po/api/items?q=' + encodeURIComponent(input.value), { credentials: 'same-origin' })
        .then(function (r) { return r.ok ? r.json() : { items: [] }; })
        .then(function (data) {
          var list = document.getElementById('po-items');
          list.innerHTML = '';
          (data.items || []).forEach(function (item) {
            var o = document.createElement('option');
            o.value = item.item_code;
            o.label = item.description;
            list.appendChild(o);
          });
          input._items = data.items || [];
        });
    }, 200);
  }

  function fillFromItem(input) {
    var match = (input._items || []).filter(function (i) { return i.item_code === input.value; })[0];
    if (!match) return;
    var tr = input.closest('tr');
    if (!tr.querySelector('[name="description"]').value) tr.querySelector('[name="description"]').value = match.description;
    if (!tr.querySelector('[name="uom"]').value) tr.querySelector('[name="uom"]').value = match.uom;
    if (!tr.querySelector('[name="unit_price"]').value && match.unit_price) tr.querySelector('[name="unit_price"]').value = match.unit_price;
    recalc();
  }

  body.addEventListener('input', function (e) {
    if (e.target.name === 'item_code') lookup(e.target);
    recalc();
  });
  body.addEventListener('change', function (e) { if (e.target.name === 'item_code') fillFromItem(e.target); });

  body.addEventListener('click', function (e) {
    var action = e.target.getAttribute('data-row-action');
    if (!action) return;
    var tr = e.target.closest('tr');
    if (action === 'dup') addRow(rowValues(tr), tr).querySelector('input').focus();
    if (action === 'del') removeRow(tr);
  });

  function removeRow(tr) {
    if (body.rows.length <= 1) { Array.prototype.forEach.call(tr.querySelectorAll('input'), function (i) { i.value = ''; }); recalc(); return; }
    var next = tr.nextElementSibling || tr.previousElementSibling;
    tr.remove();
    renumber();
    recalc();
    if (next) next.querySelector('input').focus();
  }

  body.addEventListener('keydown', function (e) {
    var tr = e.target.closest('tr');
    if (!tr) return;
    if (e.key === 'Enter' && e.target.name === 'tax_pct') {
      e.preventDefault();
      addRow(null, tr).querySelector('input').focus();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      addRow(rowValues(tr), tr).querySelector('input').focus();
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'Backspace') {
      e.preventDefault();
      removeRow(tr);
    }
  });

  document.getElementById('po-add-line').addEventListener('click', function () { addRow().querySelector('input').focus(); });
  Array.prototype.forEach.call(form.querySelectorAll('[data-action]'), function (btn) {
    btn.addEventListener('click', function () { submit(btn.getAttribute('data-action')); });
  });
  form.addEventListener('submit', function (e) { e.preventDefault(); });

  var initial = [];
  try { initial = JSON.parse(form.getAttribute('data-lines') || '[]'); } catch (err) { initial = []; }
  if (!initial.length) initial = [{}];
  initial.forEach(function (l) { addRow(l); });
})();
