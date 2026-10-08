const express = require('express');
const store = require('../data/store');
const { frontlineSessionBranch } = require('../lib/frontline-roles');
const { canonicalizeBranchName, normalizeBranchKey } = require('../lib/branches');
const router = express.Router();

const EXPENSE_TYPES = ['OpEx', 'COGS'];
const EXPENSE_CATEGORIES = ['Repairs & Maintenance', 'Xparts', 'Utilities', 'Shop Supplies', 'Miscellaneous'];

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

async function listExpenses(req) {
  const branch = sessionBranch(req);
  let rows = await store.getAll('expense_logs');
  if (branch) rows = rows.filter(row => normalizeBranchKey(row.branch) === normalizeBranchKey(branch));
  return rows.slice().sort((a, b) => (
    String(b.log_date).localeCompare(String(a.log_date)) || String(b.created_at).localeCompare(String(a.created_at))
  ));
}

async function findAccessibleExpense(req) {
  const expense = await store.getById('expense_logs', req.params.id);
  const branch = sessionBranch(req);
  if (!expense || (branch && normalizeBranchKey(expense.branch) !== normalizeBranchKey(branch))) return null;
  return expense;
}

async function renderIndex(req, res, extra) {
  res.render('service/expenses', {
    expenses: await listExpenses(req),
    expenseTypes: EXPENSE_TYPES,
    expenseCategories: EXPENSE_CATEGORIES,
    today: new Date().toISOString().slice(0, 10),
    formError: '',
    prefill: {},
    ...extra,
  });
}

router.get('/', async (req, res) => {
  await renderIndex(req, res);
});

router.post('/', async (req, res) => {
  const body = req.body || {};
  const user = req.session && req.session.user ? req.session.user : {};
  const expenseType = text(body.expense_type);
  const category = text(body.category);
  const logDate = text(body.log_date);

  let formError = '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(logDate)) formError = 'Log Date is required.';
  else if (!EXPENSE_TYPES.includes(expenseType)) formError = 'Select a valid Expenses Type.';
  else if (!EXPENSE_CATEGORIES.includes(category)) formError = 'Select a valid Category / Account.';
  if (formError) {
    res.status(400);
    return renderIndex(req, res, { formError, prefill: body });
  }

  const unitPrice = money(body.unit_price);
  const qty = money(body.qty);
  await store.create('expense_logs', {
    log_date: logDate,
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
    petty_cash_out: money(body.petty_cash_out),
    petty_cash_in: money(body.petty_cash_in),
    received_by: text(body.received_by),
    note: text(body.note),
    branch: canonicalizeBranchName(sessionBranch(req) || text(user.branch) || ''),
    created_by: text(user.username),
  });
  res.redirect('/expenses');
});

router.get('/:id', async (req, res) => {
  const expense = await findAccessibleExpense(req);
  if (!expense) return res.redirect('/expenses');
  res.render('service/expense-view', { expense });
});

module.exports = router;
