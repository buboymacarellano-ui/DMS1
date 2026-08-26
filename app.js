const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const customersRouter = require('./routes/customers');
const vehiclesRouter = require('./routes/vehicles');
const workOrdersRouter = require('./routes/workorders');
const workOrderTransactionsRouter = require('./routes/workorder-transactions');
const pricingRouter = require('./routes/pricing');
const transactionsRouter = require('./routes/transactions');
const partsRouter = require('./routes/parts');
const partsManagerRouter = require('./routes/parts-manager');
const { isPartsManagerRole } = require('./routes/parts-manager');
const financeRouter = require('./routes/finance');
const { isFinanceManagerRole, ROLE_FINANCE_MANAGER, computeInvoiceEconomics, buildPartsCostIndex } = require('./lib/finance-ledger');
// Invoice/transaction finance fields (persisted on work_orders + transaction_records):
// paymentMethod, partsCostPrice, partsSellingPrice, laborCost, taxAmount, paymentStatus.
const employeesRouter = require('./routes/employees');
const helperRouter = require('./routes/helper');
const branchPartsRouter = require('./routes/branch-parts');
const technicianRouter = require('./routes/technician');
const adminRouter = require('./routes/admin');
const hrRouter = require('./routes/hr');
const storesRouter = require('./routes/stores');
const authRouter = require('./routes/auth');
const kpiRouter = require('./routes/kpi');
const approvalsRouter = require('./routes/approvals');
const reportsRouter = require('./routes/reports');
const store = require('./data/store');
const {
  buildComebackWorkOrderIdSet,
  computeQualityMetrics,
} = require('./lib/comeback-metrics');
const {
  resolveBranchCatalog,
  averageOperationalBranchMetric,
  normalizeBranchKey,
  canonicalizeBranchName,
  isPipelineBranch,
  DEFAULT_OPERATIONAL_BRANCHES,
  PRIMARY_BRANCH_NAME,
} = require('./lib/branches');
const { buildOcpdReport } = require('./lib/ocpd-reporting');
const { buildTechnicianOperations, toDashboardStats } = require('./lib/technician-activity');
const { getFteSeedTransactions } = require('./lib/fte-seed');
const {
  TYPE_SOLD,
  isPartsActivityLog,
  normalizePartsTransactionType,
} = require('./lib/parts-request');
const {
  envLoginDisabled,
  isLoginAuthDisabled,
  isOpenLoginEnabled,
  loadLoginAuthState,
} = require('./lib/login-auth');

const ROLE_GENERAL_MANAGER = 'general_manager';
const ROLE_ADMIN = 'admin';
const ROLE_HR = 'hr';
const {
  ROLE_SERVICE_ADVISOR,
  ROLE_SERVICE_RECEPTIONIST,
  ROLE_SENIOR_SERVICE_RECEPTIONIST,
  isFrontlineRole,
  frontlineHomePath,
  frontlineRoleLabel,
} = require('./lib/frontline-roles');
const portals = require('./lib/portals');
const ROLE_STM = portals.ROLE_STM;
const ROLE_PARTS_MANAGER = portals.ROLE_PARTS_MANAGER;
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
const ROLE_ASSETS_FACILITIES = portals.ROLE_ASSETS_FACILITIES;
const ROLE_ACCOUNTING = portals.ROLE_ACCOUNTING;
const APPROVER_ROLES = new Set([
  ROLE_GENERAL_MANAGER,
  ROLE_ADMIN,
  ROLE_HR,
  ROLE_HR_MANAGER,
  ROLE_STM,
  ROLE_OPERATIONS_MANAGER,
  ROLE_STORE_MANAGER,
]);
const BYPASS_ROLES = new Set([
  ROLE_SERVICE_ADVISOR,
  ROLE_SERVICE_RECEPTIONIST,
  ROLE_SENIOR_SERVICE_RECEPTIONIST,
  ROLE_GENERAL_MANAGER,
  ROLE_ADMIN,
  ROLE_HR,
  ROLE_HR_MANAGER,
  ROLE_HR_GENERALIST,
  ROLE_PAYROLL,
  ROLE_HR_CLERK,
  ROLE_STM,
  ROLE_PARTS_MANAGER,
  ROLE_PARTS_CLERK,
  ROLE_FINANCE_MANAGER,
  ROLE_ACCOUNTING,
  ROLE_ASSETS_FACILITIES,
  ROLE_TECHNICIAN,
  ROLE_OPERATIONS_MANAGER,
  ROLE_STORE_MANAGER,
  ROLE_CASHIER,
  ROLE_STORES_CLERK,
]);
const HR_SEED_USERNAME = 'HR';
const HR_SEED_PASSWORD = '123456';

// Temporary env toggle: set DISABLE_LOGIN=1 to auto-bypass login in local dev.
// HR Sign Up also has a Disable Login Auth button for empty-form login while building.
const AUTH_DISABLED = envLoginDisabled();
const requestedBypassRole = String(process.env.BYPASS_ROLE || ROLE_SERVICE_RECEPTIONIST).trim().toLowerCase();
const BYPASS_ROLE = BYPASS_ROLES.has(requestedBypassRole) ? requestedBypassRole : ROLE_SERVICE_RECEPTIONIST;

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';

function resolveSessionSecret() {
  const fromEnv = String(process.env.SESSION_SECRET || '').trim();
  if (fromEnv.length >= 32) return fromEnv;

  const dataDir = String(process.env.DMS_SQLITE_PATH || '').trim()
    ? path.dirname(path.resolve(process.env.DMS_SQLITE_PATH))
    : (fs.existsSync('/data') ? '/data' : path.join(process.env.LOCALAPPDATA || __dirname, 'AE-DMS'));
  const secretFile = path.join(dataDir, 'session-secret.txt');

  try {
    if (fs.existsSync(secretFile)) {
      const stored = String(fs.readFileSync(secretFile, 'utf8') || '').trim();
      if (stored.length >= 32) return stored;
    }
  } catch (_) {
    // Fall through and generate.
  }

  const generated = crypto.randomBytes(32).toString('hex');
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(secretFile, generated, { encoding: 'utf8', mode: 0o600 });
    console.log('Generated SESSION_SECRET file at', secretFile);
    return generated;
  } catch (error) {
    if (isProduction) {
      throw new Error('SESSION_SECRET must be set to at least 32 characters in production. Add it in Render Environment, then Redeploy.');
    }
    return 'local-dev-only-secret-change-me';
  }
}

const sessionSecret = resolveSessionSecret();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));
app.use(express.urlencoded({ extended: true, limit: '8mb' }));
app.use(express.json({ limit: '200kb' }));
app.use(session({
  name: 'dms.sid',
  secret: sessionSecret || 'local-dev-only-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    maxAge: 1000 * 60 * 60 * 12,
  },
}));
app.use(express.static(path.join(__dirname, 'public')));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many authentication requests. Please try again in 15 minutes.',
});

app.use(async (req, res, next) => {
  if (AUTH_DISABLED && !req.session.user) {
    const roleLabel = BYPASS_ROLE === ROLE_GENERAL_MANAGER
      ? 'GM'
      : (BYPASS_ROLE === ROLE_ADMIN ? 'FO' : (BYPASS_ROLE === ROLE_HR ? 'HR' : (BYPASS_ROLE === ROLE_STM ? 'STM' : (BYPASS_ROLE === ROLE_PARTS_MANAGER ? 'PARTS' : (BYPASS_ROLE === ROLE_FINANCE_MANAGER || BYPASS_ROLE === ROLE_ACCOUNTING ? 'ACCT' : (BYPASS_ROLE === ROLE_ASSETS_FACILITIES ? 'A&F' : (BYPASS_ROLE === ROLE_TECHNICIAN ? 'TECH' : 'SA')))))));
    req.session.user = {
      id: `dev-bypass-${BYPASS_ROLE}`,
      username: `DEV-${roleLabel}`,
      role: BYPASS_ROLE,
    };
  }
  res.locals.currentUser = req.session.user || null;
  res.locals.globalError = req.session.globalError || '';
  res.locals.loginAuthDisabled = isLoginAuthDisabled();
  res.locals.openLoginEnabled = isOpenLoginEnabled();
  res.locals.deletePasswordEnabled = await store.isDeletePasswordEnabled();
  res.locals.currentPath = req.path || '';
  res.locals.currentQuery = req.query || {};
  const activeRole = String(req.session.user && req.session.user.role || '').trim().toLowerCase();
  const activePortal = portals.portalForPath(req.path) || portals.departmentForRole(activeRole);
  res.locals.canApproveRequests = APPROVER_ROLES.has(activeRole) || portals.hasGrant(activeRole, activePortal, portals.GRANT.approval);
  res.locals.isPartsManager = isPartsManagerRole(activeRole);
  res.locals.isFinanceManager = isFinanceManagerRole(activeRole);
  res.locals.isGmSupervisor = activeRole === ROLE_GENERAL_MANAGER;
  res.locals.currentPortal = activePortal;
  res.locals.portalLabel = portals.portalLabel(activePortal);
  res.locals.accessiblePortals = activeRole ? portals.accessiblePortals(activeRole) : [];
  res.locals.canGrant = (portalKey, grantKey) => portals.hasGrant(activeRole, portalKey, grantKey);
  res.locals.pendingApprovalCount = res.locals.canApproveRequests
    ? (await store.getAll('approval_requests')).filter(request => request.status === 'pending').length
    : 0;
  delete req.session.globalError;
  next();
});

app.get('/healthz', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    storage: store.getEngineName ? store.getEngineName() : 'sqlite',
    sqlitePath: store.getSqlitePath(),
    jsonSnapshot: store.getSnapshotPath(),
    persistent: true,
  });
});

app.use('/auth', authLimiter, authRouter);

app.use((req, res, next) => {
  if (envLoginDisabled()) return next();
  if (req.path.startsWith('/auth/')) return next();
  if (req.session.user) return next();
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  return res.redirect('/auth/login');
});

app.use((req, res, next) => {
  if (isLoginAuthDisabled()) return next();
  if (req.path.startsWith('/auth/')) return next();
  if (req.path === '/healthz') return next();
  const user = req.session && req.session.user;
  if (!user) return next();
  if (req.path === '/helper' || req.path.indexOf('/helper') === 0) return next();
  if (req.path === '/approvals' || req.path.indexOf('/approvals') === 0) {
    if (
      portals.hasGrant(user, portals.PORTAL_SERVICE, portals.GRANT.approval)
      || portals.hasGrant(user, portals.PORTAL_PARTS, portals.GRANT.approval)
      || portals.hasGrant(user, portals.PORTAL_STORES, portals.GRANT.approval)
      || portals.hasGrant(user, portals.PORTAL_HR, portals.GRANT.approval)
      || portals.hasGrant(user, portals.PORTAL_SERVICE, portals.GRANT.request)
      || portals.hasGrant(user, portals.PORTAL_PARTS, portals.GRANT.request)
      || portals.hasGrant(user, portals.PORTAL_STORES, portals.GRANT.request)
      || portals.hasGrant(user, portals.PORTAL_HR, portals.GRANT.request)
    ) {
      return next();
    }
    return res.redirect(portals.homePathForRole(user.role));
  }
  if (req.path === '/transactions' || req.path.indexOf('/transactions') === 0) {
    if (
      portals.canEnterPortal(user, portals.PORTAL_SERVICE, req.method)
      || portals.canEnterPortal(user, portals.PORTAL_STORES, req.method)
      || portals.canEnterPortal(user, portals.PORTAL_GM, req.method)
    ) {
      return next();
    }
    return res.redirect(portals.homePathForRole(user.role));
  }
  const portalKey = portals.portalForPath(req.path);
  if (!portalKey) return next();
  if (portals.canEnterPortal(user, portalKey, req.method)) return next();
  if (req.path.startsWith('/api/')) return res.status(403).json({ error: 'Forbidden' });
  return res.redirect(portals.homePathForRole(user.role));
});

