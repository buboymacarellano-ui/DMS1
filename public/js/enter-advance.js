/* Enter-to-next-field: advances focus to the next fillable field on Enter,
 * within the same form only. Skips textareas (multi-line), hidden, readonly,
 * disabled fields, buttons and elements inside modals/dialogs.
 *
 * When focus moves to a field via Enter, a red flashing border is applied
 * (cursor-blink rate) so the jumped-to box is obvious. */
(function () {
  'use strict';

  const FLASH_CLASS = 'enter-advance-flash';
  let flashTimer = null;

  function clearFlash() {
    if (flashTimer) {
      clearInterval(flashTimer);
      flashTimer = null;
    }
  }

  function applyFlash(el) {
    clearFlash();
    el.classList.add(FLASH_CLASS);
    let ticks = 0;
    flashTimer = setInterval(() => {
      el.classList.toggle(FLASH_CLASS);
      ticks += 1;
      if (ticks > 10) {
        clearFlash();
        el.classList.remove(FLASH_CLASS);
      }
    }, 500);
  }

  function isAdvanceable(el) {
    if (!el) return false;
    if (el.closest('dialog, [role="dialog"], .modal, .dialog, [data-modal]')) return false;
    const tag = (el.tagName || '').toLowerCase();
    if (tag === 'textarea') return false;
    if (el.type === 'hidden' || el.readOnly || el.disabled || el.readonly) return false;
    if (el.classList && el.classList.contains('no-enter-advance')) return false;
    return (
      tag === 'input' ||
      tag === 'select' ||
      (el.isContentEditable && el.isContentEditable() === true)
    );
  }

  function nextFocusable(form, current) {
    const fields = form.querySelectorAll(
      'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])'
    );
    const list = Array.from(fields).filter((f) => {
      if (f.readOnly || f.disabled) return false;
      if (f.type === 'hidden') return false;
      if (f.closest('dialog, [role="dialog"], .modal, .dialog, [data-modal]')) return false;
      if (f.classList && f.classList.contains('no-enter-advance')) return false;
      return true;
    });
    const idx = list.indexOf(current);
    if (idx === -1) return null;
    return list[idx + 1] || null;
  }

  function handleEnter(ev) {
    const el = ev.target;
    if (!isAdvanceable(el)) return;
    if (el.tagName === 'textarea') return; // allow newline
    const form = el.closest('form');
    if (!form) return;
    const next = nextFocusable(form, el);
    if (!next) return;
    ev.preventDefault();
    next.focus();
    if (next.select) next.select();
    applyFlash(next);
  }

  document.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Enter') return;
    handleEnter(ev);
  });
})();