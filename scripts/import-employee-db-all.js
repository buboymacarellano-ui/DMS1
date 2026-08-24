/**
 * Replace the employee roster from employee-db-all.csv and rewrite
 * technician / employee names and IDs across stored records.
 *
 * Usage: node scripts/import-employee-db-all.js
 */
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const csvParser = require('csv-parser');
const { canonicalizeBranchName } = require('../lib/branches');

const ROOT = path.join(__dirname, '..');
const DATA_FILE = path.join(ROOT, 'data', 'data.json');
const CSV_FILE = path.join(ROOT, 'employee-db-all.csv');

function text(value) {
  return String(value == null ? '' : value).trim();
}

function normalizeHeader(value) {
  return text(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function displayName(employee) {
  const name = [employee.first_name, employee.middle_name, employee.last_name]
    .map(text)
    .filter(Boolean)
    .join(' ');
  const id = text(employee.employee_id);
  if (name && id) return `${name} (${id})`;
  return name || id;
}

function canonicalPerson(value) {
  return text(value)
    .replace(/\s*\([^)]+\)\s*$/, '')
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function extractId(value) {
  const match = text(value).match(/\(([^)]+)\)\s*$/);
  return match ? text(match[1]).toUpperCase() : text(value).toUpperCase();
}

const HEADER_MAP = {
  employeeid: 'employee_id',
  firstname: 'first_name',
  middlename: 'middle_name',
  lastname: 'last_name',
  preferredname: 'preferred_name',
  telephonenumber: 'work_phone',
  nationalid: 'national_id',
  dateofbirth: 'date_of_birth',
  genderidentity: 'gender_identity',
  workemail: 'work_email',
  personalemail: 'personal_email',
  workphone: 'work_phone',
  personalphone: 'personal_phone',
  residentialaddress: 'residential_address',
  city: 'city',
  stateprovince: 'state_province',
  postalcode: 'postal_code',
  country: 'country',
  emergencycontactname: 'emergency_contact_name',
  emergencycontactrelationship: 'emergency_contact_relationship',
  emergencycontactphone: 'emergency_contact_phone',
  employmentstatus: 'employment_status',
  employmenttype: 'employment_type',
  hiredate: 'hire_date',
  adjustedservicedate: 'adjusted_service_date',
  terminationdate: 'termination_date',
  terminationreason: 'termination_reason',
  jobtitle: 'job_title',
  jobcode: 'job_code',
  department: 'department_id_name',
  departmentidname: 'department_id_name',
  businessunitdivision: 'business_unit_division',
  worklocationbranch: 'work_location_branch_id',
  worklocationbranchid: 'work_location_branch_id',
  workmode: 'work_mode',
  managername: 'manager_name',
  manageremployeeid: 'manager_employee_id',
  payfrequency: 'pay_frequency',
  paystructure: 'pay_structure',
  basesalarypayrate: 'base_salary_pay_rate',
  currency: 'currency_code',
  currencycode: 'currency_code',
  flsaovertimeclassification: 'flsa_overtime_classification',
  bankname: 'bank_name',
  bankroutingswiftcode: 'bank_routing_swift_code',
  accountnumberencrypted: 'account_number_encrypted',
  taxfilingstatus: 'tax_filing_status',
  taxallowancewithholdingexemptions: 'tax_allowance_withholding_exemptions',
  healthinsuranceplanstatus: 'health_insurance_plan_status',
  retirementplanenrollmentstatus: 'retirement_plan_enrollment_status',
  ptobalance: 'pto_balance',
  sickleavebalance: 'sick_leave_balance',
  remarks1: 'remarks_1',
  remarks2: 'remarks_2',
  workauthorizationvisatype: 'remarks_1',
  visaexpirationdate: 'remarks_2',
  backgroundcheckstatus: 'background_check_status',
  backgroundcheckdate: 'background_check_date',
};

function parseCsv(filePath) {
  const payload = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  return new Promise((resolve, reject) => {
    const rows = [];
    Readable.from([payload])
      .pipe(csvParser())
      .on('data', (row) => rows.push(row))
      .on('end', () => resolve(rows))
      .on('error', reject);
  });
}

function mapCsvRow(row) {
  const mapped = {};
  Object.entries(row || {}).forEach(([header, value]) => {
    const key = HEADER_MAP[normalizeHeader(header)];
    if (!key) return;
    mapped[key] = text(value);
  });
  mapped.work_location_branch_id = canonicalizeBranchName(mapped.work_location_branch_id);
  mapped.base_salary_pay_rate = Number(mapped.base_salary_pay_rate) || 0;
  mapped.pto_balance = Number(mapped.pto_balance) || 0;
  mapped.sick_leave_balance = Number(mapped.sick_leave_balance) || 0;
  return mapped;
}

function rewritePerson(value, byOldId, byOldName) {
  const current = text(value);
  if (!current) return current;
  const id = extractId(current);
  if (id && byOldId.has(id)) return byOldId.get(id);
  const nameKey = canonicalPerson(current);
  if (nameKey && byOldName.has(nameKey)) return byOldName.get(nameKey);
  return current;
}

function rewriteId(value, byOldId) {
  const current = text(value);
  if (!current) return current;
  return byOldId.get(current.toUpperCase()) || current;
}

function remapRateMap(source, byOldId) {
  if (!source || typeof source !== 'object') return source;
  const next = {};
  Object.entries(source).forEach(([key, rate]) => {
    const mapped = byOldId.get(String(key).trim().toUpperCase()) || key;
    next[mapped] = rate;
  });
  return next;
}

async function main() {
  if (!fs.existsSync(CSV_FILE)) {
    throw new Error(`Missing ${CSV_FILE}`);
  }

  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  const existing = Array.isArray(data.employees) ? data.employees : [];
  const incoming = (await parseCsv(CSV_FILE))
    .map(mapCsvRow)
    .filter((row) => text(row.employee_id) && (text(row.first_name) || text(row.last_name)));

  if (!incoming.length) throw new Error('CSV did not contain employee rows.');

  const now = new Date().toISOString();
  const byOldId = new Map();
  const byOldName = new Map();
  const idToNewId = new Map();

  data.employees = incoming.map((row, index) => {
    const previous = existing[index] || {};
    const next = {
      ...previous,
      ...row,
      id: previous.id || `emp-${text(row.employee_id).toLowerCase()}`,
      created_at: previous.created_at || now,
      updated_at: now,
    };

    const oldId = text(previous.employee_id).toUpperCase();
    const newLabel = displayName(next);
    const newId = text(next.employee_id);
    if (oldId) {
      byOldId.set(oldId, newLabel);
      idToNewId.set(oldId, newId);
    }
    const oldNameKey = canonicalPerson(displayName(previous));
    if (oldNameKey) byOldName.set(oldNameKey, newLabel);
    return next;
  });

  const counts = {
    employees: data.employees.length,
    work_orders: 0,
    transaction_records: 0,
    technician_updates: 0,
    users: 0,
    service_advisors: 0,
  };

  (data.work_orders || []).forEach((row) => {
    const beforeTech = text(row.technician);
    const afterTech = rewritePerson(beforeTech, byOldId, byOldName);
    if (afterTech !== beforeTech) {
      row.technician = afterTech;
      counts.work_orders += 1;
    }
    const beforeSa = text(row.service_advisor);
    const afterSa = rewritePerson(beforeSa, byOldId, byOldName);
    if (afterSa !== beforeSa) {
      row.service_advisor = afterSa;
      counts.service_advisors += 1;
    }
  });

  (data.transaction_records || []).forEach((row) => {
    let changed = false;
    ['Tecnician', 'Technician', 'Service Advisor', 'service_advisor'].forEach((field) => {
      if (row[field] == null) return;
      const before = text(row[field]);
      const after = rewritePerson(before, byOldId, byOldName);
      if (after !== before) {
        row[field] = after;
        changed = true;
      }
    });
    if (changed) counts.transaction_records += 1;
  });

  (data.technician_updates || []).forEach((row) => {
    const before = text(row.technician_name);
    const after = rewritePerson(before, byOldId, byOldName);
    if (after !== before) {
      row.technician_name = after;
      counts.technician_updates += 1;
    }
  });

  (data.users || []).forEach((user) => {
    let changed = false;
    const beforeTechName = text(user.technician_name);
    const afterTechName = rewritePerson(beforeTechName, byOldId, byOldName);
    if (afterTechName !== beforeTechName) {
      user.technician_name = afterTechName;
      changed = true;
    }
    const beforeSrName = text(user.receptionist_name);
    const afterSrName = rewritePerson(beforeSrName, byOldId, byOldName);
    if (afterSrName !== beforeSrName) {
      user.receptionist_name = afterSrName;
      changed = true;
    }
    const beforeTechId = text(user.technician_employee_id);
    const afterTechId = rewriteId(beforeTechId, idToNewId);
    if (afterTechId !== beforeTechId) {
      user.technician_employee_id = afterTechId;
      changed = true;
    }
    const beforeSrId = text(user.receptionist_employee_id);
    const afterSrId = rewriteId(beforeSrId, idToNewId);
    if (afterSrId !== beforeSrId) {
      user.receptionist_employee_id = afterSrId;
      changed = true;
    }
    if (user.branch) {
      const nextBranch = canonicalizeBranchName(user.branch);
      if (nextBranch !== user.branch) {
        user.branch = nextBranch;
        changed = true;
      }
    }
    const username = text(user.username);
    if (username && beforeTechName && username === beforeTechName && afterTechName) {
      user.username = afterTechName;
      changed = true;
    }
    if (username && beforeSrName && username === beforeSrName && afterSrName) {
      user.username = afterSrName;
      changed = true;
    }
    if (changed) counts.users += 1;
  });

  (data.approval_requests || []).forEach((row) => {
    if (row.employee_id) row.employee_id = rewriteId(row.employee_id, idToNewId);
    if (row.employee_name) row.employee_name = rewritePerson(row.employee_name, byOldId, byOldName);
    if (row.current_branch) row.current_branch = canonicalizeBranchName(row.current_branch);
    if (row.target_branch) row.target_branch = canonicalizeBranchName(row.target_branch);
  });

  if (data.pricing_settings && typeof data.pricing_settings === 'object') {
    if (data.pricing_settings.technician_incentive_rates) {
      data.pricing_settings.technician_incentive_rates = remapRateMap(
        data.pricing_settings.technician_incentive_rates,
        idToNewId
      );
    }
    if (data.pricing_settings.employee_incentive_rates) {
      data.pricing_settings.employee_incentive_rates = remapRateMap(
        data.pricing_settings.employee_incentive_rates,
        idToNewId
      );
    }
  }

  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
  console.log(JSON.stringify({
    catalog: 'Carx2, Carmen, CebuCity, Lapux2, Bogo, Toledo, ITPark',
    ...counts,
    sample: data.employees.slice(0, 3).map((row) => `${row.employee_id} ${displayName(row)} @ ${row.work_location_branch_id}`),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
