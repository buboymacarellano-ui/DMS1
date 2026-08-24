const fs = require('fs').promises;
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'data', 'data.json');

function normalizeData(data) {
  return {
    users: Array.isArray(data.users) ? data.users : [],
    customers: Array.isArray(data.customers) ? data.customers : [],
    vehicles: Array.isArray(data.vehicles) ? data.vehicles : [],
    work_orders: Array.isArray(data.work_orders) ? data.work_orders : [],
    transaction_records: Array.isArray(data.transaction_records) ? data.transaction_records : [],
    pricing_rules: Array.isArray(data.pricing_rules) ? data.pricing_rules : [],
    pricing_settings: data.pricing_settings || { hourly_rate: 350 },
  };
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function buildFingerprint(record) {
  return [
    String(record.work_order_id || '').trim(),
    String(record.transaction_action || '').trim(),
    String(record['Transaction date'] || record.created_at || '').trim(),
    String(record['work order Number'] || '').trim(),
    String(record['Customer name'] || '').trim(),
    String(record['Grand Total'] || '').trim(),
  ].join('||').toLowerCase();
}

function normalizeTransactionRecord(record) {
  const normalized = Object.assign({}, record);
  if (!normalized.id) normalized.id = genId();
  if (!normalized.created_at) normalized.created_at = new Date().toISOString();
  return normalized;
}

async function loadJson(filePath) {
  const content = await fs.readFile(filePath, 'utf8');
  return JSON.parse(content);
}

async function backupDataFile() {
  const stamp = new Date().toISOString().replace(/[.:]/g, '-');
  const backupPath = path.join(path.dirname(DATA_FILE), `data.backup.${stamp}.json`);
  await fs.copyFile(DATA_FILE, backupPath);
  return backupPath;
}

async function run() {
  const sourceArg = process.argv[2];
  if (!sourceArg) {
    console.error('Usage: node scripts/import-transaction-records.js <path-to-json> [--replace]');
    process.exit(1);
  }

  const replaceMode = process.argv.includes('--replace');
  const sourcePath = path.resolve(process.cwd(), sourceArg);
  const targetData = normalizeData(await loadJson(DATA_FILE));
  const sourceJson = await loadJson(sourcePath);
  const sourceRecords = Array.isArray(sourceJson)
    ? sourceJson
    : Array.isArray(sourceJson.transaction_records)
      ? sourceJson.transaction_records
      : [];

  if (!sourceRecords.length) {
    console.error('No transaction_records array found in the source file.');
    process.exit(1);
  }

  const backupPath = await backupDataFile();
  let imported = 0;
  let skipped = 0;

  if (replaceMode) {
    targetData.transaction_records = sourceRecords.map(normalizeTransactionRecord);
    imported = targetData.transaction_records.length;
  } else {
    const existingFingerprints = new Set(targetData.transaction_records.map(buildFingerprint));
    for (const sourceRecord of sourceRecords) {
      const normalized = normalizeTransactionRecord(sourceRecord);
      const fingerprint = buildFingerprint(normalized);
      if (existingFingerprints.has(fingerprint)) {
        skipped += 1;
        continue;
      }

      targetData.transaction_records.push(normalized);
      existingFingerprints.add(fingerprint);
      imported += 1;
    }
  }

  await fs.writeFile(DATA_FILE, JSON.stringify(targetData, null, 2), 'utf8');

  console.log(`Import completed. imported=${imported}, skipped=${skipped}, total=${targetData.transaction_records.length}`);
  console.log(`Backup created: ${backupPath}`);
}

run().catch((error) => {
  console.error('Import failed:', error.message);
  process.exit(1);
});