function normalizeBranchAccess(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

app.use((req, res, next) => {
  if (req.method !== 'POST') return next();
  const isNewWorkOrder = req.path === '/work-orders/new';
  const isWorkOrderEdit = /^\/work-orders\/[^/]+\/edit\/?$/i.test(req.path);
  if (!isNewWorkOrder && !isWorkOrderEdit) return next();

  const user = req.session && req.session.user ? req.session.user : {};
  req.body.service_advisor = String(user.username || user.receptionist_name || '').trim();
  return next();
});

app.use(async (req, res, next) => {
  if (isLoginAuthDisabled()) return next();
  const user = req.session && req.session.user ? req.session.user : {};
  if (!isFrontlineRole(user.role)) return next();

  const branch = canonicalizeBranchName(String(user.branch || '').trim());
  if (!branch) return res.status(403).send('Assigned branch is required. Please log in again.');

  if (req.method === 'POST' && req.path === '/work-orders/new') {
    req.body.branch = branch;
    req.body.service_advisor = user.username || user.receptionist_name || '';
  }

  const workOrderMatch = req.path.match(/^\/work-orders\/([^/]+)(?:\/|$)/i);
  if (!workOrderMatch || workOrderMatch[1] === 'new') return next();
  const workOrder = await store.getById('work_orders', decodeURIComponent(workOrderMatch[1]));
  if (!workOrder) return next();
  if (normalizeBranchKey(workOrder.branch) !== normalizeBranchKey(branch)) {
    return res.status(403).send('This work order belongs to another branch.');
  }
  if (req.method === 'POST' && /\/edit\/?$/i.test(req.path)) {
    req.body.branch = branch;
    req.body.service_advisor = user.username || user.receptionist_name || '';
  }
  return next();
});

function getSafeReturnPath(req) {
  const fallback = '/';
  const referrer = String(req.get('referer') || '').trim();
  if (!referrer) return fallback;

  try {
    const base = `${req.protocol}://${req.get('host')}`;
    const parsed = new URL(referrer, base);
    if (parsed.host !== req.get('host')) return fallback;
    return `${parsed.pathname}${parsed.search}`;
  } catch (error) {
    return fallback;
  }
}

app.use(async (req, res, next) => {
  if (!res.locals.deletePasswordEnabled) return next();
  const isDeleteRequest = req.method === 'POST' && /\/delete\/?$/i.test(req.path);
  if (!isDeleteRequest) return next();

  const configured = await store.hasDeletePassword();
  const valid = configured && await store.verifyDeletePassword(req.body.delete_password);
  if (valid) return next();

  req.session.globalError = configured
    ? 'Delete cancelled: incorrect admin delete password.'
    : 'Delete cancelled: the Admin has not configured the delete password.';
  return res.redirect(getSafeReturnPath(req));
});

function requireRole(role) {
  return (req, res, next) => {
    if (isLoginAuthDisabled()) return next();
    const activeRole = String(req.session.user && req.session.user.role || '').trim().toLowerCase();
    if (activeRole === role) return next();
    if (req.path.startsWith('/api/')) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    return res.redirect('/');
  };
}

function requireAnyRole(...roles) {
  return (req, res, next) => {
    if (isLoginAuthDisabled()) return next();
    const activeRole = String(req.session.user && req.session.user.role || '').trim().toLowerCase();
    if (roles.includes(activeRole)) return next();
    if (req.path.startsWith('/api/')) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    return res.redirect('/');
  };
}

function requirePortalAccess(portalKey, grantKey) {
  return (req, res, next) => {
    if (isLoginAuthDisabled()) return next();
    const user = req.session && req.session.user;
    if (!user) return res.redirect('/auth/login');
    if (grantKey) {
      if (portals.hasGrant(user, portalKey, grantKey) || portals.hasGrant(user, portalKey, portals.GRANT.access)) {
        if (grantKey === portals.GRANT.limited_view || portals.canEnterPortal(user, portalKey, req.method)) {
          return next();
        }
      }
      if (portals.hasGrant(user, portalKey, grantKey)) return next();
      if (req.path.startsWith('/api/')) return res.status(403).json({ error: 'Forbidden' });
      return res.redirect(portals.homePathForRole(user.role));
    }
    if (portals.canEnterPortal(user, portalKey, req.method)) return next();
    if (req.path.startsWith('/api/')) return res.status(403).json({ error: 'Forbidden' });
    return res.redirect(portals.homePathForRole(user.role));
  };
}

function requireGrant(portalKey, grantKey) {
  return (req, res, next) => {
    if (isLoginAuthDisabled()) return next();
    const user = req.session && req.session.user;
    if (portals.hasGrant(user, portalKey, grantKey)) return next();
    if (req.path.startsWith('/api/')) return res.status(403).json({ error: 'Forbidden' });
    return res.redirect(portals.homePathForRole(user && user.role));
  };
}

function requireFinanceManager(req, res, next) {
  if (isLoginAuthDisabled()) return next();
  const activeRole = String(req.session.user && req.session.user.role || '').trim().toLowerCase();
  if (
    isFinanceManagerRole(activeRole)
    || activeRole === ROLE_GENERAL_MANAGER
    || activeRole === ROLE_ADMIN
  ) return next();
  const url = String(req.originalUrl || req.path || '');
  if (url.indexOf('/api/') !== -1) return res.status(403).json({ error: 'Finance Office Accounting access only.' });
  return res.status(403).send('Finance Office Accounting access only.');
}

function requirePartsManager(req, res, next) {
  if (isLoginAuthDisabled()) return next();
  const activeRole = String(req.session.user && req.session.user.role || '').trim().toLowerCase();
  // GM has full supervisory read/write access to PM workspace
  if (isPartsManagerRole(activeRole) || activeRole === ROLE_GENERAL_MANAGER) return next();
  return res.status(403).send('Parts Manager access only.');
}

async function ensureSeedHrAccount() {
  const users = await store.getAll('users');
  const exists = users.some((user) => String(user.role || '').trim().toLowerCase() === ROLE_HR);
  if (exists) return;

  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = crypto.pbkdf2Sync(HR_SEED_PASSWORD, salt, 120000, 64, 'sha512').toString('hex');

  await store.create('users', {
    username: HR_SEED_USERNAME,
    role: ROLE_HR,
    password_salt: salt,
    password_hash: passwordHash,
  });
}

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function getServiceLineTotal(item) {
  const manualTotal = toNumber(item && item.total_price);
  if (manualTotal > 0) return manualTotal;

  const labor = toNumber(item && item.labor_price);
  const serviceQty = Math.max(1, toNumber(item && item.service_qty) || 1);
  const qtyRaw = Number(item && item.parts_qty);
  const hasQty = Number.isFinite(qtyRaw) && qtyRaw > 0;
  const partsUnitPrice = toNumber(item && item.parts_price);
  const partsTotal = hasQty ? qtyRaw * partsUnitPrice : partsUnitPrice;
  return (labor * serviceQty) + partsTotal;
}

function getWorkOrderTotal(wo) {
  const items = Array.isArray(wo && wo.service_items) ? wo.service_items : [];
  return items.reduce((sum, item) => sum + getServiceLineTotal(item), 0);
}

function getWorkOrderLaborTotal(wo) {
  const items = Array.isArray(wo && wo.service_items) ? wo.service_items : [];
  return items.reduce((sum, item) => sum + (toNumber(item && item.labor_price) * Math.max(1, toNumber(item && item.service_qty) || 1)), 0);
}

function getWorkOrderLaborHours(wo) {
  const header = toNumber(wo && wo.labor_hours);
  if (header > 0) return header;
  const items = Array.isArray(wo && wo.service_items) ? wo.service_items : [];
  return items.reduce((sum, item) => {
    const qty = Math.max(1, toNumber(item && item.service_qty) || 1);
    return sum + (toNumber(item && item.labor_hours) * qty);
  }, 0);
}

function getWorkOrderPartsTotal(wo) {
  const items = Array.isArray(wo && wo.service_items) ? wo.service_items : [];
  return items.reduce((sum, item) => {
    const qtyRaw = Number(item && item.parts_qty);
    const hasQty = Number.isFinite(qtyRaw) && qtyRaw > 0;
    const unitPrice = toNumber(item && item.parts_price);
    return sum + (hasQty ? (qtyRaw * unitPrice) : unitPrice);
  }, 0);
}

function getWorkOrderRevenueTotal(wo) {
  return getWorkOrderLaborTotal(wo) + getWorkOrderPartsTotal(wo);
}

function getStartOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function getStartOfWeek(date) {
  const day = date.getDay();
  const shift = day === 0 ? 6 : day - 1;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - shift, 0, 0, 0, 0);
}

function isWorkOrderOpen(wo) {
  const status = String(wo && wo.status || '').trim().toLowerCase();
  return status === 'open'
    || status === 'in-progress'
    || status === 'waiting-parts'
    || status === 'break'
    || status === 'on-other-priority'
    || status === 'completed';
}

function isWorkOrderClosed(wo) {
  const status = String(wo && wo.status || '').trim().toLowerCase();
  return status === 'closed';
}

function toAgeBucket(createdAt, now) {
  const startedAt = new Date(createdAt || 0);
  const elapsedMs = Math.max(0, now.getTime() - startedAt.getTime());
  const ageDays = Math.floor(elapsedMs / 86400000);
  if (ageDays <= 2) return '0-2';
  if (ageDays <= 5) return '3-5';
  return '6+';
}

function buildTopServices(workOrders) {
  const groups = new Map();
  for (const wo of workOrders) {
    const items = Array.isArray(wo.service_items) ? wo.service_items : [];
    for (const item of items) {
      const service = String(item.reason || item.service_type || item.description || '').trim() || 'Unspecified';
      const total = getServiceLineTotal(item);
      const entry = groups.get(service) || { service, count: 0, revenue: 0 };
      entry.count += 1;
      entry.revenue += total;
      groups.set(service, entry);
    }
  }

  return Array.from(groups.values())
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);
}

function buildTopTechnicians(workOrders) {
  const groups = new Map();
  for (const wo of workOrders) {
    const tech = String(wo.technician || '').trim();
    if (!tech) continue;
    const total = getWorkOrderTotal(wo);
    const entry = groups.get(tech) || { technician: tech, closedCount: 0, revenue: 0 };
    if (isWorkOrderClosed(wo)) {
      entry.closedCount += 1;
      entry.revenue += total;
    }
    groups.set(tech, entry);
  }

  return Array.from(groups.values())
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);
}

const GM_BRANCH_TARGET_TOTAL = 25;

function defaultGmBranchSalesTargets() {
  return {
    monthKey: '2026-08',
    monthLabel: 'August 2026',
    branches: {
      Carx2: 1800000,
      Carmen: 1500000,
      CebuCity: 2500000,
      Lapux2: 2600000,
      Bogo: 2000000,
      Toledo: 1600000,
      ITPark: 1700000,
    },
  };
}

function resolveGmBranchSalesTargets(pricingSettings) {
  const defaults = defaultGmBranchSalesTargets();
  const stored = pricingSettings && pricingSettings.gm_branch_sales_targets
    ? pricingSettings.gm_branch_sales_targets
    : {};
  const storedBranches = stored.branches && typeof stored.branches === 'object' ? stored.branches : {};
  const branches = {};
  DEFAULT_OPERATIONAL_BRANCHES.forEach((name) => {
    const value = Number(storedBranches[name]);
    branches[name] = Number.isFinite(value) && value >= 0 ? value : defaults.branches[name];
  });
  return {
    monthKey: stored.monthKey || defaults.monthKey,
    monthLabel: stored.monthLabel || defaults.monthLabel,
    branches,
  };
}

function scaleMonthlySalesTarget(monthlyAmount, duration) {
  const monthly = Math.max(0, Number(monthlyAmount) || 0);
  const code = normalizeGmDuration(duration);
  if (code === 'H') return monthly / 22 / 8;
  if (code === 'D') return monthly / 22;
  if (code === 'W') return monthly / 4;
  if (code === 'Y' || code === 'ALL') return monthly * 12;
  return monthly;
}

function durationWorkOrderTarget(duration) {
  const code = normalizeGmDuration(duration);
  if (code === 'H') return Math.max(1, Number((GM_BRANCH_TARGET_TOTAL / 22 / 8).toFixed(2)));
  if (code === 'D') return Math.max(1, Number((GM_BRANCH_TARGET_TOTAL / 22).toFixed(2)));
  if (code === 'W') return Math.max(1, Number((GM_BRANCH_TARGET_TOTAL / 4).toFixed(2)));
  if (code === 'Y') return GM_BRANCH_TARGET_TOTAL * 12;
  if (code === 'ALL') return GM_BRANCH_TARGET_TOTAL * 12;
  return GM_BRANCH_TARGET_TOTAL;
}

function isDateInGmWindow(date, rangeWindow) {
  if (!rangeWindow || !date || !Number.isFinite(date.getTime())) return !rangeWindow;
  return date >= rangeWindow.start && date < rangeWindow.end;
}

function normalizeGmBranchKey(value) {
  return normalizeBranchKey(value);
}

function formatDashboardPeso(value) {
  return '₱' + Number(value || 0).toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function roundOneDecimal(value) {
  return Math.round((Number(value) || 0) * 10) / 10;
}

function clampDisplayPct(value) {
  return Math.max(0, Math.min(100, Number(value) || 0));
}

function pacingHealthStatus(pct) {
  if (pct >= 100) return 'ahead';
  if (pct >= 90) return 'on-pace';
  if (pct >= 70) return 'watch';
  return 'behind';
}

function resolveFrontlineDashboardBranch(user) {
  const fromUser = canonicalizeBranchName(String(user && user.branch || '').trim());
  return fromUser || PRIMARY_BRANCH_NAME;
}

function monthPacingWindow() {
  const period = resolveGmReportPeriod();
  const daysInMonth = Math.max(1, Math.round((period.endOfMonth.getTime() - period.startOfMonth.getTime()) / 86400000));
  const elapsedDays = Math.min(
    daysInMonth,
    Math.max(1, Math.round((period.endOfDay.getTime() - period.startOfMonth.getTime()) / 86400000))
  );
  return {
    period,
    daysInMonth,
    elapsedDays,
    expectedPct: (elapsedDays / daysInMonth) * 100,
  };
}

function buildRevenueBarsFromTotals(opts) {
  const laborRevenue = Number(opts.laborRevenue || 0);
  const partsRevenue = Number(opts.partsRevenue || 0);
  const totalGross = Number(opts.totalGross || 0);
  const monthlyTarget = Number(opts.monthlyTarget || 0);
  const expectedPct = Number(opts.expectedPct != null ? opts.expectedPct : monthPacingWindow().expectedPct);
  const actualPct = monthlyTarget > 0 ? (totalGross / monthlyTarget) * 100 : 0;
  const pacingHealthPct = expectedPct > 0 ? (actualPct / expectedPct) * 100 : 0;
  const healthStatus = pacingHealthStatus(pacingHealthPct);
  const targetShare = (amount) => (monthlyTarget > 0 ? (amount / monthlyTarget) * 100 : 0);
  const noTargetMeta = 'Set this branch target in GM My Enterprises';
  const monthLabel = opts.monthLabel || '';

  return {
    monthLabel,
    monthKey: opts.monthKey || '',
    branch: opts.branchLabel || '',
    laborRevenue,
    partsRevenue,
    totalGross,
    monthlyTarget,
    pacingHealthPct: roundOneDecimal(pacingHealthPct),
    expectedPct: roundOneDecimal(expectedPct),
    actualPct: roundOneDecimal(actualPct),
    bars: [
      {
        key: 'labor',
        label: 'MTD Labor Revenue',
        valueText: formatDashboardPeso(laborRevenue),
        meta: monthlyTarget > 0
          ? `${roundOneDecimal(targetShare(laborRevenue)).toFixed(1)}% of month target`
          : noTargetMeta,
        fillPct: roundOneDecimal(clampDisplayPct(targetShare(laborRevenue))),
        tone: 'labor',
      },
      {
        key: 'parts',
        label: 'MTD Parts Revenue',
        valueText: formatDashboardPeso(partsRevenue),
        meta: monthlyTarget > 0
          ? `${roundOneDecimal(targetShare(partsRevenue)).toFixed(1)}% of month target`
          : noTargetMeta,
        fillPct: roundOneDecimal(clampDisplayPct(targetShare(partsRevenue))),
        tone: 'parts',
      },
      {
        key: 'gross',
        label: 'MTD Total Gross Revenue',
        valueText: formatDashboardPeso(totalGross),
        meta: monthlyTarget > 0
          ? `${roundOneDecimal(actualPct).toFixed(1)}% of month target`
          : noTargetMeta,
        fillPct: roundOneDecimal(clampDisplayPct(actualPct)),
        tone: 'gross',
      },
      {
        key: 'target',
        label: 'Month Total Gross Revenue Target',
        valueText: formatDashboardPeso(monthlyTarget),
        meta: monthlyTarget > 0
          ? `GM target · ${monthLabel || 'this month'}`
          : noTargetMeta,
        fillPct: monthlyTarget > 0 ? 100 : 0,
        tone: 'target',
      },
      {
        key: 'pacing',
        label: 'Pacing Health%',
        valueText: `${roundOneDecimal(pacingHealthPct).toFixed(1)}%`,
        meta: monthlyTarget > 0
          ? `Expected ${roundOneDecimal(expectedPct).toFixed(1)}% of target by today`
          : noTargetMeta,
        fillPct: roundOneDecimal(clampDisplayPct(pacingHealthPct)),
        tone: healthStatus,
      },
    ],
  };
}

function buildFrontlineBranchRevenueBars(branchName, transactionRecords, pricingSettings) {
  const window = monthPacingWindow();
  const snapshots = getLatestTransactionSnapshots(transactionRecords, window.period.endOfDay);
  const canonical = canonicalizeBranchName(branchName) || String(branchName || '').trim();
  const branchKey = normalizeGmBranchKey(canonical);
  const salesTargets = resolveGmBranchSalesTargets(pricingSettings);
  const monthlyTarget = Number(
    (salesTargets.branches && (
      salesTargets.branches[canonical] != null
        ? salesTargets.branches[canonical]
        : salesTargets.branches[branchName]
    )) || 0
  );

  let laborRevenue = 0;
  let partsRevenue = 0;
  let totalGross = 0;
  for (const { record, date } of snapshots) {
    if (date < window.period.startOfMonth || date >= window.period.endOfDay) continue;
    if (normalizeGmBranchKey(record && record.Branch) !== branchKey) continue;
    laborRevenue += toNumber(record['Total Labor']);
    partsRevenue += toNumber(record['Total Parts']);
    totalGross += getTransactionRecordTotal(record);
  }

  return buildRevenueBarsFromTotals({
    laborRevenue,
    partsRevenue,
    totalGross,
    monthlyTarget,
    expectedPct: window.expectedPct,
    monthLabel: salesTargets.monthLabel,
    monthKey: salesTargets.monthKey,
    branchLabel: canonical,
  });
}

function buildPacingByScope(transactionRecords, pricingSettings) {
  const window = monthPacingWindow();
  const snapshots = getLatestTransactionSnapshots(transactionRecords, window.period.endOfDay);
  const salesTargets = resolveGmBranchSalesTargets(pricingSettings);
  const buckets = new Map(
    DEFAULT_OPERATIONAL_BRANCHES.map((name) => [normalizeGmBranchKey(name), {
      name,
      laborRevenue: 0,
      partsRevenue: 0,
      totalGross: 0,
      monthlyTarget: Number((salesTargets.branches && salesTargets.branches[name]) || 0),
    }])
  );

  for (const { record, date } of snapshots) {
    if (date < window.period.startOfMonth || date >= window.period.endOfDay) continue;
    const entry = buckets.get(normalizeGmBranchKey(record && record.Branch));
    if (!entry) continue;
    entry.laborRevenue += toNumber(record['Total Labor']);
    entry.partsRevenue += toNumber(record['Total Parts']);
    entry.totalGross += getTransactionRecordTotal(record);
  }

  const scopes = { ALL: null };
  let allLabor = 0;
  let allParts = 0;
  let allGross = 0;
  let allTarget = 0;
  DEFAULT_OPERATIONAL_BRANCHES.forEach((name) => {
    const entry = buckets.get(normalizeGmBranchKey(name));
    scopes[name] = buildRevenueBarsFromTotals({
      laborRevenue: entry.laborRevenue,
      partsRevenue: entry.partsRevenue,
      totalGross: entry.totalGross,
      monthlyTarget: entry.monthlyTarget,
      expectedPct: window.expectedPct,
      monthLabel: salesTargets.monthLabel,
      monthKey: salesTargets.monthKey,
      branchLabel: name,
    });
    allLabor += entry.laborRevenue;
    allParts += entry.partsRevenue;
    allGross += entry.totalGross;
    allTarget += entry.monthlyTarget;
  });
  scopes.ALL = buildRevenueBarsFromTotals({
    laborRevenue: allLabor,
    partsRevenue: allParts,
    totalGross: allGross,
    monthlyTarget: allTarget,
    expectedPct: window.expectedPct,
    monthLabel: salesTargets.monthLabel,
    monthKey: salesTargets.monthKey,
    branchLabel: 'All branches',
  });
  return scopes;
}

function getTransactionRecordDate(record) {
  const date = new Date(record && (record['Transaction date'] || record.created_at) || 0);
  return Number.isFinite(date.getTime()) ? date : null;
}

function getTransactionRecordTotal(record) {
  if (!record) return 0;

  // 1. Extract the base positive total amount
  const baseTotal = toNumber(record['Grand Total'] || record['Totalwith Vat']);

  // 2. Identify if this specific record is flagged as a "Back Job"
  const statusField = record['Job Type'] || record['Transaction Type'] || record['Status'] || '';
  const isBackJob = String(statusField).toLowerCase().includes('back job');

  // 3. Return negative value if it's a Back Job, otherwise return normal total
  return isBackJob ? -Math.abs(baseTotal) : baseTotal;
}

function getTransactionWorkOrderNumber(record) {
  return String(record && (
    record['work order Number']
    || record.work_order_number
    || record.workOrderNumber
    || ''
  )).trim();
}

function getTransactionWorkOrderId(record) {
  return String(record && (record.work_order_id || record.workOrderId || '')).trim();
}


function getLatestTransactionSnapshots(records, endOfDay) {
  const latestByWorkOrder = new Map();
  for (const record of records) {
    const key = String(record.work_order_id || record['work order Number'] || record.id || '').trim();
    const date = getTransactionRecordDate(record);
    if (!key || !date || date >= endOfDay) continue;
    const current = latestByWorkOrder.get(key);
    if (!current || date > current.date) latestByWorkOrder.set(key, { record, date });
  }
  return Array.from(latestByWorkOrder.values());
}

function getManilaDateKey(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function resolveGmReportPeriod(value) {
  const requested = String(value || '').trim();
  const dateKey = /^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : getManilaDateKey(new Date());
  const startOfDay = new Date(`${dateKey}T00:00:00+08:00`);
  if (!Number.isFinite(startOfDay.getTime())) return resolveGmReportPeriod('');
  const endOfDay = new Date(startOfDay.getTime() + 86400000);
  const weekday = new Date(`${dateKey}T00:00:00Z`).getUTCDay();
  const daysFromMonday = weekday === 0 ? 6 : weekday - 1;
  const startOfWeek = new Date(startOfDay.getTime() - (daysFromMonday * 86400000));
  const endOfWeek = new Date(startOfWeek.getTime() + (7 * 86400000));
  const startOfMonth = new Date(startOfDay.getFullYear(), startOfDay.getMonth(), 1);
  const endOfMonth = new Date(startOfDay.getFullYear(), startOfDay.getMonth() + 1, 1);
  const startOfYear = new Date(startOfDay.getFullYear(), 0, 1);
  const label = new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(`${dateKey}T12:00:00+08:00`));
  return { dateKey, label, startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfYear };
}

function normalizeGmDuration(value) {
  const code = String(value || 'D').trim().toUpperCase();
  return ['H', 'D', 'W', 'M', 'Y', 'ALL'].includes(code) ? code : 'D';
}

function manilaHourOnDate(dateKey) {
  const hourText = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila',
    hour: '2-digit',
    hour12: false,
  }).format(new Date());
  const hour = String(Math.min(23, Math.max(0, Number(hourText) || 0))).padStart(2, '0');
  const start = new Date(`${dateKey}T${hour}:00:00+08:00`);
  return { start, end: new Date(start.getTime() + 3600000) };
}

