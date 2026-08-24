const express = require('express');
const store = require('../data/store');
const { frontlineSessionBranch } = require('../lib/frontline-roles');
const router = express.Router();

function branchContext(req) {
  const user = req.session && req.session.user ? req.session.user : {};
  return frontlineSessionBranch(user);
}

async function branchEntityIds(req) {
  const branch = branchContext(req);
  if (!branch) return null;
  const workOrders = await store.getAll('work_orders');
  const scoped = workOrders.filter(wo => String(wo.branch || '').trim().toLowerCase() === branch.toLowerCase());
  return {
    vehicleIds: new Set(scoped.map(wo => wo.vehicle_id).filter(Boolean)),
    customerIds: new Set(scoped.map(wo => wo.customer_id).filter(Boolean)),
  };
}

async function canAccessVehicle(req, vehicle) {
  const branch = branchContext(req);
  if (!branch) return true;
  if (String(vehicle.branch || '').trim().toLowerCase() === branch.toLowerCase()) return true;
  const ids = await branchEntityIds(req);
  return ids.vehicleIds.has(vehicle.id);
}

router.get('/', async (req, res) => {
  let vehicles = await store.getAll('vehicles');
  let customers = await store.getAll('customers');
  const branch = branchContext(req);
  if (branch) {
    const ids = await branchEntityIds(req);
    vehicles = vehicles.filter(vehicle => ids.vehicleIds.has(vehicle.id) || String(vehicle.branch || '').trim().toLowerCase() === branch.toLowerCase());
    customers = customers.filter(customer => ids.customerIds.has(customer.id) || String(customer.branch || '').trim().toLowerCase() === branch.toLowerCase());
  }
  res.render('vehicles/index', { vehicles, customers });
});

router.get('/new', async (req, res) => {
  let customers = await store.getAll('customers');
  const branch = branchContext(req);
  if (branch) {
    const ids = await branchEntityIds(req);
    customers = customers.filter(customer => ids.customerIds.has(customer.id) || String(customer.branch || '').trim().toLowerCase() === branch.toLowerCase());
  }
  res.render('vehicles/new', { customers });
});

router.post('/new', async (req, res) => {
  const { customer_id, make, model, year, vin, license_plate, vehicle_type } = req.body;
  await store.create('vehicles', { customer_id, make, model, year, vin, license_plate, vehicle_type, branch: branchContext(req) });
  res.redirect('/vehicles');
});

router.get('/:id/edit', async (req, res) => {
  const vehicle = await store.getById('vehicles', req.params.id);
  if (!vehicle) return res.redirect('/vehicles');
  if (!await canAccessVehicle(req, vehicle)) return res.status(403).send('This vehicle belongs to another branch.');
  const customers = await store.getAll('customers');
  res.render('vehicles/edit', { vehicle, customers });
});

router.post('/:id/edit', async (req, res) => {
  const vehicle = await store.getById('vehicles', req.params.id);
  if (!vehicle || !await canAccessVehicle(req, vehicle)) return res.status(403).send('This vehicle belongs to another branch.');
  const { customer_id, make, model, year, vin, license_plate, vehicle_type } = req.body;
  await store.update('vehicles', req.params.id, { customer_id, make, model, year, vin, license_plate, vehicle_type });
  res.redirect('/vehicles');
});

router.post('/:id/delete', async (req, res) => {
  const vehicle = await store.getById('vehicles', req.params.id);
  if (!vehicle || !await canAccessVehicle(req, vehicle)) return res.status(403).send('This vehicle belongs to another branch.');
  await store.remove('vehicles', req.params.id);
  res.redirect('/vehicles');
});

module.exports = router;