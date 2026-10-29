const express = require('express');
const store = require('../data/store');
const { frontlineSessionBranch, employeeMatchesIdentifier, employeeDisplayName } = require('../lib/frontline-roles');
const { canonicalizeBranchName, normalizeBranchKey } = require('../lib/branches');

const router = express.Router();

const EXPENSE_TYPES = ['OpEx', 'COGS'];
const EXPENSE_CATEGORIES_BY_TYPE = {
  COGS: ['Xparts', 'Machine Shop', 'TP Repair'],
  OpEx: ['Sundries', 'Misc', 'Tools', 'Equipment', 'Facility'],
};

const EXPENSE_CATEGORIES = [
  ...EXPENSE_CATEGORIES_BY_TYPE.COGS,
  ...EXPENSE_CATEGORIES_BY_TYPE.OpEx,
];

function text(value) {
  return String(value == null ? '' : value).trim();
}

function money(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
}

function sessionBranch(req) {
  const user = req.session && req.session.user ? req.session.user : {};
  return frontlineSessionBranch(user);
}

function sameBranch(a, b) {
  return normalizeBranchKey(a) === normalizeBranchKey(b);
}

async function listExpenses(req) {
  const branch = sessionBranch(req);
  let rows = await store.getAll('expense_logs');
  if (branch) rows = rows.filter(row => sameBranch(row.branch || '', branch));
  return rows.slice().sort((a, b) => (
    String(b.created_at).localeCompare(String(a.created_at))
  ));
}

async function getAccessibleExpense(req, id) {
  const expense = await store.getById('expense_logs', id);
  if (!expense) return null;
  const branch = sessionBranch(req);
  if (branch && !sameBranch(expense.branch || '', branch)) return null;
  return expense;
}

async function nextSerialNo(req) {
  const branch = sessionBranch(req);
  const rows = await store.getAll('expense_logs');
  const scoped = branch ? rows.filter(r => sameBranch(r.branch || '', branch)) : rows;
  const max = scoped.reduce((m, r) => {
    const n = Number(r.serial_no || 0);
    return Number.isFinite(n) && n > m ? n : m;
  }, 0);
  return max + 1;
}

async function renderIndex(req, res, extra) {
  const merged = {
    formError: '',
    prefill: {},
    editId: '',
    ...(extra || {}),
  };

  const serialNo = merged.editId
    ? (merged.prefill && merged.prefill.serial_no ? merged.prefill.serial_no : '')
    : await nextSerialNo(req);

  const today = new Date().toISOString().slice(0, 10);

  res.render('service/expenses', {
    expenses: await listExpenses(req),
    expenseTypes: EXPENSE_TYPES,
    expenseCategories: EXPENSE_CATEGORIES,
    expenseCategoriesByType: EXPENSE_CATEGORIES_BY_TYPE,
    today,
    serialNo,
    ...merged,
  });
}

router.get('/', async (req, res) => {
  await renderIndex(req, res);
});

router.get('/:id/edit', async (req, res) => {
  const expense = await getAccessibleExpense(req, req.params.id);
  if (!expense) return res.redirect('/expenses');
  await renderIndex(req, res, { prefill: expense, editId: expense.id });
});

