const express = require('express');
const store = require('../data/store');
const { canonicalizeBranchName, normalizeBranchKey } = require('../lib/branches');

const router = express.Router();

function text(value) {
  return String(value == null ? '' : value).trim();
}

function money(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
}

function sessionBranch(req) {
  const user = req.session && req.session.user ? req.session.user : {};
  return canonicalizeBranchName(String(user.branch || '').trim());
}

async function listExpenses(req) {
  const branch = sessionBranch(req);
  let rows = await store.getAll('expense_logs');
  if (branch) rows = rows.filter(row => normalizeBranchKey(row.branch || '') === normalizeBranchKey(branch));
  return rows.slice().sort((a, b) => (
    String(b.created_at).localeCompare(String(a.created_at))
  ));
}

function buildReplenishRows(body) {
  const rows = [];
  for (let i = 0; i < 5; i++) {
    rows.push({
      amount: money(body['replenish_amount_' + i] || body.replenish_amount),
      source: text(body['replenish_source_' + i] || body.replenish_source),
      reason: text(body['replenish_reason_' + i] || body.replenish_reason),
    });
  }
  return rows;
}

function sumPettyCashOut(rows) {
  return rows.reduce((sum, row) => sum + (Number(row.petty_cash_out) || 0), 0);
}

async function listSnapshots(req) {
  const branch = sessionBranch(req);
  let rows = await store.getAll('petty_cash_snapshots');
  if (branch) rows = rows.filter(row => normalizeBranchKey(row.branch || '') === normalizeBranchKey(branch));
  return rows.slice().sort((a, b) => (
    String(b.created_at || '').localeCompare(String(a.created_at || ''))
  )).slice(0, 100);
}

async function renderView(req, res, extra) {
  const merged = { formError: '', formSuccess: '', prefill: {}, formAction: '/Petty-cash--view', ...(extra || {}) };
  const expenses = await listExpenses(req);
  res.render('service/Petty-cash--view', {
    expensesTotal: sumPettyCashOut(expenses),
    snapshots: await listSnapshots(req),
    ...merged,
  });
}

// GET /Petty-cash  and  GET /Petty-cash--view
router.get(['/', '/view'], async (req, res) => {
  await renderView(req, res);
});

// POST /Petty-cash--view  -> save petty cash snapshot
router.post('/', async (req, res) => {
  const body = req.body || {};
  const prefill = {
    last_inv_amount: money(body.last_inv_amount),
    replenish_rows: buildReplenishRows(body),
    total_cash_registered: money(body.total_cash_registered),
    total_expenses: money(body.total_expenses),
    cash_on_hand: money(body.cash_on_hand),
  };

  // Persist snapshot to a petty_cash_snapshots collection for later recall.
  try {
    await store.create('petty_cash_snapshots', {
      log_date: new Date().toISOString().slice(0, 10),
      last_inv_amount: prefill.last_inv_amount,
      replenish_rows: prefill.replenish_rows,
      total_cash_registered: prefill.total_cash_registered,
      total_expenses: prefill.total_expenses,
      cash_on_hand: prefill.cash_on_hand,
      branch: sessionBranch(req),
      created_by: String(req.session && req.session.user ? req.session.user.username : '').trim(),
    });
  } catch (e) {
    // Snapshot storage is best-effort.
  }

  await renderView(req, res, { formSuccess: 'Petty cash snapshot saved.', prefill });
});

module.exports = router;