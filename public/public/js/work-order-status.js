(function (global) {
  const HOLD = ['waiting-parts', 'break', 'on-other-priority'];

  function bindWorkOrderStatusSequence(options) {
    const settings = options || {};
    const technicianInput = document.getElementById(settings.technicianId || 'technician-input');
    const statusSelect = document.getElementById(settings.statusId || 'wo-status-select');
    if (!technicianInput || !statusSelect) return;

    function currentValue() {
      return String(statusSelect.value || '').trim().toLowerCase();
    }

    function applySequence() {
      if (statusSelect.dataset.locked === '1') return;
      const hasTechnician = Boolean((technicianInput.value || '').trim());
      const selected = currentValue();

      if (!hasTechnician) {
        statusSelect.value = 'open';
      } else if (selected === 'open' || selected === 'completed' || !selected) {
        statusSelect.value = 'in-progress';
      }

      Array.from(statusSelect.options).forEach((option) => {
        const value = String(option.value || '').trim().toLowerCase();
        if (value === 'completed') {
          option.disabled = true;
          return;
        }
        if (HOLD.indexOf(value) !== -1) {
          option.disabled = !hasTechnician;
        }
      });
    }

    technicianInput.addEventListener('input', applySequence);
    technicianInput.addEventListener('change', applySequence);
    technicianInput.addEventListener('blur', applySequence);
    statusSelect.addEventListener('change', applySequence);
    applySequence();
  }

  global.DmsWorkOrderStatus = { bindWorkOrderStatusSequence };
})(window);
