/**
 * Seeds 500 open work-order transactions dated 2026-08-01 through 2026-08-23.
 * Services come from VehServiceLabor.csv, parts from the parts catalog,
 * and technicians from the imported employee-db-all roster.
 */
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const store = require('../data/store');

const ROOT = path.join(__dirname, '..');
const SERVICE_FILE = path.join(ROOT, 'VehServiceLabor.csv');
const VEHICLE_FILE = path.join(ROOT, 'VehicleType.csv');
const BATCH_ID = 'open-wo-aug26-500';
const TARGET_COUNT = 500;
const VAT_RATE = 0.12;
const RANDOM_SEED = 20260823;

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
];

const LAST_NAMES = [
  'Abad', 'Alonzo', 'Bautista', 'Cabrera', 'Dela Cruz', 'Domingo', 'Enriquez', 'Flores', 'Garcia',
  'Hernandez', 'Ignacio', 'Jimenez', 'Katigbak', 'Lim', 'Mendoza', 'Navarro', 'Ocampo', 'Pascual',
  'Quiambao', 'Ramos', 'Santos', 'Torres', 'Umali', 'Villanueva', 'Yap', 'Zamora', 'Bernal',
  'Castillo', 'Fernandez', 'Gomez', 'Gutierrez', 'Lopez', 'Marquez', 'Ortega', 'Reyes', 'Salazar',
  'Tan', 'Velasco', 'Wong', 'Cruz',
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

function dateForIndex(index) {
  const start = new Date(Date.UTC(2026, 7, 1, 0, 0, 0));
  const end = new Date(Date.UTC(2026, 7, 23, 15, 0, 0));
  const span = end.getTime() - start.getTime();
  const t = start.getTime() + Math.round((index / (TARGET_COUNT - 1)) * span);
  return new Date(t);
}

function isoManila(date, hour, minute, second) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}+08:00`;
}

function hhmm(hour, minute) {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function nextWorkOrderNumber(existing, index) {
  let max = 0;
  existing.forEach((wo) => {
    const value = Number(String(wo.work_order_number || '').replace(/\D/g, ''));
    if (Number.isFinite(value) && value > max) max = value;
  });
  return String(max + index + 1).padStart(7, '0');
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
  if (already >= TARGET_COUNT) {
    console.log(JSON.stringify({ skipped: true, reason: 'batch already present', count: already }, null, 2));
    return;
  }

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
    && normalizeText(employee.work_location_branch_id)
    && /(mechanic|aligner|toolkeeper|carwasher|technician)/i.test(String(employee.job_title || ''))
  ));
  if (!technicians.length) throw new Error('No technicians found in the employee roster.');

  const advisors = (data.employees || []).filter((employee) => (
    /service advisor|service receptionist|senior service receptionist/i.test(String(employee.job_title || ''))
  ));

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
        supplier: normalizeText(row.supplier),
      });
    }
  });
  const catalogParts = Array.from(partsByNumber.values());
  if (!catalogParts.length) throw new Error('No parts found in the parts database.');

  const random = createRandom(RANDOM_SEED);
  const usedNames = new Set((data.customers || []).map((row) => normalizeText(row.name).toLowerCase()));
  const customers = [];
  const vehicles = [];
  const workOrders = [];
  const transactions = [];

  for (let index = 0; index < TARGET_COUNT; index += 1) {
    let name = '';
    let attempt = 0;
    while (!name || usedNames.has(name.toLowerCase())) {
      const first = FIRST_NAMES[(index + attempt) % FIRST_NAMES.length];
      const last = LAST_NAMES[Math.floor((index + attempt) / FIRST_NAMES.length) % LAST_NAMES.length];
      const suffix = attempt > LAST_NAMES.length ? ` ${String(index + 1).padStart(3, '0')}` : '';
      name = `${first} ${last}${suffix}`.trim();
      attempt += 1;
    }
    usedNames.add(name.toLowerCase());

    const day = dateForIndex(index);
    const hour = 8 + (index % 9);
    const minute = (index * 11) % 60;
    const second = (index * 17) % 60;
    const createdAt = isoManila(day, hour, minute, second);
    const sequence = String(index + 1).padStart(4, '0');
    const customerId = `cust-${BATCH_ID}-${sequence}`;
    const vehicleId = `veh-${BATCH_ID}-${sequence}`;
    const workOrderId = `wo-${BATCH_ID}-${sequence}`;
    const sourceVehicle = vehicleCatalog[index % vehicleCatalog.length];
    const vehicleType = normalizeVehicleType(sourceVehicle.Unit_Type || sourceVehicle.Vehicle_Type);
    const technician = technicians[index % technicians.length];
    const branch = normalizeText(technician.work_location_branch_id);
    const branchAdvisors = advisors.filter((row) => normalizeText(row.work_location_branch_id) === branch);
    const advisor = (branchAdvisors.length ? branchAdvisors : advisors)[index % Math.max(1, (branchAdvisors.length ? branchAdvisors : advisors).length || 1)];
    const serviceCount = 1 + (index % 3);
    const chosenServices = [];
    for (let slot = 0; slot < serviceCount; slot += 1) {
      const service = services[(index + slot * 17) % services.length];
      if (!chosenServices.some((row) => row.name === service.name)) chosenServices.push(service);
    }
    const partCount = 1 + (index % 2);
    const chosenParts = [];
    for (let slot = 0; slot < partCount; slot += 1) {
      const part = catalogParts[(index + slot * 13) % catalogParts.length];
      if (!chosenParts.some((row) => row.part_number === part.part_number)) chosenParts.push(part);
    }

    const serviceItems = chosenServices.map((service, slot) => {
      const part = chosenParts[slot] || chosenParts[0];
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
      email: `openwo.${sequence}@example.test`,
      address: `${20 + (index % 80)} ${LAST_NAMES[index % LAST_NAMES.length]} St, ${branch}, Cebu`,
      notes: 'Open WO August 2026 seed customer',
      branch,
    };

    const vehicle = {
      id: vehicleId,
      created_at: createdAt,
      seed_batch: BATCH_ID,
      customer_id: customerId,
      make: normalizeText(sourceVehicle['Car Brand']),
      model: normalizeText(sourceVehicle.Model),
      year: String(2013 + (index % 14)),
      vin: `AUG26${String(index + 1).padStart(12, '0')}`.slice(0, 17),
      license_plate: `OA${String(1000 + index).slice(-4)}`,
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
      odometer: String(18000 + (index * 137) % 120000),
      service_items: serviceItems,
    };

    const transaction = {
      id: `tx-${BATCH_ID}-${sequence}`,
      created_at: createdAt,
      seed_batch: BATCH_ID,
      work_order_id: workOrderId,
      transaction_action: 'created',
      action_by: 'SEED-OPEN-WO',
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
  await store.replaceData(data);

  console.log(JSON.stringify({
    created: workOrders.length,
    status: 'open',
    date_span: '2026-08-01 to 2026-08-23',
    unique_customers: new Set(customers.map((row) => row.name)).size,
    unique_vehicles: new Set(vehicles.map((row) => `${row.make} ${row.model} ${row.license_plate}`)).size,
    services_used: new Set(workOrders.flatMap((wo) => wo.service_items.map((item) => item.description))).size,
    parts_used: new Set(workOrders.flatMap((wo) => wo.service_items.map((item) => item.part_number))).size,
    technicians_used: new Set(workOrders.map((wo) => wo.technician)).size,
    branches: [...new Set(workOrders.map((wo) => wo.branch))],
    first_wo: workOrders[0].work_order_number,
    last_wo: workOrders[workOrders.length - 1].work_order_number,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
