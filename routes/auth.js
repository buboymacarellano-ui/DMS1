const express = require('express');
const crypto = require('crypto');
const store = require('../data/store');
const {
  ROLE_SERVICE_ADVISOR,
  ROLE_SERVICE_RECEPTIONIST,
  ROLE_SENIOR_SERVICE_RECEPTIONIST,
  isFrontlineRole,
  isReceptionistFamily,
  frontlineHomePath,
  jobCodeForRole,
  frontlineIdLabel,
  employeeDisplayName,
  employeeMatchesAccess,
  employeeBranch,
  buildFrontlineOptionsByRole,
  getFrontlineLoginBranches,
  findFrontlineAccount,
  accountEmployeeId,
  normalizeEmployeeId: normalizeFrontlineEmployeeId,
} = require('../lib/frontline-roles');
const {
  DEFAULT_OPERATIONAL_BRANCHES,
  canonicalizeBranchName,
  normalizeBranchKey,
  PRIMARY_BRANCH_NAME,
} = require('../lib/branches');
const { isLoginAuthDisabled, setOpenLoginEnabled } = require('../lib/login-auth');
const {
  authorizeEmployeeLogin,
  sessionFromEmployee,
  passwordAccepted,
} = require('../lib/employee-login');
const portals = require('../lib/portals');

const router = express.Router();
const ROLE_GENERAL_MANAGER = portals.ROLE_GENERAL_MANAGER;
const ROLE_ADMIN = portals.ROLE_ADMIN;
const ROLE_HR = portals.ROLE_HR;
const ROLE_STM = portals.ROLE_STM;
const ROLE_PARTS_MANAGER = portals.ROLE_PARTS_MANAGER;
const ROLE_FINANCE_MANAGER = portals.ROLE_FINANCE_MANAGER;
const ROLE_ASSETS_FACILITIES = portals.ROLE_ASSETS_FACILITIES;
const ROLE_ACCOUNTING = portals.ROLE_ACCOUNTING;
const ROLE_TECHNICIAN = portals.ROLE_TECHNICIAN;
const ROLE_PARTS_CLERK = portals.ROLE_PARTS_CLERK;
const ROLE_OPERATIONS_MANAGER = portals.ROLE_OPERATIONS_MANAGER;
const ROLE_STORE_MANAGER = portals.ROLE_STORE_MANAGER;
const ROLE_CASHIER = portals.ROLE_CASHIER;
const ROLE_STORES_CLERK = portals.ROLE_STORES_CLERK;
const ROLE_HR_MANAGER = portals.ROLE_HR_MANAGER;
const ROLE_HR_GENERALIST = portals.ROLE_HR_GENERALIST;
const ROLE_PAYROLL = portals.ROLE_PAYROLL;
const ROLE_HR_CLERK = portals.ROLE_HR_CLERK;
const MAX_GM_USERS = 3;

function normalizeUsername(value) {
  return String(value || '').trim().toUpperCase();
}

