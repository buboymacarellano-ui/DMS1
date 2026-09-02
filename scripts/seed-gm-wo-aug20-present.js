const store = require('../data/store');
const {
  computeInvoiceEconomics,
  financeFieldsFromSnapshot,
  PAYMENT_STATUS,
  PAYMENT_METHODS,
} = require('../lib/finance-ledger');

const BATCH_ID = 'gm-wo-aug20-present-150';
const COUNT = 150;
const VAT_RATE = 0.12;
const START = new Date('2026-08-20T08:00:00+08:00');
const END = new Date('2026-09-02T17:00:00+08:00');
const BRANCHES = ['Carx2', 'Carmen', 'CebuCity', 'Lapux2', 'Bogo', 'Toledo', 'ITPark'];
const SERVICES = [
  { name: 'Preventive Maintenance Service', labor: 950 },
  { name: 'Brake Inspection and Service', labor: 1350 },
  { name: 'Engine Diagnostics', labor: 1650 },
  { name: 'Air Conditioning Service', labor: 1850 },
  { name: 'Wheel Alignment', labor: 1200 },
];
const PARTS = [
  { number: 'GM26-OIL-001', name: 'Engine Oil Filter', price: 420, cost: 285 },
  { number: 'GM26-AIR-002', name: 'Engine Air Filter', price: 820, cost: 640 },
  { number: 'GM26-BRK-003', name: 'Front Brake Pad Set', price: 2240, cost: 1680 },
  { number: 'GM26-AC-004', name: 'Cabin Filter', price: 680, cost: 475 },
  { number: 'GM26-WIP-005', name: 'Wiper Blade Set', price: 850, cost: 620 },
];

function pad(value, width) {
  return String(value).padStart(width, '0');
}

function money(value) {
  return Number((Number(value) || 0).toFixed(2));
}

function isoAt(index) {
  const span = END.getTime() - START.getTime();
  return new Date(START.getTime() + Math.round((index / (COUNT - 1)) * span)).toISOString();
}

function nextWorkOrderNumber(rows) {
  const max = rows.reduce((highest, row) => {
    const value = Number(String(row.work_order_number || row['work order Number'] || '').replace(/\D/g, ''));
    return Number.isFinite(value) ? Math.max(highest, value) : highest;
  }, 0);
  return max + 1;
}

function buildTransaction(workOrder, customer, vehicle, item, transactionDate, economics) {
  const labor = money(item.labor_price * item.service_qty);
  const parts = money(item.parts_qty * item.parts_price);
  const subtotal = money(labor + parts);
  const vat = money(subtotal * VAT_RATE);
  const record = {
    id: `tx-${BATCH_ID}-${pad(workOrder.seed_index, 4)}`,
    created_at: transactionDate,
    seed_batch: BATCH_ID,
    work_order_id: workOrder.id,
    transaction_action: 'billing-print',
    action_by: 'SEED-GM-AUG20',
    action_by_role: 'service_advisor',
    'Transaction date': transactionDate,
    Branch: workOrder.branch,
    'work order Number': workOrder.work_order_number,
    'Customer name': customer.name,
    'Telephone number': customer.phone,
    'Car Brand': vehicle.make,
    Model: vehicle.model,
    Year: vehicle.year,
    'Service Advice Advisor': workOrder.service_advisor,
    Tecnician: workOrder.technician,
    'Total Labor': labor.toFixed(2),
    'Total Parts': parts.toFixed(2),
    'Grand Total': subtotal.toFixed(2),
    Vat: vat.toFixed(2),
    'Totalwith Vat': money(subtotal + vat).toFixed(2),
    TimeIn: workOrder.time_in,
    TimeOut: workOrder.time_out,
    Service1: item.description,
    'Service Required1': item.description,
    Labor1: labor.toFixed(2),
    Part1: `${item.parts} x${item.parts_qty}`,
    'Parts Price1': parts.toFixed(2),
    invoice_number: workOrder.invoice_number,
    invoice_date: workOrder.invoice_date,
    ...financeFieldsFromSnapshot(economics, {
      paymentMethod: PAYMENT_METHODS[workOrder.seed_index % PAYMENT_METHODS.length],
      paymentStatus: PAYMENT_STATUS.PAID,
      balanceDue: 0,
    }),
  };
  return record;
}

