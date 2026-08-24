const express = require('express');
const csvParser = require('csv-parser');
const { Readable } = require('stream');
const store = require('../data/store');
const { canonicalizeBranchName } = require('../lib/branches');

const router = express.Router();

const EMPLOYMENT_STATUSES = ['Active', 'Terminated', 'On Leave'];
const EMPLOYMENT_TYPES = ['Full-Time', 'Part-Time', 'Contractor', 'Intern'];
const TERMINATION_REASONS = ['Voluntary', 'Involuntary', 'Retirement'];
const WORK_MODES = ['On-site', 'Remote', 'Hybrid'];
const PAY_FREQUENCIES = ['Bi-weekly', 'Monthly', 'Semi-monthly'];
const PAY_STRUCTURES = ['Salaried', 'Hourly', 'Commission-based'];
const FLSA_TYPES = ['Exempt', 'Non-Exempt'];
const EMPLOYEE_FIELD_OPTIONS = [
  { key: 'employee_id', label: 'Employee ID' },
  { key: 'first_name', label: 'First Name' },
  { key: 'middle_name', label: 'Middle Name' },
  { key: 'last_name', label: 'Last Name' },
  { key: 'preferred_name', label: 'Preferred Name' },
  { key: 'national_id', label: 'National ID' },
  { key: 'date_of_birth', label: 'Date of Birth' },
  { key: 'gender_identity', label: 'Gender Identity' },
  { key: 'work_email', label: 'Work Email' },
  { key: 'personal_email', label: 'Personal Email' },
  { key: 'work_phone', label: 'Work Phone' },
  { key: 'personal_phone', label: 'Personal Phone' },
  { key: 'residential_address', label: 'Residential Address' },
  { key: 'city', label: 'City' },
  { key: 'state_province', label: 'State / Province' },
  { key: 'postal_code', label: 'Postal Code' },
  { key: 'country', label: 'Country' },
  { key: 'emergency_contact_name', label: 'Emergency Contact Name' },
  { key: 'emergency_contact_relationship', label: 'Emergency Contact Relationship' },
  { key: 'emergency_contact_phone', label: 'Emergency Contact Phone' },
  { key: 'employment_status', label: 'Employment Status' },
  { key: 'employment_type', label: 'Employment Type' },
  { key: 'hire_date', label: 'Hire Date' },
  { key: 'adjusted_service_date', label: 'Adjusted Service Date' },
  { key: 'termination_date', label: 'Termination Date' },
  { key: 'termination_reason', label: 'Termination Reason' },
  { key: 'job_title', label: 'Job Title' },
  { key: 'job_code', label: 'Job Code' },
  { key: 'department_id_name', label: 'Department' },
  { key: 'business_unit_division', label: 'Business Unit / Division' },
  { key: 'work_location_branch_id', label: 'Work Location / Branch' },
  { key: 'work_mode', label: 'Work Mode' },
  { key: 'manager_name', label: 'Manager Name' },
  { key: 'manager_employee_id', label: 'Manager Employee ID' },
  { key: 'pay_frequency', label: 'Pay Frequency' },
  { key: 'pay_structure', label: 'Pay Structure' },
  { key: 'base_salary_pay_rate', label: 'Base Salary / Pay Rate' },
  { key: 'currency_code', label: 'Currency' },
  { key: 'flsa_overtime_classification', label: 'FLSA / Overtime Classification' },
  { key: 'bank_name', label: 'Bank Name' },
  { key: 'bank_routing_swift_code', label: 'Bank Routing / SWIFT Code' },
  { key: 'account_number_encrypted', label: 'Account Number Encrypted' },
  { key: 'tax_filing_status', label: 'Tax Filing Status' },
  { key: 'tax_allowance_withholding_exemptions', label: 'Tax Allowance / Withholding Exemptions' },
  { key: 'health_insurance_plan_status', label: 'Health Insurance Plan Status' },
  { key: 'retirement_plan_enrollment_status', label: 'Retirement Plan Enrollment Status' },
  { key: 'pto_balance', label: 'PTO Balance' },
  { key: 'sick_leave_balance', label: 'Sick Leave Balance' },
  { key: 'remarks_1', label: 'Remarks 1' },
  { key: 'remarks_2', label: 'Remarks 2' },
  { key: 'background_check_status', label: 'Background Check Status' },
  { key: 'background_check_date', label: 'Background Check Date' },
];