function normalizeRole(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeAccessLevel(value) {
  const normalized = portals.normalizeRole(value);
  if (normalized === ROLE_ADMIN) return ROLE_ADMIN;
  if (normalized === ROLE_HR || normalized === ROLE_HR_MANAGER) return normalized === ROLE_HR ? ROLE_HR : ROLE_HR_MANAGER;
  if (normalized === ROLE_STM) return ROLE_STM;
  if (normalized === ROLE_PARTS_MANAGER) return ROLE_PARTS_MANAGER;
  if (normalized === ROLE_FINANCE_MANAGER) return ROLE_FINANCE_MANAGER;
  if (normalized === ROLE_ACCOUNTING) return ROLE_ACCOUNTING;
  if (normalized === ROLE_ASSETS_FACILITIES) return ROLE_ASSETS_FACILITIES;
  if (normalized === ROLE_TECHNICIAN) return ROLE_TECHNICIAN;
  if (normalized === ROLE_SERVICE_ADVISOR) return ROLE_SERVICE_ADVISOR;
  if (normalized === ROLE_SENIOR_SERVICE_RECEPTIONIST) return ROLE_SENIOR_SERVICE_RECEPTIONIST;
  if (normalized === ROLE_SERVICE_RECEPTIONIST) return ROLE_SERVICE_RECEPTIONIST;
  if (normalized === ROLE_PARTS_CLERK) return ROLE_PARTS_CLERK;
  if (normalized === ROLE_OPERATIONS_MANAGER) return ROLE_OPERATIONS_MANAGER;
  if (normalized === ROLE_STORE_MANAGER) return ROLE_STORE_MANAGER;
  if (normalized === ROLE_CASHIER) return ROLE_CASHIER;
  if (normalized === ROLE_STORES_CLERK) return ROLE_STORES_CLERK;
  if (normalized === ROLE_HR_GENERALIST) return ROLE_HR_GENERALIST;
  if (normalized === ROLE_PAYROLL) return ROLE_PAYROLL;
  if (normalized === ROLE_HR_CLERK) return ROLE_HR_CLERK;
  return normalized === ROLE_GENERAL_MANAGER ? ROLE_GENERAL_MANAGER : ROLE_SERVICE_RECEPTIONIST;
}

function redirectForRole(role) {
  return portals.homePathForRole(role);
}

function roleShortLabel(role) {
  return portals.roleShortLabel(role);
}

function applyOpenLoginSession(req, accessLevel, loginInputRaw, selectedBranch, department) {
  const role = department === portals.PORTAL_GM ? ROLE_GENERAL_MANAGER : normalizeAccessLevel(accessLevel);
  const label = roleShortLabel(role);
  const username = String(loginInputRaw || '').trim() || `OPEN-${label}`;
  const dept = portals.normalizeDepartment(department) || portals.departmentForRole(role);
  const location = portals.canonicalizeLocation(dept, selectedBranch);
  req.session.user = {
    id: `open-login-${role}`,
    username,
    role,
    technician_name: role === ROLE_TECHNICIAN ? username : '',
    technician_employee_id: role === ROLE_TECHNICIAN ? username : '',
    employee_id: String(loginInputRaw || '').trim(),
    receptionist_employee_id: '',
    receptionist_name: isFrontlineRole(role) ? username : '',
    job_code: '',
    branch: location,
    location,
    department: dept,
    auth_open: true,
  };
  return role;
}

function canManageAccounts(req) {
  const role = normalizeRole(req.session && req.session.user && req.session.user.role);
  return role === ROLE_GENERAL_MANAGER
    || role === ROLE_ADMIN
    || role === ROLE_HR
    || role === ROLE_HR_MANAGER;
}

function getTechnicianDisplayName(employee) {
  return employeeDisplayName(employee);
}

function normalizeEmployeeId(value) {
  return normalizeFrontlineEmployeeId(value);
}

function buildTechnicianOptions(employees) {
  return (employees || [])
    .map((employee) => {
      const employeeId = normalizeEmployeeId(employee && employee.employee_id);
      const label = getTechnicianDisplayName(employee);
      return {
        employeeId,
        label,
      };
    })
    .filter((entry) => entry.employeeId && entry.label)
    .sort((a, b) => a.label.localeCompare(b.label));
}

function buildTechnicianOptionMap(technicianOptions) {
  return new Map((technicianOptions || []).map((entry) => [normalizeEmployeeId(entry.employeeId), entry.label]));
}

function getLoginBranches(employees, branchRows) {
  const names = new Set(DEFAULT_OPERATIONAL_BRANCHES);
  (branchRows || []).forEach((row) => {
    const name = canonicalizeBranchName(row && (row.name || row.branch));
    if (name) names.add(name);
  });
  (employees || []).forEach((employee) => {
    const name = canonicalizeBranchName(employeeBranch(employee));
    if (name) names.add(name);
  });
  getFrontlineLoginBranches(employees).forEach((name) => {
    const canonical = canonicalizeBranchName(name);
    if (canonical) names.add(canonical);
  });
  return Array.from(names).sort((a, b) => {
    const aIdx = DEFAULT_OPERATIONAL_BRANCHES.indexOf(a);
    const bIdx = DEFAULT_OPERATIONAL_BRANCHES.indexOf(b);
    if (aIdx !== -1 || bIdx !== -1) {
      if (aIdx === -1) return 1;
      if (bIdx === -1) return -1;
      return aIdx - bIdx;
    }
    return a.localeCompare(b);
  });
}

function branchesMatch(selected, assigned) {
  const left = canonicalizeBranchName(selected);
  const right = canonicalizeBranchName(assigned);
  if (!left || !right) return false;
  return normalizeBranchKey(left) === normalizeBranchKey(right);
}

function employeeMatchesStm(employee) {
  const text = [employee && employee.job_code, employee && employee.job_title]
    .map((value) => String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim())
    .filter(Boolean)
    .join(' ');
  return /\bSTM\b/.test(text) || /SERVICE\s*TECHNICAL\s*MANAGER/.test(text) || /TECHNICAL\s*MANAGER/.test(text);
}

function findStmEmployee(employees, loginInput) {
  const employeeId = normalizeEmployeeId(loginInput);
  const username = normalizeUsername(loginInput);
  return (employees || []).find((employee) => {
    if (!employeeMatchesStm(employee)) return false;
    return normalizeEmployeeId(employee.employee_id) === employeeId
      || normalizeUsername(employee.employee_id) === username
      || normalizeUsername([employee.first_name, employee.last_name].filter(Boolean).join('')) === username;
  }) || null;
}

function findStmAccount(users, loginInput, employee) {
  const username = normalizeUsername(loginInput);
  const employeeId = normalizeEmployeeId(loginInput || (employee && employee.employee_id));
  return (users || []).find((user) => {
    if (normalizeRole(user.role) !== ROLE_STM) return false;
    return normalizeUsername(user.username) === username
      || normalizeEmployeeId(user.employee_id || user.stm_employee_id) === employeeId;
  }) || null;
}

function missingIdError(accessLevel) {
  if (accessLevel === ROLE_GENERAL_MANAGER) return 'GM username or employee ID is required.';
  if (accessLevel === ROLE_TECHNICIAN) return 'Technician ID is required.';
  if (isFrontlineRole(accessLevel)) return `${frontlineIdLabel(accessLevel)} is required.`;
  return 'Employee ID is required.';
}

function getGmAccounts(users) {
  return users
    .filter((user) => normalizeRole(user.role) === ROLE_GENERAL_MANAGER)
    .sort((a, b) => {
      const aTime = new Date(a.created_at || 0).getTime();
      const bTime = new Date(b.created_at || 0).getTime();
      return aTime - bTime;
    });
}

function isAllowedGmLogin(account, users) {
  const gmAccounts = getGmAccounts(users);
  const allowedIds = new Set(gmAccounts.slice(0, MAX_GM_USERS).map((user) => user.id));
  return allowedIds.has(account.id);
}

function buildLoginPayload({
  error = '',
  success = '',
  hasAccounts = false,
  username = '',
  accessLevel = ROLE_SERVICE_ADVISOR,
  department = portals.PORTAL_SERVICE,
  branch = '',
  branches = [],
} = {}) {
  const dept = portals.normalizeDepartment(department) || portals.PORTAL_SERVICE;
  return Object.assign({
    error,
    success,
    hasAccounts,
    username,
    accessLevel,
    department: dept,
    branch,
    branches,
  }, portals.loginPayloadExtras());
}

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(String(password || ''), salt, 120000, 64, 'sha512').toString('hex');
}

