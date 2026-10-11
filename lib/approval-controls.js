// GM Control Panel: master switches for every approval step in the app.
// Each switch defaults to ON (approval required), preserving the original workflow.
const AUTO_APPROVER = 'Auto-approved (GM Control Panel)';

const CONTROLS = [
  {
    key: 'po_gm_approval',
    group: 'Parts & Procurement',
    label: 'Parts Purchase Orders need GM approval',
    on: 'POs sent from the Parts Manager Purchase grid wait in GM Approvals.',
    off: 'POs sent from the Purchase grid within the amount range are approved automatically and go straight to PO release.',
  },
  {
    key: 'stock_transfer_gm_approval',
    group: 'Parts & Procurement',
    label: 'Stock Transfers need GM approval',
    on: 'New stock transfers stay pending until the GM approves them.',
    off: 'Stock transfers within the amount range are filed as approved, so the transit receipt can be made right away.',
  },
  {
    key: 'parts_request_approval',
    group: 'Parts & Procurement',
    label: 'Parts requests need Parts Manager approval',
    on: 'Parts requests from technicians and service wait for the Parts Manager.',
    off: 'Parts requests within the amount range are approved automatically and the approved parts receipt is issued.',
  },
  {
    key: 'po_module_approval',
    group: 'Parts & Procurement',
    label: 'PO module (/po) uses the approver chain',
    on: 'POs submitted in the PO module go through the approvers set in PO Settings.',
    off: 'POs in the PO module within the amount range are approved immediately.',
  },
  {
    key: 'rwo_approval',
    group: 'Service',
    label: 'Work order removal (RWO) requests need approval',
    on: 'Requests to remove a work order wait for a manager.',
    off: 'The work order is removed as soon as the request is submitted.',
  },
  {
    key: 'cbd_approval',
    group: 'HR',
    label: 'Change of branch (CBD) requests need approval',
    on: 'Employee branch changes wait for a manager.',
    off: 'The employee branch change applies as soon as the request is submitted.',
  },
];

const KEYS = new Set(CONTROLS.map((control) => control.key));
// Approval steps that carry a peso amount, so an auto-approve threshold applies.
const AMOUNT_KEYS = new Set(['po_gm_approval', 'stock_transfer_gm_approval', 'parts_request_approval', 'po_module_approval']);
CONTROLS.forEach((control) => { control.hasAmount = AMOUNT_KEYS.has(control.key); });

function isRequired(controls, key) {
  const value = controls && controls[key];
  return value === undefined || value === null ? true : value !== false;
}

function toAmount(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const n = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function threshold(controls, key) {
  return { min: toAmount(controls && controls[`${key}_min`]), max: toAmount(controls && controls[`${key}_max`]) };
}

// True only when the switch is OFF and (for amount-based steps) the amount is inside the GM's range.
// Amounts outside the range, or a missing range, still go through normal approval.
function autoApproves(controls, key, amount) {
  if (isRequired(controls, key)) return false;
  if (!AMOUNT_KEYS.has(key)) return true;
  const range = threshold(controls, key);
  if (range.max === null) return false;
  const value = Number(amount) || 0;
  return value >= (range.min || 0) && value <= range.max;
}

function fromData(data) {
  return (data && data.approval_controls) || {};
}

async function requires(store, key) {
  return isRequired(await store.getApprovalControls(), key);
}

async function autoApprovesAsync(store, key, amount) {
  return autoApproves(await store.getApprovalControls(), key, amount);
}

module.exports = {
  AUTO_APPROVER, CONTROLS, KEYS, AMOUNT_KEYS,
  isRequired, toAmount, threshold, autoApproves, autoApprovesAsync, fromData, requires,
};
