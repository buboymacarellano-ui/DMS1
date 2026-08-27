(function initPartsReportModal() {
  var btn = document.getElementById('parts-report-btn');
  var modal = document.getElementById('parts-report-modal');
  var form = document.getElementById('parts-report-form');
  var typeSelect = document.getElementById('report-type');
  var hint = document.getElementById('report-type-hint');
  if (!btn || !modal || !form || !typeSelect) return;

  var hints = {
    lifecycle: 'Tracks one Part Number through its full lifetime history and current on-hand quantity.',
    'date-range': 'Filter records by month or a custom start/end date window.',
    supplier: 'Limit the report to a specific supplier.',
    warehouse: 'Sort and list parts by warehouse or present location.',
    audit: 'Side-by-side restock and sold transactions for accounting verification. Optional date window.',
    'low-stock': 'Lists catalog items whose current stock is at or below the safe minimum.',
    'whole-database': 'Downloads every parts-database row as a CSV file. No extra filters required.'
  };

  function openModal() {
    modal.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    typeSelect.focus();
  }

  function closeModal() {
    modal.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
  }

  function syncCriteria() {
    var selected = typeSelect.value;
    hint.textContent = hints[selected] || 'Choose a report to reveal the matching criteria.';
    modal.querySelectorAll('.report-criteria').forEach(function (block) {
      var types = String(block.getAttribute('data-for') || '').split(/\s+/);
      block.hidden = types.indexOf(selected) === -1;
    });
  }

  btn.addEventListener('click', function (event) {
    event.preventDefault();
    if (modal.hidden) openModal();
    else closeModal();
  });

  modal.querySelectorAll('[data-report-close]').forEach(function (el) {
    el.addEventListener('click', closeModal);
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !modal.hidden) closeModal();
  });

  typeSelect.addEventListener('change', syncCriteria);

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var type = typeSelect.value;
    if (!type) {
      typeSelect.focus();
      return;
    }
    if (type === 'lifecycle' && !document.getElementById('report-part-number').value.trim()) {
      document.getElementById('report-part-number').focus();
      return;
    }
    if (type === 'supplier' && !document.getElementById('report-supplier').value.trim()) {
      document.getElementById('report-supplier').focus();
      return;
    }
    if (type === 'warehouse' && !document.getElementById('report-warehouse').value.trim()) {
      document.getElementById('report-warehouse').focus();
      return;
    }

    var params = new URLSearchParams();
    params.set('type', type);
    var scope = String(form.getAttribute('data-report-scope') || '').trim();
    if (scope) params.set('scope', scope);
    var fields = {
      partNumber: document.getElementById('report-part-number'),
      startDate: document.getElementById('report-start-date'),
      endDate: document.getElementById('report-end-date'),
      month: document.getElementById('report-month'),
      supplier: document.getElementById('report-supplier'),
      warehouse: document.getElementById('report-warehouse'),
      threshold: document.getElementById('report-threshold')
    };
    Object.keys(fields).forEach(function (key) {
      var value = fields[key] && String(fields[key].value || '').trim();
      if (value) params.set(key, value);
    });

    window.open('/api/reports/generate?' + params.toString(), '_blank', 'noopener');
  });

  syncCriteria();
})();