function verifyPassword(password, salt, expectedHash) {
  const actualHash = hashPassword(password, salt);
  return crypto.timingSafeEqual(Buffer.from(actualHash, 'hex'), Buffer.from(String(expectedHash || ''), 'hex'));
}

function requestOrigin(req) {
  return `${req.protocol}://${req.get('host')}`;
}

router.get('/share-login', (req, res) => {
  const origin = requestOrigin(req);
  res.render('auth/share-login', {
    loginUrl: `${origin}/auth/login`,
    shareUrl: `${origin}/auth/share-login`,
    iconUrl: `${origin}/icons/login-shortcut.svg`,
  });
});

router.get('/login-shortcut.url', (req, res) => {
  const origin = requestOrigin(req);
  const shortcut = [
    '[InternetShortcut]',
    `URL=${origin}/auth/login`,
    `IconFile=${origin}/icons/login-shortcut.svg`,
    'IconIndex=0',
  ].join('\r\n');
  res.type('application/internet-shortcut');
  res.set('Content-Disposition', 'attachment; filename="A-and-E-Login.url"');
  res.send(shortcut);
});

router.get('/login', async (req, res) => {
  if (req.session.user && !isLoginAuthDisabled()) {
    return res.redirect(redirectForRole(normalizeRole(req.session.user.role)));
  }

  const users = await store.getAll('users');
  const employees = await store.getAll('employees');
  const branchRows = await store.getAll('branches').catch(() => []);
  const hasAccounts = users.length > 0;
  const success = req.query.registered ? 'Account created. Please log in.' : '';

  return res.render('auth/login', buildLoginPayload({
    error: '',
    success,
    hasAccounts,
    username: '',
    accessLevel: normalizeAccessLevel(req.query.level || req.query.role || ROLE_STM),
    department: portals.normalizeDepartment(req.query.department) || portals.departmentForRole(req.query.level),
    branches: getLoginBranches(employees, branchRows),
  }));
});

