(function () {
  const root = document.querySelector('main');
  if (!root) return;

  const editable = 'input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]), select, textarea, [contenteditable="true"]';
  const numericHeading = /^(?:#|qty|tr qty|quantity|stock qty|on[- ]hand|current on[- ]hand|received \/ transaction qty|received qty|stock|current stock|safety stock|sold qty|year|vat|totalwith vat|count|amount|balance|hours|cost|cost price|retail|retail price|markup|markup pct|markup %|price|total|subtotal|grand total|total labor|total parts|total labor price mtd|work orders handled mtd|inventory value)(?:\s*\([^)]*\))?$/i;
  const observed = new WeakSet();
  let queued = false;

  function alignColumns(table) {
    const headers = Array.from(table.tHead ? table.tHead.rows : [])
      .find((row) => Array.from(row.cells).every((cell) => cell.colSpan === 1 && cell.rowSpan === 1));
    if (!headers) return;
    const dataRows = Array.from(table.tBodies).flatMap((body) => Array.from(body.rows))
      .filter((row) => row.cells.length === headers.cells.length
        && Array.from(row.cells).every((cell) => cell.colSpan === 1 && cell.rowSpan === 1));
    Array.from(headers.cells).forEach((header, index) => {
      let label = header.querySelector('.database-header-label');
      if (!label) {
        label = document.createElement('span');
        label.className = 'database-header-label';
        while (header.firstChild) label.appendChild(header.firstChild);
        header.appendChild(label);
      }
      label.classList.toggle('database-header-data-width',
        dataRows.some((row) => row.cells[index].textContent.trim() !== ''));
    });
    const numeric = Array.from(headers.cells).map((header, index) => {
      const label = header.textContent.trim().replace(/\s+/g, ' ');
      return header.dataset.columnType === 'number'
        || (table.matches('.transaction-table') && /^(services|parts)$/i.test(label))
        || header.classList.contains('num') || header.classList.contains('stock-qty')
        || header.style.textAlign === 'right' || numericHeading.test(label)
        || Array.from(table.tBodies).some((body) => Array.from(body.rows).some((row) => {
          if (row.cells.length !== headers.cells.length || Array.from(row.cells).some((cell) => cell.colSpan !== 1)) return false;
          const cell = row.cells[index];
          return cell.style.textAlign === 'right' || cell.classList.contains('num') || cell.classList.contains('stock-qty');
        }));
    });
    Array.from(table.rows).forEach((row) => {
      if (row.cells.length !== numeric.length || Array.from(row.cells).some((cell) => cell.colSpan !== 1 || cell.rowSpan !== 1)) return;
      Array.from(row.cells).forEach((cell, index) => {
        cell.classList.toggle('database-cell-number', numeric[index]);
      });
    });
  }

  function updateStickyColumns(table) {
    const cells = table.querySelectorAll('.sticky-col');
    cells.forEach((cell) => {
      const row = cell.parentElement;
      const left = Array.from(row.cells).slice(0, cell.cellIndex)
        .reduce((sum, previous) => sum + previous.getBoundingClientRect().width, 0);
      cell.style.left = left + 'px';
    });
  }

  const resizeObserver = new ResizeObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.target.classList.contains('database-table-fit')) updateStickyColumns(entry.target);
    });
  });

  function refresh() {
    queued = false;
    root.querySelectorAll('table.list').forEach((table) => {
      if (table.querySelector(editable) || table.querySelector('table')
        || table.matches('.pm-po-grid, .po-grid, .pm-multiple-entry__table, [data-table-layout="manual"]')) {
        table.classList.remove('database-table-fit');
        return;
      }
      table.classList.add('database-table-fit');
      if (!table.parentElement.matches('.table-scroll, .database-table-scroll, .part-history-stock-scroll')) {
        const wrapper = document.createElement('div');
        wrapper.className = 'database-table-scroll';
        table.parentElement.insertBefore(wrapper, table);
        wrapper.appendChild(table);
      }
      alignColumns(table);
      updateStickyColumns(table);
      if (!observed.has(table)) {
        observed.add(table);
        resizeObserver.observe(table);
      }
    });
  }

  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(refresh);
  }

  new MutationObserver(schedule).observe(root, { childList: true, characterData: true, subtree: true });
  refresh();
})();
