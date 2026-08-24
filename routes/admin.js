const express = require('express');
const csvParser = require('csv-parser');
const { Readable } = require('stream');
const store = require('../data/store');

const router = express.Router();
const ALLOWED_COLLECTIONS = ['users', 'customers', 'vehicles', 'work_orders', 'transaction_records', 'pricing_rules'];
const ADMIN_GATES = [
  { slug: 'transaction-database', label: 'Transaction Database' },
  { slug: 'removed-records', label: 'Removed Records' },
  { slug: 'parts-database', label: 'Parts Database' },
  { slug: 'technician', label: 'Technician' },
  { slug: 'purchases', label: 'Purchases' },
  { slug: 'expenses', label: 'Expenses' },
  { slug: 'reports', label: 'Reports' },
];
const SERVICE_LINE_COUNT = 15;
const SERVICE_REQUIRED_LINE_COUNT = 15;
const PART_LINE_COUNT = 50;
const serviceRequestReasonHeaders = Array.from({ length: SERVICE_LINE_COUNT }, (_, i) => `Service Request and Reason${i + 1}`);
const serviceRequiredHeaders = Array.from({ length: SERVICE_REQUIRED_LINE_COUNT }, (_, i) => `Service Required${i + 1}`);
const laborHeaders = Array.from({ length: SERVICE_LINE_COUNT }, (_, i) => `Labor${i + 1}`);
const partHeaders = Array.from({ length: PART_LINE_COUNT }, (_, i) => `Part${i + 1}`);
const partPriceHeaders = Array.from({ length: PART_LINE_COUNT }, (_, i) => `Parts Price${i + 1}`);
const transactionCsvTemplateHeaders = [
  'Transaction date',
  'Branch',
  'work order Number',
  'Customer name',
  'Telephone number',
  'Car Brand',
  'Model',
  'Year',
  'SA',
  'Tecnician',
  ...serviceRequestReasonHeaders,
  ...serviceRequiredHeaders,
  ...laborHeaders,
  ...partHeaders,
  ...partPriceHeaders,
  'Total Labor',
  'Total Parts',
  'Grand Total',
  'Vat',
  'Totalwith Vat',
  'TimeIn',
  'TimeOut',
];

