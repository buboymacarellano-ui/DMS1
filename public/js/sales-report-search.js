(function () {
  const input = document.getElementById('sales-report-search');
  const table = document.getElementById('sales-report-table');
  if (!input || !table) return;

  const tbody = table.querySelector('tbody');
  if (!tbody) return;
  const rows = Array.from(tbody.querySelectorAll('tr'));

  input.addEventListener('input', function () {
    const query = input.value.trim().toLowerCase();
    rows.forEach(function (row) {
      if (!query) {
        row.style.display = '';
        return;
      }
      const haystack = row.textContent.toLowerCase();
      row.style.display = haystack.indexOf(query) !== -1 ? '' : 'none';
    });
  });
})();
