const express = require('express');
const store = require('../data/store');
const { frontlineSessionBranch } = require('../lib/frontline-roles');
const { canonicalizeBranchName, normalizeBranchKey } = require('../lib/branches');
const workOrdersRouter = require('./workorders');
const router = express.Router();

function text(value) {
  return String(value == null ? '' : value).trim();
}

function sessionBranch(req) {
  const user = req.session && req.session.user ? req.session.user : {};
  return frontlineSessionBranch(user);
}

async function listQuotations(req) {
  const branch = sessionBranch(req);
  let rows = await store.getAll('quotations');
  if (branch) rows = rows.filter(q => normalizeBranchKey(q.branch) === normalizeBranchKey(branch));
  return rows.slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

// qs turns indexes above 20 into an object instead of an array.
function parseServiceItems(raw) {
  const rows = Array.isArray(raw) ? raw : (raw && typeof raw === 'object' ? Object.values(raw) : []);
  return rows
    .filter(row => row && typeof row === 'object')
    .map((row) => {
      const laborPrice = Math.max(0, toNumber(row.labor_price));
      const serviceQty = Math.max(1, Math.floor(toNumber(row.service_qty)) || 1);
      const partsPrice = Math.max(0, toNumber(row.parts_price));
      const partsQty = Math.max(0, Math.floor(toNumber(row.parts_qty)));
      return {
        reason: text(row.reason),
        description: text(row.description),
        labor_price: laborPrice,
        service_qty: serviceQty,
        parts: text(row.parts),
        part_number: text(row.part_number),
        unit: text(row.unit),
        parts_price: partsPrice,
        parts_qty: partsQty,
        total_price: Math.round(((laborPrice * serviceQty) + (partsQty * partsPrice)) * 100) / 100,
      };
    })
    .filter(item => item.description || item.parts || item.part_number || item.labor_price > 0);
}

async function findAccessibleQuotation(req) {
  const quotation = await store.getById('quotations', req.params.id);
  const branch = sessionBranch(req);
  if (!quotation || (branch && normalizeBranchKey(quotation.branch) !== normalizeBranchKey(branch))) return null;
  return quotation;
}

async function renderContext(req, extra) {
  return {
    ...(await workOrdersRouter.buildNewFormContext(req)),
    ...(await workOrdersRouter.buildServiceModuleContext()),
    quotations: await listQuotations(req),
    ...extra,
  };
}

router.get('/', async (req, res) => {
  res.render('quotations/new', await renderContext(req));
});

router.post('/', async (req, res) => {
  const body = req.body || {};
  const user = req.session && req.session.user ? req.session.user : {};
  const customerName = text(body.customer_entry);
  if (!customerName) {
    return res.status(400).render('quotations/new', await renderContext(req, {
      vehicleTypeError: 'Customer name is required',
      prefill: body,
    }));
  }

  const serviceItems = parseServiceItems(body.service_items);

  await store.create('quotations', {
    customer_id: text(body.customer_id),
    customer_name: customerName,
    telephone_number: text(body.telephone_number),
    customer_type: text(body.customer_type) === 'Service' ? 'Service' : 'Walk-In',
    plate_number: text(body.plate_number),
    car_brand: text(body.car_brand),
    car_model: text(body.car_model),
    car_year: text(body.car_year),
    vehicle_type: text(body.vehicle_type),
    odometer: text(body.odometer),
    branch: canonicalizeBranchName(text(body.branch) || sessionBranch(req) || ''),
    service_items: serviceItems,
    grand_total: serviceItems.reduce((sum, item) => sum + item.total_price, 0),
    created_by: text(user.username),
  });
  res.redirect('/quotations');
});

router.get('/:id', async (req, res) => {
  const quotation = await findAccessibleQuotation(req);
  if (!quotation) return res.redirect('/quotations');
  res.render('quotations/view', { quotation, sendError: text(req.query.sendError) });
});

router.post('/:id/send-to-work-order', async (req, res) => {
  const quotation = await findAccessibleQuotation(req);
  if (!quotation) return res.redirect('/quotations');
  if (quotation.work_order_id && await store.getById('work_orders', quotation.work_order_id)) {
    return res.redirect('/work-orders');
  }

  const result = await workOrdersRouter.createWorkOrderFromQuotation(req, quotation);
  if (!result.ok) {
    return res.redirect(`/quotations/${quotation.id}?sendError=${encodeURIComponent(result.error)}`);
  }
  await store.update('quotations', quotation.id, {
    work_order_id: result.workOrder.id,
    work_order_number: result.workOrder.work_order_number,
    sent_at: new Date().toISOString(),
  });
  res.redirect('/work-orders');
});

module.exports = router;
