const fs = require('fs');
const fsPromises = fs.promises;
const path = require('path');
const csv = require('csv-parser');

const ROOT_DIR = path.join(__dirname, '..');
const DATA_FILE = path.join(ROOT_DIR, 'data', 'data.json');
const SERVICE_FILE = path.join(ROOT_DIR, 'VehServiceLabor.csv');
const VEHICLE_FILE = path.join(ROOT_DIR, 'VehicleType.csv');
const BATCH_ID = 'july-2026-simulation';
const CUSTOMER_COUNT = 300;
const RECORD_COUNT = 1070;
const VAT_RATE = 0.12;
const RANDOM_SEED = 20260730;
const DRY_RUN = process.argv.includes('--dry-run');

const SERVICE_COLUMNS = {
  small: 'Small',
  medium: 'Medium',
  large: 'Large',
  compactSuv: 'CompactSuv',
  vanSuvPickup: 'VanSuvPickUp',
  truck: 'Truck',
};

const BRANCHES = [
  { label: 'Carx2', key: 'carx2', count: 100 },
  { label: 'Carmen', key: 'carmen', count: 50 },
  { label: 'CebuCity', key: 'cebucity', count: 250 },
  { label: 'Lapux2', key: 'lapux2', count: 300 },
  { label: 'Bogo', key: 'bogo', count: 170 },
  { label: 'Toledo', key: 'toledo', count: 150 },
  { label: 'ITPark', key: 'itpark', count: 50 },
];

const SERVICE_ADVISORS = ['Anabele', 'Lito', 'Joni', 'Juvy', 'Escel', 'Marishell', 'Irish'];
const CUSTOMER_FIRST_NAMES = ['Alex', 'Andrea', 'Carlo', 'Celine', 'Daniel', 'Diana', 'Erwin', 'Faith', 'Gabriel', 'Grace', 'Henry', 'Irene', 'Jacob', 'Karen', 'Leo', 'Maria', 'Nathan', 'Olivia', 'Paolo', 'Queenie'];
const CUSTOMER_LAST_NAMES = ['Abad', 'Bautista', 'Cabrera', 'Domingo', 'Evangelista', 'Flores', 'Garcia', 'Hernandez', 'Ignacio', 'Jimenez', 'Lim', 'Mendoza', 'Navarro', 'Ocampo', 'Pascual'];

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

function normalizeBranch(value) {
  const key = normalizeText(value).toLowerCase().replace(/[^a-z0-9]/g, '');
  const aliases = {
    carx2: 'carx2',
    carmen: 'carmen',
    cebucity: 'cebucity',
    lapux2: 'lapux2',
    bogo: 'bogo',
    toledo: 'toledo',
    itpark: 'itpark',
    car2: 'lapux2',
    lapu2: 'toledo',
    goodyear: 'lapux2',
    escario: 'cebucity',
    pusok: 'toledo',
    srp1: 'bogo',
    srp01: 'bogo',
    carreta: 'carx2',
    mjcareta: 'carx2',
    mjcarreta: 'carx2',
    banilad: 'carmen',
    naga: 'itpark',
  };
  return aliases[key] || key;
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
    equipment: 'equipment',
    facility: 'facility',
    tools: 'tools',
  };
  return types[key] || 'small';
}

function asMoney(value) {
  return (Number(value) || 0).toFixed(2);
}

function readCsv(filePath) {
  return new Promise((resolve, reject) => {
    const rows = [];
    fs.createReadStream(filePath)
      .pipe(csv({ mapHeaders: ({ header }) => normalizeText(header).replace(/^\uFEFF/, '') }))
      .on('data', row => rows.push(row))
      .on('end', () => resolve(rows))
      .on('error', reject);
  });
}

function employeeName(employee) {
  return [employee.first_name, employee.middle_name, employee.last_name]
    .map(normalizeText)
    .filter(Boolean)
    .join(' ');
}

function buildTechniciansByBranch(employees) {
  const result = new Map(BRANCHES.map(branch => [branch.key, []]));
  const eligibleTitle = /(mechanic|aligner|toolkeeper|carwasher)/i;

  employees.forEach(employee => {
    if (!eligibleTitle.test(normalizeText(employee.job_title))) return;
    const branchKey = normalizeBranch(employee.work_location_branch_id);
    const name = employeeName(employee);
    if (result.has(branchKey) && name) result.get(branchKey).push(name);
  });

  BRANCHES.forEach(branch => {
    if (!result.get(branch.key).length) {
      throw new Error(`No eligible technicians found for ${branch.label}.`);
    }
  });
  return result;
}

