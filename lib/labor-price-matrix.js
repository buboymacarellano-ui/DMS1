const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const store = require('../data/store');

const LABOR_MATRIX_CSV_PATH = path.join(__dirname, '..', 'VehServiceLabor.csv');

function normalizeText(value) {
  return String(value || '').trim();
}

function serviceKey(value) {
  return normalizeText(value).toLowerCase().replace(/\s+/g, ' ');
}

function vehiclePriceKey(value) {
  const key = serviceKey(value).replace(/[^a-z0-9]/g, '');
  const map = {
    small: 'small',
    smallsedan: 'small',
    medium: 'medium',
    large: 'large',
    largeunit: 'large',
    compactsuv: 'compactsuv',
    vansuv: 'vansuvpickup',
    vansuvpickup: 'vansuvpickup',
    suvvanpickup: 'vansuvpickup',
    pickup: 'vansuvpickup',
    van: 'vansuvpickup',
    truck: 'truck',
    equipment: 'equipment',
    facility: 'facility',
    tools: 'tools',
  };
  return map[key] || key;
}

function readImportField(row, keys) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== '') {
      return row[key];
    }
  }
  return '';
}

function toNumber(value) {
  const numeric = Number(String(value || '').replace(/,/g, '').trim());
  return Number.isFinite(numeric) ? numeric : 0;
}

function laborPriceFromRule(rule, hourlyRate) {
  const hours = toNumber(rule && rule.hours);
  const rate = toNumber(hourlyRate);
  const fromHours = hours * rate;
  if (fromHours > 0) return Math.round(fromHours * 100) / 100;
  const stored = toNumber(rule && rule.price);
  return stored > 0 ? Math.round(stored * 100) / 100 : 0;
}

async function loadCsvLaborPriceMatrix() {
  if (!fs.existsSync(LABOR_MATRIX_CSV_PATH)) return [];
  const matrix = [];
  const vehicleTypeColumns = [
    ['Small', 'small'],
    ['Medium', 'medium'],
    ['Large', 'large'],
    ['CompactSuv', 'compactsuv'],
    ['VanSuvPickUp', 'vansuvpickup'],
    ['Truck', 'truck'],
  ];

  await new Promise((resolve, reject) => {
    fs.createReadStream(LABOR_MATRIX_CSV_PATH)
      .pipe(csv({ mapHeaders: ({ header }) => String(header || '').replace(/^\uFEFF/, '').trim() }))
      .on('data', (row) => {
        const service_required = normalizeText(readImportField(row, ['Sub Group', 'Service Required', 'service_required']));
        if (!service_required) return;
        const prices = {};
        vehicleTypeColumns.forEach(([column, vehtype]) => {
          const rawPrice = readImportField(row, [column]);
          if (rawPrice === '') return;
          const price = toNumber(rawPrice);
          if (!price && rawPrice !== '0') return;
          if (!Number.isFinite(price)) return;
          prices[vehtype] = price;
        });
        matrix.push({ service_required, prices });
      })
      .on('end', resolve)
      .on('error', reject);
  });

  return matrix;
}

function mergePricingRulesIntoMatrix(csvMatrix, pricingRules, hourlyRate) {
  const byService = new Map();

  (csvMatrix || []).forEach((row) => {
    const name = normalizeText(row && row.service_required);
    if (!name) return;
    byService.set(serviceKey(name), {
      service_required: name,
      prices: Object.assign({}, row.prices || {}),
    });
  });

  (pricingRules || []).forEach((rule) => {
    const name = normalizeText(rule && rule.service_type);
    if (!name) return;
    const vehKey = vehiclePriceKey(rule.vehicle_type);
    if (!vehKey) return;
    const price = laborPriceFromRule(rule, hourlyRate);
    if (!(price > 0)) return;

    const key = serviceKey(name);
    const existing = byService.get(key);
    if (existing) {
      existing.prices[vehKey] = price;
      return;
    }
    byService.set(key, {
      service_required: name,
      prices: { [vehKey]: price },
    });
  });

  return Array.from(byService.values()).sort((a, b) => (
    a.service_required.localeCompare(b.service_required, undefined, { sensitivity: 'base' })
  ));
}

async function loadLaborPriceMatrix() {
  const [csvMatrix, pricingRules, settings] = await Promise.all([
    loadCsvLaborPriceMatrix(),
    store.getAll('pricing_rules'),
    store.getPricingSettings(),
  ]);
  const hourlyRate = toNumber(settings && settings.hourly_rate) || 350;
  return mergePricingRulesIntoMatrix(csvMatrix, pricingRules, hourlyRate);
}

module.exports = {
  loadLaborPriceMatrix,
  mergePricingRulesIntoMatrix,
  vehiclePriceKey,
  laborPriceFromRule,
};