router.post('/login', async (req, res) => {
  const loginInputRaw = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const username = normalizeUsername(loginInputRaw);
  const technicianEmployeeIdInput = normalizeEmployeeId(loginInputRaw);
  const receptionistEmployeeIdInput = normalizeEmployeeId(loginInputRaw);
  const department = portals.normalizeDepartment(req.body.department) || portals.PORTAL_SERVICE;
  const selectedBranch = portals.canonicalizeLocation(department, req.body.branch);
  const accessLevel = department === portals.PORTAL_GM
    ? ROLE_GENERAL_MANAGER
    : normalizeAccessLevel(req.body.access_level);
  const users = await store.getAll('users');
  const employees = await store.getAll('employees');
  const branchRows = await store.getAll('branches').catch(() => []);
  const branches = getLoginBranches(employees, branchRows);
  const hasAccounts = users.length > 0;

  function renderLogin(status, error) {
    return res.status(status).render('auth/login', buildLoginPayload({
      error,
      success: '',
      hasAccounts,
      username: loginInputRaw,
      accessLevel,
      department,
      branch: selectedBranch,
      branches,
    }));
  }

  if (!String(req.body.department || '').trim()) {
    return renderLogin(400, 'Department is required.');
  }
  if (!String(req.body.access_level || '').trim() && department !== portals.PORTAL_GM) {
    return renderLogin(400, 'Role is required.');
  }

  if (department === portals.PORTAL_GM || accessLevel === ROLE_GENERAL_MANAGER) {
    if (!loginInputRaw) {
      return renderLogin(400, 'GM name is required.');
    }
    if (username !== 'GM') {
      return renderLogin(401, 'Invalid GM name or password.');
    }
    if (!password) {
      return renderLogin(400, 'Password is required.');
    }
    if (isLoginAuthDisabled()) {
      const role = applyOpenLoginSession(req, ROLE_GENERAL_MANAGER, 'GM', '', portals.PORTAL_GM);
      return res.redirect(redirectForRole(role));
    }
    const gmPassword = Buffer.from('123456');
    const givenPassword = Buffer.from(password);
    const passwordOk = givenPassword.length === gmPassword.length
      && crypto.timingSafeEqual(givenPassword, gmPassword);
    if (!passwordOk) {
      return renderLogin(401, 'Invalid GM name or password.');
    }
    const namedGm = getGmAccounts(users).find((account) => normalizeUsername(account.username) === 'GM') || null;
    req.session.user = {
      id: (namedGm && namedGm.id) || 'gm-login',
      username: 'GM',
      role: ROLE_GENERAL_MANAGER,
      technician_name: '',
      technician_employee_id: '',
      employee_id: '',
      receptionist_employee_id: '',
      receptionist_name: '',
      job_code: '',
      branch: '',
      location: '',
      department: portals.PORTAL_GM,
    };
    return res.redirect(redirectForRole(ROLE_GENERAL_MANAGER));
  }

  if (!loginInputRaw) {
    return renderLogin(400, missingIdError(accessLevel));
  }
  if (!selectedBranch) {
    return renderLogin(400, 'Select your assigned location to continue.');
  }
  if (!password) {
    return renderLogin(400, 'Password is required.');
  }

  if (isLoginAuthDisabled()) {
    const role = applyOpenLoginSession(req, accessLevel, loginInputRaw, selectedBranch, department);
    return res.redirect(redirectForRole(role));
  }

  const authorized = authorizeEmployeeLogin({
    employees,
    users,
    department,
    role: accessLevel,
    loginInput: loginInputRaw,
    location: selectedBranch,
    password,
  });

  if (authorized.ok) {
    req.session.user = sessionFromEmployee({
      employee: authorized.employee,
      account: authorized.account,
      role: accessLevel,
      department,
      location: authorized.location,
      loginInput: loginInputRaw,
    });
    return res.redirect(redirectForRole(req.session.user.role));
  }

  function findDepartmentAccount() {
    if (accessLevel === ROLE_TECHNICIAN) {
      return users.find((user) => (
        normalizeRole(user.role) === ROLE_TECHNICIAN
        && normalizeEmployeeId(user.technician_employee_id) === technicianEmployeeIdInput
      )) || null;
    }
    if (isFrontlineRole(accessLevel)) {
      return findFrontlineAccount(users, receptionistEmployeeIdInput, accessLevel);
    }
    if (accessLevel === ROLE_STM) {
      return findStmAccount(users, loginInputRaw, null);
    }
    const employeeId = normalizeEmployeeId(loginInputRaw);
    return (users || []).find((user) => {
      if (!portals.accountRoleMatches(user.role, accessLevel)) return false;
      return normalizeUsername(user.username) === username
        || normalizeEmployeeId(user.employee_id || user.stm_employee_id || user.technician_employee_id) === employeeId
        || accountEmployeeId(user) === employeeId;
    }) || null;
  }

  const employeeMissing = /not found in Employee DB/i.test(String(authorized.error || ''));
  if (!employeeMissing) {
    return renderLogin(authorized.status || 401, authorized.error);
  }

  const account = findDepartmentAccount();
  if (!account) {
    return renderLogin(authorized.status || 401, authorized.error);
  }
  if (account.password_enabled === false) {
    return renderLogin(403, 'This account password is disabled. Contact HR.');
  }
  if (!passwordAccepted(password, account)) {
    return renderLogin(401, 'Invalid password.');
  }
  const assignedLocation = String(account.branch || account.location || '').trim();
  if (assignedLocation && !branchesMatch(selectedBranch, assignedLocation)
    && portals.canonicalizeLocation(department, selectedBranch) !== portals.canonicalizeLocation(department, assignedLocation)) {
    return renderLogin(403, 'Selected location must match this employee ID in Employee DB.');
  }

  const accountRole = normalizeRole(account.role || accessLevel);
  req.session.user = {
    id: account.id,
    username: account.username,
    role: accountRole === ROLE_HR ? ROLE_HR_MANAGER : accountRole,
    technician_name: account.technician_name || '',
    technician_employee_id: account.technician_employee_id || '',
    employee_id: accountEmployeeId(account) || normalizeEmployeeId(loginInputRaw),
    receptionist_employee_id: isReceptionistFamily(accountRole) ? (accountEmployeeId(account) || receptionistEmployeeIdInput) : (account.receptionist_employee_id || ''),
    receptionist_name: isFrontlineRole(accountRole) ? account.username : (account.receptionist_name || ''),
    job_code: account.job_code || account.receptionist_job_code || '',
    branch: selectedBranch,
    location: selectedBranch,
    department,
  };

  return res.redirect(redirectForRole(req.session.user.role));
});