function resolveGmDurationWindow(period, duration) {
  const code = normalizeGmDuration(duration);
  const hourly = manilaHourOnDate(period.dateKey);
  const windows = {
    H: {
      start: hourly.start,
      end: hourly.end,
      cumulativeStart: period.startOfDay,
      revenueLabel: `Revenue on ${period.label}`,
      revenueDelta: '▲ Hourly close',
      cumulativeLabel: `Day Through ${period.label}`,
      cumulativeDelta: '▲ Day to date',
    },
    D: {
      start: period.startOfDay,
      end: period.endOfDay,
      cumulativeStart: period.startOfWeek,
      revenueLabel: `Revenue on ${period.label}`,
      revenueDelta: '▲ Daily close',
      cumulativeLabel: `Week Through ${period.label}`,
      cumulativeDelta: '▲ Week to date',
    },
    W: {
      start: period.startOfWeek,
      end: period.endOfDay,
      cumulativeStart: period.startOfMonth,
      revenueLabel: `Revenue on ${period.label}`,
      revenueDelta: '▲ Weekly close',
      cumulativeLabel: `Month Through ${period.label}`,
      cumulativeDelta: '▲ Month to date',
    },
    M: {
      start: period.startOfMonth,
      end: period.endOfDay,
      cumulativeStart: period.startOfYear,
      revenueLabel: `Revenue on ${period.label}`,
      revenueDelta: '▲ Monthly close',
      cumulativeLabel: `Year Through ${period.label}`,
      cumulativeDelta: '▲ Year to date',
    },
    Y: {
      start: period.startOfYear,
      end: period.endOfDay,
      cumulativeStart: new Date(0),
      revenueLabel: `Revenue on ${period.label}`,
      revenueDelta: '▲ Yearly close',
      cumulativeLabel: `All Through ${period.label}`,
      cumulativeDelta: '▲ All time',
    },
    ALL: {
      start: new Date(0),
      end: period.endOfDay,
      cumulativeStart: new Date(0),
      revenueLabel: `Revenue on ${period.label}`,
      revenueDelta: '▲ All records',
      cumulativeLabel: `All Through ${period.label}`,
      cumulativeDelta: '▲ All time',
    },
  };
  return Object.assign({ duration: code }, windows[code]);
}

