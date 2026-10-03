const { normalizeRole, DEPARTMENTS } = require('./portals');

const PERMISSION_PO_CREATE = 'po.create';
const ROLE_GM = 'general_manager';

const STATUS = {
  draft: 'draft',
  pending: 'pending_approval',
  approved: 'approved',
  rejected: 'rejected',
};

const STATUS_LABELS = {
  [STATUS.draft]: 'Draft',
  [STATUS.pending]: 'Pending Approval',
  [STATUS.approved]: 'Approved',
  [STATUS.rejected]: 'Rejected',
};

const PAYMENT_TERMS = ['COD', 'Net 7', 'Net 15', 'Net 30', 'Net 45', 'Net 60', '50% Down Payment'];
const CURRENCIES = ['PHP', 'USD'];
const PO_NUMBER_PATTERN = /^PO-(\d{8})-(\d+)$/i;

function text(value) {
  return String(value == null ? '' : value).trim();
}

function num(value) {
  const n = Number(String(value == null ? '' : value).replace(/,/g, ''));
  return Number.isFinite(n) ? n : NaN;
}

function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function defaultSettings() {
  return { creator_roles: [], creator_user_ids: [], approvers: [] };
}

function normalizeSettings(raw) {
  const base = defaultSettings();
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    creator_roles: Array.isArray(source.creator_roles) ? source.creator_roles.map(normalizeRole) : base.creator_roles,
    creator_user_ids: Array.isArray(source.creator_user_ids) ? source.creator_user_ids.map(text).filter(Boolean) : base.creator_user_ids,
    approvers: Array.isArray(source.approvers) ? source.approvers : base.approvers,
    updated_at: source.updated_at || '',
    updated_by: source.updated_by || '',
  };
}

function isGm(user) {
  return normalizeRole(user && user.role) === ROLE_GM;
}

// GM always holds every permission; others need the grant by role or by user id.
function hasPoPermission(user, settings, permission) {
  if (!user) return false;
  if (isGm(user)) return true;
  if (permission !== PERMISSION_PO_CREATE) return false;
  const cfg = normalizeSettings(settings);
  return cfg.creator_roles.includes(normalizeRole(user.role))
    || cfg.creator_user_ids.includes(text(user.id));
}

function canCreatePo(user, settings) {
  return hasPoPermission(user, settings, PERMISSION_PO_CREATE);
}

function canManagePoSettings(user) {
  return isGm(user);
}

function computeLine(line) {
  const qty = num(line && line.qty);
  const price = num(line && line.unit_price);
  const discount = num(line && line.discount_pct) || 0;
  const tax = num(line && line.tax_pct) || 0;
  const gross = (Number.isFinite(qty) ? qty : 0) * (Number.isFinite(price) ? price : 0);
  const net = round2(gross * (1 - discount / 100));
  const taxAmount = round2(net * tax / 100);
  return { net, tax_amount: taxAmount };
}

function computeTotals(lines) {
  let subtotal = 0;
  let taxTotal = 0;
  (lines || []).forEach((line) => {
    const c = computeLine(line);
    subtotal += c.net;
    taxTotal += c.tax_amount;
  });
  subtotal = round2(subtotal);
  taxTotal = round2(taxTotal);
  return { subtotal, tax_total: taxTotal, grand_total: round2(subtotal + taxTotal) };
}

function normalizeLines(rawLines) {
  return (Array.isArray(rawLines) ? rawLines : []).map((line) => {
    const item = {
      item_code: text(line && line.item_code),
      description: text(line && line.description),
      uom: text(line && line.uom),
      qty: num(line && line.qty),
      unit_price: num(line && line.unit_price),
      discount_pct: line && text(line.discount_pct) !== '' ? num(line.discount_pct) : 0,
      tax_pct: line && text(line.tax_pct) !== '' ? num(line.tax_pct) : 0,
    };
    item.line_total = computeLine(item).net;
    return item;
  });
}

function normalizeHeader(raw) {
  const src = raw || {};
  return {
    po_date: text(src.po_date),
    supplier: text(src.supplier),
    department: text(src.department),
    requestor: text(src.requestor),
    delivery_date: text(src.delivery_date),
    payment_terms: text(src.payment_terms),
    currency: text(src.currency).toUpperCase(),
    reference_no: text(src.reference_no),
    remarks: text(src.remarks),
  };
}

