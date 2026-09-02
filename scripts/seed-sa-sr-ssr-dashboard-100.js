/**
 * Seed 100 open work orders for SA/SR/SSR dashboard coverage across all 7 branches.
 * Uses customers + vehicles mock data, services from VehServiceLabor.csv,
 * available parts from stored parts collections, and branch technicians/advisors
 * sourced from the imported employee roster (employee-db-all).
 *
 * Usage: node scripts/seed-sa-sr-ssr-dashboard-100.js [--force] [--dry-run]
 */
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const store = require('../data/store');
const { canonicalizeBranchName, DEFAULT_OPERATIONAL_BRANCHES } = require('../lib/branches');

const ROOT = path.join(__dirname, '..');
const SERVICE_FILE = path.join(ROOT, 'VehServiceLabor.csv');
const VEHICLE_FILE = path.join(ROOT, 'VehicleType.csv');
const BATCH_ID = 'sa-sr-ssr-dashboard-100';
const TARGET_COUNT = 100;
const VAT_RATE = 0.12;
const RANDOM_SEED = 20260902;
const FORCE = process.argv.includes('--force');
const DRY_RUN = process.argv.includes('--dry-run');

const SERVICE_COLUMNS = {
  small: 'Small',
  medium: 'Medium',
  large: 'Large',
  compactSuv: 'CompactSuv',
  vanSuvPickup: 'VanSuvPickUp',
  truck: 'Truck',
};

const FIRST_NAMES = [
  'Adrian', 'Aileen', 'Alvin', 'Amelia', 'Andres', 'Angela', 'Anton', 'Bea', 'Benedict', 'Bianca',
  'Carlo', 'Catherine', 'Cesar', 'Clarisse', 'Daniel', 'Diana', 'Diego', 'Elena', 'Emilio', 'Erica',
  'Felix', 'Frances', 'Gabriel', 'Gia', 'Harold', 'Helena', 'Ian', 'Isabel', 'Jacob', 'Jasmine',
  'Joel', 'Karen', 'Kevin', 'Liza', 'Marco', 'Melissa', 'Nathan', 'Nina', 'Oscar', 'Patricia',
  'Paolo', 'Queenie', 'Ramon', 'Rebecca', 'Samuel', 'Sofia', 'Theo', 'Uma', 'Victor', 'Yolanda',
  'Zander', 'Rowena', 'Miguel', 'Teresa', 'Noel', 'Gloria', 'Rico', 'Hazel', 'Omar', 'Cynthia',
];

const LAST_NAMES = [
  'Abad', 'Alonzo', 'Bautista', 'Cabrera', 'Dela Cruz', 'Domingo', 'Enriquez', 'Flores', 'Garcia',
  'Hernandez', 'Ignacio', 'Jimenez', 'Katigbak', 'Lim', 'Mendoza', 'Navarro', 'Ocampo', 'Pascual',
  'Quiambao', 'Ramos', 'Santos', 'Torres', 'Umali', 'Villanueva', 'Yap', 'Zamora', 'Bernal',
  'Castillo', 'Fernandez', 'Gomez', 'Gutierrez', 'Lopez', 'Marquez', 'Ortega', 'Reyes', 'Salazar',
  'Tan', 'Velasco', 'Wong', 'Cruz', 'Aguilar', 'Pineda', 'Mercado', 'Dizon', 'Ferrer',
];