function canonicalGmTechnicianName(value) {
  return String(value || '')
    .replace(/\s*\([^)]+\)\s*$/, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

const GM_MARKUP_TARGETS = Object.freeze({
  labor: 150,
  parts: 50,
  total: 80,
});
const GM_LABOR_COST_RATIO = 0.35;

function roundMoney2(value) {
  return Number((Number(value) || 0).toFixed(2));
}

function computeIndustryMarkupPct(selling, cost) {
  const sales = Number(selling) || 0;
  const basis = Number(cost) || 0;
  if (basis > 0) return ((sales - basis) / basis) * 100;
  if (sales > 0) return null;
  return 0;
}

function computeGrossMarginPct(selling, cost) {
  const sales = Number(selling) || 0;
  const basis = Number(cost) || 0;
  if (sales > 0) return ((sales - basis) / sales) * 100;
  return 0;
}

function gradeMarkupHealth(markupPct, targetPct) {
  if (markupPct == null || !Number.isFinite(Number(markupPct))) {
    return { code: 'na', label: 'No data' };
  }
  const actual = Number(markupPct);
  if (actual < 0) return { code: 'negative', label: 'Negative' };
  if (actual < targetPct * 0.5) return { code: 'weak', label: 'Weak' };
  if (actual < targetPct) return { code: 'watch', label: 'Watch' };
  return { code: 'strong', label: 'Healthy' };
}

function estimateTechnicianHourlyCost(employee, doorRate) {
  const pay = toNumber(employee && employee.base_salary_pay_rate);
  if (pay >= 5000) return pay / 176;
  if (pay > 0) return pay;
  return Math.max(1, Number(doorRate) || 350) * GM_LABOR_COST_RATIO;
}

function buildTechnicianCostRoster(employees, doorRate) {
  const roster = new Map();
  (employees || []).forEach((employee) => {
    const name = [employee.first_name, employee.middle_name, employee.last_name]
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .join(' ');
    const key = canonicalGmTechnicianName(name);
    if (!key) return;
    roster.set(key, estimateTechnicianHourlyCost(employee, doorRate));
  });
  return roster;
}

function workOrderSalesDate(wo) {
  const raw = wo && (wo.invoice_date || wo.paidAt || wo.updated_at || wo.created_at);
  const date = new Date(raw || 0);
  return Number.isFinite(date.getTime()) ? date : null;
}

function buildMarkupHealthLine(key, label, selling, cost, targetPct) {
  const markupPct = computeIndustryMarkupPct(selling, cost);
  const health = gradeMarkupHealth(markupPct, targetPct);
  return {
    key,
    label,
    selling: roundMoney2(selling),
    cost: roundMoney2(cost),
    markupPct: markupPct == null ? null : roundOneDecimal(markupPct),
    marginPct: roundOneDecimal(computeGrossMarginPct(selling, cost)),
    targetPct,
    healthCode: health.code,
    healthLabel: health.label,
  };
}

function overallMarkupHealthCode(lines) {
  if (lines.some((row) => row.healthCode === 'negative')) return 'negative';
  if (lines.some((row) => row.healthCode === 'weak')) return 'weak';
  if (lines.some((row) => row.healthCode === 'watch')) return 'watch';
  if (lines.every((row) => row.healthCode === 'na')) return 'na';
  return 'strong';
}

function overallMarkupHealthLabel(code) {
  if (code === 'strong') return 'Healthy';
  if (code === 'watch') return 'Watch';
  if (code === 'weak') return 'Weak';
  if (code === 'negative') return 'Negative';
  return 'No data';
}

function buildGmMarkupHealth(workOrders, transactionSnapshots, partsInventory, employees, pricingSettings, rangeWindow) {
  const doorRate = Math.max(1, toNumber(pricingSettings && pricingSettings.hourly_rate) || 350);
  const roster = buildTechnicianCostRoster(employees, doorRate);
  const defaultHourlyCost = doorRate * GM_LABOR_COST_RATIO;
  const partsCostIndex = buildPartsCostIndex(partsInventory);
  const workOrdersByNumber = new Map();
  const workOrdersById = new Map();
  (workOrders || []).forEach((wo) => {
    if (!wo) return;
    const number = String(wo.work_order_number || '').trim();
    const id = String(wo.id || '').trim();
    if (number) workOrdersByNumber.set(number, wo);
    if (id) workOrdersById.set(id, wo);
  });

  const soldByWorkOrder = new Map();
  (partsInventory || []).forEach((row) => {
    if (!row || isPartsActivityLog(row)) return;
    if (normalizePartsTransactionType(row.transaction_type || row.type) !== TYPE_SOLD) return;
    const woNumber = String(row.work_order_number || row.sold_to || '').trim();
    if (!woNumber) return;
    const qty = Math.max(0, toNumber(row.qty));
    const entry = soldByWorkOrder.get(woNumber) || { cost: 0, retail: 0 };
    entry.cost += qty * toNumber(row.cost_price);
    entry.retail += qty * toNumber(row.retail_price);
    soldByWorkOrder.set(woNumber, entry);
  });

  let laborSales = 0;
  let partsSales = 0;
  let partsCost = 0;
  let laborCost = 0;
  let billedCount = 0;

  (transactionSnapshots || []).forEach(({ record, date }) => {
    if (!isDateInGmWindow(date, rangeWindow)) return;
    const woNumber = getTransactionWorkOrderNumber(record);
    const woId = getTransactionWorkOrderId(record);
    const wo = (woId && workOrdersById.get(woId))
      || (woNumber && workOrdersByNumber.get(woNumber))
      || null;
    const economics = wo ? computeInvoiceEconomics(wo, partsCostIndex) : null;
    const labor = toNumber(record && record['Total Labor'])
      || (economics && economics.laborCost)
      || (wo ? getWorkOrderLaborTotal(wo) : 0);
    const parts = toNumber(record && record['Total Parts'])
      || (economics && economics.partsSellingPrice)
      || (wo ? getWorkOrderPartsTotal(wo) : 0);
    const sold = woNumber ? soldByWorkOrder.get(woNumber) : null;
    const hours = wo ? getWorkOrderLaborHours(wo) : 0;
    const techName = (wo && wo.technician) || (record && (record.Tecnician || record.Technician)) || '';
    const hourlyCost = roster.get(canonicalGmTechnicianName(techName)) || defaultHourlyCost;

    laborSales += labor;
    partsSales += parts;
    partsCost += sold && sold.cost > 0
      ? sold.cost
      : (economics && economics.partsCostPrice) || 0;
    laborCost += hours > 0 ? hours * hourlyCost : labor * GM_LABOR_COST_RATIO;
    billedCount += 1;
  });

  const labor = buildMarkupHealthLine('labor', 'Labor Markup', laborSales, laborCost, GM_MARKUP_TARGETS.labor);
  const parts = buildMarkupHealthLine('parts', 'Parts Markup', partsSales, partsCost, GM_MARKUP_TARGETS.parts);
  const total = buildMarkupHealthLine(
    'total',
    'Total Sales Markup',
    laborSales + partsSales,
    laborCost + partsCost,
    GM_MARKUP_TARGETS.total
  );
  const overallCode = overallMarkupHealthCode([labor, parts, total]);
  return {
    formula: '(Selling − Cost) ÷ Cost × 100',
    closedCount: billedCount,
    sourceLabel: billedCount
      ? billedCount + ' work-order transaction' + (billedCount === 1 ? '' : 's') + ' · parts database cost'
      : 'No work-order transactions in this range',
    labor,
    parts,
    total,
    overallCode,
    overallLabel: overallMarkupHealthLabel(overallCode),
  };
}

function buildGmNegativeReports(metrics) {
  const reports = [];
  const markup = metrics && metrics.markupHealth ? metrics.markupHealth : {};
  ['labor', 'parts', 'total'].forEach((key) => {
    const row = markup[key];
    if (!row) return;
    const pct = row.markupPct == null ? 'n/a' : Number(row.markupPct).toFixed(1) + '%';
    if (row.healthCode === 'negative') {
      reports.push({
        severity: 'alert',
        source: 'markup',
        title: row.label + ' is negative',
        detail: 'Selling below cost at ' + pct + ' markup.',
      });
    } else if (row.healthCode === 'weak') {
      reports.push({
        severity: 'alert',
        source: 'markup',
        title: row.label + ' is below industry health',
        detail: pct + ' vs ' + row.targetPct + '% industry target.',
      });
    } else if (row.healthCode === 'watch') {
      reports.push({
        severity: 'watch',
        source: 'markup',
        title: row.label + ' is off target',
        detail: pct + ' vs ' + row.targetPct + '% industry target.',
      });
    }
  });

  const alertBranches = [];
  const watchBranches = [];
  (metrics && metrics.branchMilestones ? metrics.branchMilestones : []).forEach((row) => {
    if (!row || row.isPipeline) return;
    if (row.statusWarningCode === 'alert') alertBranches.push(row.branch || 'Branch');
    else if (row.statusWarningCode === 'watch') watchBranches.push(row.branch || 'Branch');
  });
  if (alertBranches.length) {
    reports.push({
      severity: 'alert',
      source: 'branch',
      title: alertBranches.length + ' branch' + (alertBranches.length === 1 ? '' : 'es') + ' on Alert',
      detail: alertBranches.join(', '),
    });
  }
  if (watchBranches.length) {
    reports.push({
      severity: 'watch',
      source: 'branch',
      title: watchBranches.length + ' branch' + (watchBranches.length === 1 ? '' : 'es') + ' on Watch',
      detail: watchBranches.join(', '),
    });
  }

  const risks = Array.isArray(metrics && metrics.riskAlerts) ? metrics.riskAlerts : [];
  if (risks.length) {
    const oldest = risks[0] || {};
    reports.push({
      severity: 'alert',
      source: 'aging',
      title: risks.length + ' open job' + (risks.length === 1 ? '' : 's') + ' past 24 hours',
      detail: 'Oldest WO ' + (oldest.work_order_number || '—') + ' · ' + Number(oldest.ageHours || 0) + 'h.',
    });
  }

  const pending = Number(metrics && metrics.kpis && metrics.kpis.pendingBillingCount || 0);
  if (pending >= 5) {
    reports.push({
      severity: pending >= 10 ? 'alert' : 'watch',
      source: 'billing',
      title: pending + ' jobs pending billing',
      detail: 'Completed work is waiting to be invoiced.',
    });
  }

  reports.sort((a, b) => (a.severity === 'alert' ? 0 : 1) - (b.severity === 'alert' ? 0 : 1));
  return reports.slice(0, 6);
}

function buildGmTechnicianPerformance(workOrders, employees, pricingSettings, period) {
  const hourlyRate = Math.max(1, toNumber(pricingSettings && pricingSettings.hourly_rate) || 350);
  const incentiveRates = (pricingSettings && typeof pricingSettings.technician_incentive_rates === 'object')
    ? pricingSettings.technician_incentive_rates
    : {};
  const roster = new Map();

  (employees || [])
    .filter(employee => (
      String(employee.employee_id || '').trim() &&
      /(mechanic|aligner|toolkeeper|carwasher|technician)/i.test(String(employee.job_title || ''))
    ))
    .forEach(employee => {
      const name = [employee.first_name, employee.middle_name, employee.last_name]
        .map(value => String(value || '').trim())
        .filter(Boolean)
        .join(' ');
      const key = canonicalGmTechnicianName(name);
      if (key) roster.set(key, { id: String(employee.employee_id || '').trim() || '-', technician: name });
    });

  function rowsFor(start, end) {
    const totals = new Map(Array.from(roster.entries()).map(([key, profile]) => [key, {
      ...profile,
      billableHours: 0,
      laborHours: 0,
      laborAmount: 0,
    }]));

    (workOrders || []).forEach(workOrder => {
      const createdAt = new Date(workOrder.created_at || 0);
      if (!Number.isFinite(createdAt.getTime()) || createdAt < start || createdAt >= end) return;
      const key = canonicalGmTechnicianName(workOrder.technician);
      if (!key || !totals.has(key)) return;

      const entry = totals.get(key);
      const laborAmount = getWorkOrderLaborTotal(workOrder);
      const billableHours = laborAmount / hourlyRate;
      const shiftStart = parseClockOnDate(createdAt, workOrder.time_in);
      let shiftEnd = parseClockOnDate(createdAt, workOrder.time_out);
      if (shiftStart && shiftEnd && shiftEnd < shiftStart) shiftEnd = new Date(shiftEnd.getTime() + 86400000);
      const measuredHours = getElapsedHours(shiftStart, shiftEnd);

      entry.billableHours += billableHours;
      entry.laborHours += measuredHours > 0 ? measuredHours : billableHours;
      entry.laborAmount += laborAmount;
    });

    return Array.from(totals.values())
      .map(entry => {
        const configuredRate = Number(incentiveRates[entry.id]);
        const incentiveRatePct = Number.isFinite(configuredRate) && configuredRate >= 0 && configuredRate <= 100
          ? configuredRate
          : 5;
        return {
          ...entry,
          incentiveRatePct,
          incentive: entry.laborAmount * (incentiveRatePct / 100),
        };
      })
      .filter(entry => entry.billableHours > 0 || entry.laborHours > 0 || entry.laborAmount > 0)
      .sort((a, b) => b.laborAmount - a.laborAmount);
  }

  return {
    hourlyRate,
    incentiveConfigured: false,
    periods: [
      { key: 'mtd', label: 'MTD', rows: rowsFor(period.startOfMonth, period.endOfDay) },
      { key: 'week', label: 'Week', rows: rowsFor(period.startOfWeek, period.endOfWeek) },
      { key: 'month', label: 'Month', rows: rowsFor(period.startOfMonth, period.endOfMonth) },
    ],
  };
}

function isGmTechnicianEmployee(employee) {
  return /(mechanic|aligner|toolkeeper|carwasher|technician)/i.test(String(employee && employee.job_title || ''));
}

function buildGmEmployeeSalesPerformance(transactionRecords, employees, pricingSettings, period) {
  const incentiveRates = (pricingSettings && typeof pricingSettings.employee_incentive_rates === 'object')
    ? pricingSettings.employee_incentive_rates
    : {};
  const roster = new Map();
  (employees || []).forEach(employee => {
    const id = String(employee.employee_id || '').trim();
    if (!id || isGmTechnicianEmployee(employee)) return;
    const employeeName = [employee.first_name, employee.middle_name, employee.last_name]
      .map(value => String(value || '').trim()).filter(Boolean).join(' ');
    roster.set(canonicalGmTechnicianName(employeeName), { id, employee: employeeName || '-', jobTitle: String(employee.job_title || '').trim() || '-' });
  });

  const totals = new Map(Array.from(roster.entries()).map(([key, profile]) => [key, { ...profile, totalSales: 0 }]));
  getLatestTransactionSnapshots(transactionRecords || [], period.endOfDay).forEach(({ record, date }) => {
    if (date < period.startOfMonth) return;
    const advisor = canonicalGmTechnicianName(record['Service Advice Advisor'] || record.service_advisor);
    const entry = totals.get(advisor);
    if (entry) entry.totalSales += getTransactionRecordTotal(record);
  });

  return Array.from(totals.values()).map(entry => {
    const configuredRate = Number(incentiveRates[entry.id]);
    const incentiveRatePct = Number.isFinite(configuredRate) && configuredRate >= 0 && configuredRate <= 100 ? configuredRate : 0;
    return { ...entry, incentiveRatePct, incentive: entry.totalSales * (incentiveRatePct / 100) };
  }).sort((a, b) => b.totalSales - a.totalSales);
}

function buildGmCurrentTransactions(transactionRecords, period) {
  return getLatestTransactionSnapshots(transactionRecords || [], period.endOfDay)
    .filter(({ date }) => date >= period.startOfDay)
    .map(({ record, date }) => ({
      date,
      workOrderNumber: String(record['work order Number'] || record.work_order_number || '-'),
      customer: String(record['Customer name'] || record.customer_name || '-'),
      advisor: String(record['Service Advice Advisor'] || record.service_advisor || '-'),
      total: getTransactionRecordTotal(record),
    }))
    .sort((a, b) => b.total - a.total);
}

function buildTransactionTopServices(snapshots, endOfDay) {
  const groups = new Map();
  snapshots.forEach(({ record, date }) => {
    if (date >= endOfDay) return;
    for (let slot = 1; slot <= 15; slot += 1) {
      const service = String(record[`Service${slot}`] || record[`Service Required${slot}`] || '').trim();
      if (!service) continue;
      const entry = groups.get(service) || { service, count: 0, revenue: 0 };
      entry.count += 1;
      entry.revenue += toNumber(record[`Labor${slot}`]);
      groups.set(service, entry);
    }
  });
  return Array.from(groups.values()).sort((a, b) => b.revenue - a.revenue).slice(0, 5);
}

function buildTransactionTopTechnicians(snapshots, endOfDay) {
  const groups = new Map();
  snapshots.forEach(({ record, date }) => {
    if (date >= endOfDay) return;
    const technician = String(record.Tecnician || record.Technician || '').trim();
    if (!technician) return;
    const entry = groups.get(technician) || { technician, closedCount: 0, revenue: 0 };
    entry.closedCount += 1;
    entry.revenue += getTransactionRecordTotal(record);
    groups.set(technician, entry);
  });
  return Array.from(groups.values()).sort((a, b) => b.revenue - a.revenue).slice(0, 5);
}

function buildBranchStatusWarning(entry, isPipeline) {
  if (isPipeline) return { code: 'pipeline', label: 'Pipeline' };
  if (entry.openRiskCount >= 3 || entry.targetPacingPct < 35) {
    return { code: 'alert', label: 'Alert' };
  }
  if (entry.openRiskCount > 0 || entry.pendingBillingCount >= 5 || entry.targetPacingPct < 60) {
    return { code: 'watch', label: 'Watch' };
  }
  return { code: 'ok', label: 'OK' };
}

function buildBranchMilestones(workOrders, transactionSnapshots, period, branchCatalog, rangeWindow, salesTargets) {
  const catalog = resolveBranchCatalog(branchCatalog);
  const now = new Date();
  const duration = (rangeWindow && rangeWindow.duration) || 'D';
  const targetMap = salesTargets && typeof salesTargets === 'object' ? salesTargets : {};
  const periodTarget = durationWorkOrderTarget(duration);
  const byKey = new Map(
    catalog.map((branch) => [normalizeGmBranchKey(branch.name), {
      branch: branch.name,
      status: branch.status,
      type: branch.type,
      totalWorkOrders: 0,
      openWorkOrders: 0,
      closedWorkOrders: 0,
      pendingBillingCount: 0,
      todayRevenue: 0,
      weeklyRevenue: 0,
      periodRevenue: 0,
      periodWorkOrders: 0,
      closedRevenue: 0,
      laborRevenue: 0,
      partsRevenue: 0,
      openRiskCount: 0,
      avgTicket: 0,
      activeTechnicians: 0,
      target: periodTarget,
      milestonePercent: 0,
      _techSet: new Set(),
    }])
  );

  for (const wo of workOrders) {
    const key = normalizeGmBranchKey(wo && wo.branch);
    if (!key || !byKey.has(key)) continue;

    const entry = byKey.get(key);
    const createdAt = new Date(wo.created_at || 0);
    const inWindow = isDateInGmWindow(createdAt, rangeWindow);
    if (inWindow) entry.periodWorkOrders += 1;
    entry.totalWorkOrders += 1;

    if (isWorkOrderOpen(wo)) {
      entry.openWorkOrders += 1;
      const ageHours = Math.floor(Math.max(0, now.getTime() - createdAt.getTime()) / 3600000);
      if (ageHours > 24) entry.openRiskCount += 1;
    }

    if (inWindow && String(wo.status || '').trim().toLowerCase() === 'completed') {
      entry.pendingBillingCount += 1;
    }

    const techName = String(wo.technician || '').trim();
    if (techName && inWindow) {
      entry._techSet.add(techName);
    }
  }

  for (const { record, date } of transactionSnapshots) {
    if (date >= period.endOfDay) continue;
    const key = normalizeGmBranchKey(record && record.Branch);
    if (!key || !byKey.has(key)) continue;
    const entry = byKey.get(key);
    const inWindow = isDateInGmWindow(date, rangeWindow);
    const total = getTransactionRecordTotal(record);
    const labor = toNumber(record['Total Labor']);
    const parts = toNumber(record['Total Parts']);
    if (date >= period.startOfDay) entry.todayRevenue += total;
    if (date >= period.startOfWeek) entry.weeklyRevenue += total;
    if (!inWindow) continue;
    entry.closedWorkOrders += 1;
    entry.closedRevenue += total;
    entry.laborRevenue += labor;
    entry.partsRevenue += parts;
    entry.periodRevenue += total;
  }

  return catalog.map((branch) => {
    const entry = byKey.get(normalizeGmBranchKey(branch.name));
    const monthlySalesTarget = Number(
      targetMap[branch.name] != null
        ? targetMap[branch.name]
        : targetMap[normalizeGmBranchKey(branch.name)]
    );
    if (Number.isFinite(monthlySalesTarget) && monthlySalesTarget > 0) {
      entry.salesTargetMonthly = monthlySalesTarget;
      entry.target = scaleMonthlySalesTarget(monthlySalesTarget, duration);
    } else {
      entry.target = periodTarget;
    }
    const progress = entry.target > 0
      ? Math.min(100, ((Number.isFinite(monthlySalesTarget) && monthlySalesTarget > 0
        ? entry.periodRevenue
        : entry.periodWorkOrders) / entry.target) * 100)
      : 0;
    const avgTicket = entry.closedWorkOrders > 0 ? (entry.closedRevenue / entry.closedWorkOrders) : 0;
    const mixBase = entry.laborRevenue + entry.partsRevenue;
    const laborGrossMarginPct = mixBase > 0 ? (entry.laborRevenue / mixBase) * 100 : 0;
    const partsGrossMarginPct = mixBase > 0 ? (entry.partsRevenue / mixBase) * 100 : 0;
    const targetPacingPct = Math.round(progress * 10) / 10;
    const pipeline = isPipelineBranch(branch);
    const warning = buildBranchStatusWarning({
      openRiskCount: entry.openRiskCount,
      pendingBillingCount: entry.pendingBillingCount,
      targetPacingPct,
    }, pipeline);

    return {
      ...entry,
      avgTicket,
      activeTechnicians: entry._techSet.size,
      milestonePercent: targetPacingPct,
      targetPacingPct,
      laborGrossMarginPct: Math.round(laborGrossMarginPct * 10) / 10,
      partsGrossMarginPct: Math.round(partsGrossMarginPct * 10) / 10,
      liveAccumulatedRevenue: entry.periodRevenue,
      statusWarning: warning.label,
      statusWarningCode: warning.code,
      isPipeline: pipeline,
      total: entry.periodWorkOrders,
      open: entry.openWorkOrders,
      closed: entry.closedWorkOrders,
      revenue: entry.periodRevenue,
      _techSet: undefined,
    };
  });
}

function buildGmLiveTransactionBranches(workOrders, transactionRecords, branchCatalog) {
  const livePeriod = resolveGmReportPeriod();
  const catalog = resolveBranchCatalog(branchCatalog);
  const branches = new Map(catalog.map((branch) => [normalizeGmBranchKey(branch.name), {
    branch: branch.name,
    status: branch.status,
    type: branch.type,
    openWorkOrders: 0,
    closedWorkOrders: 0,
    revenue: 0,
    workOrderCount: 0,
    pendingJobs: 0,
  }]));

  (workOrders || []).forEach(workOrder => {
    const entry = branches.get(normalizeGmBranchKey(workOrder && workOrder.branch));
    if (!entry) return;
    if (isWorkOrderOpen(workOrder)) entry.openWorkOrders += 1;
    if (String(workOrder.status || '').trim().toLowerCase() === 'completed') entry.pendingJobs += 1;
    const createdAt = new Date(workOrder.created_at || 0);
    if (Number.isFinite(createdAt.getTime()) && createdAt >= livePeriod.startOfDay && createdAt < livePeriod.endOfDay) {
      entry.workOrderCount += 1;
    }
  });

  getLatestTransactionSnapshots(transactionRecords || [], livePeriod.endOfDay).forEach(({ record, date }) => {
    if (date < livePeriod.startOfDay) return;
    const entry = branches.get(normalizeGmBranchKey(record && record.Branch));
    if (!entry) return;
    entry.closedWorkOrders += 1;
    entry.revenue += getTransactionRecordTotal(record);
  });

  const formattedDate = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila', weekday: 'long', month: 'numeric', day: 'numeric', year: 'numeric',
  }).format(new Date(`${livePeriod.dateKey}T12:00:00+08:00`)).replace(',', '');
  return { title: `Transactions Today ${formattedDate}`, branches: Array.from(branches.values()) };
}