function createCustomers() {
  return Array.from({ length: CUSTOMER_COUNT }, (_, index) => {
    const sequence = index + 1;
    const firstName = CUSTOMER_FIRST_NAMES[index % CUSTOMER_FIRST_NAMES.length];
    const lastName = CUSTOMER_LAST_NAMES[Math.floor(index / CUSTOMER_FIRST_NAMES.length) % CUSTOMER_LAST_NAMES.length];
    return {
      id: `sim-jul26-customer-${String(sequence).padStart(3, '0')}`,
      created_at: `2026-06-${String(1 + (index % 30)).padStart(2, '0')}T01:00:00.000Z`,
      simulation_batch: BATCH_ID,
      name: `${firstName} ${lastName} ${String(sequence).padStart(3, '0')}`,
      phone: `09${String(170000000 + sequence).padStart(9, '0')}`,
      email: `july26.customer${String(sequence).padStart(3, '0')}@example.test`,
      address: `Simulation Address ${sequence}, Cebu`,
      notes: 'July 2026 KPI simulation customer',
    };
  });
}

function createVehicles(customers, vehicleCatalog) {
  return customers.map((customer, index) => {
    const source = vehicleCatalog[index % vehicleCatalog.length];
    const sequence = index + 1;
    return {
      id: `sim-jul26-vehicle-${String(sequence).padStart(3, '0')}`,
      created_at: customer.created_at,
      simulation_batch: BATCH_ID,
      customer_id: customer.id,
      make: normalizeText(source['Car Brand']),
      model: normalizeText(source.Model),
      year: String(2014 + (index % 13)),
      vin: `J26SIM${String(sequence).padStart(11, '0')}`,
      license_plate: `SIM-${String(sequence).padStart(4, '0')}`,
      vehicle_type: normalizeVehicleType(source.Unit_Type || source.Vehicle_Type),
    };
  });
}

function createTimestamps(random) {
  const timestamps = Array.from({ length: RECORD_COUNT }, (_, index) => {
    const day = 1 + (index % 30);
    const slot = Math.floor(index / 30);
    const localMinutes = (8 * 60) + (slot * 15) + Math.floor(random() * 10);
    const hour = Math.floor(localMinutes / 60);
    const minute = localMinutes % 60;
    const second = (index * 37) % 60;
    return new Date(Date.UTC(2026, 6, day, hour - 8, minute, second)).toISOString();
  });
  return shuffle(timestamps, random);
}

function buildServiceQueue(services, random) {
  let queue = [];
  return function takeThree() {
    const selected = [];
    while (selected.length < 3) {
      if (!queue.length) queue = shuffle(services, random);
      const candidate = queue.shift();
      if (!selected.some(service => service.name === candidate.name)) selected.push(candidate);
    }
    return selected;
  };
}

function createTransactionRecord(options) {
  const { index, branch, timestamp, customer, vehicle, technician, serviceAdvisor, services } = options;
  const laborAmounts = services.map(service => Number(asMoney(service.prices[vehicle.vehicle_type])));
  const totalLabor = laborAmounts.reduce((sum, amount) => sum + amount, 0);
  const vat = totalLabor * VAT_RATE;
  const created = new Date(timestamp);
  const localHour = String((created.getUTCHours() + 8) % 24).padStart(2, '0');
  const localMinute = String(created.getUTCMinutes()).padStart(2, '0');
  const durationMinutes = 60 + ((index * 17) % 241);
  const timeOutMinutes = (Number(localHour) * 60) + Number(localMinute) + durationMinutes;
  const record = {
    id: `sim-jul26-transaction-${String(index + 1).padStart(4, '0')}`,
    created_at: timestamp,
    simulation_batch: BATCH_ID,
    work_order_id: `sim-jul26-workorder-${String(index + 1).padStart(4, '0')}`,
    transaction_action: 'simulated',
    'Transaction date': timestamp,
    'Branch': branch.label,
    'work order Number': String(7000000 + index + 1),
    'Customer name': customer.name,
    'Telephone number': customer.phone,
    'Car Brand': vehicle.make,
    'Model': vehicle.model,
    'Year': vehicle.year,
    'Service Advice Advisor': serviceAdvisor,
    'Tecnician': technician,
    'Total Labor': asMoney(totalLabor),
    'Total Parts': '0.00',
    'Grand Total': asMoney(totalLabor),
    'Vat': asMoney(vat),
    'Totalwith Vat': asMoney(totalLabor + vat),
    'TimeIn': `${localHour}:${localMinute}`,
    'TimeOut': `${String(Math.floor(timeOutMinutes / 60) % 24).padStart(2, '0')}:${String(timeOutMinutes % 60).padStart(2, '0')}`,
  };

  for (let slot = 1; slot <= 15; slot += 1) {
    const service = services[slot - 1];
    record[`Service${slot}`] = service ? service.name : '';
    record[`Service Required${slot}`] = service ? service.name : '';
    record[`Labor${slot}`] = service ? asMoney(laborAmounts[slot - 1]) : '';
  }
  for (let slot = 1; slot <= 50; slot += 1) {
    record[`Part${slot}`] = '';
    record[`Parts Price${slot}`] = '';
  }
  return record;
}