async function main() {
  const data = await store.getRawData();
  data.customers = Array.isArray(data.customers) ? data.customers : [];
  data.vehicles = Array.isArray(data.vehicles) ? data.vehicles : [];
  data.work_orders = Array.isArray(data.work_orders) ? data.work_orders : [];
  data.transaction_records = Array.isArray(data.transaction_records) ? data.transaction_records : [];

  const existingBatch = data.work_orders.filter((row) => row.seed_batch === BATCH_ID);
  if (existingBatch.length >= COUNT) {
    console.log(JSON.stringify({ skipped: true, batch: BATCH_ID, count: existingBatch.length }, null, 2));
    return;
  }

  const workOrders = [];
  const transactions = [];
  let sequence = nextWorkOrderNumber([...data.work_orders, ...data.transaction_records]);

  for (let index = 0; index < COUNT; index += 1) {
    const sequenceText = pad(index + 1, 4);
    const createdAt = isoAt(index);
    const branch = BRANCHES[index % BRANCHES.length];
    const service = SERVICES[index % SERVICES.length];
    const part = PARTS[index % PARTS.length];
    const workOrderNumber = pad(sequence++, 7);
    const customer = {
      id: `cust-${BATCH_ID}-${sequenceText}`,
      created_at: createdAt,
      seed_batch: BATCH_ID,
      name: `GM Demo Customer ${sequenceText}`,
      phone: `0917${pad(index + 1000000, 7)}`,
      email: `gm-demo-${sequenceText}@example.test`,
      address: `${branch}, Cebu`,
      branch,
    };
    const vehicle = {
      id: `veh-${BATCH_ID}-${sequenceText}`,
      created_at: createdAt,
      seed_batch: BATCH_ID,
      customer_id: customer.id,
      make: ['Toyota', 'Honda', 'Mitsubishi', 'Ford'][index % 4],
      model: ['Vios', 'Civic', 'Montero', 'Ranger'][index % 4],
      year: String(2018 + (index % 8)),
      vin: `GM26${pad(index + 1, 13)}`,
      license_plate: `GM-${pad(index + 1, 4)}`,
      vehicle_type: 'small',
      branch,
    };
    const item = {
      description: service.name,
      reason: service.name,
      labor_price: service.labor,
      service_qty: 1,
      part_number: part.number,
      unit: 'pc',
      parts: part.name,
      parts_qty: 1,
      parts_price: part.price,
      cost_price: part.cost,
      total_price: money(service.labor + part.price),
    };
    const workOrderId = `wo-${BATCH_ID}-${sequenceText}`;
    const workOrder = {
      id: workOrderId,
      created_at: createdAt,
      updated_at: createdAt,
      seed_batch: BATCH_ID,
      seed_index: index + 1,
      customer_id: customer.id,
      vehicle_id: vehicle.id,
      description: service.name,
      status: 'closed',
      branch,
      work_order_number: workOrderNumber,
      service_advisor: 'SEED-GM-AUG20',
      technician: `GM Demo Technician ${pad((index % 20) + 1, 2)}`,
      technician_assigned_at: createdAt,
      time_in: '08:00',
      time_out: '10:00',
      telephone_number: customer.phone,
      car_brand: vehicle.make,
      car_model: vehicle.model,
      car_year: vehicle.year,
      plate_number: vehicle.license_plate,
      service_items: [item],
      invoice_number: workOrderNumber,
      invoice_date: createdAt,
    };
    const economics = computeInvoiceEconomics(workOrder);
    Object.assign(workOrder, financeFieldsFromSnapshot(economics, {
      paymentMethod: PAYMENT_METHODS[index % PAYMENT_METHODS.length],
      paymentStatus: PAYMENT_STATUS.PAID,
      balanceDue: 0,
    }));
    data.customers.push(customer);
    data.vehicles.push(vehicle);
    workOrders.push(workOrder);
    transactions.push(buildTransaction(workOrder, customer, vehicle, item, createdAt, economics));
  }

  const backup = await store.backupData();
  data.work_orders.push(...workOrders);
  data.transaction_records.push(...transactions);
  await store.replaceData(data);
  console.log(JSON.stringify({
    created: workOrders.length,
    batch: BATCH_ID,
    status: 'closed',
    date_span: `${workOrders[0].created_at} to ${workOrders[workOrders.length - 1].created_at}`,
    branches: BRANCHES,
    backup,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});