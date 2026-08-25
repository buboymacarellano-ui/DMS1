(function setupSaRevenueBars() {
  const root = document.getElementById('sa-mtd-bars');
  if (!root) return;

  function applyFill(card, fillPct) {
    const pct = Math.max(0, Math.min(100, Number(fillPct) || 0));
    card.style.setProperty('--fill', pct + '%');
    card.setAttribute('data-fill', String(pct));
    const track = card.querySelector('.sa-mtd-bar__track');
    if (track) track.setAttribute('aria-valuenow', String(pct));
  }

  function paint(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.bars)) return;
    snapshot.bars.forEach((bar) => {
      const card = root.querySelector('.sa-mtd-bar[data-key="' + bar.key + '"]');
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
    root.querySelectorAll('.sa-mtd-bar[data-fill]').forEach((card) => {
      applyFill(card, card.getAttribute('data-fill'));
    });
    root.classList.add('is-live');
  }

  async function refresh() {
    if (document.visibilityState === 'hidden') return;
    try {
      const response = await fetch('/api/service-receptionist/revenue-bars', {
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
      });
      if (!response.ok) return;
      paint(await response.json());
    } catch (_error) {
      // Keep last painted values if the live poll fails.
    }
  }

  requestAnimationFrame(startFills);
  setInterval(refresh, 12000);
})();