// Create new expense log.
// Only requires: petty_cash_out + received_by
router.post('/', async (req, res) => {
  const body = req.body || {};
  const user = req.session && req.session.user ? req.session.user : {};

  const employees = await store.getAll('employees');
  const receivedByRaw = text(body.received_by);
  const receivedByEmployee = receivedByRaw
    ? employees.find((employee) => employeeMatchesIdentifier(employee, receivedByRaw))
    : null;

  const pettyCashOut = money(body.petty_cash_out);

  let formError = '';
  if (!pettyCashOut) formError = 'Petty Cash Out is required.';
  else if (!receivedByRaw) formError = 'Received By (Employee ID / Barcode) is required.';
  else if (!text(body.business_purpose)) formError = 'Service WO# or Notes is required.';

  if (formError) {
    res.status(400);
    return renderIndex(req, res, { formError, prefill: body });
  }


  const expenseType = text(body.expense_type);
  const category = text(body.category);
  const allowedCategories = EXPENSE_CATEGORIES_BY_TYPE[expenseType] || [];

  if (expenseType && !EXPENSE_TYPES.includes(expenseType)) formError = 'Select a valid Expenses Type.';
  else if (category && expenseType && allowedCategories.length && !allowedCategories.includes(category)) formError = 'Select a valid Category / Account.';
  else if (category && !expenseType && !EXPENSE_CATEGORIES.includes(category)) formError = 'Select a valid Category / Account.';

  if (formError) {
    res.status(400);
    return renderIndex(req, res, { formError, prefill: body });
  }
  const unitPrice = money(body.unit_price);
  const qty = money(body.qty);

  const serialNo = await nextSerialNo(req);

  await store.create('expense_logs', {
    serial_no: serialNo,
    log_date: new Date().toISOString().slice(0, 10),

    // creation: minimal required fields
    petty_cash_out: pettyCashOut,
    received_by: receivedByEmployee ? employeeDisplayName(receivedByEmployee) : receivedByRaw,

    // optional now, can be filled later
    expense_type: expenseType,
    category,
    business_purpose: text(body.business_purpose),
    vendor: text(body.vendor),
    specifics: text(body.specifics),
    unit: text(body.unit),
    unit_price: unitPrice,
    qty,
    total: Math.round(unitPrice * qty * 100) / 100,
    reference_receipt: text(body.reference_receipt),
    petty_cash_in: money(body.petty_cash_in),
    note: text(body.note),

    edit_count: 0,
    branch: canonicalizeBranchName(sessionBranch(req) || text(user.branch) || ''),
    created_by: text(user.username),
  });

  res.redirect('/expenses');
});

// Update an existing expense log. Stamp updated_at + increment edit_count.
router.post('/:id', async (req, res) => {
  const body = req.body || {};
  const user = req.session && req.session.user ? req.session.user : {};

  const existing = await getAccessibleExpense(req, req.params.id);
  if (!existing) return res.redirect('/expenses');

  const employees = await store.getAll('employees');
  const receivedByRaw = text(body.received_by);
  const receivedByEmployee = receivedByRaw
    ? employees.find((employee) => employeeMatchesIdentifier(employee, receivedByRaw))
    : null;

  const expenseType = text(body.expense_type);
  const category = text(body.category);

  const allowedCategories = EXPENSE_CATEGORIES_BY_TYPE[expenseType] || [];

  let formError = '';
  if (expenseType && !EXPENSE_TYPES.includes(expenseType)) formError = 'Select a valid Expenses Type.';
  else if (category && expenseType && allowedCategories.length && !allowedCategories.includes(category)) formError = 'Select a valid Category / Account.';
  else if (category && !expenseType && !EXPENSE_CATEGORIES.includes(category)) formError = 'Select a valid Category / Account.';

  if (formError) {
    res.status(400);
    return renderIndex(req, res, {
      formError,
      prefill: Object.assign({}, existing, body, { id: existing.id }),
      editId: existing.id,
    });
  }

  const unitPrice = money(body.unit_price);
  const qty = money(body.qty);

  await store.update('expense_logs', existing.id, {
    // Keep original log_date/created_at as stamp.
    petty_cash_out: money(body.petty_cash_out),
    received_by: receivedByEmployee ? employeeDisplayName(receivedByEmployee) : receivedByRaw,

    expense_type: expenseType,
    category,
    business_purpose: text(body.business_purpose),
    vendor: text(body.vendor),
    specifics: text(body.specifics),
    unit: text(body.unit),
    unit_price: unitPrice,
    qty,
    total: Math.round(unitPrice * qty * 100) / 100,
    reference_receipt: text(body.reference_receipt),
    petty_cash_in: money(body.petty_cash_in),
    note: text(body.note),

    updated_at: new Date().toISOString(),
    edit_count: Number(existing.edit_count || 0) + 1,

    // Ensure branch/created_by aren't accidentally lost.
    branch: existing.branch || canonicalizeBranchName(sessionBranch(req) || text(user.branch) || ''),
    created_by: existing.created_by || text(user.username),
  });

  res.redirect('/expenses');
});

router.get('/:id', async (req, res) => {
  const expense = await getAccessibleExpense(req, req.params.id);
  if (!expense) return res.redirect('/expenses');
  res.render('service/expense-view', { expense });
});

module.exports = router;