function createRandom(seed) {
  let state = seed >>> 0;
  return function random() {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(list, random) {
  return list[Math.floor(random() * list.length)];
}

function shuffle(items, random) {
  const result = items.slice();
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

function normalizeText(value) {
  return String(value == null ? '' : value).trim();
}

function asMoney(value) {
  return Number((Number(value) || 0).toFixed(2));
}

function moneyText(value) {
  return asMoney(value).toFixed(2);
}

function normalizeVehicleType(value) {
  const key = normalizeText(value).toLowerCase().replace(/[^a-z0-9]/g, '');
  const types = {
    small: 'small',
    smallsedan: 'small',
    medium: 'medium',
    large: 'large',
    largeunit: 'large',
    compactsuv: 'compactSuv',
    vansuv: 'vanSuvPickup',
    vansuvpickup: 'vanSuvPickup',
    suvvanpickup: 'vanSuvPickup',
    pickup: 'vanSuvPickup',
    van: 'vanSuvPickup',
    truck: 'truck',
  };
  return types[key] || 'small';
}

function technicianName(employee) {
  const name = [employee.first_name, employee.middle_name, employee.last_name]
    .map(normalizeText)
    .filter(Boolean)
    .join(' ');
  const id = normalizeText(employee.employee_id);
  if (name && id) return `${name} (${id})`;
  return name || id;
}

function advisorName(employee) {
  return [employee.first_name, employee.last_name].map(normalizeText).filter(Boolean).join(' ');
}

function readCsv(filePath) {
  return new Promise((resolve, reject) => {
    const rows = [];
    fs.createReadStream(filePath)
      .pipe(csv({ mapHeaders: ({ header }) => normalizeText(header).replace(/^\uFEFF/, '') }))
      .on('data', (row) => rows.push(row))
      .on('end', () => resolve(rows))
      .on('error', reject);
  });
}

function hhmm(hour, minute) {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function isoFromDate(date, hour, minute, second) {
  return `${date.toISOString().slice(0, 10)}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}+08:00`;
}

function nextWorkOrderNumber(existing, index) {
  let max = 0;
  existing.forEach((row) => {
    const value = Number(String((row && (row.work_order_number || row['work order Number'])) || '').replace(/\D/g, ''));
    if (Number.isFinite(value) && value > max) max = value;
  });
  return String(max + index + 1).padStart(7, '0');
}

function isTechnicianEmployee(employee) {
  return /(mechanic|aligner|toolkeeper|carwasher|technician)/i.test(String(employee.job_title || ''));
}

function isAdvisorEmployee(employee) {
  return /service advisor|service receptionist|senior service receptionist/i.test(String(employee.job_title || ''));
}

function stripBatch(data) {
  ['customers', 'vehicles', 'work_orders', 'transaction_records'].forEach((name) => {
    data[name] = (data[name] || []).filter((row) => row && row.seed_batch !== BATCH_ID);
  });
}

async function main() {
  const [serviceRows, vehicleRows, data] = await Promise.all([
    readCsv(SERVICE_FILE),
    readCsv(VEHICLE_FILE),
    store.getRawData(),
  ]);

  data.customers = data.customers || [];
  data.vehicles = data.vehicles || [];
  data.work_orders = data.work_orders || [];
  data.transaction_records = data.transaction_records || [];
  data.employees = data.employees || [];
  data.parts = data.parts || [];
  data.parts_inventory = data.parts_inventory || [];

  const already = data.work_orders.filter((row) => row && row.seed_batch === BATCH_ID).length;
  if (already && !FORCE) {
    console.log(JSON.stringify({ skipped: true, reason: 'batch already present', count: already, hint: 're-run with --force' }, null, 2));
    return;
  }
  if (already && FORCE) stripBatch(data);

  const services = serviceRows
    .map((row) => ({
      name: normalizeText(row['Service Required'] || row['Sub Group']),
      prices: Object.fromEntries(Object.entries(SERVICE_COLUMNS).map(([type, column]) => [type, Number(row[column])])),
    }))
    .filter((service) => service.name && Object.values(service.prices).some((price) => Number.isFinite(price) && price > 0));
  if (!services.length) throw new Error('No usable services found in VehServiceLabor.csv');

  const vehicleCatalog = vehicleRows.filter((row) => normalizeText(row['Car Brand']) && normalizeText(row.Model));
  if (!vehicleCatalog.length) throw new Error('No usable vehicles found in VehicleType.csv');

  const technicians = (data.employees || []).filter((employee) => (
    normalizeText(employee.employee_id)
    && canonicalizeBranchName(employee.work_location_branch_id)
    && isTechnicianEmployee(employee)
  ));
  const advisors = (data.employees || []).filter((employee) => (
    canonicalizeBranchName(employee.work_location_branch_id)
    && isAdvisorEmployee(employee)
  ));
  if (!technicians.length) {
    throw new Error('No technicians found in employee roster. Import employee-db-all first.');
  }

  const techniciansByBranch = new Map(DEFAULT_OPERATIONAL_BRANCHES.map((branch) => [branch, []]));
  technicians.forEach((employee) => {
    const branch = canonicalizeBranchName(employee.work_location_branch_id);
    if (techniciansByBranch.has(branch)) techniciansByBranch.get(branch).push(employee);
  });
  DEFAULT_OPERATIONAL_BRANCHES.forEach((branch) => {
    if (!techniciansByBranch.get(branch).length) {
      throw new Error(`No technicians found for branch ${branch}.`);
    }
  });

  const advisorsByBranch = new Map(DEFAULT_OPERATIONAL_BRANCHES.map((branch) => [branch, []]));
  advisors.forEach((employee) => {
    const branch = canonicalizeBranchName(employee.work_location_branch_id);
    if (advisorsByBranch.has(branch)) advisorsByBranch.get(branch).push(employee);
  });

  const partsByNumber = new Map();
  [...data.parts, ...data.parts_inventory].forEach((row) => {
    const partNumber = normalizeText(row.part_number);
    const partName = normalizeText(row.part_name);
    if (!partNumber || !partName) return;
    if (!partsByNumber.has(partNumber.toUpperCase())) {
      partsByNumber.set(partNumber.toUpperCase(), {
        part_number: partNumber,
        part_name: partName,
        unit: normalizeText(row.unit) || 'pc',
        retail_price: asMoney(row.retail_price || row.cost_price),
      });
    }
  });
  const catalogParts = Array.from(partsByNumber.values()).filter((part) => Number(part.retail_price) >= 0);
  if (!catalogParts.length) throw new Error('No parts found in parts collections.');

  const random = createRandom(RANDOM_SEED);
  const usedNames = new Set((data.customers || []).map((row) => normalizeText(row.name).toLowerCase()));

  const slots = [];
  const baseCount = Math.floor(TARGET_COUNT / DEFAULT_OPERATIONAL_BRANCHES.length);
  let remainder = TARGET_COUNT % DEFAULT_OPERATIONAL_BRANCHES.length;
  DEFAULT_OPERATIONAL_BRANCHES.forEach((branch) => {
    const count = baseCount + (remainder > 0 ? 1 : 0);
    remainder = Math.max(0, remainder - 1);
    for (let i = 0; i < count; i += 1) slots.push(branch);
  });
  const branchSlots = shuffle(slots, random);

  const start = new Date(Date.UTC(2026, 8, 1, 0, 0, 0));
  const end = new Date(Date.UTC(2026, 8, 30, 10, 0, 0));
  const span = end.getTime() - start.getTime();

  const customers = [];
  const vehicles = [];
  const workOrders = [];
  const transactions = [];

  for (let index = 0; index < TARGET_COUNT; index += 1) {
    const branch = branchSlots[index];
    const dayMs = start.getTime() + Math.round((index / Math.max(1, TARGET_COUNT - 1)) * span);
    const day = new Date(dayMs);
    const hour = 8 + Math.floor(random() * 10);
    const minute = Math.floor(random() * 60);
    const second = Math.floor(random() * 60);
    const createdAt = isoFromDate(day, hour, minute, second);

    let name = '';
    let attempt = 0;
    while (!name || usedNames.has(name.toLowerCase())) {
      const first = FIRST_NAMES[(index + attempt) % FIRST_NAMES.length];
      const last = LAST_NAMES[(index * 3 + attempt) % LAST_NAMES.length];
      const suffix = attempt > 6 ? ` ${String(index + 1).padStart(3, '0')}` : '';
      name = `${first} ${last}${suffix}`.trim();
      attempt += 1;
    }
    usedNames.add(name.toLowerCase());

    const sequence = String(index + 1).padStart(4, '0');
    const customerId = `cust-${BATCH_ID}-${sequence}`;
    const vehicleId = `veh-${BATCH_ID}-${sequence}`;
    const workOrderId = `wo-${BATCH_ID}-${sequence}`;

    const sourceVehicle = vehicleCatalog[index % vehicleCatalog.length];
    const vehicleType = normalizeVehicleType(sourceVehicle['Unit Type'] || sourceVehicle.Unit_Type || sourceVehicle.Vehicle_Type);

    const branchTechs = techniciansByBranch.get(branch);
    const technician = pick(branchTechs, random);
    const branchAdvisors = advisorsByBranch.get(branch);
    const advisorPool = branchAdvisors.length ? branchAdvisors : advisors;
    const advisor = advisorPool.length ? pick(advisorPool, random) : null;

    const serviceCount = 1 + (index % 3);
    const chosenServices = [];
    for (let slot = 0; slot < serviceCount; slot += 1) {
      const service = services[(index + slot * 17) % services.length];
      if (!chosenServices.some((item) => item.name === service.name)) chosenServices.push(service);
    }

    const partCount = 1 + (index % 2);
    const chosenParts = [];
    for (let slot = 0; slot < partCount; slot += 1) {
      const part = catalogParts[(index + slot * 13) % catalogParts.length];
      if (!chosenParts.some((item) => item.part_number === part.part_number)) chosenParts.push(part);
    }

    const serviceItems = chosenServices.map((service, slot) => {
      const part = chosenParts[slot % chosenParts.length];
      const laborPrice = asMoney(service.prices[vehicleType] || service.prices.small || 350);
      const partsQty = 1 + ((index + slot) % 2);
      const partsPrice = asMoney(part.retail_price || 0);
      return {
        description: service.name,
        reason: service.name,
        labor_price: laborPrice,
        service_qty: 1,
        part_number: part.part_number,
        unit: part.unit,
        parts: `${part.part_name} (${part.part_number})`,
        parts_qty: partsQty,
        parts_price: partsPrice,
        total_price: asMoney(laborPrice + (partsQty * partsPrice)),
      };
    });

    const laborTotal = serviceItems.reduce((sum, item) => sum + asMoney(item.labor_price), 0);
    const partsTotal = serviceItems.reduce((sum, item) => sum + (asMoney(item.parts_qty) * asMoney(item.parts_price)), 0);
    const grandTotal = asMoney(laborTotal + partsTotal);
    const vat = asMoney(grandTotal * VAT_RATE);

    const customer = {
      id: customerId,
      created_at: createdAt,
      seed_batch: BATCH_ID,
      name,
      phone: `09${String(280000000 + index + 1).slice(0, 9)}`,
      email: `sasrssr.${sequence}@example.test`,
      address: `${30 + (index % 60)} ${LAST_NAMES[index % LAST_NAMES.length]} St, ${branch}, Cebu`,
      notes: 'SA/SR/SSR dashboard mock customer',
      branch,
    };

    const vehicle = {
      id: vehicleId,
      created_at: createdAt,
      seed_batch: BATCH_ID,
      customer_id: customerId,
      make: normalizeText(sourceVehicle['Car Brand']),
      model: normalizeText(sourceVehicle.Model),
      year: String(2012 + (index % 14)),
      vin: `SASR${String(index + 1).padStart(13, '0')}`.slice(0, 17),
      license_plate: `SR${String(1000 + index).slice(-4)}`,
      vehicle_type: vehicleType,
      branch,
    };

    const workOrderNumber = nextWorkOrderNumber([...data.work_orders, ...workOrders], 0);
    const workOrder = {
      id: workOrderId,
      created_at: createdAt,
      seed_batch: BATCH_ID,
      customer_id: customerId,
      vehicle_id: vehicleId,
      description: chosenServices.map((row) => row.name).join(', '),
      status: 'open',
      branch,
      work_order_number: workOrderNumber,
      service_advisor: advisor ? advisorName(advisor) : 'Service Desk',
      technician: technicianName(technician),
      technician_assigned_at: createdAt,
      time_in: hhmm(hour, minute),
      time_out: '',
      telephone_number: customer.phone,
      car_brand: vehicle.make,
      car_model: vehicle.model,
      car_year: vehicle.year,
      plate_number: vehicle.license_plate,
      odometer: String(20000 + (index * 141) % 100000),
      service_items: serviceItems,
    };

    const transaction = {
      id: `tx-${BATCH_ID}-${sequence}`,
      created_at: createdAt,
      seed_batch: BATCH_ID,
      work_order_id: workOrderId,
      transaction_action: 'created',
      action_by: 'SEED-SA-SR-SSR-100',
      action_by_role: 'service_advisor',
      'Transaction date': createdAt,
      Branch: branch,
      'work order Number': workOrderNumber,
      'Customer name': customer.name,
      'Telephone number': customer.phone,
      'Car Brand': vehicle.make,
      Model: vehicle.model,
      Year: vehicle.year,
      'Service Advice Advisor': workOrder.service_advisor,
      Tecnician: workOrder.technician,
      'Total Labor': moneyText(laborTotal),
      'Total Parts': moneyText(partsTotal),
      'Grand Total': moneyText(grandTotal),
      Vat: moneyText(vat),
      'Totalwith Vat': moneyText(grandTotal + vat),
      TimeIn: workOrder.time_in,
      TimeOut: '',
    };

    for (let slot = 1; slot <= 15; slot += 1) {
      const item = serviceItems[slot - 1];
      transaction[`Service${slot}`] = item ? item.reason : '';
      transaction[`Labor${slot}`] = item ? moneyText(item.labor_price) : '';
      transaction[`Service Required${slot}`] = item ? item.description : '';
    }

    for (let slot = 1; slot <= 50; slot += 1) {
      const item = serviceItems[slot - 1];
      transaction[`Part${slot}`] = item ? `${item.parts} x${item.parts_qty}` : '';
      transaction[`Parts Price${slot}`] = item ? moneyText(item.parts_qty * item.parts_price) : '';
    }

    customers.push(customer);
    vehicles.push(vehicle);
    workOrders.push(workOrder);
    transactions.push(transaction);
  }

  data.customers.push(...customers);
  data.vehicles.push(...vehicles);
  data.work_orders.push(...workOrders);
  data.transaction_records.push(...transactions);

  if (!DRY_RUN) {
    await store.replaceData(data);
  }

  console.log(JSON.stringify({
    dryRun: DRY_RUN,
    created: workOrders.length,
    status: 'open',
    unique_customers: new Set(customers.map((row) => row.name)).size,
    unique_vehicles: new Set(vehicles.map((row) => `${row.make} ${row.model} ${row.license_plate}`)).size,
    services_used: new Set(workOrders.flatMap((wo) => wo.service_items.map((item) => item.description))).size,
    parts_used: new Set(workOrders.flatMap((wo) => wo.service_items.map((item) => item.part_number))).size,
    technicians_used: new Set(workOrders.map((wo) => wo.technician)).size,
    advisors_used: new Set(workOrders.map((wo) => wo.service_advisor)).size,
    branches: DEFAULT_OPERATIONAL_BRANCHES.map((branch) => ({
      branch,
      count: workOrders.filter((wo) => wo.branch === branch).length,
    })),
    first_wo: workOrders[0] && workOrders[0].work_order_number,
    last_wo: workOrders[workOrders.length - 1] && workOrders[workOrders.length - 1].work_order_number,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