// Drafts only need a supplier; Submit enforces every rule.
// Returns { header: {field: msg}, lines: {index: {field: msg}}, general: [msg] }.
function validatePo(header, lines, options) {
  const errors = { header: {}, lines: {}, general: [] };
  const submit = Boolean(options && options.submit);
  if (!header.supplier) errors.header.supplier = 'Supplier / vendor is required.';
  if (!submit) return errors;
  if (!header.po_date) errors.header.po_date = 'PO date is required.';
  if (!header.department) errors.header.department = 'Department is required.';
  if (!header.requestor) errors.header.requestor = 'Requestor is required.';
  if (!header.delivery_date) errors.header.delivery_date = 'Delivery date is required.';
  else if (header.po_date && header.delivery_date < header.po_date) {
    errors.header.delivery_date = 'Delivery date cannot be before the PO date.';
  }
  if (!header.payment_terms) errors.header.payment_terms = 'Payment terms are required.';
  if (!header.currency) errors.header.currency = 'Currency is required.';
  if (!lines.length) errors.general.push('Add at least one line item.');
  lines.forEach((line, index) => {
    const e = {};
    if (!line.item_code) e.item_code = 'Item code is required.';
    if (!line.description) e.description = 'Description is required.';
    if (!line.uom) e.uom = 'UOM is required.';
    if (!(line.qty > 0)) e.qty = 'Quantity must be greater than 0.';
    if (!(line.unit_price > 0)) e.unit_price = 'Unit price must be greater than 0.';
    if (!(line.discount_pct >= 0 && line.discount_pct <= 100)) e.discount_pct = 'Discount must be 0-100%.';
    if (!(line.tax_pct >= 0 && line.tax_pct <= 100)) e.tax_pct = 'Tax must be 0-100%.';
    if (Object.keys(e).length) errors.lines[index] = e;
  });
  return errors;
}

function hasErrors(errors) {
  return Object.keys(errors.header).length > 0
    || Object.keys(errors.lines).length > 0
    || errors.general.length > 0;
}

function allocatePoNumber(existingPos, date) {
  const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  let max = 0;
  (existingPos || []).forEach((po) => {
    const m = text(po && po.po_number).match(PO_NUMBER_PATTERN);
    if (m && Number(m[2]) > max) max = Number(m[2]);
  });
  const stamp = d.toISOString().slice(0, 10).replace(/-/g, '');
  return `PO-${stamp}-${String(max + 1).padStart(6, '0')}`;
}

function ruleMatches(rule, department, amount) {
  const dept = text(rule.department).toLowerCase();
  if (dept && dept !== '*' && dept !== text(department).toLowerCase()) return false;
  const min = text(rule.min_amount) === '' ? 0 : num(rule.min_amount);
  const max = text(rule.max_amount) === '' ? Infinity : num(rule.max_amount);
  return amount >= (Number.isFinite(min) ? min : 0) && amount <= (Number.isFinite(max) ? max : Infinity);
}

// Builds sequential approval levels. Each level lists approvers (any one may act).
// The requestor is never allowed to approve their own PO.
function resolveApprovalChain(settings, department, amount, requesterId) {
  const cfg = normalizeSettings(settings);
  const byLevel = new Map();
  cfg.approvers
    .filter((rule) => rule && text(rule.approver_user_id) && ruleMatches(rule, department, amount))
    .filter((rule) => text(rule.approver_user_id) !== text(requesterId))
    .forEach((rule) => {
      const level = Math.max(1, parseInt(rule.level, 10) || 1);
      if (!byLevel.has(level)) byLevel.set(level, []);
      const list = byLevel.get(level);
      if (!list.some((a) => a.user_id === text(rule.approver_user_id))) {
        list.push({ user_id: text(rule.approver_user_id), name: text(rule.approver_name) });
      }
    });
  return Array.from(byLevel.keys()).sort((a, b) => a - b)
    .map((level, idx) => ({ level: idx + 1, approvers: byLevel.get(level) }));
}

function currentApprovers(po) {
  if (!po || po.status !== STATUS.pending) return [];
  const level = (po.approval_chain || [])[po.current_level_index || 0];
  return level ? level.approvers : [];
}

function isAssignedApprover(po, user) {
  return Boolean(user) && currentApprovers(po).some((a) => a.user_id === text(user.id));
}

// Pure state transition for an approver decision; returns the patch to persist.
function applyDecision(order, decision, user, remarks) {
  const idx = order.current_level_index || 0;
  const level = (order.approval_chain || [])[idx];
  const history = (order.history || []).concat(
    historyEntry(decision, user, remarks, { level: level ? level.level : null })
  );
  const patch = { history };
  const now = new Date().toISOString();
  if (decision === 'rejected') {
    patch.status = STATUS.rejected;
    patch.rejected_at = now;
  } else if (idx + 1 < (order.approval_chain || []).length) {
    patch.current_level_index = idx + 1;
  } else {
    patch.status = STATUS.approved;
    patch.approved_at = now;
  }
  return patch;
}

function historyEntry(action, user, remarks, extra) {
  return Object.assign({
    action,
    by_user_id: text(user && user.id),
    by: text(user && user.username),
    at: new Date().toISOString(),
    remarks: text(remarks),
  }, extra || {});
}

module.exports = {
  PERMISSION_PO_CREATE,
  STATUS,
  STATUS_LABELS,
  PAYMENT_TERMS,
  CURRENCIES,
  DEPARTMENTS,
  normalizeSettings,
  hasPoPermission,
  canCreatePo,
  canManagePoSettings,
  computeLine,
  computeTotals,
  normalizeLines,
  normalizeHeader,
  validatePo,
  hasErrors,
  allocatePoNumber,
  resolveApprovalChain,
  currentApprovers,
  isAssignedApprover,
  historyEntry,
  applyDecision,
};
