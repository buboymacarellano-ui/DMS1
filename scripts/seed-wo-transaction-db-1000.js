/**
 * Seeds 1000 work-order transaction entries from 2026-07-26 through today.
 * 50% closed (older, customer billed) / 50% open (newer, on-going).
 * Branch mix 1-7: 5% 7% 9% 11% 16% 25% 27%.
 * Services from VehServiceLabor.csv, techs from employee-db-all,
 * parts wired as restock + sold so used SKUs end at 0 on-hand.
 *
 * Usage: node scripts/seed-wo-transaction-db-1000.js [--force] [--dry-run]
 */
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const store = require('../data/store');
const inventory = require('../lib/parts-inventory-controller');
const { allocatePartsTransactionNumber } = require('../lib/parts-transaction-number');
const { canonicalizeBranchName } = require('../lib/branches');
const {
  TYPE_RESTOCK,
  TYPE_SOLD,
  isIncomingStockType,
  isPartsActivityLog,
} = require('../lib/parts-request');
const {
  computeInvoiceEconomics,
  financeFieldsFromSnapshot,
  PAYMENT_STATUS,
  PAYMENT_METHODS,
} = require('../lib/finance-ledger');

const ROOT = path.join(__dirname, '..');
const SERVICE_FILE = path.join(ROOT, 'VehServiceLabor.csv');
const VEHICLE_FILE = path.join(ROOT, 'VehicleType.csv');
const BATCH_ID = 'wo-txdb-1000-jul26-present';
const TARGET_COUNT = 1000;
const VAT_RATE = 0.12;
const RANDOM_SEED = 20260726;
const EDITOR = 'SEED-WO-TXDB-1000';
const FORCE = process.argv.includes('--force');
const DRY_RUN = process.argv.includes('--dry-run');
const PRESENT = new Date(2026, 7, 26);

const SERVICE_COLUMNS = {
  small: 'Small',
  medium: 'Medium',
  large: 'Large',
  compactSuv: 'CompactSuv',
  vanSuvPickup: 'VanSuvPickUp',
  truck: 'Truck',
};

const BRANCHES = [
  { label: 'Carx2', share: 0.05, count: 50 },
  { label: 'Carmen', share: 0.07, count: 70 },
  { label: 'CebuCity', share: 0.09, count: 90 },
  { label: 'Lapux2', share: 0.11, count: 110 },
  { label: 'Bogo', share: 0.16, count: 160 },
  { label: 'Toledo', share: 0.25, count: 250 },
  { label: 'ITPark', share: 0.27, count: 270 },
];

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