function validateGenerated(customers, vehicles, records, services, techniciansByBranch, existingData) {
  if (customers.length !== CUSTOMER_COUNT || vehicles.length !== CUSTOMER_COUNT || records.length !== RECORD_COUNT) {
    throw new Error('Generated collection counts do not match the requested totals.');
  }

  const seenTimestamps = new Set();
  const seenServices = new Set();
  const seenCustomers = new Set();
  const branchCounts = new Map();
  const existingIds = new Set([...existingData.customers, ...existingData.vehicles, ...existingData.transaction_records].map(item => item.id).filter(Boolean));
  const existingWorkOrderNumbers = new Set(existingData.transaction_records.map(record => normalizeText(record['work order Number'])).filter(Boolean));
  [...customers, ...vehicles, ...records].forEach(item => {
    if (existingIds.has(item.id)) throw new Error(`Generated ID collides with existing data: ${item.id}`);
  });
  records.forEach(record => {
    const timestamp = record['Transaction date'];
    if (timestamp < '2026-06-30T16:00:00.000Z' || timestamp >= '2026-07-30T16:00:00.000Z') {
      throw new Error(`Transaction timestamp is outside July 1-30 Manila time: ${timestamp}`);
    }
    if (seenTimestamps.has(timestamp)) throw new Error(`Duplicate timestamp generated: ${timestamp}`);
    seenTimestamps.add(timestamp);

    const selectedServices = [record.Service1, record.Service2, record.Service3];
    if (new Set(selectedServices).size !== 3 || selectedServices.some(value => !value)) {
      throw new Error(`Transaction ${record.id} does not contain three distinct services.`);
    }
    selectedServices.forEach(service => seenServices.add(service));
    for (let slot = 4; slot <= 15; slot += 1) {
      if (record[`Service${slot}`] || record[`Service Required${slot}`] || record[`Labor${slot}`]) {
        throw new Error(`Unused service slots are not empty for ${record.id}.`);
      }
    }
    for (let slot = 1; slot <= 50; slot += 1) {
      if (record[`Part${slot}`] || record[`Parts Price${slot}`]) throw new Error(`Parts are not empty for ${record.id}.`);
    }
    if (existingWorkOrderNumbers.has(record['work order Number'])) {
      throw new Error(`Work order number collides with existing data: ${record['work order Number']}`);
    }
    const laborTotal = Number(record.Labor1) + Number(record.Labor2) + Number(record.Labor3);
    const expectedLaborTotal = Number(asMoney(laborTotal));
    const expectedVat = Number(asMoney(laborTotal * VAT_RATE));
    const expectedTotalWithVat = Number(asMoney(laborTotal + (laborTotal * VAT_RATE)));
    if (record['Total Parts'] !== '0.00' || Number(record['Total Labor']) !== expectedLaborTotal || Number(record['Grand Total']) !== expectedLaborTotal || Number(record.Vat) !== expectedVat || Number(record['Totalwith Vat']) !== expectedTotalWithVat) {
      throw new Error(`Transaction totals are invalid for ${record.id}.`);
    }

    seenCustomers.add(record['Customer name']);

    branchCounts.set(record.Branch, (branchCounts.get(record.Branch) || 0) + 1);
    const branch = BRANCHES.find(item => item.label === record.Branch);
    if (!branch || !techniciansByBranch.get(branch.key).includes(record.Tecnician)) {
      throw new Error(`Technician ${record.Tecnician} is not valid for ${record.Branch}.`);
    }
  });

  BRANCHES.forEach(branch => {
    if (branchCounts.get(branch.label) !== branch.count) throw new Error(`Incorrect count for ${branch.label}.`);
  });
  if (seenCustomers.size !== CUSTOMER_COUNT) throw new Error('Not every simulation customer and vehicle is used.');
  if (seenServices.size !== services.length) throw new Error('Not every service appears in the generated records.');
  if (!SERVICE_ADVISORS.every(name => records.some(record => record['Service Advice Advisor'] === name))) {
    throw new Error('Not every service advisor appears in the generated records.');
  }
}

