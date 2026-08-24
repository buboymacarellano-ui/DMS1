const ROLE_SERVICE_ADVISOR = 'service_advisor';
const ROLE_SERVICE_RECEPTIONIST = 'service_receptionist';
const ROLE_SENIOR_SERVICE_RECEPTIONIST = 'senior_service_receptionist';

const FRONTLINE_ROLES = [
  ROLE_SERVICE_ADVISOR,
  ROLE_SERVICE_RECEPTIONIST,
  ROLE_SENIOR_SERVICE_RECEPTIONIST,
];

const JOB_CODE_BY_ROLE = {
  [ROLE_SERVICE_ADVISOR]: 'SERVICE ADVISOR',
  [ROLE_SERVICE_RECEPTIONIST]: 'SERVICE RECEPTIONIST',
  [ROLE_SENIOR_SERVICE_RECEPTIONIST]: 'SENIOR SERVICE RECEPTIONIST',
};

const ACCESS_LABEL_BY_ROLE = {
  [ROLE_SERVICE_ADVISOR]: 'SA',
  [ROLE_SERVICE_RECEPTIONIST]: 'SR',
  [ROLE_SENIOR_SERVICE_RECEPTIONIST]: 'SSR',
};

function normalizeRole(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeJobCode(value) {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, ' ');
}

function normalizeEmployeeId(value) {
  return String(value || '').trim().toUpperCase();
}

function isFrontlineRole(role) {
  return FRONTLINE_ROLES.includes(normalizeRole(role));
}

function isReceptionistFamily(role) {
  const normalized = normalizeRole(role);
  return normalized === ROLE_SERVICE_RECEPTIONIST || normalized === ROLE_SENIOR_SERVICE_RECEPTIONIST;
}

function frontlineHomePath(role) {
  return isFrontlineRole(role) ? '/service-receptionist' : '/';
}

function jobCodeForRole(role) {
  return JOB_CODE_BY_ROLE[normalizeRole(role)] || '';
}

function frontlineRoleLabel(role) {
  return ACCESS_LABEL_BY_ROLE[normalizeRole(role)] || '';
}

function frontlineIdLabel(role) {
  const normalized = normalizeRole(role);
  if (normalized === ROLE_SERVICE_ADVISOR) return 'SA Employee ID';
  if (normalized === ROLE_SENIOR_SERVICE_RECEPTIONIST) return 'Senior SR Employee ID';
  if (normalized === ROLE_SERVICE_RECEPTIONIST) return 'SR Employee ID';
  return 'Employee ID';
}

function accountEmployeeId(account) {
  return normalizeEmployeeId(
    account && (account.employee_id || account.receptionist_employee_id || account.advisor_employee_id)
  );
}

function employeeDisplayName(employee) {
  const name = [employee && employee.first_name, employee && employee.middle_name, employee && employee.last_name]
    .filter(Boolean)
    .map((value) => String(value).trim())
    .join(' ')
    .trim();
  const identifier = String(employee && employee.employee_id || '').trim();
  if (name && identifier) return `${name} (${identifier})`;
  return name || identifier;
}

function employeeMatchesAccess(employee, accessLevel) {
  if (!employee) return false;
  const expected = jobCodeForRole(accessLevel);
  if (!expected) return false;
  const code = normalizeJobCode(employee.job_code);
  if (code === expected) return true;
  const title = normalizeJobCode(employee.job_title);
  return title === expected;
}

function employeeBranch(employee) {
  return String(employee && employee.work_location_branch_id || '').trim();
}

function frontlineSessionBranch(user) {
  if (!isFrontlineRole(user && user.role)) return '';
  return String(user && user.branch || '').trim();
}

function buildFrontlineOptions(employees, accessLevel) {
  return (employees || [])
    .filter((employee) => employeeMatchesAccess(employee, accessLevel))
    .map((employee) => ({
      employeeId: normalizeEmployeeId(employee.employee_id),
      label: employeeDisplayName(employee),
      branch: employeeBranch(employee),
      jobCode: String(employee.job_code || '').trim(),
      role: normalizeRole(accessLevel),
    }))
    .filter((entry) => entry.employeeId && entry.label && entry.branch)
    .sort((a, b) => a.label.localeCompare(b.label));
}

function buildFrontlineOptionsByRole(employees) {
  return {
    [ROLE_SERVICE_ADVISOR]: buildFrontlineOptions(employees, ROLE_SERVICE_ADVISOR),
    [ROLE_SERVICE_RECEPTIONIST]: buildFrontlineOptions(employees, ROLE_SERVICE_RECEPTIONIST),
    [ROLE_SENIOR_SERVICE_RECEPTIONIST]: buildFrontlineOptions(employees, ROLE_SENIOR_SERVICE_RECEPTIONIST),
  };
}

function getFrontlineLoginBranches(employees) {
  const branches = new Set();
  FRONTLINE_ROLES.forEach((role) => {
    buildFrontlineOptions(employees, role).forEach((entry) => {
      if (entry.branch) branches.add(entry.branch);
    });
  });
  return Array.from(branches).sort((a, b) => a.localeCompare(b));
}

function findFrontlineAccount(users, employeeId, accessLevel) {
  const wantedId = normalizeEmployeeId(employeeId);
  const wantedRole = normalizeRole(accessLevel);
  return (users || []).find((user) => (
    normalizeRole(user.role) === wantedRole
    && accountEmployeeId(user) === wantedId
  ));
}

module.exports = {
  ROLE_SERVICE_ADVISOR,
  ROLE_SERVICE_RECEPTIONIST,
  ROLE_SENIOR_SERVICE_RECEPTIONIST,
  FRONTLINE_ROLES,
  JOB_CODE_BY_ROLE,
  normalizeRole,
  normalizeJobCode,
  normalizeEmployeeId,
  isFrontlineRole,
  isReceptionistFamily,
  frontlineHomePath,
  jobCodeForRole,
  frontlineRoleLabel,
  frontlineIdLabel,
  accountEmployeeId,
  employeeDisplayName,
  employeeMatchesAccess,
  employeeBranch,
  frontlineSessionBranch,
  buildFrontlineOptions,
  buildFrontlineOptionsByRole,
  getFrontlineLoginBranches,
  findFrontlineAccount,
};