function buildPendingSpark(workOrders, rangeStart, rangeEnd) {
  const buckets = [0, 0, 0, 0, 0, 0, 0];
  const startMs = rangeStart.getTime();
  const span = Math.max(1, rangeEnd.getTime() - startMs);
  for (const wo of workOrders) {
    if (String(wo.status || '').trim().toLowerCase() !== 'completed') continue;
    const createdAt = new Date(wo.created_at || 0);
    if (!Number.isFinite(createdAt.getTime()) || createdAt < rangeStart || createdAt >= rangeEnd) continue;
    const idx = Math.min(6, Math.floor(((createdAt.getTime() - startMs) / span) * 7));
    buckets[idx] += 1;
  }
  const peak = Math.max.apply(null, buckets.concat([1]));
  return buckets.map((count) => Math.max(18, Math.round((count / peak) * 100)));
}

function buildGmMetrics(workOrders, transactionRecords, employees, pricingSettings, reportDate, branchCatalog, duration, partsInventory) {
  const now = new Date();
  const period = resolveGmReportPeriod(reportDate);
  const window = resolveGmDurationWindow(period, duration);
  const transactionSnapshots = getLatestTransactionSnapshots(transactionRecords, period.endOfDay);
  const catalog = resolveBranchCatalog(branchCatalog);

  const openWorkOrders = workOrders.filter(isWorkOrderOpen);
  const completedAwaitingBilling = workOrders.filter((wo) => {
    if (String(wo.status || '').trim().toLowerCase() !== 'completed') return false;
    const createdAt = new Date(wo.created_at || 0);
    if (!Number.isFinite(createdAt.getTime())) return true;
    return createdAt >= window.start && createdAt < window.end;
  });

  let todayRevenue = 0;
  let weeklyRevenue = 0;
  let windowRevenue = 0;
  let windowClosedCount = 0;
  let windowClosedRevenue = 0;
  let totalClosedRevenue = 0;
  let closedWorkOrders = 0;
  for (const { record, date } of transactionSnapshots) {
    if (date >= period.endOfDay) continue;
    const total = getTransactionRecordTotal(record);
    closedWorkOrders += 1;
    totalClosedRevenue += total;
    if (date >= period.startOfDay) todayRevenue += total;
    if (date >= period.startOfWeek) weeklyRevenue += total;
    if (date >= window.start && date < window.end) {
      windowRevenue += total;
      windowClosedCount += 1;
      windowClosedRevenue += total;
    }
  }

  let cumulativeRevenue = 0;
  for (const { record, date } of transactionSnapshots) {
    if (date >= window.end) continue;
    if (date >= window.cumulativeStart) cumulativeRevenue += getTransactionRecordTotal(record);
  }

  const avgTicket = windowClosedCount ? windowClosedRevenue / windowClosedCount : 0;
  const risks = [];
  for (const wo of openWorkOrders) {
    const createdAt = new Date(wo.created_at || 0);
    const ageHours = Math.floor(Math.max(0, now.getTime() - createdAt.getTime()) / 3600000);
    if (ageHours > 24) {
      risks.push({
        work_order_number: wo.work_order_number || wo.id,
        status: wo.status || 'open',
        ageHours,
      });
    }
  }

  const salesTargets = resolveGmBranchSalesTargets(pricingSettings);
  const branchMilestones = buildBranchMilestones(
    workOrders,
    transactionSnapshots,
    period,
    catalog,
    window,
    salesTargets.branches
  );
  const transactionToday = buildGmLiveTransactionBranches(workOrders, transactionRecords, catalog);

  const metrics = {
    duration: window.duration,
    branchSalesTargets: salesTargets,
    kpis: {
      todayRevenue: windowRevenue,
      weeklyRevenue: cumulativeRevenue,
      dayRevenue: todayRevenue,
      weekRevenue: weeklyRevenue,
      openWorkOrders: openWorkOrders.length,
      closedWorkOrders,
      avgTicket,
      pendingBillingCount: completedAwaitingBilling.length,
      pendingSpark: buildPendingSpark(workOrders, window.start, window.end),
      activeTechnicians: new Set(workOrders.map((wo) => String(wo.technician || '').trim()).filter(Boolean)).size,
      // Company-wide branch averages exclude pipeline / pre-operational + empty/zero values
      avgBranchTodayRevenue: averageOperationalBranchMetric(branchMilestones, 'todayRevenue'),
      avgBranchWeeklyRevenue: averageOperationalBranchMetric(branchMilestones, 'weeklyRevenue'),
      avgBranchOpenWorkOrders: averageOperationalBranchMetric(branchMilestones, 'openWorkOrders'),
    },
    reporting: {
      date: period.dateKey,
      label: period.label,
      duration: window.duration,
      revenueLabel: window.revenueLabel,
      revenueDelta: window.revenueDelta,
      cumulativeLabel: window.cumulativeLabel,
      cumulativeDelta: window.cumulativeDelta,
    },
    transactionToday,
    technicianPerformance: buildGmTechnicianPerformance(workOrders, employees, pricingSettings, period),
    branchMilestones,
    topServices: buildTransactionTopServices(transactionSnapshots, period.endOfDay),
    topTechnicians: buildTransactionTopTechnicians(transactionSnapshots, period.endOfDay),
    riskAlerts: risks.sort((a, b) => b.ageHours - a.ageHours).slice(0, 8),
  };
  metrics.markupHealth = buildGmMarkupHealth(
    workOrders,
    transactionSnapshots,
    partsInventory,
    employees,
    pricingSettings,
    window
  );
  metrics.negativeReports = buildGmNegativeReports(metrics);
  return metrics;
}

function gmDashboardTemplateVars(metrics) {
  const allBranchRows = Array.isArray(metrics.branchMilestones) ? metrics.branchMilestones : [];
  const branchRows = allBranchRows.filter((row) => !row.isPipeline && String(row.branch || '').trim().toLowerCase() !== 'proposed location');
  const matrixTotals = branchRows.reduce((acc, row) => {
    acc.openWorkOrders += Number(row.openWorkOrders || 0);
    acc.liveAccumulatedRevenue += Number(row.liveAccumulatedRevenue != null ? row.liveAccumulatedRevenue : row.todayRevenue || 0);
    acc.targetPacingPct += Number(row.targetPacingPct != null ? row.targetPacingPct : row.milestonePercent || 0);
    acc.laborGrossMarginPct += Number(row.laborGrossMarginPct || 0);
    acc.partsGrossMarginPct += Number(row.partsGrossMarginPct || 0);
    return acc;
  }, {
    openWorkOrders: 0,
    liveAccumulatedRevenue: 0,
    targetPacingPct: 0,
    laborGrossMarginPct: 0,
    partsGrossMarginPct: 0,
  });
  const branchCount = branchRows.length || 1;
  const avgLabor = matrixTotals.laborGrossMarginPct / branchCount;
  const avgParts = matrixTotals.partsGrossMarginPct / branchCount;
  const avgPacing = matrixTotals.targetPacingPct / branchCount;
  const clampPct = (value) => Math.max(0, Math.min(100, Number(value) || 0));
  const reporting = metrics.reporting || {};
  const kpis = metrics.kpis || {};
  return {
    branchRows,
    matrixTotals,
    branchCount,
    avgPacing,
    avgLabor,
    avgParts,
    segA: clampPct(avgLabor * 0.45),
    segB: clampPct(clampPct(avgLabor * 0.45) + (avgParts * 0.35)),
    segC: clampPct(clampPct(clampPct(avgLabor * 0.45) + (avgParts * 0.35)) + (avgPacing * 0.35)),
    maxRevenue: Math.max.apply(null, branchRows.map((row) => Number(row.liveAccumulatedRevenue != null ? row.liveAccumulatedRevenue : row.todayRevenue || 0)).concat([1])),
    maxOpenWorkOrders: Math.max.apply(null, branchRows.map((row) => Number(row.openWorkOrders || 0)).concat([1])),
    activeDuration: String(metrics.duration || reporting.duration || 'D').toUpperCase(),
    sparkHeights: Array.isArray(kpis.pendingSpark) && kpis.pendingSpark.length ? kpis.pendingSpark : [36, 52, 44, 70, 58, 82, 64],
    revenueLabel: reporting.revenueLabel || ('Revenue on ' + (reporting.label || '')),
    revenueDelta: reporting.revenueDelta || '▲ Daily close',
    cumulativeLabel: reporting.cumulativeLabel || ('Week Through ' + (reporting.label || '')),
    cumulativeDelta: reporting.cumulativeDelta || '▲ Week to date',
    branchSalesTargets: metrics.branchSalesTargets || resolveGmBranchSalesTargets(null),
    reportingDate: reporting.date || '',
  };
}

async function loadGmDashboardPage(req) {
  const [customers, vehicles, workOrders, transactionRecords, employees, pricingSettings, branches, partsInventory] = await Promise.all([
    store.getAll('customers'),
    store.getAll('vehicles'),
    store.getAll('work_orders'),
    store.getAll('transaction_records'),
    store.getAll('employees'),
    store.getPricingSettings(),
    store.getAll('branches'),
    store.getAll('parts_inventory'),
  ]);
  const metrics = buildGmMetrics(
    workOrders,
    transactionRecords,
    employees,
    pricingSettings,
    req.query.date,
    branches,
    req.query.duration,
    partsInventory
  );
  return Object.assign({
    customersCount: customers.length,
    vehiclesCount: vehicles.length,
    totalWorkOrders: workOrders.length,
    metrics,
    ocpdReport: buildOcpdReport(req.query.date, workOrders, vehicles),
    targetsSaved: String(req.query.targetsSaved || '') === '1',
  }, gmDashboardTemplateVars(metrics));
}

function serializeGmDashboardPayload(metrics) {
  const allBranchRows = Array.isArray(metrics.branchMilestones) ? metrics.branchMilestones : [];
  const branchRows = allBranchRows.filter((row) => !row.isPipeline && String(row.branch || '').trim().toLowerCase() !== 'proposed location');
  const totals = branchRows.reduce((acc, row) => {
    acc.openWorkOrders += Number(row.openWorkOrders || 0);
    acc.liveAccumulatedRevenue += Number(row.liveAccumulatedRevenue != null ? row.liveAccumulatedRevenue : row.todayRevenue || 0);
    acc.targetPacingPct += Number(row.targetPacingPct != null ? row.targetPacingPct : row.milestonePercent || 0);
    acc.laborGrossMarginPct += Number(row.laborGrossMarginPct || 0);
    acc.partsGrossMarginPct += Number(row.partsGrossMarginPct || 0);
    return acc;
  }, {
    openWorkOrders: 0,
    liveAccumulatedRevenue: 0,
    targetPacingPct: 0,
    laborGrossMarginPct: 0,
    partsGrossMarginPct: 0,
  });
  const branchCount = branchRows.length || 1;
  const avgPacing = totals.targetPacingPct / branchCount;
  const avgLabor = totals.laborGrossMarginPct / branchCount;
  const avgParts = totals.partsGrossMarginPct / branchCount;
  const clampPct = (value) => Math.max(0, Math.min(100, Number(value) || 0));
  const reporting = metrics.reporting || {};
  const kpis = metrics.kpis || {};
  return {
    duration: metrics.duration || reporting.duration || 'D',
    branchSalesTargets: metrics.branchSalesTargets || resolveGmBranchSalesTargets(null),
    reporting,
    cards: {
      revenueLabel: reporting.revenueLabel || `Revenue on ${reporting.label || ''}`.trim(),
      revenueValue: Number(kpis.todayRevenue || 0),
      revenueDelta: reporting.revenueDelta || '▲ Daily close',
      cumulativeLabel: reporting.cumulativeLabel || `Week Through ${reporting.label || ''}`.trim(),
      cumulativeValue: Number(kpis.weeklyRevenue || 0),
      cumulativeDelta: reporting.cumulativeDelta || '▲ Week to date',
      pendingBillingCount: Number(kpis.pendingBillingCount || 0),
      pendingSpark: Array.isArray(kpis.pendingSpark) ? kpis.pendingSpark : [36, 52, 44, 70, 58, 82, 64],
      avgTicket: Number(kpis.avgTicket || 0),
    },
    markupHealth: metrics.markupHealth || null,
    negativeReports: Array.isArray(metrics.negativeReports) ? metrics.negativeReports : [],
    pacing: {
      avgPacing,
      segA: clampPct(avgLabor * 0.45),
      segB: clampPct(clampPct(avgLabor * 0.45) + (avgParts * 0.35)),
      segC: clampPct(clampPct(clampPct(avgLabor * 0.45) + (avgParts * 0.35)) + (avgPacing * 0.35)),
    },
    matrix: {
      rows: branchRows.map((row) => ({
        branch: row.branch || '—',
        openWorkOrders: Number(row.openWorkOrders || 0),
        liveAccumulatedRevenue: Number(row.liveAccumulatedRevenue != null ? row.liveAccumulatedRevenue : row.todayRevenue || 0),
        targetPacingPct: Number(row.targetPacingPct != null ? row.targetPacingPct : row.milestonePercent || 0),
        laborGrossMarginPct: Number(row.laborGrossMarginPct || 0),
        partsGrossMarginPct: Number(row.partsGrossMarginPct || 0),
        statusWarning: row.statusWarning || 'OK',
        statusWarningCode: row.statusWarningCode || 'ok',
      })),
      totals,
    },
  };
}

function parseClockOnDate(referenceDate, value) {
  if (!referenceDate) return null;
  const text = String(value || '').trim();
  const match = text.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
  return new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate(),
    h,
    m,
    0,
    0,
  );
}

function parseDateSafe(value) {
  const dt = new Date(value || 0);
  return Number.isFinite(dt.getTime()) ? dt : null;
}

function getElapsedHours(start, end) {
  if (!start || !end) return 0;
  const diffMs = end.getTime() - start.getTime();
  if (!Number.isFinite(diffMs) || diffMs <= 0) return 0;
  return diffMs / 3600000;
}

function estimateAssignmentAt(wo) {
  const explicit = parseDateSafe(wo && wo.technician_assigned_at);
  if (explicit) return explicit;

  const technician = String(wo && wo.technician || '').trim();
  if (!technician) return null;

  const createdAt = parseDateSafe(wo && wo.created_at);
  if (!createdAt) return null;

  const fromTimeIn = parseClockOnDate(createdAt, wo && wo.time_in);
  if (!fromTimeIn) return null;
  if (fromTimeIn.getTime() < createdAt.getTime()) {
    fromTimeIn.setDate(fromTimeIn.getDate() + 1);
  }
  return fromTimeIn;
}

