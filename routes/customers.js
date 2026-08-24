const express = require('express');
const store = require('../data/store');
const { frontlineSessionBranch } = require('../lib/frontline-roles');
const router = express.Router();

function branchContext(req) {
  const user = req.session && req.session.user ? req.session.user : {};
  return frontlineSessionBranch(user);
}

async function branchCustomerIds(req) {
  const branch = branchContext(req);
  if (!branch) return null;
  const workOrders = await store.getAll('work_orders');
  return new Set(workOrders
    .filter(wo => String(wo.branch || '').trim().toLowerCase() === branch.toLowerCase())
    .map(wo => wo.customer_id)
    .filter(Boolean));
}

async function canAccessCustomer(req, customer) {
  const branch = branchContext(req);
  if (!branch) return true;
  if (String(customer.branch || '').trim().toLowerCase() === branch.toLowerCase()) return true;
  const ids = await branchCustomerIds(req);
  return ids.has(customer.id);
}

router.get('/', async (req, res) => {
  let customers = await store.getAll('customers');
  const branch = branchContext(req);
  if (branch) {
    const ids = await branchCustomerIds(req);
    customers = customers.filter(customer => ids.has(customer.id) || String(customer.branch || '').trim().toLowerCase() === branch.toLowerCase());
  }
  res.render('customers/index', { customers });
});

router.get('/new', (req, res) => {
  res.render('customers/new');
});

router.post('/new', async (req, res) => {
  const { name, phone, email, address, tin, business_style, notes } = req.body;
  await store.create('customers', { name, phone, email, address, tin, business_style, notes, branch: branchContext(req) });
  res.redirect('/customers');
});

router.get('/:id/edit', async (req, res) => {
  const customer = await store.getById('customers', req.params.id);
  if (!customer) return res.redirect('/customers');
  if (!await canAccessCustomer(req, customer)) return res.status(403).send('This customer belongs to another branch.');
  res.render('customers/edit', { customer });
});

router.post('/:id/edit', async (req, res) => {
  const customer = await store.getById('customers', req.params.id);
  if (!customer || !await canAccessCustomer(req, customer)) return res.status(403).send('This customer belongs to another branch.');
  const { name, phone, email, address, tin, business_style, notes } = req.body;
  await store.update('customers', req.params.id, { name, phone, email, address, tin, business_style, notes });
  res.redirect('/customers');
});

router.post('/:id/delete', async (req, res) => {
  const customer = await store.getById('customers', req.params.id);
  if (!customer || !await canAccessCustomer(req, customer)) return res.status(403).send('This customer belongs to another branch.');
  await store.remove('customers', req.params.id);
  res.redirect('/customers');
});

module.exports = router;