const MOCK_PARTS = [
  { part_number: 'WO26-90915-YZZF1', part_name: 'Engine Oil Filter Cartridge', generic: 'Oil Filter', supplier: 'Toyota Genuine Parts', unit: 'pc', cost_price: 285.00, markup: 32 },
  { part_number: 'WO26-17801-0T050', part_name: 'Engine Air Filter Element', generic: 'Air Filter', supplier: 'Mann+Hummel', unit: 'pc', cost_price: 640.00, markup: 28 },
  { part_number: 'WO26-87139-YZZ08', part_name: 'Cabin Pollen Filter', generic: 'Cabin Filter', supplier: 'Denso Sales Philippines', unit: 'pc', cost_price: 475.00, markup: 30 },
  { part_number: 'WO26-23300-0L090', part_name: 'Fuel Filter Assembly', generic: 'Fuel Filter', supplier: 'Bosch Automotive PH', unit: 'pc', cost_price: 1280.00, markup: 26 },
  { part_number: 'WO26-90919-01253', part_name: 'Iridium Spark Plug Set', generic: 'Ignition', supplier: 'NGK Spark Plugs', unit: 'set', cost_price: 1860.00, markup: 35 },
  { part_number: 'WO26-90916-03075', part_name: 'Serpentine Drive Belt', generic: 'Belt', supplier: 'Gates Industrial', unit: 'pc', cost_price: 980.00, markup: 24 },
  { part_number: 'WO26-13568-09071', part_name: 'Timing Belt Kit', generic: 'Belt', supplier: 'Aisin Philippines', unit: 'set', cost_price: 4250.00, markup: 22 },
  { part_number: 'WO26-16100-0T060', part_name: 'Water Pump Assembly', generic: 'Cooling', supplier: 'Aisin Philippines', unit: 'pc', cost_price: 3480.00, markup: 27 },
  { part_number: 'WO26-16400-31030', part_name: 'Radiator Assembly', generic: 'Cooling', supplier: 'Denso Sales Philippines', unit: 'pc', cost_price: 6890.00, markup: 20 },
  { part_number: 'WO26-16571-0T010', part_name: 'Radiator Upper Hose', generic: 'Cooling', supplier: 'Gates Industrial', unit: 'pc', cost_price: 420.00, markup: 38 },
  { part_number: 'WO26-88320-0T040', part_name: 'A/C Compressor', generic: 'A/C', supplier: 'Denso Sales Philippines', unit: 'pc', cost_price: 11250.00, markup: 18 },
  { part_number: 'WO26-04465-02340', part_name: 'Front Brake Pad Set', generic: 'Brakes', supplier: 'Bosch Automotive PH', unit: 'set', cost_price: 1680.00, markup: 33 },
  { part_number: 'WO26-04466-0K080', part_name: 'Rear Brake Pad Set', generic: 'Brakes', supplier: 'Bosch Automotive PH', unit: 'set', cost_price: 1420.00, markup: 33 },
  { part_number: 'WO26-43512-0K050', part_name: 'Front Brake Disc Rotor', generic: 'Brakes', supplier: 'Aisin Philippines', unit: 'pc', cost_price: 2350.00, markup: 26 },
  { part_number: 'WO26-04945-0K010', part_name: 'Brake Master Cylinder', generic: 'Brakes', supplier: 'Aisin Philippines', unit: 'pc', cost_price: 2875.00, markup: 24 },
  { part_number: 'WO26-04495-0K010', part_name: 'Brake Fluid DOT 4 500ml', generic: 'Fluids', supplier: 'Castrol Philippines', unit: 'bottle', cost_price: 185.00, markup: 42 },
  { part_number: 'WO26-08880-10705', part_name: 'Engine Oil 5W-30 4L', generic: 'Fluids', supplier: 'Petron Corporation', unit: 'bottle', cost_price: 980.00, markup: 30 },
  { part_number: 'WO26-08886-01605', part_name: 'ATF WS 4L', generic: 'Fluids', supplier: 'Toyota Genuine Parts', unit: 'bottle', cost_price: 1450.00, markup: 28 },
  { part_number: 'WO26-08816-00132', part_name: 'Coolant Premix 4L', generic: 'Fluids', supplier: 'Petron Corporation', unit: 'bottle', cost_price: 420.00, markup: 36 },
  { part_number: 'WO26-48510-0K080', part_name: 'Front Shock Absorber', generic: 'Suspension', supplier: 'KYB Philippines', unit: 'pc', cost_price: 3120.00, markup: 27 },
  { part_number: 'WO26-48530-0K070', part_name: 'Rear Shock Absorber', generic: 'Suspension', supplier: 'KYB Philippines', unit: 'pc', cost_price: 2780.00, markup: 27 },
  { part_number: 'WO26-48609-0K040', part_name: 'Front Stabilizer Link', generic: 'Suspension', supplier: '555 Chassis Parts', unit: 'pc', cost_price: 540.00, markup: 34 },
  { part_number: 'WO26-45503-0K060', part_name: 'Tie Rod End Outer', generic: 'Steering', supplier: '555 Chassis Parts', unit: 'pc', cost_price: 680.00, markup: 32 },
  { part_number: 'WO26-27060-0T050', part_name: 'Alternator Assembly 90A', generic: 'Electrical', supplier: 'Denso Sales Philippines', unit: 'pc', cost_price: 7450.00, markup: 18 },
  { part_number: 'WO26-28100-0T070', part_name: 'Starter Motor', generic: 'Electrical', supplier: 'Denso Sales Philippines', unit: 'pc', cost_price: 6290.00, markup: 20 },
  { part_number: 'WO26-28800-0T040', part_name: 'MF Battery 12V 65AH', generic: 'Electrical', supplier: 'Motolite Philippines', unit: 'pc', cost_price: 4850.00, markup: 22 },
  { part_number: 'WO26-90980-15016', part_name: 'Wiper Blade Set 22/16', generic: 'Wipers', supplier: 'Bosch Automotive PH', unit: 'set', cost_price: 620.00, markup: 37 },
  { part_number: 'WO26-81110-0K060', part_name: 'Headlamp Assembly LH', generic: 'Lighting', supplier: 'Koito Philippines', unit: 'pc', cost_price: 3980.00, markup: 23 },
  { part_number: 'WO26-90080-81097', part_name: 'H4 Halogen Bulb Pair', generic: 'Lighting', supplier: 'Osram Philippines', unit: 'pair', cost_price: 310.00, markup: 45 },
  { part_number: 'WO26-04428-0K010', part_name: 'Clutch Disc and Cover Kit', generic: 'Drivetrain', supplier: 'Sachs / ZF', unit: 'set', cost_price: 5120.00, markup: 21 },
  { part_number: 'WO26-33401-0K080', part_name: 'CV Joint Outer Assembly', generic: 'Drivetrain', supplier: 'GKN Driveline', unit: 'pc', cost_price: 2680.00, markup: 26 },
  { part_number: 'WO26-42311-0K040', part_name: 'Rear Wheel Hub Bearing', generic: 'Drivetrain', supplier: 'NSK Bearings PH', unit: 'pc', cost_price: 1890.00, markup: 28 },
  { part_number: 'WO26-90947-02476', part_name: 'Oxygen Sensor Upstream', generic: 'Emissions', supplier: 'NGK Spark Plugs', unit: 'pc', cost_price: 3240.00, markup: 24 },
  { part_number: 'WO26-89465-0K050', part_name: 'Mass Air Flow Sensor', generic: 'Sensors', supplier: 'Denso Sales Philippines', unit: 'pc', cost_price: 4120.00, markup: 22 },
  { part_number: 'WO26-23250-0T070', part_name: 'Fuel Injector Set of 4', generic: 'Fuel', supplier: 'Denso Sales Philippines', unit: 'set', cost_price: 6780.00, markup: 20 },
  { part_number: 'WO26-77020-0K090', part_name: 'Fuel Pump Assembly In-Tank', generic: 'Fuel', supplier: 'Aisin Philippines', unit: 'pc', cost_price: 5340.00, markup: 21 },
  { part_number: 'WO26-16572-0T020', part_name: 'Radiator Lower Hose', generic: 'Cooling', supplier: 'Gates Industrial', unit: 'pc', cost_price: 395.00, markup: 38 },
  { part_number: 'WO26-87110-0T010', part_name: 'A/C Condenser', generic: 'A/C', supplier: 'Valeo Philippines', unit: 'pc', cost_price: 5420.00, markup: 21 },
  { part_number: 'WO26-42431-0K090', part_name: 'Rear Brake Disc Rotor', generic: 'Brakes', supplier: 'Aisin Philippines', unit: 'pc', cost_price: 1980.00, markup: 26 },
  { part_number: 'WO26-08885-81001', part_name: 'Power Steering Fluid 1L', generic: 'Fluids', supplier: 'Castrol Philippines', unit: 'bottle', cost_price: 265.00, markup: 40 },
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

function retailPrice(cost, markup) {
  return asMoney(cost + cost * ((Number(markup) || 0) / 100));
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
      .on('error', reject)
      .on('end', () => resolve(rows));
  });
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function manilaIso(year, monthIndex, day, hour, minute, second) {
  return `${year}-${pad2(monthIndex + 1)}-${pad2(day)}T${pad2(hour)}:${pad2(minute)}:${pad2(second)}+08:00`;
}