function buildCloseTimestampMap(transactionRecords) {
  const closeMap = new Map();
  const closeActions = new Set(['billing-printed', 'closed', 'finalized']);
  for (const record of transactionRecords || []) {
    const woId = String(record && record.work_order_id || '').trim();
    if (!woId) continue;
    const action = String(record && record.transaction_action || '').trim().toLowerCase();
    if (!closeActions.has(action)) continue;
    const when = parseDateSafe(record && (record.created_at || record['Transaction date']));
    if (!when) continue;
    const prev = closeMap.get(woId);
    if (!prev || when.getTime() > prev.getTime()) {
      closeMap.set(woId, when);
    }
  }
  return closeMap;
}

function estimateClosedAt(wo, closeMap) {
  const byRecord = closeMap.get(String(wo && wo.id || '').trim());
  if (byRecord) return byRecord;

  const createdAt = parseDateSafe(wo && wo.created_at);
  if (!createdAt) return null;
  const fromTimeOut = parseClockOnDate(createdAt, wo && wo.time_out);
  if (!fromTimeOut) return null;
  if (fromTimeOut.getTime() < createdAt.getTime()) {
    fromTimeOut.setDate(fromTimeOut.getDate() + 1);
  }
  return fromTimeOut;
}

function getMonthStart(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
}

function safePercent(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return 0;
  return (numerator / denominator) * 100;
}

function buildStmMetrics(workOrders, transactionRecords, partsInventory, pricingSettings) {
  const now = new Date();
  const startOfMonth = getMonthStart(now);
  const hourlyRate = Math.max(1, toNumber(pricingSettings && pricingSettings.hourly_rate) || 350);
  const assignTargetMinutes = 10;

  const workOrdersMtd = (workOrders || []).filter((wo) => {
    const createdAt = parseDateSafe(wo && wo.created_at);
    return createdAt && createdAt >= startOfMonth && createdAt <= now;
  });

  const technicianSet = new Set();
  let laborRevenue = 0;
  let partsRevenue = 0;
  let billedHours = 0;
  let actualHoursWorked = 0;
  let assignedRos = 0;

  const assignmentRows = [];
  for (const wo of workOrdersMtd) {
    const labor = getWorkOrderLaborTotal(wo);
    const parts = getWorkOrderPartsTotal(wo);
    laborRevenue += labor;
    partsRevenue += parts;

    const technician = String(wo && wo.technician || '').trim();
    if (technician) {
      technicianSet.add(technician);
      assignedRos += 1;
    }

    const woBilledHours = labor / hourlyRate;
    billedHours += woBilledHours;

    const createdAt = parseDateSafe(wo && wo.created_at);
    const start = parseClockOnDate(createdAt, wo && wo.time_in);
    let end = parseClockOnDate(createdAt, wo && wo.time_out);
    if (start && end && end.getTime() < start.getTime()) {
      end = new Date(end.getTime() + 24 * 3600000);
    }

    const measuredActual = getElapsedHours(start, end);
    actualHoursWorked += measuredActual > 0 ? measuredActual : woBilledHours;

    const assignedAt = estimateAssignmentAt(wo);
    if (technician && createdAt && assignedAt) {
      const minutes = Math.max(0, Math.round((assignedAt.getTime() - createdAt.getTime()) / 60000));
      assignmentRows.push({
        work_order_number: wo.work_order_number || wo.id,
        service_advisor: String(wo.service_advisor || '').trim() || '-',
        technician,
        minutes_to_assign: minutes,
        within_target: minutes <= assignTargetMinutes,
      });
    }
  }

  const elapsedDays = Math.max(1, Math.floor((now.getTime() - startOfMonth.getTime()) / 86400000) + 1);
  const availableHours = technicianSet.size * elapsedDays * 8;
  const totalRevenue = laborRevenue + partsRevenue;

  const openStatuses = new Set(['open', 'in-progress', 'waiting-parts', 'break', 'on-other-priority']);
  const closedStatuses = new Set(['closed']);
  const closeMap = buildCloseTimestampMap(transactionRecords || []);
  const closedMtd = workOrdersMtd.filter((wo) => closedStatuses.has(String(wo.status || '').trim().toLowerCase()));
  const tatHours = closedMtd
    .map((wo) => {
      const createdAt = parseDateSafe(wo && wo.created_at);
      const closedAt = estimateClosedAt(wo, closeMap);
      return getElapsedHours(createdAt, closedAt);
    })
    .filter((v) => v > 0);

  const comebackSet = buildComebackWorkOrderIdSet(workOrders, transactionRecords);
  const qualityMetrics = computeQualityMetrics(workOrdersMtd, comebackSet);

  const byCustomer = new Map();
  for (const wo of workOrders || []) {
    const customerId = String(wo.customer_id || '').trim();
    if (!customerId) continue;
    byCustomer.set(customerId, (byCustomer.get(customerId) || 0) + 1);
  }
  const activeCustomers = Array.from(byCustomer.values()).filter((count) => count > 0).length;
  const retainedCustomers = Array.from(byCustomer.values()).filter((count) => count > 1).length;

  let soldQtyMtd = 0;
  let soldRetailMtd = 0;
  let soldCostMtd = 0;
  const stockByPart = new Map();
  for (const tx of partsInventory || []) {
    const type = String(tx.transaction_type || '').trim().toLowerCase();
    const qty = Math.max(0, toNumber(tx.qty));
    const partNumber = String(tx.part_number || '').trim() || '__unknown';
    const createdAt = parseDateSafe(tx.created_at || tx.transaction_date);
    if (!stockByPart.has(partNumber)) stockByPart.set(partNumber, 0);

    if (type === 'sold') {
      stockByPart.set(partNumber, stockByPart.get(partNumber) - qty);
      if (createdAt && createdAt >= startOfMonth && createdAt <= now) {
        soldQtyMtd += qty;
        soldRetailMtd += qty * toNumber(tx.retail_price);
        soldCostMtd += qty * toNumber(tx.cost_price);
      }
    } else {
      stockByPart.set(partNumber, stockByPart.get(partNumber) + qty);
    }
  }

  const currentOnHandQty = Array.from(stockByPart.values()).reduce((sum, qty) => sum + Math.max(0, qty), 0);
  const averageInventoryQty = currentOnHandQty + (soldQtyMtd / 2);

  const assignmentAverage = assignmentRows.length
    ? assignmentRows.reduce((sum, row) => sum + row.minutes_to_assign, 0) / assignmentRows.length
    : 0;

  assignmentRows.sort((a, b) => b.minutes_to_assign - a.minutes_to_assign);

  return {
    period: {
      monthLabel: now.toLocaleString('en-US', { month: 'long', year: 'numeric' }),
      hourlyRate,
      assignTargetMinutes,
    },
    technicianLabor: {
      activeTechnicians: technicianSet.size,
      technicianProductivityPct: safePercent(actualHoursWorked, availableHours),
      technicianEfficiencyPct: safePercent(billedHours, actualHoursWorked),
      technicianUtilizationPct: safePercent(assignedRos, workOrdersMtd.length),
      effectiveLaborRate: billedHours > 0 ? (laborRevenue / billedHours) : 0,
      billedHours,
      actualHoursWorked,
      availableHours,
    },
    financial: {
      totalRevenue,
      laborRevenue,
      partsRevenue,
      averageRepairOrderValue: workOrdersMtd.length ? (totalRevenue / workOrdersMtd.length) : 0,
      hoursSoldPerRepairOrder: workOrdersMtd.length ? (billedHours / workOrdersMtd.length) : 0,
      laborToPartsRatio: partsRevenue > 0 ? (laborRevenue / partsRevenue) : null,
      laborGrossProfitMarginPct: null,
      partsGrossProfitMarginPct: soldRetailMtd > 0 ? safePercent((soldRetailMtd - soldCostMtd), soldRetailMtd) : null,
    },
    operations: {
      serviceTurnaroundHoursAvg: tatHours.length ? (tatHours.reduce((sum, v) => sum + v, 0) / tatHours.length) : 0,
      serviceTurnaroundSampleSize: tatHours.length,
      carCountRoVolume: workOrdersMtd.length,
      openRoCount: workOrdersMtd.filter((wo) => openStatuses.has(String(wo.status || '').trim().toLowerCase())).length,
      closedRoCount: closedMtd.length,
      partsInventoryTurnoverRate: averageInventoryQty > 0 ? (soldQtyMtd / averageInventoryQty) : 0,
      soldQtyMtd,
      averageInventoryQty,
    },
    quality: {
      firstTimeFixRatePct: qualityMetrics.firstTimeFixRatePct,
      comebackRatePct: qualityMetrics.comebackRatePct,
      comebackCount: qualityMetrics.comebackCount,
      activeRoCount: qualityMetrics.activeRoCount,
      performanceEligibleCount: qualityMetrics.performanceEligibleCount,
      customerRetentionRatePct: activeCustomers ? safePercent(retainedCustomers, activeCustomers) : 0,
      npsOrCsi: null,
    },
    assignment: {
      averageMinutesToAssignTechnician: assignmentAverage,
      sampleSize: assignmentRows.length,
      delayedCount: assignmentRows.filter((row) => !row.within_target).length,
      rows: assignmentRows.slice(0, 12),
    },
  };
}

// Role landing page
app.get('/', async (req, res) => {
  const activeRole = String(req.session.user && req.session.user.role || '').trim().toLowerCase();
  return res.redirect(portals.homePathForRole(activeRole));
});

app.get('/service', requirePortalAccess(portals.PORTAL_SERVICE), async (req, res) => {
  const [workOrders, customers, employees] = await Promise.all([
    store.getAll('work_orders'),
    store.getAll('customers'),
    store.getAll('employees'),
  ]);
  return res.render('service/index', {
    openWorkOrdersCount: (workOrders || []).filter((wo) => !isWorkOrderClosed(wo)).length,
    customerCount: (customers || []).length,
    technicianCount: (employees || []).length,
  });
});

app.get('/parts-portal', requirePortalAccess(portals.PORTAL_PARTS), (req, res) => {
  return res.render('parts-portal/index');
});

app.get('/service-receptionist', requireAnyRole(
  ROLE_SERVICE_ADVISOR,
  ROLE_SERVICE_RECEPTIONIST,
  ROLE_SENIOR_SERVICE_RECEPTIONIST,
  ROLE_GENERAL_MANAGER,
  ROLE_STM
), async (req, res) => {
  const user = req.session && req.session.user ? req.session.user : {};
  const branchName = resolveFrontlineDashboardBranch(user);
  const branchKey = normalizeBranchKey(branchName);
  const [allWorkOrders, allCustomers, allVehicles, employees, technicianUpdates, transactionRecords, pricingSettings] = await Promise.all([
    store.getAll('work_orders'),
    store.getAll('customers'),
    store.getAll('vehicles'),
    store.getAll('employees'),
    store.getAll('technician_updates'),
    store.getAll('transaction_records'),
    store.getPricingSettings(),
  ]);
  const workOrders = allWorkOrders.filter((wo) => normalizeBranchKey(wo.branch) === branchKey);
  const customerIds = new Set(workOrders.map((wo) => wo.customer_id).filter(Boolean));
  const vehicleIds = new Set(workOrders.map((wo) => wo.vehicle_id).filter(Boolean));
  const customers = allCustomers.filter((customer) => (
    customerIds.has(customer.id) || normalizeBranchKey(customer.branch) === branchKey
  ));
  const vehicles = allVehicles.filter((vehicle) => (
    vehicleIds.has(vehicle.id) || normalizeBranchKey(vehicle.branch) === branchKey
  ));
  const scopedEmployees = employees.filter((employee) => (
    normalizeBranchKey(employee.work_location_branch_id) === branchKey
  ));
  const openWorkOrdersCount = workOrders.filter((wo) => !isWorkOrderClosed(wo)).length;
  return res.render('index', {
    work_orders: workOrders,
    customers,
    vehicles,
    technicianStats: toDashboardStats(
      buildTechnicianOperations(workOrders, vehicles, technicianUpdates, scopedEmployees, customers)
    ),
    roleLabel: frontlineRoleLabel(user.role) || 'SA',
    branch: branchName,
    openWorkOrdersCount,
    branchRevenueBars: buildFrontlineBranchRevenueBars(branchName, transactionRecords, pricingSettings),
  });
});

app.get('/api/service-receptionist/revenue-bars', requireAnyRole(ROLE_SERVICE_ADVISOR, ROLE_SERVICE_RECEPTIONIST, ROLE_SENIOR_SERVICE_RECEPTIONIST), async (req, res) => {
  try {
    const user = req.session && req.session.user ? req.session.user : {};
    const branchName = resolveFrontlineDashboardBranch(user);
    const [transactionRecords, pricingSettings] = await Promise.all([
      store.getAll('transaction_records'),
      store.getPricingSettings(),
    ]);
    return res.json(buildFrontlineBranchRevenueBars(branchName, transactionRecords, pricingSettings));
  } catch (error) {
    console.error('GET /api/service-receptionist/revenue-bars failed', error);
    return res.status(500).json({ error: 'Unable to load branch revenue bars' });
  }
});

app.get('/api/dashboard/metrics', requireRole(ROLE_GENERAL_MANAGER), async (req, res) => {
  try {
    const [workOrders, transactionRecords, employees, pricingSettings, branches, partsInventory] = await Promise.all([
      store.getAll('work_orders'),
      store.getAll('transaction_records'),
      store.getAll('employees'),
      store.getPricingSettings(),
      store.getAll('branches'),
      store.getAll('parts_inventory'),
    ]);
    const metrics = buildGmMetrics(
      workOrders,
      transactionRecords,
      employees,
      pricingSettings,
      req.query.date,
      branches,
      req.query.duration,
      partsInventory
    );
    return res.json(serializeGmDashboardPayload(metrics));
  } catch (error) {
    console.error('GET /api/dashboard/metrics failed', error);
    return res.status(500).json({ error: 'Unable to load dashboard metrics' });
  }
});

app.get('/api/gm/ocpd', requireRole(ROLE_GENERAL_MANAGER), async (req, res) => {
  try {
    const [workOrders, vehicles] = await Promise.all([
      store.getAll('work_orders'),
      store.getAll('vehicles'),
    ]);
    return res.json(buildOcpdReport(req.query.date, workOrders, vehicles));
  } catch (error) {
    console.error('GET /api/gm/ocpd failed', error);
    return res.status(500).json({ error: 'Unable to load OCPD reporting' });
  }
});

app.post('/gm/branch-targets', requireRole(ROLE_GENERAL_MANAGER), async (req, res) => {
  const current = await store.getPricingSettings();
  const resolved = resolveGmBranchSalesTargets(current);
  const nextBranches = {};
  DEFAULT_OPERATIONAL_BRANCHES.forEach((name) => {
    const raw = req.body && req.body[name];
    const value = Number(raw);
    nextBranches[name] = Number.isFinite(value) && value >= 0 ? value : resolved.branches[name];
  });
  await store.updatePricingSettings({
    gm_branch_sales_targets: {
      monthKey: resolved.monthKey,
      monthLabel: resolved.monthLabel,
      branches: nextBranches,
      updated_at: new Date().toISOString(),
    },
  });
  const date = String((req.body && req.body.date) || req.query.date || '').trim();
  const duration = normalizeGmDuration((req.body && req.body.duration) || req.query.duration);
  const params = new URLSearchParams();
  if (date) params.set('date', date);
  if (duration) params.set('duration', duration);
  params.set('targetsSaved', '1');
  const returnTo = String((req.body && req.body.return_to) || '').trim().toLowerCase();
  const dest = returnTo === 'enterprise' ? '/gm/enterprise' : '/gm';
  return res.redirect(dest + '?' + params.toString());
});

app.get('/gm', requireRole(ROLE_GENERAL_MANAGER), async (req, res) => {
  return res.render('gm/index', await loadGmDashboardPage(req));
});

