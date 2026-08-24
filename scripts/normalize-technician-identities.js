const fs = require('fs').promises;
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'data', 'data.json');

function text(value) {
  return String(value || '').trim();
}

function canonical(value) {
  return text(value)
    .replace(/\s*\([^)]+\)\s*$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function isTechnician(employee) {
  return /(mechanic|aligner|toolkeeper|carwasher|technician)/i.test(text(employee && employee.job_title));
}

function employeeName(employee) {
  return [employee.first_name, employee.middle_name, employee.last_name].map(text).filter(Boolean).join(' ');
}

function buildIdentityMap(employees) {
  const identities = new Map();
  const uniqueFirstNames = new Map();

  employees.filter(employee => text(employee.employee_id) && isTechnician(employee)).forEach(employee => {
    const name = employeeName(employee);
    const id = text(employee.employee_id);
    const identity = `${name} (${id})`;
    const fullKey = canonical(name);
    if (fullKey) identities.set(fullKey, identity);

    const firstKey = canonical(employee.first_name);
    if (!firstKey) return;
    if (uniqueFirstNames.has(firstKey)) uniqueFirstNames.set(firstKey, null);
    else uniqueFirstNames.set(firstKey, identity);
  });

  uniqueFirstNames.forEach((identity, key) => {
    if (identity && !identities.has(key)) identities.set(key, identity);
  });
  return identities;
}

function normalizeIdentity(value, identities) {
  const current = text(value);
  if (!current) return current;
  const key = canonical(current);
  return identities.get(key) || '';
}

async function run() {
  const raw = await fs.readFile(DATA_FILE, 'utf8');
  const data = JSON.parse(raw);
  const identities = buildIdentityMap(Array.isArray(data.employees) ? data.employees : []);
  const stamp = new Date().toISOString().replace(/[.:]/g, '-');
  const backupFile = path.join(__dirname, '..', 'data', `data.backup.technician-identity-cleanup.${stamp}.json`);
  await fs.writeFile(backupFile, raw, 'utf8');

  const counts = { work_orders: 0, transaction_records: 0, technician_updates: 0, users: 0, cleared: 0 };

  function update(record, field, collection) {
    if (!record || !text(record[field])) return;
    const before = text(record[field]);
    const after = normalizeIdentity(before, identities);
    if (before === after) return;
    record[field] = after;
    counts[collection] += 1;
    if (!after) counts.cleared += 1;
  }

  (data.work_orders || []).forEach(record => update(record, 'technician', 'work_orders'));
  (data.transaction_records || []).forEach(record => {
    update(record, 'Tecnician', 'transaction_records');
    update(record, 'Technician', 'transaction_records');
  });
  (data.technician_updates || []).forEach(record => update(record, 'technician_name', 'technician_updates'));
  (data.users || []).filter(user => text(user.role).toLowerCase() === 'technician').forEach(user => {
    update(user, 'technician_name', 'users');
    if (text(user.technician_name)) user.username = user.technician_name;
  });

  await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
  console.log(JSON.stringify({ backup: backupFile, ...counts }, null, 2));
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});