function hhmm(hour, minute) {
  return `${pad2(hour)}:${pad2(minute)}`;
}

function addMinutesIso(iso, minutes) {
  const ms = new Date(iso).getTime() + (minutes * 60000);
  const local = new Date(ms + (8 * 3600000));
  return manilaIso(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate(),
    local.getUTCHours(),
    local.getUTCMinutes(),
    local.getUTCSeconds()
  );
}

function clockFromIso(iso) {
  const local = new Date(new Date(iso).getTime() + (8 * 3600000));
  return hhmm(local.getUTCHours(), local.getUTCMinutes());
}

function dateKeyFromIso(iso) {
  return String(iso || '').slice(0, 10);
}

function spreadTimestamps(start, end, count, random) {
  const startMs = start.getTime();
  const span = Math.max(1, end.getTime() - startMs);
  return Array.from({ length: count }, (_, index) => {
    const base = startMs + Math.round((index / Math.max(1, count - 1)) * span);
    const jitter = Math.floor((random() - 0.5) * 18 * 60000);
    const date = new Date(base + jitter);
    const hour = 8 + Math.floor(random() * 9);
    const minute = Math.floor(random() * 60);
    const second = Math.floor(random() * 60);
    return manilaIso(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute, second);
  }).sort();
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
  return /(mechanic|aligner|technician)/i.test(String(employee.job_title || ''));
}

function isAdvisorEmployee(employee) {
  return /service advisor|service receptionist|senior service receptionist/i.test(String(employee.job_title || ''));
}

function stripBatch(data) {
  const collections = [
    'customers', 'vehicles', 'work_orders', 'transaction_records',
    'technician_updates', 'parts_inventory', 'transactions',
  ];
  collections.forEach((name) => {
    data[name] = (data[name] || []).filter((row) => row && row.seed_batch !== BATCH_ID);
  });
  data.parts = (data.parts || []).filter((row) => {
    const number = normalizeText(row && row.part_number);
    return !number.toUpperCase().startsWith('WO26-');
  });
}

