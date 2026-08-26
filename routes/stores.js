const express = require('express');
const store = require('../data/store');
const {
  GROCERY_STORES,
  GRANT,
  hasGrant,
  PORTAL_STORES,
} = require('../lib/portals');

const router = express.Router();

function emptyTill(storeName) {
  return {
    store: storeName,
    opening_float: 0,
    cash_in: 0,
    cash_out: 0,
    expected_drawer: 0,
    actual_drawer: 0,
    variance: 0,
    status: 'closed',
  };
}

function emptyShelf(storeName, aisle) {
  return {
    store: storeName,
    aisle,
    facings: 0,
    on_hand: 0,
    capacity: 0,
    fill_pct: 0,
  };
}

async function loadStoresPayload(req) {
  const [sales, tills, shelves] = await Promise.all([
    store.getAll('store_pos_sales'),
    store.getAll('store_tills'),
    store.getAll('store_shelves'),
  ]);
  const user = req.session && req.session.user ? req.session.user : {};
  const assigned = String(user.branch || user.location || '').trim();
  const stores = GROCERY_STORES.map((name) => {
    const posRows = (sales || []).filter((row) => String(row.store || '') === name);
    const till = (tills || []).find((row) => String(row.store || '') === name) || emptyTill(name);
    const shelfRows = (shelves || []).filter((row) => String(row.store || '') === name);
    return {
      name,
      posCount: posRows.length,
      posTotal: posRows.reduce((sum, row) => sum + Number(row.amount || 0), 0),
      till,
      shelfCount: shelfRows.length,
      onHand: shelfRows.reduce((sum, row) => sum + Number(row.on_hand || 0), 0),
    };
  });
  return {
    stores,
    assignedStore: assigned,
    canPos: hasGrant(user, PORTAL_STORES, GRANT.pos_sale),
    canCashier: hasGrant(user, PORTAL_STORES, GRANT.cashier_control),
    canEdit: hasGrant(user, PORTAL_STORES, GRANT.edit),
    canRequest: hasGrant(user, PORTAL_STORES, GRANT.request),
    canFill: hasGrant(user, PORTAL_STORES, GRANT.filloutform),
    canApprove: hasGrant(user, PORTAL_STORES, GRANT.approval),
  };
}

router.get('/', async (req, res) => {
  return res.render('stores/index', await loadStoresPayload(req));
});

router.get('/pos', async (req, res) => {
  const payload = await loadStoresPayload(req);
  return res.render('stores/pos', payload);
});

router.get('/shelving', async (req, res) => {
  const payload = await loadStoresPayload(req);
  payload.aisles = ['A', 'B', 'C', 'D'].map((aisle) => emptyShelf(payload.assignedStore || GROCERY_STORES[0], aisle));
  return res.render('stores/shelving', payload);
});

router.get('/cashier', async (req, res) => {
  const payload = await loadStoresPayload(req);
  return res.render('stores/cashier', payload);
});

module.exports = router;