function normalizeCsvHeader(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function buildCsvHeaderAliases() {
  const aliases = {
    id: 'id',
    createdat: 'created_at',
    workorderid: 'work_order_id',
    transactionaction: 'transaction_action',
    transactiondate: 'Transaction date',
    branch: 'Branch',
    workordernumber: 'work order Number',
    customername: 'Customer name',
    telephonenumber: 'Telephone number',
    carbrand: 'Car Brand',
    model: 'Model',
    year: 'Year',
    sa: 'Service Advice Advisor',
    serviceadviceadvisor: 'Service Advice Advisor',
    tecnician: 'Tecnician',
    technician: 'Tecnician',
    totallabor: 'Total Labor',
    totalparts: 'Total Parts',
    grandtotal: 'Grand Total',
    vat: 'Vat',
    totalwithvat: 'Totalwith Vat',
    timein: 'TimeIn',
    timeout: 'TimeOut',
  };

  for (let i = 1; i <= SERVICE_LINE_COUNT; i += 1) {
    aliases[`service${i}`] = `Service${i}`;
    aliases[`servicerequestandreason${i}`] = `Service${i}`;
    aliases[`labor${i}`] = `Labor${i}`;
  }

  for (let i = 1; i <= SERVICE_REQUIRED_LINE_COUNT; i += 1) {
    aliases[`servicerequired${i}`] = `Service Required${i}`;
  }

  for (let i = 1; i <= PART_LINE_COUNT; i += 1) {
    aliases[`part${i}`] = `Part${i}`;
    aliases[`partsprice${i}`] = `Parts Price${i}`;
    aliases[`partprice${i}`] = `Parts Price${i}`;
  }

  return aliases;
}

const CSV_HEADER_ALIASES = buildCsvHeaderAliases();

function stripBom(text) {
  return String(text || '').replace(/^\uFEFF/, '');
}

function parseCsvRows(text) {
  const payload = stripBom(text).trim();
  if (!payload) return Promise.resolve([]);

  return new Promise((resolve, reject) => {
    const rows = [];
    Readable.from([payload])
      .pipe(csvParser())
      .on('data', (row) => rows.push(row))
      .on('end', () => resolve(rows))
      .on('error', reject);
  });
}

function mapCsvRowToTransactionRecord(row) {
  const mapped = {};
  Object.entries(row || {}).forEach(([header, value]) => {
    const key = CSV_HEADER_ALIASES[normalizeCsvHeader(header)];
    if (!key) return;
    mapped[key] = String(value == null ? '' : value).trim();
  });
  return mapped;
}

function asCsvValue(value) {
  const str = String(value == null ? '' : value);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
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

function normalizeRecord(record) {
  const normalized = Object.assign({}, record);
  if (!normalized.id) {
    normalized.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  if (!normalized.created_at) {
    normalized.created_at = new Date().toISOString();
  }
  return normalized;
}

function parseJson(text, fallbackMessage) {
  try {
    return { value: JSON.parse(String(text || '')) };
  } catch (error) {
    return { error: fallbackMessage || error.message };
  }
}

function buildAdminSummary(data) {
  return [
    { label: 'Users', value: Array.isArray(data.users) ? data.users.length : 0 },
    { label: 'Customers', value: Array.isArray(data.customers) ? data.customers.length : 0 },
    { label: 'Vehicles', value: Array.isArray(data.vehicles) ? data.vehicles.length : 0 },
    { label: 'Work Orders', value: Array.isArray(data.work_orders) ? data.work_orders.length : 0 },
    { label: 'Transactions', value: Array.isArray(data.transaction_records) ? data.transaction_records.length : 0 },
    { label: 'Pricing Rules', value: Array.isArray(data.pricing_rules) ? data.pricing_rules.length : 0 },
  ];
}

async function renderAdmin(res, options = {}) {
  const data = await store.getRawData();
  const deletePasswordConfigured = await store.hasDeletePassword();
  const deletePasswordEnabled = await store.isDeletePasswordEnabled();
  const selectedCollection = ALLOWED_COLLECTIONS.includes(options.selectedCollection)
    ? options.selectedCollection
    : 'transaction_records';

  return res.render('admin/index', {
    summary: buildAdminSummary(data),
    databaseJson: JSON.stringify(data, null, 2),
    selectedCollection,
    collectionJson: JSON.stringify(data[selectedCollection] || [], null, 2),
    collectionOptions: ALLOWED_COLLECTIONS,
    importMode: options.importMode || 'merge',
    importJson: options.importJson || '',
    importCsv: options.importCsv || '',
    adminGates: ADMIN_GATES,
    deletePasswordConfigured,
    deletePasswordEnabled,
    error: options.error || '',
    success: options.success || '',
    backupPath: options.backupPath || '',
  });
}

router.get('/', async (req, res) => {
  return renderAdmin(res, {
    selectedCollection: req.query.collection,
    success: req.query.success || '',
    error: req.query.error || '',
  });
});

router.post('/delete-password', async (req, res) => {
  const password = String(req.body.delete_password || '');
  const confirmation = String(req.body.confirm_delete_password || '');

  if (password.length < 6) {
    return res.redirect('/admin?error=Delete+password+must+be+at+least+6+characters.');
  }

  if (password !== confirmation) {
    return res.redirect('/admin?error=Delete+password+confirmation+does+not+match.');
  }

  await store.setDeletePassword(password);
  return res.redirect('/admin?success=Global+delete+password+updated.');
});

router.post('/delete-password/toggle', async (req, res) => {
  const enabled = String(req.body.enabled || '') === '1';
  await store.setDeletePasswordEnabled(enabled);
  const status = enabled ? 'enabled' : 'disabled';
  return res.redirect(`/admin?success=Delete+password+protection+${status}.`);
});

router.get('/gates/parts-database', (req, res) => {
  return res.redirect('/parts');
});

router.get('/gates/transaction-database', async (req, res) => {
  const records = await store.getAll('transaction_records');
  return res.render('admin/transaction-database', {
    records,
    importError: req.query.importError || '',
    importSuccess: req.query.importSuccess || '',
  });
});

router.get('/gates/removed-records', async (req, res) => {
  const records = (await store.getAll('transaction_records'))
    .filter(record => ['deleted', 'removed'].includes(String(record.transaction_action || '').trim().toLowerCase()))
    .sort((a, b) => {
      const aDate = new Date(a['Transaction date'] || a.created_at || 0).getTime() || 0;
      const bDate = new Date(b['Transaction date'] || b.created_at || 0).getTime() || 0;
      return bDate - aDate;
    });

  const branchSummary = Array.from(records.reduce((summary, record) => {
    const branch = String(record.Branch || '').trim() || 'Unassigned';
    const current = summary.get(branch) || { branch, count: 0, total: 0 };
    current.count += 1;
    current.total += Number(record['Totalwith Vat'] || record['Grand Total']) || 0;
    summary.set(branch, current);
    return summary;
  }, new Map()).values()).sort((a, b) => b.count - a.count || a.branch.localeCompare(b.branch));

  return res.render('admin/removed-records', { records, branchSummary });
});

// Required fields for a valid transaction record
const REQUIRED_TX_FIELDS = ['work order Number', 'Transaction date', 'Customer name'];

function validateTransactionRecord(record, rowIndex) {
  const errors = [];
  REQUIRED_TX_FIELDS.forEach(field => {
    if (!String(record[field] || '').trim()) {
      errors.push(`Missing "${field}"`);
    }
  });
  const wo = String(record['work order Number'] || '').trim();
  if (wo && !/^\d{7}$/.test(wo)) {
    errors.push(`Work Order # must be 7 digits (got "${wo}")`);
  }
  return { rowIndex, record, errors, valid: errors.length === 0 };
}

router.post('/transaction-database/preview-csv', async (req, res) => {
  const csvPayload = String(req.body.import_csv || '');
  if (!csvPayload.trim()) {
    const records = await store.getAll('transaction_records');
    return res.render('admin/transaction-database', { records, importError: 'No CSV data received.' });
  }

  let rows;
  try {
    rows = await parseCsvRows(csvPayload);
  } catch (err) {
    const records = await store.getAll('transaction_records');
    return res.render('admin/transaction-database', { records, importError: `Invalid CSV: ${err.message}` });
  }

  const mapped = rows
    .map(mapCsvRowToTransactionRecord)
    .filter(r => Object.values(r).some(v => String(v || '').trim()));

  if (!mapped.length) {
    const records = await store.getAll('transaction_records');
    return res.render('admin/transaction-database', { records, importError: 'CSV contained no data rows.' });
  }

  const validated = mapped.map((r, i) => validateTransactionRecord(r, i + 2)); // row 1 = header
  req.session.pendingCsvImport = csvPayload;

  return res.render('admin/transaction-database-preview', {
    validated,
    validCount: validated.filter(v => v.valid).length,
    invalidCount: validated.filter(v => !v.valid).length,
  });
});

router.post('/transaction-database/confirm-import', async (req, res) => {
  const csvPayload = req.session.pendingCsvImport;
  if (!csvPayload) {
    return res.redirect('/admin/gates/transaction-database?importError=Session+expired.+Please+re-upload+the+CSV.');
  }

  let rows;
  try {
    rows = await parseCsvRows(csvPayload);
  } catch (err) {
    delete req.session.pendingCsvImport;
    return res.redirect('/admin/gates/transaction-database?importError=CSV+parse+failed.');
  }

  const incomingRecords = rows
    .map(mapCsvRowToTransactionRecord)
    .filter(r => Object.values(r).some(v => String(v || '').trim()));

  // Only import records that pass validation
  const validRecords = incomingRecords
    .map((r, i) => validateTransactionRecord(r, i))
    .filter(v => v.valid)
    .map(v => v.record);

  const backupPath = await store.backupData();
  const data = await store.getRawData();
  const existing = new Set((data.transaction_records || []).map(buildFingerprint));
  let imported = 0;
  let skipped = 0;

  for (const record of validRecords) {
    const normalized = normalizeRecord(record);
    const fp = buildFingerprint(normalized);
    if (existing.has(fp)) { skipped += 1; continue; }
    data.transaction_records.push(normalized);
    existing.add(fp);
    imported += 1;
  }

  await store.replaceData(data);
  delete req.session.pendingCsvImport;

  return res.redirect(`/admin/gates/transaction-database?importSuccess=Imported+${imported}+records,+${skipped}+duplicates+skipped.+Backup+saved.`);
});

router.get('/transaction-database/export.csv', async (req, res) => {
  const records = await store.getAll('transaction_records');
  const headers = transactionCsvTemplateHeaders;
  const lines = [headers.map(asCsvValue).join(',')];
  records.forEach(rec => {
    lines.push(headers.map(h => asCsvValue(rec[h] != null ? rec[h] : '')).join(','));
  });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="transaction-database.csv"');
  return res.status(200).send(lines.join('\n'));
});

router.get('/gates/:slug', (req, res) => {
  const gate = ADMIN_GATES.find(item => item.slug === req.params.slug);
  if (!gate) {
    return res.redirect('/admin?error=Requested%20admin%20gate%20does%20not%20exist.');
  }

  return res.render('admin/gate', {
    gate,
  });
});

router.get('/transaction-template.csv', (req, res) => {
  const headerLine = transactionCsvTemplateHeaders.map(asCsvValue).join(',');
  const exampleLine = transactionCsvTemplateHeaders.map(() => '').join(',');
  const csv = `${headerLine}\n${exampleLine}\n`;

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="workorder-transactions-template.csv"');
  return res.status(200).send(csv);
});

router.post('/import-transactions', async (req, res) => {
  const importMode = req.body.import_mode === 'replace' ? 'replace' : 'merge';
  const parsed = parseJson(req.body.import_json, 'Imported file is not valid JSON.');
  if (parsed.error) {
    return renderAdmin(res, {
      error: parsed.error,
      importMode,
      importJson: req.body.import_json || '',
      importCsv: req.body.import_csv || '',
      selectedCollection: 'transaction_records',
    });
  }

  const incoming = parsed.value;
  const incomingRecords = Array.isArray(incoming)
    ? incoming
    : Array.isArray(incoming.transaction_records)
      ? incoming.transaction_records
      : null;

  if (!Array.isArray(incomingRecords)) {
    return renderAdmin(res, {
      error: 'Import JSON must be an array or an object with transaction_records array.',
      importMode,
      importJson: req.body.import_json || '',
      importCsv: req.body.import_csv || '',
      selectedCollection: 'transaction_records',
    });
  }

  const backupPath = await store.backupData();
  const data = await store.getRawData();
  let imported = 0;
  let skipped = 0;

  if (importMode === 'replace') {
    data.transaction_records = incomingRecords.map(normalizeRecord);
    imported = data.transaction_records.length;
  } else {
    const existing = new Set((data.transaction_records || []).map(buildFingerprint));
    for (const record of incomingRecords) {
      const normalized = normalizeRecord(record);
      const fingerprint = buildFingerprint(normalized);
      if (existing.has(fingerprint)) {
        skipped += 1;
        continue;
      }
      data.transaction_records.push(normalized);
      existing.add(fingerprint);
      imported += 1;
    }
  }

  await store.replaceData(data);
  return renderAdmin(res, {
    success: `Transaction import completed. Imported ${imported}, skipped ${skipped}.`,
    backupPath,
    selectedCollection: 'transaction_records',
  });
});

router.post('/import-transactions-csv', async (req, res) => {
  const importMode = req.body.import_mode === 'replace' ? 'replace' : 'merge';
  const csvPayload = String(req.body.import_csv || '');

  let rows;
  try {
    rows = await parseCsvRows(csvPayload);
  } catch (error) {
    return renderAdmin(res, {
      error: `Imported file is not a valid CSV: ${error.message}`,
      importMode,
      importJson: req.body.import_json || '',
      importCsv: csvPayload,
      selectedCollection: 'transaction_records',
    });
  }

  const incomingRecords = rows
    .map(mapCsvRowToTransactionRecord)
    .filter((record) => Object.values(record).some(value => String(value || '').trim()));

  if (!incomingRecords.length) {
    return renderAdmin(res, {
      error: 'CSV import did not contain any transaction rows.',
      importMode,
      importJson: req.body.import_json || '',
      importCsv: csvPayload,
      selectedCollection: 'transaction_records',
    });
  }

  const backupPath = await store.backupData();
  const data = await store.getRawData();
  let imported = 0;
  let skipped = 0;

  if (importMode === 'replace') {
    data.transaction_records = incomingRecords.map(normalizeRecord);
    imported = data.transaction_records.length;
  } else {
    const existing = new Set((data.transaction_records || []).map(buildFingerprint));
    for (const record of incomingRecords) {
      const normalized = normalizeRecord(record);
      const fingerprint = buildFingerprint(normalized);
      if (existing.has(fingerprint)) {
        skipped += 1;
        continue;
      }
      data.transaction_records.push(normalized);
      existing.add(fingerprint);
      imported += 1;
    }
  }

  await store.replaceData(data);
  return renderAdmin(res, {
    success: `CSV transaction import completed. Imported ${imported}, skipped ${skipped}.`,
    backupPath,
    selectedCollection: 'transaction_records',
  });
});

router.post('/save-database', async (req, res) => {
  const parsed = parseJson(req.body.database_json, 'Database JSON is not valid.');
  if (parsed.error || !parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) {
    return renderAdmin(res, {
      error: parsed.error || 'Database JSON must be an object shaped like data.json.',
      selectedCollection: req.body.selected_collection,
    });
  }

  const backupPath = await store.backupData();
  await store.replaceData(parsed.value);
  return renderAdmin(res, {
    success: 'Full database JSON saved successfully.',
    backupPath,
    selectedCollection: req.body.selected_collection,
  });
});

router.post('/save-collection', async (req, res) => {
  const selectedCollection = ALLOWED_COLLECTIONS.includes(req.body.collection_name)
    ? req.body.collection_name
    : 'transaction_records';
  const parsed = parseJson(req.body.collection_json, 'Collection JSON is not valid.');

  if (parsed.error || !Array.isArray(parsed.value)) {
    return renderAdmin(res, {
      error: parsed.error || 'Collection JSON must be an array.',
      selectedCollection,
    });
  }

  const backupPath = await store.backupData();
  const data = await store.getRawData();
  data[selectedCollection] = parsed.value;
  await store.replaceData(data);
  return renderAdmin(res, {
    success: `${selectedCollection} saved successfully.`,
    backupPath,
    selectedCollection,
  });
});

module.exports = router;