async function main() {
  const [dataText, serviceRows, vehicleRows] = await Promise.all([
    fsPromises.readFile(DATA_FILE, 'utf8'),
    readCsv(SERVICE_FILE),
    readCsv(VEHICLE_FILE),
  ]);
  const data = JSON.parse(dataText);
  data.customers = Array.isArray(data.customers) ? data.customers : [];
  data.vehicles = Array.isArray(data.vehicles) ? data.vehicles : [];
  data.transaction_records = Array.isArray(data.transaction_records) ? data.transaction_records : [];
  data.employees = Array.isArray(data.employees) ? data.employees : [];

  const existingBatch = [...data.customers, ...data.vehicles, ...data.transaction_records]
    .some(item => item && item.simulation_batch === BATCH_ID);
  if (existingBatch) throw new Error(`Simulation batch ${BATCH_ID} already exists. No changes were made.`);

  const services = serviceRows
    .map(row => ({
      name: normalizeText(row['Sub Group']),
      prices: Object.fromEntries(Object.entries(SERVICE_COLUMNS).map(([type, column]) => [type, Number(row[column])])),
    }))
    .filter(service => service.name);
  if (services.length !== 88) throw new Error(`Expected 88 services but found ${services.length}.`);
  services.forEach(service => {
    if (Object.values(service.prices).some(price => !Number.isFinite(price))) {
      throw new Error(`Invalid labor price for ${service.name}.`);
    }
  });

  const vehicleCatalog = vehicleRows.filter(row => normalizeText(row['Car Brand']) && normalizeText(row.Model));
  if (!vehicleCatalog.length) throw new Error('VehicleType.csv does not contain usable vehicles.');
  const techniciansByBranch = buildTechniciansByBranch(data.employees);
  const random = createRandom(RANDOM_SEED);
  const customers = createCustomers();
  const vehicles = createVehicles(customers, vehicleCatalog);
  const timestamps = createTimestamps(random);
  const branches = shuffle(BRANCHES.flatMap(branch => Array(branch.count).fill(branch)), random);
  const takeServices = buildServiceQueue(services, random);

  const records = Array.from({ length: RECORD_COUNT }, (_, index) => {
    const customerIndex = (index * 73) % CUSTOMER_COUNT;
    const customer = customers[customerIndex];
    const vehicle = vehicles[customerIndex];
    const branch = branches[index];
    const technicians = techniciansByBranch.get(branch.key);
    return createTransactionRecord({
      index,
      branch,
      timestamp: timestamps[index],
      customer,
      vehicle,
      technician: technicians[Math.floor(random() * technicians.length)],
      serviceAdvisor: SERVICE_ADVISORS[index % SERVICE_ADVISORS.length],
      services: takeServices(),
    });
  });

  validateGenerated(customers, vehicles, records, services, techniciansByBranch, data);
  console.log(`Validated ${customers.length} customers, ${vehicles.length} vehicles, and ${records.length} transaction records.`);
  console.log(`Branch counts: ${BRANCHES.map(branch => `${branch.label}=${branch.count}`).join(', ')}`);
  console.log(`Service coverage: ${services.length}/${services.length}; parts total: 0.00`);

  if (DRY_RUN) {
    console.log('Dry run completed. No data was written.');
    return;
  }

  const stamp = new Date().toISOString().replace(/[.:]/g, '-');
  const backupPath = path.join(path.dirname(DATA_FILE), `data.backup.${stamp}.json`);
  await fsPromises.copyFile(DATA_FILE, backupPath);
  data.customers.push(...customers);
  data.vehicles.push(...vehicles);
  data.transaction_records.push(...records);
  await fsPromises.writeFile(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');

  console.log(`Backup created: ${backupPath}`);
  console.log(`Simulation merged. customers=${data.customers.length}, vehicles=${data.vehicles.length}, transaction_records=${data.transaction_records.length}`);
}

main().catch(error => {
  console.error(`Simulation generation failed: ${error.message}`);
  process.exit(1);
});
