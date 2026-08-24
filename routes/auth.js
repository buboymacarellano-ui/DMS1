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
} = require('../lib/branches');

const router = express.Router();
const ROLE_GENERAL_MANAGER = 'general_manager';
const ROLE_ADMIN = 'admin';
const ROLE_HR = 'hr';
const ROLE_STM = 'service_technical_manager';
const ROLE_PARTS_MANAGER = 'parts_manager';
const ROLE_TECHNICIAN = 'technician';
const MAX_GM_USERS = 3;

function normalizeUsername(value) {
  return String(value || '').trim().toUpperCase();
}

function normalizeRole(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeAccessLevel(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === ROLE_ADMIN) return ROLE_ADMIN;
  if (normalized === ROLE_HR) return ROLE_HR;
  if (normalized === ROLE_STM || normalized === 'stm' || normalized === 'service & technical manager') return ROLE_STM;
  if (normalized === ROLE_PARTS_MANAGER || normalized === 'pm') return ROLE_PARTS_MANAGER;
  if (normalized === ROLE_TECHNICIAN) return ROLE_TECHNICIAN;
  if (normalized === ROLE_SERVICE_ADVISOR || normalized === 'sa') return ROLE_SERVICE_ADVISOR;
  if (normalized === ROLE_SENIOR_SERVICE_RECEPTIONIST || normalized === 'ssr' || normalized === 'senior_sr') {
    return ROLE_SENIOR_SERVICE_RECEPTIONIST;
  }
  if (normalized === ROLE_SERVICE_RECEPTIONIST || normalized === 'sr') return ROLE_SERVICE_RECEPTIONIST;
  return normalized === 'general_manager' ? ROLE_GENERAL_MANAGER : ROLE_SERVICE_RECEPTIONIST;
}

function redirectForRole(role) {
  if (role === ROLE_GENERAL_MANAGER) return '/gm';
  if (role === ROLE_ADMIN) return '/admin';
  if (role === ROLE_HR) return '/hr';
  if (role === ROLE_STM) return '/stm';
  if (role === ROLE_PARTS_MANAGER || role === 'pm') return '/parts-manager';
  if (role === ROLE_TECHNICIAN) return '/technician';
  if (isFrontlineRole(role)) return frontlineHomePath(role);
  return '/work-order-transactions';
}

function canManageAccounts(req) {
  const role = normalizeRole(req.session && req.session.user && req.session.user.role);
  return role === ROLE_GENERAL_MANAGER || role === ROLE_ADMIN || role === ROLE_HR;
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
  if (accessLevel === ROLE_TECHNICIAN) return 'Technician ID is required.';
  if (isFrontlineRole(accessLevel)) return `${frontlineIdLabel(accessLevel)} is required.`;
  return 'Username is required.';
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

function buildLoginPayload({ error = '', success = '', hasAccounts = false, username = '', accessLevel = ROLE_SERVICE_RECEPTIONIST, branch = '', branches = [] } = {}) {
  return {
    error,
    success,
    hasAccounts,
    username,
    accessLevel,
    branch,
    branches,
  };
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
  if (req.session.user) {
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
    accessLevel: normalizeAccessLevel(req.query.level),
    branches: getLoginBranches(employees, branchRows),
  }));
});

