const fs = require('fs').promises;
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'data', 'data.json');
const WORK_ORDER_NUMBER_PATTERN = /^\d{7}$/;

function normalizeWorkOrderNumber(value, fallbackId) {
  const candidate = String(value || '').trim();
  const digits = candidate.replace(/\D/g, '');
  if (candidate && WORK_ORDER_NUMBER_PATTERN.test(candidate)) {
    return candidate;
  }
  if (digits) {
    return digits.slice(-7).padStart(7, '0');
  }
  return String(fallbackId || 0).replace(/\D/g, '').slice(-7).padStart(7, '0');
}

async function run() {
  const raw = await fs.readFile(DATA_FILE, 'utf8');
  const data = JSON.parse(raw);

  const workOrders = Array.isArray(data.work_orders) ? data.work_orders : [];
  const transactions = Array.isArray(data.transaction_records) ? data.transaction_records : [];

  const workOrderNumberMap = new Map();
  let workOrderUpdated = 0;
  let transactionUpdated = 0;

  for (const wo of workOrders) {
    const normalized = normalizeWorkOrderNumber(wo.work_order_number, wo.id || Date.now());
    if (wo.work_order_number !== normalized) {
      wo.work_order_number = normalized;
      workOrderUpdated += 1;
    }
    if (wo.id) {
      workOrderNumberMap.set(wo.id, normalized);
    }
  }

  for (const record of transactions) {
    const current = record['work order Number'];
    const fromMap = record.work_order_id ? workOrderNumberMap.get(record.work_order_id) : '';
    const normalized = normalizeWorkOrderNumber(fromMap || current, record.work_order_id || record.id || Date.now());
    if (current !== normalized) {
      record['work order Number'] = normalized;
      transactionUpdated += 1;
    }
  }

  await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
  console.log(`Normalized work order numbers. work_orders=${workOrderUpdated}, transactions=${transactionUpdated}`);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