app.get('/gm/enterprise', requireRole(ROLE_GENERAL_MANAGER), async (req, res) => {
  return res.render('gm/enterprise', await loadGmDashboardPage(req));
});

app.get(
  '/gm/fte',
  requireAnyRole(ROLE_GENERAL_MANAGER, ROLE_STM, ROLE_SERVICE_ADVISOR, ROLE_SERVICE_RECEPTIONIST, ROLE_SENIOR_SERVICE_RECEPTIONIST, ROLE_ASSETS_FACILITIES, ROLE_ADMIN),
  async (req, res) => {
  const branchRows = await store.getAll('branches').catch(() => []);
  const branchNames = Array.isArray(branchRows) && branchRows.length
    ? branchRows.map((row) => String(row.name || row.branch || '').trim()).filter(Boolean)
    : DEFAULT_OPERATIONAL_BRANCHES.slice();
  const viewerRole = String(
    (req.session.user && req.session.user.role) || (isLoginAuthDisabled() ? BYPASS_ROLE : '') || ''
  ).trim().toLowerCase();
  const canApproveFte = viewerRole === ROLE_GENERAL_MANAGER;
  const isFrontlineFte = isFrontlineRole(viewerRole);
  const isStmFte = viewerRole === ROLE_STM;
  const assignedBranch = isFrontlineFte
    ? String((req.session.user && req.session.user.branch) || '').trim() || PRIMARY_BRANCH_NAME
    : String((req.session.user && req.session.user.branch) || '').trim();
  const assignedBranchCanonical = (() => {
    if (isFrontlineFte) return PRIMARY_BRANCH_NAME;
    const key = normalizeBranchAccess(assignedBranch);
    if (!key) return '';
    const hit = branchNames.find((name) => normalizeBranchAccess(name) === key);
    return hit || assignedBranch;
  })();
  let fteHomeHref = '/gm';
  let fteHomeLabel = '← GM Dashboard';
  if (isStmFte) {
    fteHomeHref = '/stm';
    fteHomeLabel = '← STM Dashboard';
  } else if (viewerRole === ROLE_ASSETS_FACILITIES || viewerRole === ROLE_ADMIN) {
    fteHomeHref = '/admin';
    fteHomeLabel = '← Finance Office';
  } else if (isFrontlineRole(viewerRole)) {
    fteHomeHref = frontlineHomePath(viewerRole);
    const tag = frontlineRoleLabel(viewerRole) || 'SA';
    fteHomeLabel = `← ${tag} Dashboard`;
  }
  res.render('gm/fte', {
    branches: branchNames,
    canApproveFte,
    isFrontlineFte,
    assignedBranch: assignedBranchCanonical,
    fteHomeHref,
    fteHomeLabel,
    metrics: {
      opexMtd: 86420.75,
      criticalUptimePct: 97.4,
      openWorkOrders: 4,
      upcomingPms7Days: 4,
      emergencyOrders: [
        { id: 'FTE-2401', equipment: '2-Post Lift #3', branch: 'Carmen', priority: 'Critical', status: 'Open', ageHours: 6 },
        { id: 'FTE-2398', equipment: 'Wheel Aligner', branch: 'CebuCity', priority: 'High', status: 'In Progress', ageHours: 14 },
        { id: 'FTE-2395', equipment: 'Air Compressor', branch: 'Lapux2', priority: 'Critical', status: 'Open', ageHours: 3 },
        { id: 'FTE-2391', equipment: 'Tire Changer', branch: 'Bogo', priority: 'Medium', status: 'In Progress', ageHours: 22 },
      ],
      scheduledPm: [
        { id: 'PM-118', asset: 'Torque Wrench Set A', branch: 'Toledo', dueDate: '2026-08-15', technician: 'R. Santos' },
        { id: 'PM-119', asset: 'Paint Booth Filters', branch: 'ITPark', dueDate: '2026-08-16', technician: 'J. Cruz' },
        { id: 'PM-120', asset: 'Hydraulic Press', branch: 'Carmen', dueDate: '2026-08-17', technician: 'M. Dela Cruz' },
        { id: 'PM-121', asset: 'AC Recovery Unit', branch: 'CebuCity', dueDate: '2026-08-18', technician: 'A. Reyes' },
      ],
      recentExpenses: [
        { id: 'EXP-901', date: '2026-08-13', description: 'Lift cable replacement', category: 'Repair', branch: 'Carmen', amount: 13750 },
        { id: 'EXP-900', date: '2026-08-12', description: 'Calibration service fee', category: 'Calibration', branch: 'CebuCity', amount: 4800 },
        { id: 'EXP-898', date: '2026-08-11', description: 'PPE restock (gloves/goggles)', category: 'Safety', branch: 'Bogo', amount: 2650.5 },
        { id: 'EXP-896', date: '2026-08-10', description: 'Compressor oil & filters', category: 'Consumable', branch: 'Lapux2', amount: 3120 },
      ],
      cribTracker: [
        { id: 'CRB-441', tool: 'Impact Oil Gun #12', assignee: 'K. Lim', branch: 'Carmen', action: 'Check-Out', at: '08:14' },
        { id: 'CRB-440', tool: 'Scan Tool Elite', assignee: 'R. Santos', branch: 'CebuCity', action: 'Check-In', at: '09:02' },
        { id: 'CRB-439', tool: 'Torque Wrench 1/2"', assignee: 'J. Cruz', branch: 'ITPark', action: 'Check-Out', at: '09:40' },
        { id: 'CRB-438', tool: 'ATF Exchanger Hose', assignee: 'M. Dela Cruz', branch: 'Toledo', action: 'Check-In', at: '10:15' },
      ],
      safetyChecklist: [
        { branch: 'Carmen', date: '2026-08-13', result: 'Pass', completedBy: 'STM Desk' },
        { branch: 'CebuCity', date: '2026-08-13', result: 'Pass', completedBy: 'Lead Tech' },
        { branch: 'Lapux2', date: '2026-08-13', result: 'Fail', completedBy: 'Shift Lead' },
        { branch: 'Bogo', date: '2026-08-13', result: 'Pass', completedBy: 'STM Desk' },
        { branch: 'ITPark', date: '2026-08-13', result: 'Pass', completedBy: 'Lead Tech' },
        { branch: 'Carx2', date: '2026-08-13', result: 'Fail', completedBy: '—' },
      ],
      calibrationAlerts: [
        { asset: 'Torque Wrench Master', branch: 'Carmen', dueInDays: 2, serial: 'TW-8841' },
        { asset: 'Alignment Heads', branch: 'CebuCity', dueInDays: 5, serial: 'AL-2207' },
        { asset: 'Pressure Gauge Kit', branch: 'Toledo', dueInDays: 6, serial: 'PG-1190' },
        { asset: 'Multimeter Fluke', branch: 'Bogo', dueInDays: 7, serial: 'MM-552' },
      ],
      transactions: [
        {
          Transaction_ID: 'FTE-TXN-20260813-0001',
          Transaction_Date: '2026-08-13',
          Transaction_Time: '08:42:15',
          Branch_Name: 'Carmen',
          Asset_ID: 'AST-LFT-003',
          Asset_Name: '2-Post Lift #3',
          Asset_Category: 'Shop Equipment',
          Transaction_Type: 'Repair',
          Description: 'Hydraulic hose kit and seal replacement after bay leak',
          serviceRenderedBy: 'In-House Mechanic',
          laborRate: 350,
          serviceHours: 4,
          laborPrice: 1400,
          partsPrice: 12350,
          total: 13750,
          Payment_Method: 'Company Card',
          Vendor_Supplier: 'Industrial Supply PH',
          Requested_By_User_ID: 'USR-STM-014',
          Approved_By_User_ID: 'USR-GM-001',
          Status: 'Posted',
        },
        {
          Transaction_ID: 'FTE-TXN-20260812-0004',
          Transaction_Date: '2026-08-12',
          Transaction_Time: '14:18:03',
          Branch_Name: 'CebuCity',
          Asset_ID: 'AST-ALN-001',
          Asset_Name: 'Wheel Aligner Heads',
          Asset_Category: 'Calibration Asset',
          Transaction_Type: 'Calibration',
          Description: 'Annual camera head calibration and certificate renewal',
          serviceRenderedBy: 'Manufacturer Tech',
          laborRate: 0,
          serviceHours: 6,
          laborPrice: 4800,
          partsPrice: 0,
          total: 4800,
          Payment_Method: 'Bank Transfer',
          Vendor_Supplier: 'Metro Cal Lab',
          Requested_By_User_ID: 'USR-TECH-027',
          Approved_By_User_ID: 'USR-STM-008',
          Status: 'Posted',
        },
        {
          Transaction_ID: 'FTE-TXN-20260811-0009',
          Transaction_Date: '2026-08-11',
          Transaction_Time: '10:05:41',
          Branch_Name: 'Bogo',
          Asset_ID: 'AST-PPE-LOT',
          Asset_Name: 'Shop PPE Restock Lot',
          Asset_Category: 'Safety Consumable',
          Transaction_Type: 'Purchase',
          Description: 'Gloves, goggles, and spill kit refill for bay ends',
          serviceRenderedBy: 'In-House Mechanic',
          laborRate: 350,
          serviceHours: 0,
          laborPrice: 0,
          partsPrice: 2650.5,
          total: 2650.5,
          Payment_Method: 'Cash',
          Vendor_Supplier: 'Safety First Depot',
          Requested_By_User_ID: 'USR-LEAD-003',
          Approved_By_User_ID: 'USR-STM-014',
          Status: 'Posted',
        },
        {
          Transaction_ID: 'FTE-TXN-20260810-0012',
          Transaction_Date: '2026-08-10',
          Transaction_Time: '16:27:55',
          Branch_Name: 'Lapux2',
          Asset_ID: 'AST-CMP-002',
          Asset_Name: 'Air Compressor Bay 2',
          Asset_Category: 'Facility Equipment',
          Transaction_Type: 'Preventive Maintenance',
          Description: 'Compressor oil change, filter set, and pressure check',
          serviceRenderedBy: 'In-House Electrician',
          laborRate: 350,
          serviceHours: 2,
          laborPrice: 700,
          partsPrice: 2420,
          total: 3120,
          Payment_Method: 'Company Card',
          Vendor_Supplier: 'AirTech Parts',
          Requested_By_User_ID: 'USR-FAC-002',
          Approved_By_User_ID: 'USR-GM-001',
          Status: 'Posted',
        },
        {
          Transaction_ID: 'FTE-TXN-20260809-0007',
          Transaction_Date: '2026-08-09',
          Transaction_Time: '09:33:12',
          Branch_Name: 'ITPark',
          Asset_ID: 'AST-TW-012',
          Asset_Name: 'Torque Wrench 1/2" TW-12',
          Asset_Category: 'Hand Tool',
          Transaction_Type: 'Tool Replacement',
          Description: 'Replace damaged torque wrench from tool crib inventory',
          serviceRenderedBy: 'Third-Party Provider',
          laborRate: 0,
          serviceHours: 0.5,
          laborPrice: 175,
          partsPrice: 4075,
          total: 4250,
          Payment_Method: 'Petty Cash',
          Vendor_Supplier: 'Tool World Cebu',
          Requested_By_User_ID: 'USR-TECH-041',
          Approved_By_User_ID: 'USR-STM-008',
          Status: 'Pending Approval',
        },
        {
          Transaction_ID: 'FTE-TXN-20260808-0015',
          Transaction_Date: '2026-08-08',
          Transaction_Time: '11:50:28',
          Branch_Name: 'Toledo',
          Asset_ID: 'AST-GEN-001',
          Asset_Name: 'Backup Generator',
          Asset_Category: 'Facility Equipment',
          Transaction_Type: 'Service Contract',
          Description: 'Monthly load test service and diesel stabilizer top-up',
          serviceRenderedBy: 'In-House Mechanic',
          laborRate: 350,
          serviceHours: 3,
          laborPrice: 1050,
          partsPrice: 5800,
          total: 6850,
          Payment_Method: 'Bank Transfer',
          Vendor_Supplier: 'PowerSafe Facilities',
          Requested_By_User_ID: 'USR-FAC-002',
          Approved_By_User_ID: 'USR-GM-001',
          Status: 'Posted',
        },
      ],
    },
  });
});

app.get(
  '/gm/catalog',
  requireAnyRole(ROLE_GENERAL_MANAGER, ROLE_STM, ROLE_SERVICE_ADVISOR, ROLE_SERVICE_RECEPTIONIST, ROLE_SENIOR_SERVICE_RECEPTIONIST, ROLE_PARTS_MANAGER),
  (req, res) => {
    return res.render('gm/catalog');
  }
);

app.get('/gm/performance-incentives', requireRole(ROLE_GENERAL_MANAGER), async (req, res) => {
  const [workOrders, transactionRecords, employees, pricingSettings] = await Promise.all([
    store.getAll('work_orders'),
    store.getAll('transaction_records'),
    store.getAll('employees'),
    store.getPricingSettings(),
  ]);
  const period = resolveGmReportPeriod(req.query.date);
  return res.render('gm/performance-incentives', {
    reporting: { date: period.dateKey, label: period.label },
    technicianPerformance: buildGmTechnicianPerformance(workOrders, employees, pricingSettings, period),
    employeeSalesPerformance: buildGmEmployeeSalesPerformance(transactionRecords, employees, pricingSettings, period),
    currentTransactions: buildGmCurrentTransactions(transactionRecords, period),
  });
});

app.post('/gm/technician-incentive-rate', requireRole(ROLE_GENERAL_MANAGER), async (req, res) => {
  const technicianId = String(req.body.technician_id || '').trim();
  const incentiveType = String(req.body.incentive_type || 'technician').trim();
  const ratePct = Number(req.body.rate_pct);
  if (!technicianId || !['technician', 'employee'].includes(incentiveType) || !Number.isFinite(ratePct) || ratePct < 0 || ratePct > 100) {
    return res.status(400).json({ error: 'Enter an incentive rate from 0 to 100.' });
  }

  const settings = await store.getPricingSettings();
  const rateKey = incentiveType === 'employee' ? 'employee_incentive_rates' : 'technician_incentive_rates';
  const incentiveRates = (settings && typeof settings[rateKey] === 'object')
    ? settings[rateKey]
    : {};
  incentiveRates[technicianId] = ratePct;
  await store.updatePricingSettings({ [rateKey]: incentiveRates });
  return res.json({ technicianId, ratePct });
});

app.get('/gm/aging/:bucket', requireRole(ROLE_GENERAL_MANAGER), async (req, res) => {
  const bucket = String(req.params.bucket || '').trim();
  const bucketLabels = {
    '0-2': '0-2 Days',
    '3-5': '3-5 Days',
    '6+': '6+ Days',
  };
  if (!bucketLabels[bucket]) return res.status(404).send('Aging report not found');

  const [workOrders, customers, vehicles] = await Promise.all([
    store.getAll('work_orders'),
    store.getAll('customers'),
    store.getAll('vehicles'),
  ]);
  const customerById = new Map(customers.map(customer => [customer.id, customer]));
  const vehicleById = new Map(vehicles.map(vehicle => [vehicle.id, vehicle]));
  const now = new Date();
  const agingWorkOrders = workOrders
    .filter(wo => isWorkOrderOpen(wo) && toAgeBucket(wo.created_at, now) === bucket)
    .map(wo => {
      const customer = customerById.get(wo.customer_id) || {};
      const vehicle = vehicleById.get(wo.vehicle_id) || {};
      const createdAt = new Date(wo.created_at || 0);
      const ageHours = Math.floor(Math.max(0, now.getTime() - createdAt.getTime()) / 3600000);
      return {
        ...wo,
        customer_name: customer.name || 'Unknown Customer',
        telephone_number: wo.telephone_number || customer.phone || '',
        vehicle_label: [wo.car_brand || vehicle.make, wo.car_model || vehicle.model, wo.plate_number || vehicle.license_plate].filter(Boolean).join(' '),
        ageHours,
        ageDays: Math.floor(ageHours / 24),
        total: getWorkOrderTotal(wo),
      };
    })
    .sort((a, b) => b.ageHours - a.ageHours);

  return res.render('gm/aging-details', {
    bucket,
    bucketLabel: bucketLabels[bucket],
    agingWorkOrders,
  });
});