function deductFromSourceStockRows(partsInventory, partNumberKey, qtyToDeduct, data) {
  let remaining = Math.max(0, asMoney(qtyToDeduct));
  if (remaining <= 0) return true;
  for (const row of partsInventory || []) {
    const rowKey = inventory.normalizePartNumberKey(row.part_number);
    if (rowKey !== partNumberKey) continue;
    if (isPartsActivityLog(row)) continue;
    if (!isIncomingStockType(row.transaction_type)) continue;
    const available = Math.max(0, Number(row.qty) || 0);
    if (available <= 0) continue;
    const consumed = Math.min(available, remaining);
    row.qty = Number((available - consumed).toFixed(2));
    inventory.syncInventoryRowToTransactions(data, row);
    remaining = Number((remaining - consumed).toFixed(2));
    if (remaining <= 0) return true;
  }
  return remaining <= 0;
}

function buildTransactionRecord(wo, customer, vehicle, action, timestamp) {
  const items = wo.service_items || [];
  const laborTotal = items.reduce((sum, item) => sum + (asMoney(item.labor_price) * Math.max(1, Number(item.service_qty) || 1)), 0);
  const partsTotal = items.reduce((sum, item) => sum + (asMoney(item.parts_qty) * asMoney(item.parts_price)), 0);
  const grandTotal = asMoney(laborTotal + partsTotal);
  const vat = asMoney(grandTotal * VAT_RATE);
  const record = {
    id: `tx-${BATCH_ID}-${wo.work_order_number}-${action}`,
    created_at: timestamp,
    seed_batch: BATCH_ID,
    work_order_id: wo.id,
    transaction_action: action,
    action_by: EDITOR,
    action_by_role: action.startsWith('billing') ? 'admin' : 'service_advisor',
    'Transaction date': timestamp,
    Branch: wo.branch,
    'work order Number': wo.work_order_number,
    'Customer name': customer.name,
    'Telephone number': customer.phone,
    'Car Brand': vehicle.make,
    Model: vehicle.model,
    Year: vehicle.year,
    'Service Advice Advisor': wo.service_advisor,
    Tecnician: wo.technician,
    'Total Labor': moneyText(laborTotal),
    'Total Parts': moneyText(partsTotal),
    'Grand Total': moneyText(grandTotal),
    Vat: moneyText(vat),
    'Totalwith Vat': moneyText(grandTotal + vat),
    TimeIn: wo.time_in,
    TimeOut: wo.time_out || '',
  };
  for (let slot = 1; slot <= 15; slot += 1) {
    const item = items[slot - 1];
    record[`Service${slot}`] = item ? item.reason : '';
    record[`Labor${slot}`] = item ? moneyText(item.labor_price) : '';
    record[`Service Required${slot}`] = item ? item.description : '';
  }
  for (let slot = 1; slot <= 50; slot += 1) {
    const item = items[slot - 1];
    record[`Part${slot}`] = item ? `${item.parts} x${item.parts_qty}` : '';
    record[`Parts Price${slot}`] = item ? moneyText(asMoney(item.parts_qty) * asMoney(item.parts_price)) : '';
  }
  return record;
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
  data.transactions = data.transactions || [];
  data.technician_updates = data.technician_updates || [];

  const already = (data.work_orders || []).filter((row) => row && row.seed_batch === BATCH_ID).length;
  if (already && !FORCE) {
    console.log(JSON.stringify({ skipped: true, reason: 'batch already present', count: already, hint: 're-run with --force' }, null, 2));
    return;
  }
  if (already && FORCE) stripBatch(data);

  const services = serviceRows
    .map((row) => ({
      name: normalizeText(row['Service Required'] || row['Sub Group']),
      hours: Number(row['Flat Rate (Hours)']) || 1,
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
    canonicalizeBranchName(employee.work_location_branch_id) && isAdvisorEmployee(employee)
  ));
  if (!technicians.length) throw new Error('No technicians found in employee-db-all roster.');

  const techsByBranch = new Map(BRANCHES.map((branch) => [branch.label, []]));
  technicians.forEach((employee) => {
    const branch = canonicalizeBranchName(employee.work_location_branch_id);
    if (techsByBranch.has(branch)) techsByBranch.get(branch).push(employee);
  });
  const advisorsByBranch = new Map(BRANCHES.map((branch) => [branch.label, []]));
  advisors.forEach((employee) => {
    const branch = canonicalizeBranchName(employee.work_location_branch_id);
    if (advisorsByBranch.has(branch)) advisorsByBranch.get(branch).push(employee);
  });
  BRANCHES.forEach((branch) => {
    if (!techsByBranch.get(branch.label).length) {
      throw new Error(`No technicians found for branch ${branch.label}.`);
    }
  });

  const random = createRandom(RANDOM_SEED);
  const closedStart = new Date(2026, 6, 26, 8, 0, 0);
  const closedEnd = new Date(2026, 7, 10, 18, 0, 0);
  const openStart = new Date(2026, 7, 11, 8, 0, 0);
  const openEnd = new Date(PRESENT.getFullYear(), PRESENT.getMonth(), PRESENT.getDate(), 17, 30, 0);

  const slots = [];
  BRANCHES.forEach((branch) => {
    const closedCount = branch.count / 2;
    const openCount = branch.count - closedCount;
    for (let i = 0; i < closedCount; i += 1) slots.push({ branch: branch.label, closed: true });
    for (let i = 0; i < openCount; i += 1) slots.push({ branch: branch.label, closed: false });
  });
  const shuffled = shuffle(slots, random);
  const closedSlots = shuffled.filter((slot) => slot.closed);
  const openSlots = shuffled.filter((slot) => !slot.closed);
  const closedTimes = spreadTimestamps(closedStart, closedEnd, closedSlots.length, random);
  const openTimes = spreadTimestamps(openStart, openEnd, openSlots.length, random);
  closedSlots.forEach((slot, index) => { slot.createdAt = closedTimes[index]; });
  openSlots.forEach((slot, index) => { slot.createdAt = openTimes[index]; });
  const ordered = [...closedSlots, ...openSlots].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));

  const usedNames = new Set((data.customers || []).map((row) => normalizeText(row.name).toLowerCase()));
  const customers = [];
  const vehicles = [];
  const workOrders = [];
  const transactions = [];
  const technicianUpdates = [];
  const usageByPart = new Map();
  const techCursor = new Map(BRANCHES.map((branch) => [branch.label, 0]));
  const advisorCursor = new Map(BRANCHES.map((branch) => [branch.label, 0]));
  const mockParts = MOCK_PARTS.map((part) => Object.assign({}, part, { retail_price: retailPrice(part.cost_price, part.markup) }));

  ordered.forEach((slot, index) => {
    const sequence = String(index + 1).padStart(4, '0');
    let name = '';
    let attempt = 0;
    while (!name || usedNames.has(name.toLowerCase())) {
      const first = FIRST_NAMES[(index + attempt) % FIRST_NAMES.length];
      const last = LAST_NAMES[(index + attempt * 3) % LAST_NAMES.length];
      const suffix = attempt > 8 ? ` ${sequence}` : '';
      name = `${first} ${last}${suffix}`.trim();
      attempt += 1;
    }
    usedNames.add(name.toLowerCase());

    const branch = slot.branch;
    const createdAt = slot.createdAt;
    const sourceVehicle = vehicleCatalog[index % vehicleCatalog.length];
    const vehicleType = normalizeVehicleType(sourceVehicle['Unit Type'] || sourceVehicle.Unit_Type || sourceVehicle.Vehicle_Type);
    const branchTechs = techsByBranch.get(branch);
    const techIndex = techCursor.get(branch);
    const technician = branchTechs[techIndex % branchTechs.length];
    techCursor.set(branch, techIndex + 1);
    const branchAdvisors = advisorsByBranch.get(branch);
    const advisorPool = branchAdvisors.length ? branchAdvisors : advisors;
    const advisorIndex = advisorCursor.get(branch);
    const advisor = advisorPool[advisorIndex % advisorPool.length];
    advisorCursor.set(branch, advisorIndex + 1);

    const serviceCount = 1 + (index % 4);
    const chosenServices = [];
    for (let slotIndex = 0; slotIndex < serviceCount; slotIndex += 1) {
      const service = services[(index + slotIndex * 19) % services.length];
      if (!chosenServices.some((row) => row.name === service.name)) chosenServices.push(service);
    }
    const partCount = 1 + (index % 3);
    const chosenParts = [];
    for (let slotIndex = 0; slotIndex < partCount; slotIndex += 1) {
      const part = mockParts[(index + slotIndex * 11) % mockParts.length];
      if (!chosenParts.some((row) => row.part_number === part.part_number)) chosenParts.push(part);
    }

    const serviceItems = chosenServices.map((service, slotIndex) => {
      const part = chosenParts[slotIndex % chosenParts.length];
      const laborPrice = asMoney(service.prices[vehicleType] || service.prices.small || 350);
      const partsQty = 1 + ((index + slotIndex) % 2);
      const partsPrice = asMoney(part.retail_price);
      usageByPart.set(part.part_number, (usageByPart.get(part.part_number) || 0) + partsQty);
      return {
        description: service.name,
        reason: service.name,
        labor_hours: service.hours,
        labor_price: laborPrice,
        service_qty: 1,
        part_number: part.part_number,
        unit: part.unit,
        parts: `${part.part_name} (${part.part_number})`,
        parts_qty: partsQty,
        parts_price: partsPrice,
        cost_price: part.cost_price,
        total_price: asMoney(laborPrice + (partsQty * partsPrice)),
      };
    });

    const laborHours = serviceItems.reduce((sum, item) => sum + (Number(item.labor_hours) || 1), 0);
    const waitMinutes = 15 + Math.floor(random() * 50);
    const extraMinutes = Math.floor(random() * 90);
    const durationMinutes = Math.max(45, Math.round(laborHours * 60) + waitMinutes + extraMinutes);
    const overnightDays = slot.closed && (index % 11 === 0) ? 1 + (index % 3) : 0;
    const assignedAt = addMinutesIso(createdAt, 8 + Math.floor(random() * 25));
    const workingAt = addMinutesIso(assignedAt, 5 + Math.floor(random() * 20));
    const waitingAt = addMinutesIso(workingAt, 25 + Math.floor(random() * 40));
    const resumeAt = addMinutesIso(waitingAt, 20 + Math.floor(random() * 50));
    const closedAt = slot.closed
      ? addMinutesIso(assignedAt, durationMinutes + (overnightDays * 24 * 60))
      : '';
    const timeIn = clockFromIso(createdAt);
    const timeOut = slot.closed ? clockFromIso(closedAt) : '';

    const customerId = `cust-${BATCH_ID}-${sequence}`;
    const vehicleId = `veh-${BATCH_ID}-${sequence}`;
    const workOrderId = `wo-${BATCH_ID}-${sequence}`;
    const workOrderNumber = nextWorkOrderNumber(
      [...data.work_orders, ...data.transaction_records, ...workOrders, ...transactions],
      0
    );

    const customer = {
      id: customerId,
      created_at: createdAt,
      seed_batch: BATCH_ID,
      name,
      phone: `09${String(310000000 + index + 1).slice(0, 9)}`,
      email: `wo26.${sequence}@example.test`,
      address: `${12 + (index % 180)} ${LAST_NAMES[index % LAST_NAMES.length]} St, ${branch}, Cebu`,
      notes: slot.closed ? 'Billed WO seed customer' : 'Open WO seed customer',
      branch,
    };
    const vehicle = {
      id: vehicleId,
      created_at: createdAt,
      seed_batch: BATCH_ID,
      customer_id: customerId,
      make: normalizeText(sourceVehicle['Car Brand']),
      model: normalizeText(sourceVehicle.Model),
      year: String(2012 + (index % 15)),
      vin: `WO26${String(index + 1).padStart(12, '0')}`.slice(0, 17),
      license_plate: `W${String(1000 + index).slice(-4)}`,
      vehicle_type: vehicleType,
      branch,
    };

    const status = slot.closed ? 'closed' : ((index % 5 === 0) ? 'waiting-parts' : 'in-progress');
    const workOrder = {
      id: workOrderId,
      created_at: createdAt,
      updated_at: slot.closed ? closedAt : workingAt,
      seed_batch: BATCH_ID,
      customer_id: customerId,
      vehicle_id: vehicleId,
      description: chosenServices.map((row) => row.name).join(', '),
      status,
      branch,
      work_order_number: workOrderNumber,
      service_advisor: advisor ? advisorName(advisor) : 'Service Desk',
      technician: technicianName(technician),
      technician_assigned_at: assignedAt,
      time_in: timeIn,
      time_out: timeOut,
      telephone_number: customer.phone,
      car_brand: vehicle.make,
      car_model: vehicle.model,
      car_year: vehicle.year,
      plate_number: vehicle.license_plate,
      odometer: String(12000 + ((index * 173) % 160000)),
      service_items: serviceItems,
      labor_hours: Number(laborHours.toFixed(2)),
    };

    if (slot.closed) {
      const economics = computeInvoiceEconomics(workOrder);
      const paid = index % 4 !== 0;
      Object.assign(workOrder, financeFieldsFromSnapshot(economics, {
        paymentMethod: paid ? PAYMENT_METHODS[index % PAYMENT_METHODS.length] : '',
        paymentStatus: paid ? PAYMENT_STATUS.PAID : PAYMENT_STATUS.UNPAID,
        balanceDue: paid ? 0 : economics.grandTotal,
      }), {
        invoice_number: workOrderNumber,
        invoice_date: closedAt,
        paidAt: paid ? closedAt : '',
      });
    }

    technicianUpdates.push({
      id: `tu-${BATCH_ID}-${sequence}-assign`,
      created_at: assignedAt,
      seed_batch: BATCH_ID,
      work_order_id: workOrderId,
      sender_role: 'service_advisor',
      sender_username: EDITOR,
      technician_name: workOrder.technician,
      status_action: 'working',
      status_flags: { on_break: false, waiting_parts: false, done: false },
      message: 'Assigned. Job started (on-going).',
    });
    technicianUpdates.push({
      id: `tu-${BATCH_ID}-${sequence}-work`,
      created_at: workingAt,
      seed_batch: BATCH_ID,
      work_order_id: workOrderId,
      sender_role: 'technician',
      sender_username: workOrder.technician,
      technician_name: workOrder.technician,
      status_action: 'working',
      status_flags: { on_break: false, waiting_parts: false, done: false },
      message: `On-going. Labor hours ${laborHours.toFixed(1)} FR.`,
    });
    if (status === 'waiting-parts' || (slot.closed && index % 3 === 0)) {
      technicianUpdates.push({
        id: `tu-${BATCH_ID}-${sequence}-wait`,
        created_at: waitingAt,
        seed_batch: BATCH_ID,
        work_order_id: workOrderId,
        sender_role: 'technician',
        sender_username: workOrder.technician,
        technician_name: workOrder.technician,
        status_action: 'waiting_parts',
        status_flags: { on_break: false, waiting_parts: true, done: false },
        message: 'Waiting for parts.',
      });
      if (slot.closed || status !== 'waiting-parts') {
        technicianUpdates.push({
          id: `tu-${BATCH_ID}-${sequence}-resume`,
          created_at: resumeAt,
          seed_batch: BATCH_ID,
          work_order_id: workOrderId,
          sender_role: 'technician',
          sender_username: workOrder.technician,
          technician_name: workOrder.technician,
          status_action: 'working',
          status_flags: { on_break: false, waiting_parts: false, done: false },
          message: 'Parts received. Work resumed.',
        });
      }
    }
    if (slot.closed) {
      technicianUpdates.push({
        id: `tu-${BATCH_ID}-${sequence}-done`,
        created_at: closedAt,
        seed_batch: BATCH_ID,
        work_order_id: workOrderId,
        sender_role: 'technician',
        sender_username: workOrder.technician,
        technician_name: workOrder.technician,
        status_action: 'done',
        status_flags: { on_break: false, waiting_parts: false, done: true },
        message: 'Job completed. Customer billed.',
      });
    }

    customers.push(customer);
    vehicles.push(vehicle);
    workOrders.push(workOrder);
    transactions.push(buildTransactionRecord(
      workOrder,
      customer,
      vehicle,
      slot.closed ? 'billing-print' : 'created',
      slot.closed ? closedAt : createdAt
    ));
  });

  const restockAt = manilaIso(2026, 6, 26, 7, 15, 0);
  const restockDate = '2026-07-26';
  MOCK_PARTS.forEach((part, index) => {
    const qty = usageByPart.get(part.part_number) || 0;
    if (qty <= 0) return;
    const record = {
      id: `inv-${BATCH_ID}-in-${String(index + 1).padStart(3, '0')}`,
      created_at: addMinutesIso(restockAt, index),
      seed_batch: BATCH_ID,
      date: restockDate,
      transaction_date: restockDate,
      transaction_number: allocatePartsTransactionNumber(data, new Date(`${restockDate}T07:15:00+08:00`)),
      transaction_type: TYPE_RESTOCK,
      present_location: 'Warehouse 1',
      branch: 'Warehouse 1',
      created_branch: 'Warehouse 1',
      editor: EDITOR,
      part_number: part.part_number,
      part_name: part.part_name,
      generic: part.generic,
      supplier: part.supplier,
      unit: part.unit,
      qty,
      cost_price: part.cost_price,
      markup: part.markup,
      retail_price: retailPrice(part.cost_price, part.markup),
      sold_to: '',
    };
    data.parts_inventory.push(record);
    inventory.rememberTransaction(data, record);
  });

  workOrders.forEach((wo) => {
    const used = new Map();
    (wo.service_items || []).forEach((item) => {
      const key = inventory.normalizePartNumberKey(item.part_number);
      if (!key) return;
      used.set(key, (used.get(key) || 0) + Math.max(0, Number(item.parts_qty) || 0));
    });
    let line = 0;
    used.forEach((qty, partNumberKey) => {
      if (qty <= 0) return;
      const part = MOCK_PARTS.find((row) => inventory.normalizePartNumberKey(row.part_number) === partNumberKey);
      const soldAt = wo.invoice_date || wo.technician_assigned_at || wo.created_at;
      const dateKey = dateKeyFromIso(soldAt);
      line += 1;
      const deducted = deductFromSourceStockRows(data.parts_inventory, partNumberKey, qty, data);
      if (!deducted) {
        throw new Error(`Unable to zero stock for ${partNumberKey} on WO ${wo.work_order_number}.`);
      }
      const movement = {
        id: `inv-${BATCH_ID}-sold-${wo.work_order_number}-${line}`,
        created_at: soldAt,
        seed_batch: BATCH_ID,
        transaction_date: dateKey,
        transaction_number: allocatePartsTransactionNumber(data, new Date(soldAt)),
        transaction_type: TYPE_SOLD,
        present_location: wo.branch,
        branch: wo.branch,
        created_branch: wo.branch,
        editor: EDITOR,
        part_number: part.part_number,
        part_name: part.part_name,
        generic: part.generic,
        supplier: part.supplier,
        unit: part.unit,
        qty,
        cost_price: part.cost_price,
        markup: part.markup,
        retail_price: retailPrice(part.cost_price, part.markup),
        sold_to: wo.work_order_number,
        work_order_number: wo.work_order_number,
        work_order_id: wo.id,
      };
      data.parts_inventory.push(movement);
      inventory.rememberTransaction(data, movement);
      const soldLog = Object.assign({}, movement, {
        id: `inv-${BATCH_ID}-soldlog-${wo.work_order_number}-${line}`,
        created_via: 'create-parts-log',
        activity_log: true,
        source_part_id: movement.id,
        present_location: 'Warehouse 1',
        branch: 'Warehouse 1',
        transaction_number: allocatePartsTransactionNumber(data, new Date(soldAt)),
      });
      data.parts_inventory.push(soldLog);
      inventory.rememberTransaction(data, soldLog);
    });
  });

  inventory.rebuildPartsCatalog(data);

  const onHandUsed = MOCK_PARTS.map((part) => ({
    part_number: part.part_number,
    on_hand: inventory.getOnHand(data, part.part_number),
    used: usageByPart.get(part.part_number) || 0,
  })).filter((row) => row.used > 0);

  const nonzero = onHandUsed.filter((row) => row.on_hand !== 0);
  if (nonzero.length) {
    throw new Error(`Used parts did not end at 0 on-hand: ${nonzero.map((row) => `${row.part_number}=${row.on_hand}`).join(', ')}`);
  }

  const closedCount = workOrders.filter((wo) => wo.status === 'closed').length;
  const openCount = workOrders.length - closedCount;
  const branchCounts = BRANCHES.map((branch) => ({
    branch: branch.label,
    count: workOrders.filter((wo) => wo.branch === branch.label).length,
    pct: `${Math.round((workOrders.filter((wo) => wo.branch === branch.label).length / workOrders.length) * 100)}%`,
  }));

  if (workOrders.length !== TARGET_COUNT) throw new Error(`Expected ${TARGET_COUNT} work orders, got ${workOrders.length}.`);
  if (closedCount !== 500 || openCount !== 500) throw new Error(`Expected 500/500 open-closed, got open=${openCount} closed=${closedCount}.`);
  BRANCHES.forEach((branch) => {
    const count = workOrders.filter((wo) => wo.branch === branch.label).length;
    if (count !== branch.count) throw new Error(`Branch ${branch.label} expected ${branch.count}, got ${count}.`);
  });

  const summary = {
    created: workOrders.length,
    closed: closedCount,
    open_or_ongoing: openCount,
    date_span: `${dateKeyFromIso(workOrders[0].created_at)} to ${dateKeyFromIso(workOrders[workOrders.length - 1].created_at)}`,
    branches: branchCounts,
    unique_customers: new Set(customers.map((row) => row.name)).size,
    unique_vehicles: new Set(vehicles.map((row) => row.license_plate)).size,
    services_used: new Set(workOrders.flatMap((wo) => wo.service_items.map((item) => item.description))).size,
    service_catalog: services.length,
    parts_skus_used: onHandUsed.length,
    parts_on_hand_after: 0,
    technicians_used: new Set(workOrders.map((wo) => wo.technician)).size,
    first_wo: workOrders[0].work_order_number,
    last_wo: workOrders[workOrders.length - 1].work_order_number,
    dry_run: DRY_RUN,
  };

  if (DRY_RUN) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  const backupPath = await store.backupData();
  data.customers.push(...customers);
  data.vehicles.push(...vehicles);
  data.work_orders.push(...workOrders);
  data.transaction_records.push(...transactions);
  data.technician_updates.push(...technicianUpdates);
  await store.replaceData(data);

  console.log(JSON.stringify(Object.assign({ backup: backupPath }, summary), null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