router.post('/verify-delete-password', async (req, res) => {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ ok: false, message: 'Your session has expired. Please log in again.' });
  }

  if (!await store.isDeletePasswordEnabled()) {
    return res.json({ ok: true });
  }

  const configured = await store.hasDeletePassword();
  if (!configured) {
    return res.status(503).json({ ok: false, message: 'The Admin has not configured the delete password yet.' });
  }

  const valid = await store.verifyDeletePassword(req.body.delete_password);
  if (!valid) {
    return res.status(403).json({ ok: false, message: 'Incorrect delete password.' });
  }

  return res.json({ ok: true });
});

router.get('/register', async (req, res) => {
  if (req.session.user && !canManageAccounts(req)) {
    return res.redirect(redirectForRole(normalizeRole(req.session.user.role)));
  }

  const employees = await store.getAll('employees');
  const accessLevel = normalizeAccessLevel(req.query.level);
  const frontlineLevel = isFrontlineRole(accessLevel) ? accessLevel : ROLE_SERVICE_RECEPTIONIST;
  return res.render('auth/register', {
    error: '',
    accessLevel: frontlineLevel,
    employeeId: '',
    frontlineByRole: buildFrontlineOptionsByRole(employees),
  });
});

router.post('/register', async (req, res) => {
  const accessLevel = isFrontlineRole(normalizeAccessLevel(req.body.access_level))
    ? normalizeAccessLevel(req.body.access_level)
    : ROLE_SERVICE_RECEPTIONIST;
  const employeeId = normalizeEmployeeId(req.body.employee_id || req.body.receptionist_employee_id);
  const password = String(req.body.password || '');
  const confirmPassword = String(req.body.confirm_password || '');
  const employees = await store.getAll('employees');
  const frontlineByRole = buildFrontlineOptionsByRole(employees);
  const employee = employees.find((item) => normalizeEmployeeId(item.employee_id) === employeeId);
  const username = employee ? normalizeUsername(getTechnicianDisplayName(employee)) : '';

  function renderRegister(status, error) {
    return res.status(status).render('auth/register', {
      error,
      accessLevel,
      employeeId,
      frontlineByRole,
    });
  }

  if (!employee || !employeeMatchesAccess(employee, accessLevel) || !password) {
    return renderRegister(400, `Select an employee whose Job Code is ${jobCodeForRole(accessLevel)} and provide a password.`);
  }

  if (password.length < 6) {
    return renderRegister(400, 'Password must be at least 6 characters.');
  }

  if (password !== confirmPassword) {
    return renderRegister(400, 'Password confirmation does not match.');
  }

  const users = await store.getAll('users');
  const exists = users.some((user) => (
    isFrontlineRole(user.role)
    && accountEmployeeId(user) === employeeId
  ));
  if (exists) {
    return renderRegister(409, 'This employee ID already has a login account.');
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = hashPassword(password, salt);
  const displayName = getTechnicianDisplayName(employee);
  const branch = employeeBranch(employee);
  const jobCode = String(employee.job_code || '').trim();

  await store.create('users', {
    username,
    role: accessLevel,
    employee_id: employeeId,
    receptionist_employee_id: employeeId,
    receptionist_name: displayName,
    receptionist_job_code: jobCode,
    job_code: jobCode,
    branch,
    password_salt: salt,
    password_hash: passwordHash,
  });

  return res.redirect(`/auth/login?registered=1&level=${encodeURIComponent(accessLevel)}`);
});

router.get('/register-gm', async (req, res) => {
  if (req.session.user && !canManageAccounts(req)) {
    return res.redirect(redirectForRole(normalizeRole(req.session.user.role)));
  }

  const users = await store.getAll('users');
  const gmAccounts = getGmAccounts(users);
  return res.render('auth/register-gm', {
    error: '',
    username: '',
    slotsLeft: Math.max(0, MAX_GM_USERS - gmAccounts.length),
    maxGmUsers: MAX_GM_USERS,
  });
});

router.post('/register-gm', async (req, res) => {
  const username = normalizeUsername(req.body.username);
  const password = String(req.body.password || '');
  const confirmPassword = String(req.body.confirm_password || '');
  const users = await store.getAll('users');
  const gmAccounts = getGmAccounts(users);
  const slotsLeft = Math.max(0, MAX_GM_USERS - gmAccounts.length);

  if (!username || !password) {
    return res.status(400).render('auth/register-gm', {
      error: 'Username and password are required.',
      username,
      slotsLeft,
      maxGmUsers: MAX_GM_USERS,
    });
  }

  if (password.length < 6) {
    return res.status(400).render('auth/register-gm', {
      error: 'Password must be at least 6 characters.',
      username,
      slotsLeft,
      maxGmUsers: MAX_GM_USERS,
    });
  }

  if (password !== confirmPassword) {
    return res.status(400).render('auth/register-gm', {
      error: 'Password confirmation does not match.',
      username,
      slotsLeft,
      maxGmUsers: MAX_GM_USERS,
    });
  }

  if (gmAccounts.length >= MAX_GM_USERS) {
    return res.status(403).render('auth/register-gm', {
      error: 'GM interface already has 3 registered users.',
      username,
      slotsLeft,
      maxGmUsers: MAX_GM_USERS,
    });
  }

  const exists = users.some((user) => normalizeUsername(user.username) === username);
  if (exists) {
    return res.status(409).render('auth/register-gm', {
      error: 'Username already exists. Please choose another.',
      username,
      slotsLeft,
      maxGmUsers: MAX_GM_USERS,
    });
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = hashPassword(password, salt);

  await store.create('users', {
    username,
    role: ROLE_GENERAL_MANAGER,
    password_salt: salt,
    password_hash: passwordHash,
  });

  return res.redirect('/auth/login?registered=1&level=general_manager');
});

router.get('/register-admin', async (req, res) => {
  if (req.session.user && !canManageAccounts(req)) {
    return res.redirect(redirectForRole(normalizeRole(req.session.user.role)));
  }

  return res.render('auth/register-admin', {
    error: '',
    username: '',
  });
});

router.post('/register-admin', async (req, res) => {
  const username = normalizeUsername(req.body.username);
  const password = String(req.body.password || '');
  const confirmPassword = String(req.body.confirm_password || '');

  if (!username || !password) {
    return res.status(400).render('auth/register-admin', {
      error: 'Username and password are required.',
      username,
    });
  }

  if (password.length < 6) {
    return res.status(400).render('auth/register-admin', {
      error: 'Password must be at least 6 characters.',
      username,
    });
  }

  if (password !== confirmPassword) {
    return res.status(400).render('auth/register-admin', {
      error: 'Password confirmation does not match.',
      username,
    });
  }

  const users = await store.getAll('users');
  const exists = users.some((user) => normalizeUsername(user.username) === username);
  if (exists) {
    return res.status(409).render('auth/register-admin', {
      error: 'Username already exists. Please choose another.',
      username,
    });
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = hashPassword(password, salt);

  await store.create('users', {
    username,
    role: ROLE_ADMIN,
    password_salt: salt,
    password_hash: passwordHash,
  });

  return res.redirect('/auth/login?registered=1&level=admin&department=fo');
});

router.get('/register-hr', async (req, res) => {
  if (req.session.user && !canManageAccounts(req) && !isLoginAuthDisabled()) {
    return res.redirect(redirectForRole(normalizeRole(req.session.user.role)));
  }

  return res.render('auth/register-hr', {
    error: '',
    username: '',
    success: req.query.auth === 'off'
      ? 'Login auth is disabled. Empty login is accepted for any access level.'
      : (req.query.auth === 'on' ? 'Login auth is enabled. Branch, user ID, and password are required again.' : ''),
  });
});

router.post('/login-auth', async (req, res) => {
  const disable = String(req.body.login_auth_disabled || '').trim() === '1';
  await setOpenLoginEnabled(disable);
  return res.redirect(disable ? '/auth/register-hr?auth=off' : '/auth/register-hr?auth=on');
});

router.post('/register-hr', async (req, res) => {
  const username = normalizeUsername(req.body.username);
  const password = String(req.body.password || '');
  const confirmPassword = String(req.body.confirm_password || '');

  if (!username || !password) {
    return res.status(400).render('auth/register-hr', {
      error: 'Username and password are required.',
      username,
      success: '',
    });
  }

  if (password.length < 6) {
    return res.status(400).render('auth/register-hr', {
      error: 'Password must be at least 6 characters.',
      username,
      success: '',
    });
  }

  if (password !== confirmPassword) {
    return res.status(400).render('auth/register-hr', {
      error: 'Password confirmation does not match.',
      username,
      success: '',
    });
  }

  const users = await store.getAll('users');
  const exists = users.some((user) => normalizeUsername(user.username) === username);
  if (exists) {
    return res.status(409).render('auth/register-hr', {
      error: 'Username already exists. Please choose another.',
      username,
      success: '',
    });
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = hashPassword(password, salt);

  await store.create('users', {
    username,
    role: ROLE_HR,
    password_salt: salt,
    password_hash: passwordHash,
  });

  return res.redirect('/auth/login?registered=1&level=hr');
});

router.get('/register-stm', async (req, res) => {
  if (req.session.user && !canManageAccounts(req)) {
    return res.redirect(redirectForRole(normalizeRole(req.session.user.role)));
  }

  return res.render('auth/register-stm', {
    error: '',
    username: '',
  });
});

router.post('/register-stm', async (req, res) => {
  const username = normalizeUsername(req.body.username);
  const password = String(req.body.password || '');
  const confirmPassword = String(req.body.confirm_password || '');

  if (!username || !password) {
    return res.status(400).render('auth/register-stm', {
      error: 'Username and password are required.',
      username,
    });
  }

  if (password.length < 6) {
    return res.status(400).render('auth/register-stm', {
      error: 'Password must be at least 6 characters.',
      username,
    });
  }

  if (password !== confirmPassword) {
    return res.status(400).render('auth/register-stm', {
      error: 'Password confirmation does not match.',
      username,
    });
  }

  const users = await store.getAll('users');
  const exists = users.some((user) => normalizeUsername(user.username) === username);
  if (exists) {
    return res.status(409).render('auth/register-stm', {
      error: 'Username already exists. Please choose another.',
      username,
    });
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = hashPassword(password, salt);

  await store.create('users', {
    username,
    role: ROLE_STM,
    password_salt: salt,
    password_hash: passwordHash,
  });

  return res.redirect('/auth/login?registered=1&level=service_technical_manager');
});

router.get('/register-parts-manager', async (req, res) => {
  if (req.session.user && !canManageAccounts(req)) {
    return res.redirect(redirectForRole(normalizeRole(req.session.user.role)));
  }

  return res.render('auth/register-parts-manager', {
    error: '',
    username: '',
  });
});

router.post('/register-parts-manager', async (req, res) => {
  const username = normalizeUsername(req.body.username);
  const password = String(req.body.password || '');
  const confirmPassword = String(req.body.confirm_password || '');

  if (!username || !password) {
    return res.status(400).render('auth/register-parts-manager', {
      error: 'Username and password are required.',
      username,
    });
  }

  if (password.length < 6) {
    return res.status(400).render('auth/register-parts-manager', {
      error: 'Password must be at least 6 characters.',
      username,
    });
  }

  if (password !== confirmPassword) {
    return res.status(400).render('auth/register-parts-manager', {
      error: 'Password confirmation does not match.',
      username,
    });
  }

  const users = await store.getAll('users');
  const exists = users.some((user) => normalizeUsername(user.username) === username);
  if (exists) {
    return res.status(409).render('auth/register-parts-manager', {
      error: 'Username already exists. Please choose another.',
      username,
    });
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = hashPassword(password, salt);

  await store.create('users', {
    username,
    role: ROLE_PARTS_MANAGER,
    password_salt: salt,
    password_hash: passwordHash,
  });

  return res.redirect('/auth/login?registered=1&level=parts_manager');
});

router.get('/register-finance-manager', async (req, res) => {
  if (req.session.user && !canManageAccounts(req)) {
    return res.redirect(redirectForRole(normalizeRole(req.session.user.role)));
  }

  return res.render('auth/register-finance-manager', {
    error: '',
    username: '',
  });
});

router.post('/register-finance-manager', async (req, res) => {
  const username = normalizeUsername(req.body.username);
  const password = String(req.body.password || '');
  const confirmPassword = String(req.body.confirm_password || '');

  if (!username || !password) {
    return res.status(400).render('auth/register-finance-manager', {
      error: 'Username and password are required.',
      username,
    });
  }

  if (password.length < 6) {
    return res.status(400).render('auth/register-finance-manager', {
      error: 'Password must be at least 6 characters.',
      username,
    });
  }

  if (password !== confirmPassword) {
    return res.status(400).render('auth/register-finance-manager', {
      error: 'Password confirmation does not match.',
      username,
    });
  }

  const users = await store.getAll('users');
  const exists = users.some((user) => normalizeUsername(user.username) === username);
  if (exists) {
    return res.status(409).render('auth/register-finance-manager', {
      error: 'Username already exists. Please choose another.',
      username,
    });
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = hashPassword(password, salt);

  await store.create('users', {
    username,
    role: ROLE_FINANCE_MANAGER,
    password_salt: salt,
    password_hash: passwordHash,
  });

  return res.redirect('/auth/login?registered=1&level=accounting&department=fo');
});

router.get('/register-technician', async (req, res) => {
  if (req.session.user && !canManageAccounts(req)) {
    return res.redirect(redirectForRole(normalizeRole(req.session.user.role)));
  }

  const employees = await store.getAll('employees');
  const technicianOptions = buildTechnicianOptions(employees);
  return res.render('auth/register-technician', {
    error: '',
    username: '',
    technicianEmployeeId: '',
    technicianName: '',
    technicianOptions,
  });
});

router.post('/register-technician', async (req, res) => {
  const username = normalizeUsername(req.body.username);
  const password = String(req.body.password || '');
  const confirmPassword = String(req.body.confirm_password || '');
  const technicianEmployeeId = normalizeEmployeeId(req.body.technician_employee_id);
  const technicianName = String(req.body.technician_name || '').trim();
  const employees = await store.getAll('employees');
  const technicianOptions = buildTechnicianOptions(employees);
  const technicianOptionMap = buildTechnicianOptionMap(technicianOptions);
  const technicianLabel = technicianOptionMap.get(technicianEmployeeId) || technicianName;

  if (!username || !password || !technicianEmployeeId) {
    return res.status(400).render('auth/register-technician', {
      error: 'Username, technician ID, and password are required.',
      username,
      technicianEmployeeId,
      technicianName,
      technicianOptions,
    });
  }

  if (!technicianLabel) {
    return res.status(400).render('auth/register-technician', {
      error: 'Technician ID is not recognized in employee database.',
      username,
      technicianEmployeeId,
      technicianName,
      technicianOptions,
    });
  }

  if (password.length < 6) {
    return res.status(400).render('auth/register-technician', {
      error: 'Password must be at least 6 characters.',
      username,
      technicianEmployeeId,
      technicianName,
      technicianOptions,
    });
  }

  if (password !== confirmPassword) {
    return res.status(400).render('auth/register-technician', {
      error: 'Password confirmation does not match.',
      username,
      technicianEmployeeId,
      technicianName,
      technicianOptions,
    });
  }

  const users = await store.getAll('users');
  const exists = users.some((user) => normalizeUsername(user.username) === username);
  if (exists) {
    return res.status(409).render('auth/register-technician', {
      error: 'Username already exists. Please choose another.',
      username,
      technicianEmployeeId,
      technicianName,
      technicianOptions,
    });
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = hashPassword(password, salt);

  await store.create('users', {
    username,
    role: ROLE_TECHNICIAN,
    technician_name: technicianLabel,
    technician_employee_id: technicianEmployeeId,
    password_salt: salt,
    password_hash: passwordHash,
  });

  return res.redirect('/auth/login?registered=1&level=technician');
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/auth/login');
  });
});

module.exports = router;