app.post('/api/admin/restart-tunnel', requireRole(ROLE_STM), (req, res) => {
  const { execFile } = require('child_process');
  const script = path.join(__dirname, 'scripts', 'restart-tunnel.ps1');
  const powershell = process.env.SystemRoot
    ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    : 'powershell.exe';

  execFile(
    powershell,
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script],
    { windowsHide: true, timeout: 20000 },
    (scriptErr, stdout, stderr) => {
      if (scriptErr) {
        console.error('POST /api/admin/restart-tunnel failed', scriptErr, stderr);
        return res.status(500).json({
          status: 'error',
          message: scriptErr.message || 'Unable to recycle the Cloudflare tunnel.',
        });
      }
      return res.json({
        status: 'success',
        message: 'Tunnel cycled completely.',
        detail: String(stdout || '').trim(),
      });
    }
  );
});

function shuffleCopy(list) {
  const copy = Array.isArray(list) ? list.slice() : [];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = copy[i];
    copy[i] = copy[j];
    copy[j] = tmp;
  }
  return copy;
}

function serializeStmWorkOrder(wo, customerById, vehicleById) {
  const customer = (wo && wo.customer_id && customerById.get(wo.customer_id)) || {};
  const vehicle = (wo && wo.vehicle_id && vehicleById.get(wo.vehicle_id)) || {};
  const plate = String((wo && wo.plate_number) || vehicle.license_plate || '').trim();
  const vehicleLabel = [wo && wo.car_brand, wo && wo.car_model, plate].filter(Boolean).join(' ') || '—';
  return {
    id: wo && wo.id,
    work_order_number: (wo && (wo.work_order_number || wo.id)) || '—',
    branch: canonicalizeBranchName(wo && wo.branch) || String((wo && wo.branch) || '').trim() || '—',
    status: String((wo && wo.status) || '').trim() || 'open',
    technician: String((wo && wo.technician) || '').trim() || 'Unassigned',
    advisor: String((wo && wo.service_advisor) || '').trim() || '—',
    customer: String(customer.name || wo.customer_entry || '').trim() || '—',
    vehicle: vehicleLabel,
    created_at: wo && wo.created_at,
    href: wo && wo.id ? `/work-orders/${encodeURIComponent(wo.id)}/edit` : '',
  };
}

function emptyStmLaborRow(name) {
  return {
    branch: name,
    technicians: 0,
    working: 0,
    openJobs: 0,
    billedHours: 0,
    actualHours: 0,
    laborRevenue: 0,
    techToJobRatio: 0,
    elr: 0,
    rateAttainmentPct: 0,
  };
}

function finalizeStmLaborRow(row, hourlyRate) {
  row.techToJobRatio = row.openJobs > 0 ? row.technicians / row.openJobs : row.technicians;
  row.elr = row.billedHours > 0 ? row.laborRevenue / row.billedHours : 0;
  row.rateAttainmentPct = hourlyRate > 0 && row.elr > 0 ? (row.elr / hourlyRate) * 100 : 0;
  return row;
}

function buildStmLaborByBranch(technicians, workOrders, hourlyRate) {
  const rate = Math.max(1, Number(hourlyRate) || 350);
  const byBranch = new Map(DEFAULT_OPERATIONAL_BRANCHES.map((name) => [normalizeBranchKey(name), emptyStmLaborRow(name)]));
  const totals = emptyStmLaborRow('All branches');

  (technicians || []).forEach((tech) => {
    const entry = byBranch.get(normalizeBranchKey(tech.branch));
    if (!entry) return;
    entry.technicians += 1;
    totals.technicians += 1;
    const working = compactKeyStatus(tech.live_status) === 'ongoing' || Number(tech.active_count || 0) > 0;
    if (working) {
      entry.working += 1;
      totals.working += 1;
    }
    const labor = Number(tech.labor_mtd || 0);
    const billed = labor / rate;
    const actual = Number(tech.hours_active || 0) || billed;
    entry.laborRevenue += labor;
    entry.billedHours += billed;
    entry.actualHours += actual;
    totals.laborRevenue += labor;
    totals.billedHours += billed;
    totals.actualHours += actual;
  });

  (workOrders || []).forEach((wo) => {
    if (!isWorkOrderOpen(wo)) return;
    const entry = byBranch.get(normalizeBranchKey(wo.branch));
    if (!entry) return;
    entry.openJobs += 1;
    totals.openJobs += 1;
  });

  const rows = DEFAULT_OPERATIONAL_BRANCHES.map((name) => (
    finalizeStmLaborRow(byBranch.get(normalizeBranchKey(name)), rate)
  ));
  return { rows, totals: finalizeStmLaborRow(totals, rate), hourlyRate: rate };
}

function compactKeyStatus(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function serializeStmTechnician(tech) {
  const board = (tech && tech.board_status) || {};
  return {
    technician: tech.technician,
    employee_id: tech.employee_id || '',
    branch: canonicalizeBranchName(tech.branch) || tech.branch || '—',
    live_status: board.label || tech.live_status || 'Idle',
    present_wo: tech.current_order ? tech.current_order.work_order_number : '—',
    present_wo_id: tech.current_order ? tech.current_order.id : '',
    current_car: tech.current_order ? tech.current_order.vehicle : '—',
    current_job_time: tech.current_order ? `${Number(tech.current_order.hours_open || 0).toFixed(1)}h` : '—',
    labor_mtd: Number(tech.labor_mtd || 0),
    labor_accumulated: Number(tech.labor_accumulated || 0),
    work_orders_mtd: Number(tech.work_orders_mtd || 0),
    completed_mtd: Number(tech.completed_mtd || 0),
    completion_rate: Number(tech.completion_rate || 0),
    hours_active: Number(tech.hours_active || 0),
    average_cycle_hours: Number(tech.average_cycle_hours || 0),
    active_count: Number(tech.active_count || 0),
  };
}

async function loadStmDashboardPage() {
  const [
    workOrders,
    customers,
    vehicles,
    transactionRecords,
    partsInventory,
    employees,
    technicianUpdates,
    approvalRequests,
    pricingSettings,
  ] = await Promise.all([
    store.getAll('work_orders'),
    store.getAll('customers'),
    store.getAll('vehicles'),
    store.getAll('transaction_records'),
    store.getAll('parts_inventory'),
    store.getAll('employees'),
    store.getAll('technician_updates'),
    store.getAll('approval_requests'),
    store.getPricingSettings(),
  ]);

  const metrics = buildStmMetrics(workOrders, transactionRecords, partsInventory, pricingSettings);
  const technicians = buildTechnicianOperations(workOrders, vehicles, technicianUpdates, employees, customers)
    .map(serializeStmTechnician);
  const laborByBranch = buildStmLaborByBranch(
    technicians,
    workOrders,
    metrics.period && metrics.period.hourlyRate
  );
  const pacingByScope = buildPacingByScope(transactionRecords, pricingSettings);
  const customerById = new Map((customers || []).map((row) => [row.id, row]));
  const vehicleById = new Map((vehicles || []).map((row) => [row.id, row]));
  const openWorkOrders = (workOrders || []).filter(isWorkOrderOpen).map((wo) => (
    serializeStmWorkOrder(wo, customerById, vehicleById)
  ));
  const liveRandom = shuffleCopy(openWorkOrders).slice(0, 12);
  const pendingApprovals = (approvalRequests || [])
    .filter((request) => String(request.status || '').toLowerCase() === 'pending')
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  const fteHistory = getFteSeedTransactions().slice().sort((a, b) => (
    String(b.Transaction_Date || '').localeCompare(String(a.Transaction_Date || ''))
  ));
  const now = Date.now();
  const unassignedOverdue = (workOrders || []).filter((wo) => {
    if (!isWorkOrderOpen(wo)) return false;
    if (String(wo.technician || '').trim()) return false;
    return (now - new Date(wo.created_at || 0).getTime()) >= 10 * 60 * 1000;
  }).length;

  return {
    metrics,
    technicians,
    laborByBranch,
    pacingByScope,
    pacingBars: pacingByScope.ALL,
    openWorkOrders,
    liveRandom,
    pendingApprovals,
    fteHistory: fteHistory.slice(0, 12),
    fteOpenCount: fteHistory.filter((row) => /pending|open|in progress/i.test(String(row.Status || ''))).length,
    branches: DEFAULT_OPERATIONAL_BRANCHES.slice(),
    vitals: {
      technicianProductivityPct: metrics.technicianLabor.technicianProductivityPct,
      technicianEfficiencyPct: metrics.technicianLabor.technicianEfficiencyPct,
      technicianUtilizationPct: metrics.technicianLabor.technicianUtilizationPct,
      effectiveLaborRate: metrics.technicianLabor.effectiveLaborRate,
      hourlyRate: metrics.period.hourlyRate,
      averageRepairOrderValue: metrics.financial.averageRepairOrderValue,
      hoursSoldPerRepairOrder: metrics.financial.hoursSoldPerRepairOrder,
      serviceTurnaroundHoursAvg: metrics.operations.serviceTurnaroundHoursAvg,
      carCountRoVolume: metrics.operations.carCountRoVolume,
      openRoCount: (workOrders || []).filter(isWorkOrderOpen).length,
      firstTimeFixRatePct: metrics.quality.firstTimeFixRatePct,
      comebackRatePct: metrics.quality.comebackRatePct,
      assignmentAverage: metrics.assignment.averageMinutesToAssignTechnician,
      unassignedOverdue,
      pendingBillingCount: (workOrders || []).filter((wo) => String(wo.status || '').trim().toLowerCase() === 'completed').length,
    },
  };
}

app.get('/stm', requireAnyRole(ROLE_GENERAL_MANAGER, ROLE_STM), async (req, res) => {
  try {
    return res.render('stm/index', await loadStmDashboardPage());
  } catch (error) {
    console.error('GET /stm failed', error);
    return res.status(500).send('Unable to load STM dashboard.');
  }
});

app.get('/stm/print-technicians', requireAnyRole(ROLE_GENERAL_MANAGER, ROLE_STM), async (req, res) => {
  try {
    const payload = await loadStmDashboardPage();
    const requested = canonicalizeBranchName(String(req.query.branch || '').trim());
    const allBranches = !requested || String(req.query.branch || '').trim().toLowerCase() === 'all';
    const rows = allBranches
      ? payload.technicians
      : payload.technicians.filter((row) => normalizeBranchKey(row.branch) === normalizeBranchKey(requested));
    return res.render('stm/print-technicians', {
      printDate: new Date().toLocaleString('en-PH', { timeZone: 'Asia/Manila' }),
      branchLabel: allBranches ? 'All branches' : requested,
      technicians: rows,
      laborByBranch: payload.laborByBranch,
      showBranchTotals: allBranches,
    });
  } catch (error) {
    console.error('GET /stm/print-technicians failed', error);
    return res.status(500).send('Unable to load printable technician record.');
  }
});

app.get('/api/stm/live', requireAnyRole(ROLE_GENERAL_MANAGER, ROLE_STM), async (req, res) => {
  try {
    const payload = await loadStmDashboardPage();
    return res.json({
      technicians: payload.technicians,
      openWorkOrders: payload.openWorkOrders,
      liveRandom: payload.liveRandom,
      pacingByScope: payload.pacingByScope,
      pendingApprovalCount: payload.pendingApprovals.length,
    });
  } catch (error) {
    console.error('GET /api/stm/live failed', error);
    return res.status(500).json({ error: 'Unable to load STM live feed' });
  }
});

app.use('/technician', requireRole(ROLE_TECHNICIAN), technicianRouter);

app.use('/admin', requireAnyRole(ROLE_GENERAL_MANAGER, ROLE_ADMIN), adminRouter);
app.use('/hr/payroll', requireGrant(portals.PORTAL_HR, portals.GRANT.view_payroll), (req, res, next) => next());
app.use('/hr', requireAnyRole(
  ROLE_GENERAL_MANAGER,
  ROLE_ADMIN,
  ROLE_HR,
  ROLE_HR_MANAGER,
  ROLE_HR_GENERALIST,
  ROLE_PAYROLL,
  ROLE_HR_CLERK
), hrRouter);
app.use('/employees', requireAnyRole(
  ROLE_GENERAL_MANAGER,
  ROLE_ADMIN,
  ROLE_HR,
  ROLE_HR_MANAGER,
  ROLE_HR_GENERALIST,
  ROLE_HR_CLERK,
  ROLE_PAYROLL
), employeesRouter);
app.use('/stores', requirePortalAccess(portals.PORTAL_STORES), storesRouter);

app.use('/customers', customersRouter);
app.use('/vehicles', vehiclesRouter);
app.use('/work-orders', workOrdersRouter);
app.use('/work-order-transactions', workOrderTransactionsRouter);
app.use('/pricing', pricingRouter);
app.use('/transactions', transactionsRouter);
app.use('/parts-manager', requirePartsManager, partsManagerRouter);
app.use('/finance', requireFinanceManager, financeRouter);
app.use('/api/finance', requireFinanceManager, financeRouter.apiRouter);
app.use('/api/reports', requireAnyRole(
  ROLE_PARTS_MANAGER,
  'pm',
  ROLE_PARTS_CLERK,
  ROLE_GENERAL_MANAGER,
  ROLE_ADMIN,
  ROLE_STM,
  ROLE_SERVICE_RECEPTIONIST,
  ROLE_SENIOR_SERVICE_RECEPTIONIST,
  ROLE_SERVICE_ADVISOR,
  ROLE_OPERATIONS_MANAGER,
  ROLE_STORE_MANAGER
), reportsRouter);
app.use('/parts', requireAnyRole(
  ROLE_PARTS_MANAGER,
  'pm',
  ROLE_PARTS_CLERK,
  ROLE_GENERAL_MANAGER,
  ROLE_ADMIN,
  ROLE_STM,
  ROLE_SERVICE_RECEPTIONIST,
  ROLE_SENIOR_SERVICE_RECEPTIONIST,
  ROLE_SERVICE_ADVISOR,
  ROLE_OPERATIONS_MANAGER,
  ROLE_STORE_MANAGER,
  ROLE_STORES_CLERK
), partsRouter);
app.use('/helper', helperRouter);
app.use('/branch-parts', requireAnyRole(
  ROLE_SERVICE_ADVISOR,
  ROLE_SERVICE_RECEPTIONIST,
  ROLE_SENIOR_SERVICE_RECEPTIONIST,
  ROLE_STM,
  ROLE_PARTS_MANAGER,
  ROLE_PARTS_CLERK,
  ROLE_OPERATIONS_MANAGER,
  ROLE_STORE_MANAGER,
  ROLE_STORES_CLERK,
  ROLE_GENERAL_MANAGER
), branchPartsRouter);
app.use('/approvals', approvalsRouter);
app.use('/api/kpi', kpiRouter);
app.use('/kpi', requireAnyRole(ROLE_GENERAL_MANAGER, ROLE_ADMIN, ROLE_STM), kpiRouter);

ensureSeedHrAccount()
  .then(() => loadLoginAuthState())
  .catch((error) => {
    console.error('Failed to seed HR account:', error);
  })
  .finally(() => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Server running at http://localhost:${PORT}`);
    });
  });
