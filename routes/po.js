const crypto = require('crypto');
const express = require('express');
const store = require('../data/store');
const portals = require('../lib/portals');
const po = require('../lib/po-create');

const router = express.Router();

function normalize(value) {
  return String(value == null ? '' : value).trim();
}

function activeUser(req) {
  return req.session && req.session.user ? req.session.user : null;
}

function wantsJson(req) {
  return req.path.indexOf('/api/') === 0 || req.path === '/save' || req.is('application/json');
}

function deny(req, res, message) {
  if (wantsJson(req)) return res.status(403).json({ error: message });
  return res.status(403).render('po/denied', { message });
}

const requireCreator = safe(async (req, res, next) => {
  const user = activeUser(req);
  const settings = await store.getPoSettings();
  if (po.canCreatePo(user, settings)) return next();
  return deny(req, res, 'Access denied. You have not been granted the "Create PO" (po.create) permission.');
});

function requireGm(req, res, next) {
  if (po.canManagePoSettings(activeUser(req))) return next();
  return deny(req, res, 'Access denied. Only the General Manager can manage PO approvers and permissions.');
}

function safe(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

// Serializes PO-number allocation + insert so concurrent saves never share a number.
let createQueue = Promise.resolve();
function createSerialized(task) {
  const run = createQueue.then(task);
  createQueue = run.catch(() => {});
  return run;
}

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function canViewPo(user, order, settings) {
  if (!user) return false;
  if (po.canManagePoSettings(user)) return true;
  if (order.created_by_user_id === normalize(user.id) && po.canCreatePo(user, settings)) return true;
  return (order.approval_chain || []).some((level) => level.approvers.some((a) => a.user_id === normalize(user.id)));
}

function byNewest(a, b) {
  return new Date(b.created_at || 0) - new Date(a.created_at || 0);
}

function flash(req) {
  return { success: normalize(req.query.success), error: normalize(req.query.error) };
}

router.get('/', requireCreator, safe(async (req, res) => {
  const user = activeUser(req);
  const orders = (await store.getAll('po_orders'))
    .filter((order) => po.canManagePoSettings(user) || order.created_by_user_id === normalize(user.id))
    .sort(byNewest);
  res.render('po/index', Object.assign({ orders, STATUS_LABELS: po.STATUS_LABELS }, flash(req)));
}));

router.get('/create', requireCreator, safe(async (req, res) => {
  const user = activeUser(req);
  let order = null;
  if (req.query.id) {
    order = await store.getById('po_orders', normalize(req.query.id));
    if (!order || order.created_by_user_id !== normalize(user.id) || order.status !== po.STATUS.draft) {
      return res.redirect('/po?error=Only+your+own+drafts+can+be+edited.');
    }
  }
  const suppliers = await store.getAll('parts_suppliers');
  const inventory = await store.getAll('parts_inventory');
  const supplierNames = Array.from(new Set(
    suppliers.map((s) => normalize(s.name || s.supplier_name))
      .concat(inventory.map((r) => normalize(r.supplier)))
      .filter(Boolean)
  )).sort((a, b) => a.localeCompare(b));
  res.render('po/create', {
    order,
    suppliers: supplierNames,
    departments: po.DEPARTMENTS,
    paymentTerms: po.PAYMENT_TERMS,
    currencies: po.CURRENCIES,
    today: new Date().toISOString().slice(0, 10),
    defaultDepartment: portals.departmentForRole(user.role),
    defaultRequestor: normalize(user.username),
  });
}));

// Item lookup against existing parts and inventory lots.
router.get('/api/items', requireCreator, safe(async (req, res) => {
  const q = normalize(req.query.q).toLowerCase();
  const [parts, inventory] = await Promise.all([store.getAll('parts'), store.getAll('parts_inventory')]);
  const seen = new Map();
  parts.concat(inventory).forEach((row) => {
    const code = normalize(row.part_number);
    if (!code || seen.has(code.toLowerCase())) return;
    seen.set(code.toLowerCase(), {
      item_code: code,
      description: normalize(row.part_name || row.generic),
      uom: normalize(row.unit),
      unit_price: Number(row.cost_price) || 0,
    });
  });
  const items = Array.from(seen.values())
    .filter((item) => !q || item.item_code.toLowerCase().includes(q) || item.description.toLowerCase().includes(q))
    .slice(0, 20);
  res.json({ items });
}));

router.post('/save', requireCreator, safe(async (req, res) => {
  try {
    const user = activeUser(req);
    const body = req.body || {};
    const submit = normalize(body.action) === 'submit';
    const header = po.normalizeHeader(body.header);
    const lines = po.normalizeLines(body.lines);
    const errors = po.validatePo(header, lines, { submit });
    if (po.hasErrors(errors)) return res.status(422).json({ errors });

    let order = null;
    if (body.id) {
      order = await store.getById('po_orders', normalize(body.id));
      if (!order || order.created_by_user_id !== normalize(user.id) || order.status !== po.STATUS.draft) {
        return res.status(403).json({ error: 'Only your own drafts can be edited.' });
      }
    }

    const totals = po.computeTotals(lines);
    const patch = Object.assign({}, header, { lines }, totals);
    let chain = [];
    if (submit) {
      const settings = await store.getPoSettings();
      chain = po.resolveApprovalChain(settings, header.department, totals.grand_total, user.id);
      if (!chain.length) {
        return res.status(409).json({
          error: 'No approver is configured for this department and amount. Ask the General Manager to define approvers under PO Settings before submitting.',
        });
      }
    }

    const history = (order && order.history ? order.history.slice() : []);
    if (submit) {
      patch.status = po.STATUS.pending;
      patch.approval_chain = chain;
      patch.current_level_index = 0;
      patch.submitted_at = new Date().toISOString();
      history.push(po.historyEntry('submitted', user, header.remarks, {
        assigned_approvers: chain[0].approvers.map((a) => a.name || a.user_id),
      }));
    } else {
      patch.status = po.STATUS.draft;
      history.push(po.historyEntry('saved_draft', user, ''));
    }
    patch.history = history;

    if (order) {
      order = await store.update('po_orders', order.id, patch);
    } else {
      order = await createSerialized(async () => store.create('po_orders', Object.assign({
        po_number: po.allocatePoNumber(await store.getAll('po_orders')),
        created_by_user_id: normalize(user.id),
        created_by: normalize(user.username),
      }, patch)));
    }
    return res.json({ ok: true, id: order.id, po_number: order.po_number, status: order.status, redirect: `/po/${order.id}` });
  } catch (error) {
    console.error('POST /po/save failed', error);
    return res.status(500).json({ error: 'Unable to save the PO.' });
  }
}));

router.get('/approvals', safe(async (req, res) => {
  const user = activeUser(req);
  const orders = await store.getAll('po_orders');
  const mine = user ? normalize(user.id) : '';
  const awaiting = orders.filter((order) => po.isAssignedApprover(order, user)).sort(byNewest);
  const decided = orders.filter((order) => (order.history || []).some((h) => (
    (h.action === 'approved' || h.action === 'rejected') && h.by_user_id === mine
  ))).sort(byNewest);
  const isApproverAnywhere = awaiting.length > 0 || decided.length > 0
    || (await store.getPoSettings()).approvers.some((rule) => normalize(rule.approver_user_id) === mine);
  if (!po.canManagePoSettings(user) && !isApproverAnywhere) {
    return deny(req, res, 'Access denied. You are not an assigned PO approver.');
  }
  const all = po.canManagePoSettings(user) ? orders.slice().sort(byNewest) : [];
  res.render('po/approvals', Object.assign({ awaiting, decided, all, STATUS_LABELS: po.STATUS_LABELS }, flash(req)));
}));

router.get('/settings', requireGm, safe(async (req, res) => {
  const [settings, users] = await Promise.all([store.getPoSettings(), store.getAll('users')]);
  const roles = [];
  Object.keys(portals.ROLES_BY_DEPARTMENT || {}).forEach((dept) => {
    portals.ROLES_BY_DEPARTMENT[dept].forEach((r) => {
      if (!roles.some((x) => x.key === r.key)) roles.push({ key: r.key, label: `${r.label} (${dept})` });
    });
  });
  res.render('po/settings', Object.assign({
    settings: po.normalizeSettings(settings),
    users: users.map((u) => ({ id: u.id, username: u.username, role: u.role })).sort((a, b) => String(a.username).localeCompare(String(b.username))),
    roles,
    departments: po.DEPARTMENTS,
  }, flash(req)));
}));

router.post('/settings', requireGm, safe(async (req, res) => {
  const user = activeUser(req);
  const users = await store.getAll('users');
  const body = req.body || {};
  const depts = asArray(body.rule_department);
  const mins = asArray(body.rule_min);
  const maxs = asArray(body.rule_max);
  const levels = asArray(body.rule_level);
  const approvers = asArray(body.rule_approver);
  const rules = [];
  for (let i = 0; i < approvers.length; i += 1) {
    const approverId = normalize(approvers[i]);
    if (!approverId) continue;
    const target = users.find((u) => u.id === approverId);
    if (!target) return res.redirect('/po/settings?error=Unknown+approver+selected.');
    const min = normalize(mins[i]);
    const max = normalize(maxs[i]);
    if ((min !== '' && !(Number(min) >= 0)) || (max !== '' && !(Number(max) >= 0)) || (min !== '' && max !== '' && Number(max) < Number(min))) {
      return res.redirect('/po/settings?error=Invalid+amount+range+in+approver+rule.');
    }
    rules.push({
      id: crypto.randomUUID(),
      department: normalize(depts[i]) || '*',
      min_amount: min,
      max_amount: max,
      level: Math.max(1, parseInt(levels[i], 10) || 1),
      approver_user_id: target.id,
      approver_name: target.username,
    });
  }
  const validRoles = new Set(Object.values(portals.ROLES_BY_DEPARTMENT || {}).flat().map((r) => r.key));
  const creatorRoles = asArray(body.creator_roles).map(portals.normalizeRole).filter((r) => validRoles.has(r));
  const creatorUsers = asArray(body.creator_user_ids).map(normalize).filter((id) => users.some((u) => u.id === id));
  await store.setPoSettings({
    creator_roles: creatorRoles,
    creator_user_ids: creatorUsers,
    approvers: rules,
    updated_by: normalize(user && user.username),
  });
  res.redirect('/po/settings?success=PO+settings+saved.');
}));

router.get('/:id', safe(async (req, res) => {
  const user = activeUser(req);
  const [order, settings] = await Promise.all([store.getById('po_orders', normalize(req.params.id)), store.getPoSettings()]);
  if (!order) return res.status(404).render('po/denied', { message: 'Purchase order not found.' });
  if (!canViewPo(user, order, settings)) return deny(req, res, 'Access denied. You cannot view this purchase order.');
  res.render('po/view', Object.assign({
    order,
    canAct: po.isAssignedApprover(order, user),
    canEdit: order.status === po.STATUS.draft && order.created_by_user_id === normalize(user.id),
    STATUS_LABELS: po.STATUS_LABELS,
  }, flash(req)));
}));

async function decide(req, res, decision) {
  const user = activeUser(req);
  const order = await store.getById('po_orders', normalize(req.params.id));
  if (!order) return res.status(404).render('po/denied', { message: 'Purchase order not found.' });
  if (!po.isAssignedApprover(order, user)) {
    return deny(req, res, 'Access denied. You are not the assigned approver for this purchase order at its current level.');
  }
  const remarks = normalize(req.body && req.body.remarks);
  if (decision === 'rejected' && !remarks) {
    return res.redirect(`/po/${order.id}?error=Remarks+are+required+when+rejecting.`);
  }
  const patch = po.applyDecision(order, decision, user, remarks);
  await store.update('po_orders', order.id, patch);
  return res.redirect(`/po/${order.id}?success=PO+${decision}.`);
}

router.post('/:id/approve', safe((req, res) => decide(req, res, 'approved')));
router.post('/:id/reject', safe((req, res) => decide(req, res, 'rejected')));

module.exports = router;
