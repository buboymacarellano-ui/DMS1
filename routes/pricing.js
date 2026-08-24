const express = require('express');
const store = require('../data/store');
const { frontlineSessionBranch } = require('../lib/frontline-roles');
const router = express.Router();

const CAR_UNIT_TYPES = [
  'small',
  'medium',
  'large',
  'compactSuv',
  'vanSuvPickup',
  'truck',
];
const CAR_UNIT_TYPE_SET = new Set(CAR_UNIT_TYPES);
const HOURS_STEP = 1.1;

function normalizeVehicleType(value) {
  const key = String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  const map = {
    small: 'small',
    medium: 'medium',
    large: 'large',
    largeunit: 'large',
    compactsuv: 'compactSuv',
    vansuvpickup: 'vanSuvPickup',
    suvvanpickup: 'vanSuvPickup',
    suvpickup: 'vanSuvPickup',
    van: 'vanSuvPickup',
    pickup: 'vanSuvPickup',
    truck: 'truck',
    equipment: 'equipment',
    facility: 'facility',
    tools: 'tools',
  };
  return map[key] || String(value || '').trim();
}

function carUnitIndex(value) {
  return CAR_UNIT_TYPES.indexOf(normalizeVehicleType(value));
}

function scaleServiceHours(baseHours, fromIndex, toIndex) {
  const scaled = Number(baseHours || 0) * Math.pow(HOURS_STEP, toIndex - fromIndex);
  return Math.round(Math.max(0, scaled) * 100) / 100;
}

function sortPricingRules(rules) {
  return (rules || []).slice().sort((a, b) => {
    const serviceCmp = String(a.service_type || '').localeCompare(String(b.service_type || ''), undefined, { sensitivity: 'base' });
    if (serviceCmp) return serviceCmp;
    const aCar = carUnitIndex(a.vehicle_type);
    const bCar = carUnitIndex(b.vehicle_type);
    if (aCar !== -1 || bCar !== -1) {
      if (aCar === -1) return 1;
      if (bCar === -1) return -1;
      return aCar - bCar;
    }
    return String(a.vehicle_type || '').localeCompare(String(b.vehicle_type || ''), undefined, { sensitivity: 'base' });
  });
}

function sessionCreatorBranch(req) {
  const user = (req.session && req.session.user) || {};
  return String(frontlineSessionBranch(user) || user.branch || '').trim() || 'Shared';
}

async function upsertCarPricingFamily({ vehicle_type, service_type, hours, price, created_branch }) {
  const startType = normalizeVehicleType(vehicle_type);
  const service = normalizeServiceType(service_type);
  const baseHours = normalizeHours(hours);
  const rate = Number(price) || 0;
  const branch = String(created_branch || '').trim();

  if (!service) return;

  if (!CAR_UNIT_TYPE_SET.has(startType)) {
    await store.create('pricing_rules', {
      vehicle_type: startType,
      service_type: service,
      hours: baseHours,
      price: rate,
      created_branch: branch,
    });
    return;
  }

  const startIndex = CAR_UNIT_TYPES.indexOf(startType);
  const existing = await store.getAll('pricing_rules');
  const serviceKey = service.toLowerCase();

  for (let index = 0; index < CAR_UNIT_TYPES.length; index += 1) {
    const type = CAR_UNIT_TYPES[index];
    const nextHours = scaleServiceHours(baseHours, startIndex, index);
    const found = existing.find((rule) => (
      normalizeVehicleType(rule.vehicle_type) === type
      && String(rule.service_type || '').trim().toLowerCase() === serviceKey
    ));
    const payload = {
      vehicle_type: type,
      service_type: service,
      hours: nextHours,
      price: rate,
    };
    if (found) {
      await store.update('pricing_rules', found.id, payload);
    } else {
      await store.create('pricing_rules', Object.assign({}, payload, { created_branch: branch }));
    }
  }
}

function normalizeServiceType(value) {
  return String(value || '').trim();
}

function normalizeHours(value) {
  const numeric = Number(String(value || '').replace(/,/g, '').trim());
  return Number.isFinite(numeric) ? numeric : 0;
}

router.get('/', async (req, res) => {
  const pricing_rules = await store.getAll('pricing_rules');
  const settings = await store.getPricingSettings();
  const tab = String(req.query.tab || 'labor').trim().toLowerCase();
  const activeTab = ['labor', 'database', 'parts', 'search'].includes(tab) ? tab : 'labor';
  const search = String(req.query.search || '').trim().toLowerCase();
  const searchResults = search
    ? pricing_rules.filter(rule => {
        const vehicleType = String(rule.vehicle_type || '').toLowerCase();
        const serviceType = String(rule.service_type || '').toLowerCase();
        return vehicleType.includes(search) || serviceType.includes(search);
      })
    : [];

  res.render('pricing/index', {
    pricing_rules: sortPricingRules(pricing_rules),
    settings,
    activeTab,
    search,
    searchResults: sortPricingRules(searchResults),
  });
});

router.get('/new', async (req, res) => {
  const [settings, pricing_rules] = await Promise.all([
    store.getPricingSettings(),
    store.getAll('pricing_rules'),
  ]);
  res.render('pricing/new', {
    settings,
    pricing_rules: sortPricingRules(pricing_rules),
  });
});

router.post('/new', async (req, res) => {
  const { vehicle_type, service_type, hours, price } = req.body;
  await upsertCarPricingFamily({
    vehicle_type,
    service_type,
    hours,
    price,
    created_branch: sessionCreatorBranch(req),
  });
  res.redirect('/pricing/new');
});

router.get('/:id/edit', async (req, res) => {
  const rule = await store.getById('pricing_rules', req.params.id);
  if (!rule) return res.redirect('/pricing/new');
  res.render('pricing/edit', { rule });
});

router.post('/:id/edit', async (req, res) => {
  const { vehicle_type, service_type, hours, price } = req.body;
  const startType = normalizeVehicleType(vehicle_type);
  if (!CAR_UNIT_TYPE_SET.has(startType)) {
    await store.update('pricing_rules', req.params.id, {
      vehicle_type: startType,
      service_type: normalizeServiceType(service_type),
      hours: normalizeHours(hours),
      price: Number(price) || 0,
    });
    return res.redirect('/pricing/new');
  }
  await upsertCarPricingFamily({
    vehicle_type,
    service_type,
    hours,
    price,
    created_branch: sessionCreatorBranch(req),
  });
  res.redirect('/pricing/new');
});

router.post('/:id/delete', async (req, res) => {
  await store.remove('pricing_rules', req.params.id);
  res.redirect('/pricing');
});

router.post('/settings', async (req, res) => {
  const hourly_rate = Number(req.body.hourly_rate) || 350;
  await store.updatePricingSettings({ hourly_rate });
  res.redirect('/pricing');
});

module.exports = router;
