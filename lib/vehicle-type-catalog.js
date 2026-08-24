const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

const VEHICLE_TYPE_CSV_PATH = path.join(__dirname, '..', 'VehicleType.csv');

function catalogKey(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function toUiVehicleType(value) {
  const key = catalogKey(value);
  const map = {
    small: 'small',
    smallsedan: 'small',
    medium: 'medium',
    large: 'Large',
    largeunit: 'Large',
    compactsuv: 'CompactSuv',
    vansuv: 'VanSuvPickUp',
    vansuvpickup: 'VanSuvPickUp',
    suvvanpickup: 'VanSuvPickUp',
    vanfullsuv: 'VanSuvPickUp',
    pickup: 'VanSuvPickUp',
    truck: 'Truck',
    walkin: 'Walk-In',
    equipment: 'Equipment',
    facility: 'Facility',
    tools: 'Tools',
  };
  return map[key] || '';
}

function toStoredVehicleType(value) {
  const ui = toUiVehicleType(value);
  const map = {
    small: 'small',
    medium: 'medium',
    Large: 'large',
    CompactSuv: 'compactSuv',
    VanSuvPickUp: 'vanSuvPickup',
    Truck: 'truck',
    'Walk-In': 'walk-in',
    Equipment: 'equipment',
    Facility: 'facility',
    Tools: 'tools',
  };
  return map[ui] || '';
}

function readImportField(row, keys) {
  const normalized = {};
  Object.keys(row || {}).forEach((header) => {
    normalized[catalogKey(header)] = row[header];
  });
  for (const key of keys) {
    const hit = normalized[catalogKey(key)];
    if (hit !== undefined && hit !== null && String(hit).trim() !== '') {
      return hit;
    }
  }
  return '';
}

function findBrandName(catalog, brand) {
  const key = catalogKey(brand);
  if (!key) return '';
  return (catalog.brandOptions || []).find((name) => catalogKey(name) === key) || '';
}

function findModelEntry(catalog, brand, model) {
  const brandName = findBrandName(catalog, brand);
  const models = brandName && catalog.modelsByBrand ? (catalog.modelsByBrand[brandName] || []) : [];
  const key = catalogKey(model);
  if (!key) return null;
  return models.find((entry) => catalogKey(entry.model) === key) || null;
}

function lookupUnitType(catalog, brand, model) {
  const entry = findModelEntry(catalog, brand, model);
  if (!entry) return null;
  return {
    brand: findBrandName(catalog, brand),
    model: entry.model,
    vehicleType: entry.vehicleType,
    vehicleTypeUi: entry.vehicleTypeUi || toUiVehicleType(entry.vehicleType),
  };
}

async function loadVehicleTypeCatalog() {
  if (!fs.existsSync(VEHICLE_TYPE_CSV_PATH)) {
    return { brandOptions: [], modelsByBrand: {} };
  }

  const brandOptions = [];
  const modelsByBrand = {};
  const seenBrands = new Set();

  await new Promise((resolve, reject) => {
    fs.createReadStream(VEHICLE_TYPE_CSV_PATH)
      .pipe(csv({
        mapHeaders: ({ header }) => String(header || '').replace(/^\uFEFF/, '').trim(),
      }))
      .on('data', (row) => {
        const brand = String(readImportField(row, ['Car Brand', 'CarBrand', 'Brand', 'brand']) || '').trim();
        const model = String(readImportField(row, ['Model', 'model']) || '').trim();
        const rawType = String(readImportField(row, [
          'Unit Type',
          'Unit_Type',
          'UnitType',
          'unit_type',
          'unitType',
          'Vehicle Type',
          'Vehicle_Type',
          'VehicleType',
          'vehicle_type',
          'vehicleType',
        ]) || '').trim();

        if (!brand || !model) return;

        const vehicleTypeUi = toUiVehicleType(rawType);
        const vehicleType = toStoredVehicleType(rawType) || rawType;

        if (!seenBrands.has(brand)) {
          seenBrands.add(brand);
          brandOptions.push(brand);
        }

        if (!modelsByBrand[brand]) {
          modelsByBrand[brand] = [];
        }

        if (!modelsByBrand[brand].some((entry) => catalogKey(entry.model) === catalogKey(model))) {
          modelsByBrand[brand].push({
            model,
            vehicleType,
            vehicleTypeUi,
          });
        }
      })
      .on('end', resolve)
      .on('error', reject);
  });

  return { brandOptions, modelsByBrand };
}

module.exports = {
  catalogKey,
  findBrandName,
  findModelEntry,
  loadVehicleTypeCatalog,
  lookupUnitType,
  toStoredVehicleType,
  toUiVehicleType,
};
