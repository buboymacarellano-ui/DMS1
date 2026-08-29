/**
 * Authorize login against the employee-db-all roster.
 * Required panel: Department, Role, Employee ID, Location, password PW123456.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');
const csvParser = require('csv-parser');
const portals = require('./portals');
const { canonicalizeBranchName, normalizeBranchKey } = require('./branches');
const {
  accountEmployeeId,
  employeeDisplayName,
  employeeBranch,
  isFrontlineRole,
  isReceptionistFamily,
  normalizeEmployeeId,
} = require('./frontline-roles');

const SHOP_PASSWORD = 'PW123456';
const PASSWORD_ITERATIONS = 120000;
const CSV_FILE = path.join(__dirname, '..', 'employee-db-all.csv');
const PASSWORD_FLAG = 'PW123456';

const HEADER_MAP = {
  employeeid: 'employee_id',
  firstname: 'first_name',
  middlename: 'middle_name',
  lastname: 'last_name',
  preferredname: 'preferred_name',
  jobtitle: 'job_title',
  jobcode: 'job_code',
  department: 'department_id_name',
  departmentidname: 'department_id_name',
  worklocationbranch: 'work_location_branch_id',
  worklocationbranchid: 'work_location_branch_id',
  employmentstatus: 'employment_status',
  employmenttype: 'employment_type',
  workemail: 'work_email',
  workphone: 'work_phone',
  telephonenumber: 'work_phone',
};

function text(value) {
  return String(value == null ? '' : value).trim();
}

function normalizeHeader(value) {
  return text(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizeUsername(value) {
  return text(value).toUpperCase();
}

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(String(password || ''), salt, PASSWORD_ITERATIONS, 64, 'sha512').toString('hex');
}

function verifyPassword(password, salt, expectedHash) {
  if (!salt || !expectedHash) return false;
  const actualHash = hashPassword(password, salt);
  const expected = String(expectedHash);
  if (actualHash.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(actualHash), Buffer.from(expected));
  } catch (_error) {
    return false;
  }
}

function isShopPassword(password) {
  const left = Buffer.from(String(password || ''));
  const right = Buffer.from(SHOP_PASSWORD);
  if (left.length !== right.length) return false;
  try {
    return crypto.timingSafeEqual(left, right);
  } catch (_error) {
    return false;
  }
}

function passwordAccepted(password, account) {
  if (isShopPassword(password)) return true;
  if (!account) return false;
  if (account.password_enabled === false) return false;
  return verifyPassword(password, account.password_salt, account.password_hash);
}

function applyShopPassword(user) {
  const salt = crypto.randomBytes(16).toString('hex');
  user.password_salt = salt;
  user.password_hash = hashPassword(SHOP_PASSWORD, salt);
  user.password_enabled = true;
  return user;
}

function isActiveEmployee(employee) {
  const status = text(employee && employee.employment_status).toLowerCase();
  if (!status) return true;
  return status !== 'terminated' && status !== 'inactive' && status !== 'resigned';
}

function loginRoles() {
  const roles = [];
  Object.values(portals.ROLES_BY_DEPARTMENT || {}).forEach((list) => {
    (list || []).forEach((item) => {
      if (item && item.key && roles.indexOf(item.key) === -1) roles.push(item.key);
    });
  });
  return roles;
}

function portalRoleForEmployee(employee) {
  return loginRoles().find((role) => portals.employeeMatchesPortalRole(employee, role)) || '';
}

function locationsMatch(department, selected, assigned) {
  const left = portals.canonicalizeLocation(department, selected);
  const right = portals.canonicalizeLocation(department, assigned);
  if (!left || !right) return false;
  if (String(left).toLowerCase() === String(right).toLowerCase()) return true;
  const leftBranch = canonicalizeBranchName(left);
  const rightBranch = canonicalizeBranchName(right);
  if (!leftBranch || !rightBranch) return false;
  return normalizeBranchKey(leftBranch) === normalizeBranchKey(rightBranch);
}

function findEmployeeById(employees, loginInput) {
  const employeeId = normalizeEmployeeId(loginInput);
  if (!employeeId) return null;
  return (employees || []).find((employee) => normalizeEmployeeId(employee && employee.employee_id) === employeeId) || null;
}

function findAccountForEmployee(users, employee, role, loginInput) {
  const employeeId = normalizeEmployeeId((employee && employee.employee_id) || loginInput);
  const username = normalizeUsername(loginInput);
  return (users || []).find((user) => {
    if (!portals.accountRoleMatches(user.role, role)) return false;
    const accountId = accountEmployeeId(user)
      || normalizeEmployeeId(user.employee_id || user.technician_employee_id || user.receptionist_employee_id || user.stm_employee_id);
    if (employeeId && accountId === employeeId) return true;
    return normalizeUsername(user.username) === username;
  }) || null;
}

function authorizeEmployeeLogin({
  employees,
  users,
  department,
  role,
  loginInput,
  location,
  password,
}) {
  const employeeId = normalizeEmployeeId(loginInput);
  const matchedEmployee = findEmployeeById(employees, loginInput);
  if (!matchedEmployee) {
    return { ok: false, status: 401, error: 'Employee ID was not found in Employee DB.' };
  }
  if (!isActiveEmployee(matchedEmployee)) {
    return { ok: false, status: 403, error: 'This employee ID is not active in Employee DB.' };
  }
  if (!portals.employeeMatchesPortalRole(matchedEmployee, role)) {
    return { ok: false, status: 403, error: 'This employee ID is not listed for the selected role in Employee DB.' };
  }
  const assigned = employeeBranch(matchedEmployee);
  if (!assigned) {
    return { ok: false, status: 403, error: 'This employee ID has no assigned location in Employee DB.' };
  }
  if (!locationsMatch(department, location, assigned)) {
    return { ok: false, status: 403, error: 'Selected location must match this employee ID in Employee DB.' };
  }

  const account = findAccountForEmployee(users, matchedEmployee, role, loginInput);
  if (!passwordAccepted(password, account)) {
    return { ok: false, status: 401, error: 'Invalid password.' };
  }
  if (account && account.password_enabled === false) {
    return { ok: false, status: 403, error: 'This account password is disabled. Contact HR.' };
  }

  return {
    ok: true,
    employee: matchedEmployee,
    account,
    employeeId,
    location: portals.canonicalizeLocation(department, location) || assigned,
  };
}

function sessionFromEmployee({ employee, account, role, department, location, loginInput }) {
  const liveName = employeeDisplayName(employee) || (account && account.username) || text(loginInput);
  const liveEmployeeId = normalizeEmployeeId(employee && employee.employee_id) || normalizeEmployeeId(loginInput);
  const sessionBranch = location || employeeBranch(employee);
  return {
    id: (account && account.id) || `emp-login-${liveEmployeeId || role}`,
    username: liveName,
    role: role === portals.ROLE_HR ? portals.ROLE_HR_MANAGER : role,
    technician_name: role === portals.ROLE_TECHNICIAN ? liveName : (account && account.technician_name) || '',
    technician_employee_id: role === portals.ROLE_TECHNICIAN ? liveEmployeeId : (account && account.technician_employee_id) || '',
    employee_id: liveEmployeeId,
    receptionist_employee_id: isReceptionistFamily(role) ? liveEmployeeId : (account && account.receptionist_employee_id) || '',
    receptionist_name: isFrontlineRole(role) ? liveName : (account && account.receptionist_name) || '',
    job_code: text(employee && employee.job_code) || (account && account.job_code) || '',
    branch: sessionBranch,
    location: sessionBranch,
    department,
  };
}

function parseCsv(filePath) {
  const payload = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  return new Promise((resolve, reject) => {
    const rows = [];
    Readable.from([payload])
      .pipe(csvParser())
      .on('data', (row) => rows.push(row))
      .on('error', reject)
      .on('end', () => resolve(rows));
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
  return mapped;
}

function mergeEmployees(existing, incoming) {
  const now = new Date().toISOString();
  const byId = new Map();
  (existing || []).forEach((row) => {
    const id = normalizeEmployeeId(row && row.employee_id);
    if (id) byId.set(id, row);
  });
  incoming.forEach((row) => {
    const employeeId = normalizeEmployeeId(row.employee_id);
    if (!employeeId || !(text(row.first_name) || text(row.last_name))) return;
    const previous = byId.get(employeeId) || {};
    byId.set(employeeId, Object.assign({}, previous, row, {
      id: previous.id || `emp-${employeeId.toLowerCase()}`,
      created_at: previous.created_at || now,
      updated_at: now,
    }));
  });
  return Array.from(byId.values());
}

function buildUserFromEmployee(employee, role, previous) {
  const employeeId = normalizeEmployeeId(employee.employee_id);
  const displayName = employeeDisplayName(employee);
  const branch = employeeBranch(employee);
  const jobCode = text(employee.job_code);
  const next = Object.assign({}, previous || {}, {
    username: displayName || employeeId,
    role,
    employee_id: employeeId,
    job_code: jobCode,
    branch,
    location: branch,
    department: portals.departmentForRole(role),
  });
  if (role === portals.ROLE_TECHNICIAN) {
    next.technician_employee_id = employeeId;
    next.technician_name = displayName;
  }
  if (isFrontlineRole(role)) {
    next.receptionist_employee_id = employeeId;
    next.receptionist_name = displayName;
    next.receptionist_job_code = jobCode;
  }
  if (role === portals.ROLE_STM) {
    next.stm_employee_id = employeeId;
  }
  applyShopPassword(next);
  if (!next.id) next.id = `emp-login-${employeeId.toLowerCase()}`;
  if (!next.created_at) next.created_at = new Date().toISOString();
  next.updated_at = new Date().toISOString();
  return next;
}

async function provisionEmployeeLogins(store) {
  const data = await store.getRawData();
  const counts = {
    csv_rows: 0,
    employees: 0,
    accounts_created: 0,
    accounts_updated: 0,
    passwords_reset: 0,
    by_role: {},
  };

  if (fs.existsSync(CSV_FILE)) {
    const incoming = (await parseCsv(CSV_FILE)).map(mapCsvRow);
    counts.csv_rows = incoming.filter((row) => normalizeEmployeeId(row.employee_id)).length;
    data.employees = mergeEmployees(data.employees, incoming);
  }

  const users = Array.isArray(data.users) ? data.users : [];
  const used = new Set();
  (data.employees || []).forEach((employee) => {
    if (!isActiveEmployee(employee)) return;
    const role = portalRoleForEmployee(employee);
    if (!role) return;
    counts.by_role[role] = (counts.by_role[role] || 0) + 1;
    const existing = findAccountForEmployee(users, employee, role, employee.employee_id);
    if (existing) {
      const idx = users.indexOf(existing);
      users[idx] = buildUserFromEmployee(employee, role, existing);
      used.add(users[idx]);
      counts.accounts_updated += 1;
      return;
    }
    const created = buildUserFromEmployee(employee, role, null);
    users.push(created);
    used.add(created);
    counts.accounts_created += 1;
  });

  users.forEach((user) => {
    if (!user || typeof user !== 'object') return;
    if (used.has(user)) return;
    applyShopPassword(user);
    counts.passwords_reset += 1;
  });

  data.users = users;
  data.auth_settings = Object.assign({}, data.auth_settings || {}, {
    login_disabled: false,
    employee_db_login_password: PASSWORD_FLAG,
    updated_at: new Date().toISOString(),
  });
  counts.employees = (data.employees || []).length;

  await store.replaceData(data);
  return counts;
}

module.exports = {
  SHOP_PASSWORD,
  CSV_FILE,
  isShopPassword,
  passwordAccepted,
  findEmployeeById,
  portalRoleForEmployee,
  locationsMatch,
  authorizeEmployeeLogin,
  sessionFromEmployee,
  provisionEmployeeLogins,
};
