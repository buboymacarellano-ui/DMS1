(function setupStmDashboard() {
  const root = document.getElementById('stm-dashboard');
  if (!root) return;

  const filter = document.getElementById('stm-branch-filter');
  const printFiltered = document.getElementById('stm-print-filtered');
  const pacingRoot = document.getElementById('sa-mtd-bars');
  const pacingCaption = document.getElementById('stm-pacing-caption');
  const randomWrap = document.getElementById('stm-live-random');
  let pacingByScope = {};

  try {
    const raw = document.getElementById('stm-pacing-json');
    pacingByScope = raw && raw.textContent ? JSON.parse(raw.textContent) : {};
  } catch (_error) {
    pacingByScope = {};
  }

  function selectedBranch() {
    return filter && filter.value ? String(filter.value) : 'ALL';
  }

  function applyBranchFilter() {
    const branch = selectedBranch();
    document.querySelectorAll('#stm-tech-table tbody tr[data-branch], #stm-behaviour-table tbody tr[data-branch], #stm-wo-table tbody tr[data-branch], #stm-live-random [data-branch]').forEach((row) => {
      const match = branch === 'ALL' || String(row.getAttribute('data-branch') || '') === branch;
      row.hidden = !match;
    });
    document.querySelectorAll('#stm-labor-table tbody tr[data-branch]').forEach((row) => {
      const rowBranch = String(row.getAttribute('data-branch') || '');
      row.hidden = !(branch === 'ALL' || rowBranch === branch || rowBranch === 'ALL');
    });
    if (printFiltered) {
      printFiltered.href = '/stm/print-technicians?branch=' + encodeURIComponent(branch === 'ALL' ? 'all' : branch);
    }
    paintPacing(pacingByScope[branch] || pacingByScope.ALL);
  }

  function applyFill(card, fillPct) {
    const pct = Math.max(0, Math.min(100, Number(fillPct) || 0));
    card.style.setProperty('--fill', pct + '%');
    card.setAttribute('data-fill', String(pct));
    const track = card.querySelector('.sa-mtd-bar__track');
    if (track) track.setAttribute('aria-valuenow', String(pct));
  }

  function paintPacing(snapshot) {
    if (!pacingRoot || !snapshot || !Array.isArray(snapshot.bars)) return;
    if (pacingCaption) {
      pacingCaption.textContent = 'Month-to-date · ' + (snapshot.monthLabel || 'This month') + ' · ' + (snapshot.branch || selectedBranch());
    }
    snapshot.bars.forEach((bar) => {
      const card = pacingRoot.querySelector('.sa-mtd-bar[data-key="' + bar.key + '"]');
      if (!card) return;
      const valueEl = card.querySelector('.sa-mtd-bar__value');
      const metaEl = card.querySelector('.sa-mtd-bar__meta');
      if (valueEl) valueEl.textContent = bar.valueText || '';
      if (metaEl) metaEl.textContent = bar.meta || '';
      const nextTone = String(bar.tone || '');
      const prevTone = String(card.getAttribute('data-tone') || '');
      if (nextTone && nextTone !== prevTone) {
        if (prevTone) card.classList.remove('sa-mtd-bar--' + prevTone);
        card.classList.add('sa-mtd-bar--' + nextTone);
        card.setAttribute('data-tone', nextTone);
      }
      applyFill(card, bar.fillPct);
    });
  }

  function startFills() {
    if (!pacingRoot) return;
    pacingRoot.querySelectorAll('.sa-mtd-bar[data-fill]').forEach((card) => {
      applyFill(card, card.getAttribute('data-fill'));
    });
  }

  function renderRandom(rows) {
    if (!randomWrap) return;
    const branch = selectedBranch();
    const visible = (Array.isArray(rows) ? rows : []).filter((row) => branch === 'ALL' || row.branch === branch);
    if (!visible.length) {
      randomWrap.innerHTML = '<p class="dashboard-note">No open work orders right now.</p>';
      return;
    }
    randomWrap.innerHTML = visible.map((row) => (
      '<a class="stm-live-chip" href="' + String(row.href || '#') + '" data-branch="' + String(row.branch || '') + '">' +
        '<strong>WO ' + String(row.work_order_number || '') + '</strong>' +
        '<span>' + String(row.branch || '') + '</span>' +
        '<em>' + String(row.status || '') + '</em>' +
      '</a>'
    )).join('');
  }

  async function refresh() {
    if (document.visibilityState === 'hidden') return;
    try {
      const response = await fetch('/api/stm/live', {
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
      });
      if (!response.ok) return;
      const payload = await response.json();
      if (payload && payload.pacingByScope) pacingByScope = payload.pacingByScope;
      renderRandom(payload && payload.liveRandom);
      paintPacing(pacingByScope[selectedBranch()] || pacingByScope.ALL);
    } catch (_error) {
      // Keep last painted values.
    }
  }

  if (filter) filter.addEventListener('change', applyBranchFilter);
  requestAnimationFrame(() => {
    startFills();
    applyBranchFilter();
  });
  setInterval(refresh, 12000);
})();