router.post('/login', async (req, res) => {
  const loginInputRaw = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const username = normalizeUsername(loginInputRaw);
  const technicianEmployeeIdInput = normalizeEmployeeId(loginInputRaw);
  const receptionistEmployeeIdInput = normalizeEmployeeId(loginInputRaw);
  const selectedBranch = String(req.body.branch || '').trim();
  const accessLevel = normalizeAccessLevel(req.body.access_level);
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
      branch: selectedBranch,
      branches,
    }));
  }

  if (!loginInputRaw) {
    return renderLogin(400, missingIdError(accessLevel));
  }

  let matchedEmployee = null;
  if (isFrontlineRole(accessLevel)) {
    matchedEmployee = employees.find((item) => normalizeEmployeeId(item.employee_id) === receptionistEmployeeIdInput);
    if (!matchedEmployee) {
      return renderLogin(401, `${frontlineIdLabel(accessLevel)} was not found in Employee DB.`);
    }
    if (!employeeMatchesAccess(matchedEmployee, accessLevel)) {
      const expectedJob = jobCodeForRole(accessLevel);
      return renderLogin(403, `This employee ID is not listed as ${expectedJob} in Employee DB.`);
    }
    const employeeAssignedBranch = employeeBranch(matchedEmployee);
    if (!selectedBranch) {
      return renderLogin(400, 'Select the branch assigned to this employee ID.');
    }
    if (!branchesMatch(selectedBranch, employeeAssignedBranch)) {
      return renderLogin(403, 'Selected branch must match this employee ID in Employee DB.');
    }
  }

  if (accessLevel === ROLE_STM) {
    matchedEmployee = findStmEmployee(employees, loginInputRaw);
  }

  const account = accessLevel === ROLE_TECHNICIAN
    ? users.find((user) => (
      normalizeRole(user.role) === ROLE_TECHNICIAN &&
      normalizeEmployeeId(user.technician_employee_id) === technicianEmployeeIdInput
    ))
    : isFrontlineRole(accessLevel)
      ? findFrontlineAccount(users, receptionistEmployeeIdInput, accessLevel)
    : accessLevel === ROLE_STM
      ? findStmAccount(users, loginInputRaw, matchedEmployee)
    : users.find((user) => normalizeUsername(user.username) === username);

  if (!account) {
    if (isFrontlineRole(accessLevel)) {
      return renderLogin(401, `No login account yet for this ${frontlineIdLabel(accessLevel)}. Ask HR to create one.`);
    }
    if (accessLevel === ROLE_STM) {
      return renderLogin(401, 'STM account was not recognized. Use the STM username or employee ID registered for Service & Technical Manager.');
    }
    return renderLogin(401, accessLevel === ROLE_TECHNICIAN
      ? 'Invalid Technician ID. Please use your registered technician ID.'
      : 'Invalid username.');
  }

  if (!password || !account.password_salt || !account.password_hash || !verifyPassword(password, account.password_salt, account.password_hash)) {
    return renderLogin(401, 'Invalid password.');
  }

  const accountRole = normalizeRole(account.role || ROLE_SERVICE_ADVISOR);
  if (accessLevel === ROLE_GENERAL_MANAGER) {
    if (accountRole !== ROLE_GENERAL_MANAGER) {
      return res.status(403).render('auth/login', buildLoginPayload({
        error: 'This account is not authorized for the GM interface.',
        success: '',
        hasAccounts,
        username: loginInputRaw,
        accessLevel,
      }));
    }

    if (!isAllowedGmLogin(account, users)) {
      return res.status(403).render('auth/login', buildLoginPayload({
        error: 'GM interface is limited to 3 users. Contact admin for access.',
        success: '',
        hasAccounts,
        username: loginInputRaw,
        accessLevel,
      }));
    }
  }

  if (accessLevel === ROLE_ADMIN && accountRole !== ROLE_ADMIN) {
    return res.status(403).render('auth/login', buildLoginPayload({
      error: 'This account is not authorized for the Admin interface.',
      success: '',
      hasAccounts,
      username: loginInputRaw,
      accessLevel,
    }));
  }

  if (accessLevel === ROLE_HR && accountRole !== ROLE_HR) {
    return res.status(403).render('auth/login', buildLoginPayload({
      error: 'This account is not authorized for the HR interface.',
      success: '',
      hasAccounts,
      username: loginInputRaw,
      accessLevel,
    }));
  }

  if (accessLevel === ROLE_STM && accountRole !== ROLE_STM) {
    return res.status(403).render('auth/login', buildLoginPayload({
      error: 'This account is not authorized for the STM interface.',
      success: '',
      hasAccounts,
      username: loginInputRaw,
      accessLevel,
    }));
  }

  if (accessLevel === ROLE_PARTS_MANAGER && accountRole !== ROLE_PARTS_MANAGER && accountRole !== 'pm') {
    return res.status(403).render('auth/login', buildLoginPayload({
      error: 'This account is not authorized for the Parts Manager interface.',
      success: '',
      hasAccounts,
      username: loginInputRaw,
      accessLevel,
    }));
  }

  if (accessLevel === ROLE_TECHNICIAN && accountRole !== ROLE_TECHNICIAN) {
    return res.status(403).render('auth/login', buildLoginPayload({
      error: 'This account is not authorized for the Technician interface.',
      success: '',
      hasAccounts,
      username: loginInputRaw,
      accessLevel,
    }));
  }

  if (isFrontlineRole(accessLevel) && accountRole !== accessLevel) {
    return renderLogin(403, 'Please use the correct access level for this account.');
  }

  if (accessLevel === ROLE_GENERAL_MANAGER && accountRole === ROLE_ADMIN) {
    return res.status(403).render('auth/login', buildLoginPayload({
      error: 'Please use Admin access level for this account.',
      success: '',
      hasAccounts,
      username: loginInputRaw,
      accessLevel,
    }));
  }

  const liveName = matchedEmployee ? getTechnicianDisplayName(matchedEmployee) : account.username;
  const liveEmployeeId = matchedEmployee
    ? normalizeEmployeeId(matchedEmployee.employee_id)
    : (accountEmployeeId(account) || account.receptionist_employee_id || '');

  req.session.user = {
    id: account.id,
    username: liveName || account.username,
    role: accountRole,
    technician_name: account.technician_name || '',
    technician_employee_id: account.technician_employee_id || '',
    employee_id: liveEmployeeId,
    receptionist_employee_id: isReceptionistFamily(accountRole) ? liveEmployeeId : (account.receptionist_employee_id || ''),
    receptionist_name: isFrontlineRole(accountRole) ? liveName : (account.receptionist_name || ''),
    job_code: matchedEmployee ? String(matchedEmployee.job_code || '').trim() : (account.receptionist_job_code || ''),
    branch: isFrontlineRole(accountRole) ? selectedBranch : '',
  };

  return res.redirect(redirectForRole(accountRole));
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

  return res.redirect('/auth/login?registered=1&level=admin');
});

router.get('/register-hr', async (req, res) => {
  if (req.session.user && !canManageAccounts(req)) {
    return res.redirect(redirectForRole(normalizeRole(req.session.user.role)));
  }

  return res.render('auth/register-hr', {
    error: '',
    username: '',
  });
});

router.post('/register-hr', async (req, res) => {
  const username = normalizeUsername(req.body.username);
  const password = String(req.body.password || '');
  const confirmPassword = String(req.body.confirm_password || '');

  if (!username || !password) {
    return res.status(400).render('auth/register-hr', {
      error: 'Username and password are required.',
      username,
    });
  }

  if (password.length < 6) {
    return res.status(400).render('auth/register-hr', {
      error: 'Password must be at least 6 characters.',
      username,
    });
  }

  if (password !== confirmPassword) {
    return res.status(400).render('auth/register-hr', {
      error: 'Password confirmation does not match.',
      username,
    });
  }

  const users = await store.getAll('users');
  const exists = users.some((user) => normalizeUsername(user.username) === username);
  if (exists) {
    return res.status(409).render('auth/register-hr', {
      error: 'Username already exists. Please choose another.',
      username,
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