const EMPLOYEE_EXPORT_COLUMNS = EMPLOYEE_FIELD_OPTIONS;

function stripBom(text) {
  return String(text || '').replace(/^\uFEFF/, '');
}

function normalizeCsvHeader(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function buildEmployeeCsvHeaderAliases() {
  const aliases = {};

  EMPLOYEE_FIELD_OPTIONS.forEach((field) => {
    aliases[normalizeCsvHeader(field.key)] = field.key;
    aliases[normalizeCsvHeader(field.label)] = field.key;
  });

  aliases.workauthorizationvisatype = 'remarks_1';
  aliases.visaexpirationdate = 'remarks_2';
  aliases.remarks1 = 'remarks_1';
  aliases.remarks2 = 'remarks_2';
  aliases.telephonenumber = 'work_phone';

  return aliases;
}

const EMPLOYEE_CSV_HEADER_ALIASES = buildEmployeeCsvHeaderAliases();

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

function mapCsvRowToEmployeeRecord(row) {
  const mapped = {};

  Object.entries(row || {}).forEach(([header, value]) => {
    const key = EMPLOYEE_CSV_HEADER_ALIASES[normalizeCsvHeader(header)];
    if (!key) return;
    mapped[key] = String(value == null ? '' : value).trim();
  });

  return mapped;
}

function employeeCsvFingerprint(record) {
  return String(record.employee_id || '').trim().toLowerCase();
}

function normalizeEmployeeImportRecord(record) {
  const normalized = buildEmployeeFromBody(record || {});
  normalized.id = String(record && record.id ? record.id : '').trim() || genId();
  normalized.created_at = String(record && record.created_at ? record.created_at : '').trim() || new Date().toISOString();
  return normalized;
}

function csvValue(value) {
  const text = String(value == null ? '' : value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function getSelectionCriteria(query) {
  const criteria = [];

  for (let index = 1; index <= 15; index += 1) {
    const field = normalizeText(query[`field_${index}`]);
    const value = normalizeText(query[`value_${index}`]);
    if (!field || !value) continue;
    criteria.push({ field, value });
  }

  return criteria;
}

function matchesSelection(employee, criteria, searchTerm) {
  const matchesSearch = !searchTerm || [
    employee.employee_id,
    employee.first_name,
    employee.middle_name,
    employee.last_name,
    employee.preferred_name,
    employee.work_email,
    employee.personal_email,
    employee.job_title,
    employee.department_id_name,
    employee.work_location_branch_id,
    employee.manager_name,
  ].some((value) => String(value || '').toLowerCase().includes(searchTerm));

  if (!matchesSearch) {
    return false;
  }

  return criteria.every(({ field, value }) => {
    const fieldValue = String(employee[field] == null ? '' : employee[field]).toLowerCase();
    return fieldValue.includes(String(value).toLowerCase());
  });
}

function buildExportRows(employees, criteria, searchTerm) {
  const filtered = criteria.length || searchTerm
    ? employees.filter((employee) => matchesSelection(employee, criteria, searchTerm))
    : employees;

  const headers = EMPLOYEE_EXPORT_COLUMNS.map((column) => column.label);
  const rows = [headers.map(csvValue).join(',')];

  filtered.forEach((employee) => {
    rows.push(
      EMPLOYEE_EXPORT_COLUMNS.map((column) => csvValue(employee[column.key])).join(',')
    );
  });

  return { filtered, rows };
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function normalizeText(value) {
  return String(value || '').trim();
}

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function buildEmployeeFromBody(body, existing = {}) {
  return {
    employee_id: normalizeText(body.employee_id) || normalizeText(existing.employee_id),
    first_name: normalizeText(body.first_name),
    middle_name: normalizeText(body.middle_name),
    last_name: normalizeText(body.last_name),
    preferred_name: normalizeText(body.preferred_name),
    national_id: normalizeText(body.national_id),
    date_of_birth: normalizeText(body.date_of_birth),
    gender_identity: normalizeText(body.gender_identity),
    work_email: normalizeText(body.work_email),
    personal_email: normalizeText(body.personal_email),
    work_phone: normalizeText(body.work_phone),
    personal_phone: normalizeText(body.personal_phone),
    residential_address: normalizeText(body.residential_address),
    city: normalizeText(body.city),
    state_province: normalizeText(body.state_province),
    postal_code: normalizeText(body.postal_code),
    country: normalizeText(body.country),
    emergency_contact_name: normalizeText(body.emergency_contact_name),
    emergency_contact_relationship: normalizeText(body.emergency_contact_relationship),
    emergency_contact_phone: normalizeText(body.emergency_contact_phone),
    employment_status: normalizeText(body.employment_status),
    employment_type: normalizeText(body.employment_type),
    hire_date: normalizeText(body.hire_date),
    adjusted_service_date: normalizeText(body.adjusted_service_date),
    termination_date: normalizeText(body.termination_date),
    termination_reason: normalizeText(body.termination_reason),
    job_title: normalizeText(body.job_title),
    job_code: normalizeText(body.job_code),
    department_id_name: normalizeText(body.department_id_name),
    business_unit_division: normalizeText(body.business_unit_division),
    work_location_branch_id: canonicalizeBranchName(normalizeText(body.work_location_branch_id)),
    work_mode: normalizeText(body.work_mode),
    manager_name: normalizeText(body.manager_name),
    manager_employee_id: normalizeText(body.manager_employee_id),
    pay_frequency: normalizeText(body.pay_frequency),
    pay_structure: normalizeText(body.pay_structure),
    base_salary_pay_rate: toNumber(body.base_salary_pay_rate),
    currency_code: normalizeText(body.currency_code),
    flsa_overtime_classification: normalizeText(body.flsa_overtime_classification),
    bank_name: normalizeText(body.bank_name),
    bank_routing_swift_code: normalizeText(body.bank_routing_swift_code),
    account_number_encrypted: normalizeText(body.account_number_encrypted),
    tax_filing_status: normalizeText(body.tax_filing_status),
    tax_allowance_withholding_exemptions: normalizeText(body.tax_allowance_withholding_exemptions),
    health_insurance_plan_status: normalizeText(body.health_insurance_plan_status),
    retirement_plan_enrollment_status: normalizeText(body.retirement_plan_enrollment_status),
    pto_balance: toNumber(body.pto_balance),
    sick_leave_balance: toNumber(body.sick_leave_balance),
    remarks_1: normalizeText(body.remarks_1 || body.work_authorization_visa_type),
    remarks_2: normalizeText(body.remarks_2 || body.visa_expiration_date),
    background_check_status: normalizeText(body.background_check_status),
    background_check_date: normalizeText(body.background_check_date),
  };
}

router.get('/', async (req, res) => {
  const employees = await store.getAll('employees');
  const q = String(req.query.q || '').trim().toLowerCase();
  const criteria = getSelectionCriteria(req.query);
  const filtered = employees.filter((employee) => matchesSelection(employee, criteria, q));

  const filterSlots = Array.from({ length: 15 }, (_, index) => ({
    field: normalizeText(req.query[`field_${index + 1}`]),
    value: normalizeText(req.query[`value_${index + 1}`]),
  }));

  res.render('employees/index', {
    employees: filtered,
    total: employees.length,
    filteredCount: filtered.length,
    q,
    filterSlots,
    employeeFieldOptions: EMPLOYEE_FIELD_OPTIONS,
    error: req.query.error || '',
    success: req.query.success || '',
    importMode: 'replace',
    importCsv: '',
    importError: '',
    importSuccess: '',
  });
});

router.get('/export.csv', async (req, res) => {
  const employees = await store.getAll('employees');
  const mode = String(req.query.mode || 'selected').toLowerCase();
  const q = String(req.query.q || '').trim().toLowerCase();
  const criteria = mode === 'all' ? [] : getSelectionCriteria(req.query);
  const { rows } = buildExportRows(employees, criteria, mode === 'all' ? '' : q);
  const filename = mode === 'all' ? 'employee-db-all.csv' : 'employee-db-selected.csv';

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.status(200).send(rows.join('\n'));
});

router.post('/import-csv', async (req, res) => {
  const importMode = String(req.body.import_mode || 'replace').toLowerCase() === 'merge' ? 'merge' : 'replace';
  const csvPayload = String(req.body.import_csv || '');

  let rows;
  try {
    rows = await parseCsvRows(csvPayload);
  } catch (error) {
    const employees = await store.getAll('employees');
    const filterSlots = Array.from({ length: 15 }, (_, index) => ({
      field: normalizeText(req.body[`field_${index + 1}`]),
      value: normalizeText(req.body[`value_${index + 1}`]),
    }));

    return res.status(400).render('employees/index', {
      employees,
      total: employees.length,
      filteredCount: employees.length,
      q: '',
      filterSlots,
      employeeFieldOptions: EMPLOYEE_FIELD_OPTIONS,
      error: `Imported CSV is not valid: ${error.message}`,
      success: '',
      importError: `Imported CSV is not valid: ${error.message}`,
      importSuccess: '',
      importCsv: csvPayload,
      importMode,
      safeFilteredCount: employees.length,
    });
  }

  const incomingRecords = rows
    .map(mapCsvRowToEmployeeRecord)
    .filter((record) => Object.values(record).some((value) => String(value || '').trim()));

  if (!incomingRecords.length) {
    const employees = await store.getAll('employees');
    const filterSlots = Array.from({ length: 15 }, (_, index) => ({
      field: normalizeText(req.body[`field_${index + 1}`]),
      value: normalizeText(req.body[`value_${index + 1}`]),
    }));

    return res.status(400).render('employees/index', {
      employees,
      total: employees.length,
      filteredCount: employees.length,
      q: '',
      filterSlots,
      employeeFieldOptions: EMPLOYEE_FIELD_OPTIONS,
      error: 'CSV import did not contain any employee rows.',
      success: '',
      importError: 'CSV import did not contain any employee rows.',
      importSuccess: '',
      importCsv: csvPayload,
      importMode,
      safeFilteredCount: employees.length,
    });
  }

  const backupPath = await store.backupData();
  const data = await store.getRawData();
  let imported = 0;
  let skipped = 0;

  if (importMode === 'replace') {
    data.employees = incomingRecords.map(normalizeEmployeeImportRecord);
    imported = data.employees.length;
  } else {
    const existing = new Set((data.employees || []).map(employeeCsvFingerprint).filter(Boolean));

    for (const row of incomingRecords) {
      const normalized = normalizeEmployeeImportRecord(row);
      const fingerprint = employeeCsvFingerprint(normalized);
      if (!fingerprint) {
        skipped += 1;
        continue;
      }
      if (existing.has(fingerprint)) {
        skipped += 1;
        continue;
      }
      data.employees.push(normalized);
      existing.add(fingerprint);
      imported += 1;
    }
  }

  await store.replaceData(data);

  const employees = await store.getAll('employees');
  const filterSlots = Array.from({ length: 15 }, (_, index) => ({
    field: normalizeText(req.body[`field_${index + 1}`]),
    value: normalizeText(req.body[`value_${index + 1}`]),
  }));

  return res.render('employees/index', {
    employees,
    total: employees.length,
    filteredCount: employees.length,
    q: '',
    filterSlots,
    employeeFieldOptions: EMPLOYEE_FIELD_OPTIONS,
    error: '',
    success: `Employee CSV import completed. Imported ${imported}, skipped ${skipped}. Backup saved.`,
    importError: '',
    importSuccess: `Employee CSV import completed. Imported ${imported}, skipped ${skipped}. Backup saved.`,
    importCsv: '',
    importMode,
    safeFilteredCount: employees.length,
    backupPath,
  });
});

router.get('/new', (req, res) => {
  res.render('employees/new', {
    statuses: EMPLOYMENT_STATUSES,
    types: EMPLOYMENT_TYPES,
    terminationReasons: TERMINATION_REASONS,
    workModes: WORK_MODES,
    payFrequencies: PAY_FREQUENCIES,
    payStructures: PAY_STRUCTURES,
    flsaTypes: FLSA_TYPES,
    error: '',
    prefill: {},
  });
});

router.post('/new', async (req, res) => {
  const body = req.body;
  const employee_id = normalizeText(body.employee_id);
  const first_name = normalizeText(body.first_name);
  const last_name = normalizeText(body.last_name);
  const employment_status = normalizeText(body.employment_status);
  const employment_type = normalizeText(body.employment_type);

  const errors = [];
  if (!employee_id) errors.push('Employee ID is required.');
  if (!first_name) errors.push('First Name is required.');
  if (!last_name) errors.push('Last Name is required.');
  if (!EMPLOYMENT_STATUSES.includes(employment_status)) errors.push('Employment Status is invalid.');
  if (!EMPLOYMENT_TYPES.includes(employment_type)) errors.push('Employment Type is invalid.');

  const employees = await store.getAll('employees');
  if (employees.some((employee) => normalizeText(employee.employee_id) === employee_id)) {
    errors.push('Employee ID already exists.');
  }

  if (errors.length) {
    return res.status(400).render('employees/new', {
      statuses: EMPLOYMENT_STATUSES,
      types: EMPLOYMENT_TYPES,
      terminationReasons: TERMINATION_REASONS,
      workModes: WORK_MODES,
      payFrequencies: PAY_FREQUENCIES,
      payStructures: PAY_STRUCTURES,
      flsaTypes: FLSA_TYPES,
      error: errors.join(' '),
      prefill: body,
    });
  }

  const record = Object.assign({
    id: genId(),
    created_at: new Date().toISOString(),
  }, buildEmployeeFromBody(body));

  const data = await store.getRawData();
  data.employees.push(record);
  await store.replaceData(data);

  res.redirect('/employees?success=Employee+saved.');
});

router.get('/:id/edit', async (req, res) => {
  const employee = await store.getById('employees', req.params.id);
  if (!employee) return res.redirect('/employees?error=Record+not+found.');

  res.render('employees/edit', {
    employee,
    statuses: EMPLOYMENT_STATUSES,
    types: EMPLOYMENT_TYPES,
    terminationReasons: TERMINATION_REASONS,
    workModes: WORK_MODES,
    payFrequencies: PAY_FREQUENCIES,
    payStructures: PAY_STRUCTURES,
    flsaTypes: FLSA_TYPES,
    error: req.query.error || '',
    success: req.query.success || '',
  });
});

router.post('/:id/edit', async (req, res) => {
  const existing = await store.getById('employees', req.params.id);
  if (!existing) return res.redirect('/employees?error=Record+not+found.');

  const body = req.body;
  const employee_id = normalizeText(body.employee_id);
  const first_name = normalizeText(body.first_name);
  const last_name = normalizeText(body.last_name);
  const employment_status = normalizeText(body.employment_status);
  const employment_type = normalizeText(body.employment_type);

  const errors = [];
  if (!employee_id) errors.push('Employee ID is required.');
  if (!first_name) errors.push('First Name is required.');
  if (!last_name) errors.push('Last Name is required.');
  if (!EMPLOYMENT_STATUSES.includes(employment_status)) errors.push('Employment Status is invalid.');
  if (!EMPLOYMENT_TYPES.includes(employment_type)) errors.push('Employment Type is invalid.');

  const employees = await store.getAll('employees');
  if (employees.some((employee) => normalizeText(employee.employee_id) === employee_id && employee.id !== req.params.id)) {
    errors.push('Employee ID already exists.');
  }

  if (errors.length) {
    return res.status(400).render('employees/edit', {
      employee: Object.assign({}, existing, body),
      statuses: EMPLOYMENT_STATUSES,
      types: EMPLOYMENT_TYPES,
      terminationReasons: TERMINATION_REASONS,
      workModes: WORK_MODES,
      payFrequencies: PAY_FREQUENCIES,
      payStructures: PAY_STRUCTURES,
      flsaTypes: FLSA_TYPES,
      error: errors.join(' '),
      success: '',
    });
  }

  const patch = Object.assign({}, buildEmployeeFromBody(body, existing), {
    updated_at: new Date().toISOString(),
  });

  await store.update('employees', req.params.id, patch);
  res.redirect('/employees?success=Employee+updated.');
});

router.post('/:id/delete', async (req, res) => {
  await store.remove('employees', req.params.id);
  res.redirect('/employees?success=Employee+deleted.');
});

module.exports = router;
