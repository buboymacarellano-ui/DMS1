/**
 * Rebuilds employee-db-all.csv from the last known employee roster backup,
 * then runs scripts/import-employee-db-all.js so the live store is wired again.
 *
 * Usage: node scripts/restore-employee-db-from-backup.js
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const CSV_FILE = path.join(ROOT, 'employee-db-all.csv');
const BACKUP_FILE = path.join(
  ROOT,
  'data',
  'data.backup.branches-migration.2026-08-13T02-55-49-660Z.json'
);

const COLUMNS = [
  ['employee_id', 'Employee ID'],
  ['first_name', 'First Name'],
  ['middle_name', 'Middle Name'],
  ['last_name', 'Last Name'],
  ['preferred_name', 'Preferred Name'],
  ['national_id', 'National ID'],
  ['date_of_birth', 'Date of Birth'],
  ['gender_identity', 'Gender Identity'],
  ['work_email', 'Work Email'],
  ['personal_email', 'Personal Email'],
  ['work_phone', 'Work Phone'],
  ['personal_phone', 'Personal Phone'],
  ['residential_address', 'Residential Address'],
  ['city', 'City'],
  ['state_province', 'State / Province'],
  ['postal_code', 'Postal Code'],
  ['country', 'Country'],
  ['emergency_contact_name', 'Emergency Contact Name'],
  ['emergency_contact_relationship', 'Emergency Contact Relationship'],
  ['emergency_contact_phone', 'Emergency Contact Phone'],
  ['employment_status', 'Employment Status'],
  ['employment_type', 'Employment Type'],
  ['hire_date', 'Hire Date'],
  ['adjusted_service_date', 'Adjusted Service Date'],
  ['termination_date', 'Termination Date'],
  ['termination_reason', 'Termination Reason'],
  ['job_title', 'Job Title'],
  ['job_code', 'Job Code'],
  ['department_id_name', 'Department'],
  ['business_unit_division', 'Business Unit / Division'],
  ['work_location_branch_id', 'Work Location / Branch'],
  ['work_mode', 'Work Mode'],
  ['manager_name', 'Manager Name'],
  ['manager_employee_id', 'Manager Employee ID'],
  ['pay_frequency', 'Pay Frequency'],
  ['pay_structure', 'Pay Structure'],
  ['base_salary_pay_rate', 'Base Salary / Pay Rate'],
  ['currency_code', 'Currency'],
  ['flsa_overtime_classification', 'FLSA / Overtime Classification'],
  ['bank_name', 'Bank Name'],
  ['bank_routing_swift_code', 'Bank Routing / SWIFT Code'],
  ['account_number_encrypted', 'Account Number Encrypted'],
  ['tax_filing_status', 'Tax Filing Status'],
  ['tax_allowance_withholding_exemptions', 'Tax Allowance / Withholding Exemptions'],
  ['health_insurance_plan_status', 'Health Insurance Plan Status'],
  ['retirement_plan_enrollment_status', 'Retirement Plan Enrollment Status'],
  ['pto_balance', 'PTO Balance'],
  ['sick_leave_balance', 'Sick Leave Balance'],
  ['remarks_1', 'Remarks 1'],
  ['remarks_2', 'Remarks 2'],
  ['background_check_status', 'Background Check Status'],
  ['background_check_date', 'Background Check Date'],
];

function csvValue(value) {
  const text = String(value == null ? '' : value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function main() {
  if (!fs.existsSync(BACKUP_FILE)) {
    throw new Error(`Missing backup: ${BACKUP_FILE}`);
  }

  const backup = JSON.parse(fs.readFileSync(BACKUP_FILE, 'utf8'));
  const employees = Array.isArray(backup.employees) ? backup.employees : [];
  if (!employees.length) {
    throw new Error('Backup does not contain employee rows.');
  }

  const lines = [COLUMNS.map(([, label]) => csvValue(label)).join(',')];
  employees.forEach((employee) => {
    lines.push(COLUMNS.map(([key]) => csvValue(employee[key])).join(','));
  });
  fs.writeFileSync(CSV_FILE, `${lines.join('\n')}\n`, 'utf8');

  const imported = spawnSync(process.execPath, [path.join(__dirname, 'import-employee-db-all.js')], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (imported.stdout) process.stdout.write(imported.stdout);
  if (imported.stderr) process.stderr.write(imported.stderr);
  if (imported.status) {
    throw new Error(`import-employee-db-all.js exited ${imported.status}`);
  }

  console.log(JSON.stringify({
    csv: 'employee-db-all.csv',
    source: path.basename(BACKUP_FILE),
    rows: employees.length,
  }));
}

main();
