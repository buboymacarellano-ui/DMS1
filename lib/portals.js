const {
  DEFAULT_OPERATIONAL_BRANCHES,
  PRIMARY_BRANCH_NAME,
  canonicalizeBranchName,
} = require('./branches');
const { WAREHOUSE_1 } = require('./parts-location-scope');
const {
  ROLE_SERVICE_ADVISOR,
  ROLE_SERVICE_RECEPTIONIST,
  ROLE_SENIOR_SERVICE_RECEPTIONIST,
  isFrontlineRole,
  frontlineHomePath,
} = require('./frontline-roles');

const PORTAL_SERVICE = 'service';
const PORTAL_PARTS = 'parts';
const PORTAL_STORES = 'stores';
const PORTAL_HR = 'hr';
const PORTAL_GM = 'gm';

const ROLE_GENERAL_MANAGER = 'general_manager';
const ROLE_ADMIN = 'admin';
const ROLE_HR = 'hr';
const ROLE_STM = 'service_technical_manager';
const ROLE_PARTS_MANAGER = 'parts_manager';
const ROLE_FINANCE_MANAGER = 'finance_manager';
const ROLE_TECHNICIAN = 'technician';
const ROLE_PARTS_CLERK = 'parts_clerk';
const ROLE_OPERATIONS_MANAGER = 'operations_manager';
const ROLE_STORE_MANAGER = 'store_manager';
const ROLE_CASHIER = 'cashier';
const ROLE_STORES_CLERK = 'stores_clerk';
const ROLE_HR_MANAGER = 'hr_manager';
const ROLE_HR_GENERALIST = 'hr_generalist';
const ROLE_PAYROLL = 'payroll';
const ROLE_HR_CLERK = 'hr_clerk';

const GRANT = {
  view: 'view',
  edit: 'edit',
  validate: 'validate',
  approval: 'approval',
  request: 'request',
  filloutform: 'filloutform',
  edit_price: 'edit_price',
  modify_level_of_use: 'modify_level_of_use',
  access: 'access',
  limited_view: 'limited_view',
  print: 'print',
  export: 'export',
  receive_stock: 'receive_stock',
  adjust_inventory: 'adjust_inventory',
  pos_sale: 'pos_sale',
  cashier_control: 'cashier_control',
  schedule: 'schedule',
  view_payroll: 'view_payroll',
  view_financials: 'view_financials',
  manage_users: 'manage_users',
  close_workorder: 'close_workorder',
  assign_tech: 'assign_tech',
};

const ALL_GRANTS = Object.values(GRANT);

const GROCERY_STORES = [
  'AEG-01 Mandaue',
  'AEG-02 Banilad',
  'AEG-03 IT Park',
  'AEG-04 Lahug',
  'AEG-05 Talisay',
  'AEG-06 Consolacion',
  'AEG-07 Minglanilla',
  'AEG-08 Carcar',
  'AEG-09 Toledo',
  'AEG-10 Bogo',
  'AEG-11 Danao',
  'AEG-12 Naga',
  'AEG-13 Lapu-Lapu',
  'AEG-14 Cebu City',
];

const PARTS_LOCATIONS = [WAREHOUSE_1].concat(DEFAULT_OPERATIONAL_BRANCHES);
const HR_LOCATIONS = ['Enterprise HQ'].concat(DEFAULT_OPERATIONAL_BRANCHES);

const DEPARTMENTS = [
  { key: PORTAL_SERVICE, label: 'Service' },
  { key: PORTAL_PARTS, label: 'Parts' },
  { key: PORTAL_STORES, label: 'Stores' },
  { key: PORTAL_HR, label: 'HR' },
  { key: PORTAL_GM, label: 'GM' },
];

const ROLES_BY_DEPARTMENT = {
  [PORTAL_SERVICE]: [
    { key: ROLE_STM, label: 'STM - Service & Technical Manager' },
    { key: ROLE_SERVICE_ADVISOR, label: 'SA - Service Advisor' },
    { key: ROLE_SERVICE_RECEPTIONIST, label: 'SR - Service Receptionist' },
    { key: ROLE_SENIOR_SERVICE_RECEPTIONIST, label: 'SSR - Senior Service Receptionist' },
  ],
  [PORTAL_PARTS]: [
    { key: ROLE_PARTS_MANAGER, label: 'PM - Parts Manager' },
    { key: ROLE_PARTS_CLERK, label: 'Clerk - Parts Clerk' },
  ],
  [PORTAL_STORES]: [
    { key: ROLE_OPERATIONS_MANAGER, label: 'OM - Operation Manager' },
    { key: ROLE_STORE_MANAGER, label: 'SM - Store Manager' },
    { key: ROLE_CASHIER, label: 'Cashier' },
    { key: ROLE_STORES_CLERK, label: 'Clerk - Stores Clerk' },
  ],
  [PORTAL_HR]: [
    { key: ROLE_HR_MANAGER, label: 'HM - HR Manager' },
    { key: ROLE_HR_GENERALIST, label: 'Generalist' },
    { key: ROLE_PAYROLL, label: 'Payroll' },
    { key: ROLE_HR_CLERK, label: 'Clerk - HR Clerk' },
  ],
  [PORTAL_GM]: [
    { key: ROLE_GENERAL_MANAGER, label: 'GM - General Manager' },
  ],
};

const LOCATIONS_BY_DEPARTMENT = {
  [PORTAL_SERVICE]: DEFAULT_OPERATIONAL_BRANCHES.slice(),
  [PORTAL_PARTS]: PARTS_LOCATIONS.slice(),
  [PORTAL_STORES]: GROCERY_STORES.slice(),
  [PORTAL_HR]: HR_LOCATIONS.slice(),
  [PORTAL_GM]: [],
};

const JOB_CODES_BY_ROLE = {
  [ROLE_STM]: ['STM', 'SERVICE TECHNICAL MANAGER', 'SERVICE & TECHNICAL MANAGER', 'TECHNICAL MANAGER'],
  [ROLE_SERVICE_ADVISOR]: ['SERVICE ADVISOR', 'SA'],
  [ROLE_SERVICE_RECEPTIONIST]: ['SERVICE RECEPTIONIST', 'SR'],
  [ROLE_SENIOR_SERVICE_RECEPTIONIST]: ['SENIOR SERVICE RECEPTIONIST', 'SSR', 'SENIOR SR'],
  [ROLE_PARTS_MANAGER]: ['PARTS MANAGER', 'PM'],
  [ROLE_PARTS_CLERK]: ['PARTS CLERK', 'PARTS CLERK '],
  [ROLE_OPERATIONS_MANAGER]: ['OPERATION MANAGER', 'OPERATIONS MANAGER', 'OM'],
  [ROLE_STORE_MANAGER]: ['STORE MANAGER', 'SM'],
  [ROLE_CASHIER]: ['CASHIER'],
  [ROLE_STORES_CLERK]: ['STORE CLERK', 'STORES CLERK'],
  [ROLE_HR_MANAGER]: ['HR MANAGER', 'HM'],
  [ROLE_HR_GENERALIST]: ['HR GENERALIST', 'GENERALIST'],
  [ROLE_PAYROLL]: ['PAYROLL', 'PAYROLL CLERK'],
  [ROLE_HR_CLERK]: ['HR CLERK'],
};

function g(...keys) {
  return Array.from(new Set(keys));
}

const SERVICE_FULL = g(
  GRANT.access, GRANT.view, GRANT.edit, GRANT.validate, GRANT.approval,
  GRANT.request, GRANT.filloutform, GRANT.print, GRANT.export, GRANT.schedule,
  GRANT.assign_tech, GRANT.close_workorder
);

const PARTS_FULL = g(
  GRANT.access, GRANT.view, GRANT.edit, GRANT.validate, GRANT.approval,
  GRANT.request, GRANT.filloutform, GRANT.edit_price, GRANT.print, GRANT.export,
  GRANT.receive_stock, GRANT.adjust_inventory
);

const STORES_FULL = g(
  GRANT.access, GRANT.view, GRANT.edit, GRANT.validate, GRANT.approval,
  GRANT.request, GRANT.filloutform, GRANT.print, GRANT.export,
  GRANT.pos_sale, GRANT.cashier_control
);

const HR_FULL = g(
  GRANT.access, GRANT.view, GRANT.edit, GRANT.validate, GRANT.approval,
  GRANT.request, GRANT.filloutform, GRANT.print, GRANT.export,
  GRANT.view_payroll, GRANT.manage_users, GRANT.modify_level_of_use
);

const GM_ALL = g(...ALL_GRANTS, GRANT.view_financials, GRANT.modify_level_of_use);

const ROLE_GRANTS = {
  [ROLE_STM]: {
    [PORTAL_SERVICE]: SERVICE_FULL,
    [PORTAL_PARTS]: g(GRANT.access, GRANT.view, GRANT.request, GRANT.filloutform, GRANT.print),
    [PORTAL_STORES]: g(GRANT.limited_view),
    [PORTAL_HR]: g(GRANT.limited_view),
  },
  [ROLE_SERVICE_ADVISOR]: {
    [PORTAL_SERVICE]: g(GRANT.access, GRANT.view, GRANT.edit, GRANT.request, GRANT.filloutform, GRANT.print, GRANT.assign_tech, GRANT.close_workorder),
    [PORTAL_PARTS]: g(GRANT.access, GRANT.view, GRANT.request, GRANT.filloutform),
    [PORTAL_STORES]: [],
    [PORTAL_HR]: [],
  },
  [ROLE_SERVICE_RECEPTIONIST]: {
    [PORTAL_SERVICE]: g(GRANT.access, GRANT.view, GRANT.filloutform, GRANT.request, GRANT.print),
    [PORTAL_PARTS]: g(GRANT.access, GRANT.view, GRANT.request),
    [PORTAL_STORES]: [],
    [PORTAL_HR]: [],
  },
  [ROLE_SENIOR_SERVICE_RECEPTIONIST]: {
    [PORTAL_SERVICE]: g(GRANT.access, GRANT.view, GRANT.edit, GRANT.validate, GRANT.filloutform, GRANT.request, GRANT.print, GRANT.assign_tech),
    [PORTAL_PARTS]: g(GRANT.access, GRANT.view, GRANT.request, GRANT.filloutform),
    [PORTAL_STORES]: [],
    [PORTAL_HR]: [],
  },
  [ROLE_TECHNICIAN]: {
    [PORTAL_SERVICE]: g(GRANT.access, GRANT.view, GRANT.filloutform, GRANT.print),
    [PORTAL_PARTS]: g(GRANT.limited_view, GRANT.request),
    [PORTAL_STORES]: [],
    [PORTAL_HR]: [],
  },
  [ROLE_PARTS_MANAGER]: {
    [PORTAL_SERVICE]: g(GRANT.limited_view, GRANT.view),
    [PORTAL_PARTS]: PARTS_FULL,
    [PORTAL_STORES]: g(GRANT.access, GRANT.view, GRANT.request),
    [PORTAL_HR]: [],
  },
  [ROLE_PARTS_CLERK]: {
    [PORTAL_SERVICE]: g(GRANT.limited_view),
    [PORTAL_PARTS]: g(GRANT.access, GRANT.view, GRANT.filloutform, GRANT.receive_stock, GRANT.request, GRANT.print),
    [PORTAL_STORES]: [],
    [PORTAL_HR]: [],
  },
  [ROLE_OPERATIONS_MANAGER]: {
    [PORTAL_SERVICE]: g(GRANT.limited_view),
    [PORTAL_PARTS]: g(GRANT.access, GRANT.view, GRANT.request),
    [PORTAL_STORES]: STORES_FULL,
    [PORTAL_HR]: g(GRANT.limited_view),
  },
  [ROLE_STORE_MANAGER]: {
    [PORTAL_SERVICE]: [],
    [PORTAL_PARTS]: g(GRANT.access, GRANT.view, GRANT.request),
    [PORTAL_STORES]: g(GRANT.access, GRANT.view, GRANT.edit, GRANT.validate, GRANT.approval, GRANT.filloutform, GRANT.cashier_control, GRANT.pos_sale, GRANT.print, GRANT.request),
    [PORTAL_HR]: [],
  },
  [ROLE_CASHIER]: {
    [PORTAL_SERVICE]: [],
    [PORTAL_PARTS]: [],
    [PORTAL_STORES]: g(GRANT.access, GRANT.view, GRANT.filloutform, GRANT.pos_sale, GRANT.print),
    [PORTAL_HR]: [],
  },
  [ROLE_STORES_CLERK]: {
    [PORTAL_SERVICE]: [],
    [PORTAL_PARTS]: g(GRANT.access, GRANT.view, GRANT.request),
    [PORTAL_STORES]: g(GRANT.access, GRANT.view, GRANT.filloutform, GRANT.request),
    [PORTAL_HR]: [],
  },
  [ROLE_HR]: {
    [PORTAL_SERVICE]: g(GRANT.limited_view),
    [PORTAL_PARTS]: g(GRANT.limited_view),
    [PORTAL_STORES]: g(GRANT.limited_view),
    [PORTAL_HR]: HR_FULL,
  },
  [ROLE_HR_MANAGER]: {
    [PORTAL_SERVICE]: g(GRANT.limited_view),
    [PORTAL_PARTS]: g(GRANT.limited_view),
    [PORTAL_STORES]: g(GRANT.limited_view),
    [PORTAL_HR]: HR_FULL,
  },
  [ROLE_HR_GENERALIST]: {
    [PORTAL_SERVICE]: [],
    [PORTAL_PARTS]: [],
    [PORTAL_STORES]: [],
    [PORTAL_HR]: g(GRANT.access, GRANT.view, GRANT.edit, GRANT.validate, GRANT.filloutform, GRANT.manage_users, GRANT.print, GRANT.request),
  },
  [ROLE_PAYROLL]: {
    [PORTAL_SERVICE]: [],
    [PORTAL_PARTS]: [],
    [PORTAL_STORES]: [],
    [PORTAL_HR]: g(GRANT.access, GRANT.view, GRANT.filloutform, GRANT.view_payroll, GRANT.print, GRANT.export),
  },
  [ROLE_HR_CLERK]: {
    [PORTAL_SERVICE]: [],
    [PORTAL_PARTS]: [],
    [PORTAL_STORES]: [],
    [PORTAL_HR]: g(GRANT.access, GRANT.view, GRANT.filloutform, GRANT.request),
  },
  [ROLE_GENERAL_MANAGER]: {
    [PORTAL_SERVICE]: GM_ALL,
    [PORTAL_PARTS]: GM_ALL,
    [PORTAL_STORES]: GM_ALL,
    [PORTAL_HR]: GM_ALL,
    [PORTAL_GM]: GM_ALL,
  },
  [ROLE_ADMIN]: {
    [PORTAL_SERVICE]: g(GRANT.limited_view),
    [PORTAL_PARTS]: g(GRANT.limited_view),
    [PORTAL_STORES]: g(GRANT.limited_view),
    [PORTAL_HR]: g(GRANT.access, GRANT.view, GRANT.manage_users),
    [PORTAL_GM]: g(GRANT.access, GRANT.view, GRANT.edit, GRANT.modify_level_of_use),
  },
  [ROLE_FINANCE_MANAGER]: {
    [PORTAL_SERVICE]: g(GRANT.limited_view, GRANT.view_financials),
    [PORTAL_PARTS]: g(GRANT.limited_view, GRANT.view_financials),
    [PORTAL_STORES]: g(GRANT.limited_view, GRANT.view_financials),
    [PORTAL_HR]: g(GRANT.limited_view, GRANT.view_payroll),
    [PORTAL_GM]: g(GRANT.access, GRANT.view, GRANT.view_financials, GRANT.print, GRANT.export),
  },
};

const PORTAL_LABELS = {
  [PORTAL_SERVICE]: 'Service Portal',
  [PORTAL_PARTS]: 'Parts Portal',
  [PORTAL_STORES]: 'Stores Portal',
  [PORTAL_HR]: 'HR Portal',
  [PORTAL_GM]: 'GM Portal',
};

const HOME_BY_ROLE = {
  [ROLE_GENERAL_MANAGER]: '/gm',
  [ROLE_ADMIN]: '/admin',
  [ROLE_HR]: '/hr/portal',
  [ROLE_HR_MANAGER]: '/hr/portal',
  [ROLE_HR_GENERALIST]: '/hr/portal',
  [ROLE_PAYROLL]: '/hr/payroll',
  [ROLE_HR_CLERK]: '/hr/portal',
  [ROLE_STM]: '/stm',
  [ROLE_TECHNICIAN]: '/technician',
  [ROLE_PARTS_MANAGER]: '/parts-manager',
  [ROLE_PARTS_CLERK]: '/parts-portal',
  [ROLE_FINANCE_MANAGER]: '/finance',
  [ROLE_SERVICE_ADVISOR]: '/service-receptionist',
  [ROLE_SERVICE_RECEPTIONIST]: '/service-receptionist',
  [ROLE_SENIOR_SERVICE_RECEPTIONIST]: '/service-receptionist',
  [ROLE_OPERATIONS_MANAGER]: '/stores',
  [ROLE_STORE_MANAGER]: '/stores',
  [ROLE_CASHIER]: '/stores/pos',
  [ROLE_STORES_CLERK]: '/stores',
};

const ROLE_SHORT_LABELS = {
  [ROLE_GENERAL_MANAGER]: 'GM',
  [ROLE_ADMIN]: 'ADMIN',
  [ROLE_HR]: 'HM',
  [ROLE_HR_MANAGER]: 'HM',
  [ROLE_HR_GENERALIST]: 'GEN',
  [ROLE_PAYROLL]: 'PAY',
  [ROLE_HR_CLERK]: 'HRC',
  [ROLE_STM]: 'STM',
  [ROLE_TECHNICIAN]: 'TECH',
  [ROLE_PARTS_MANAGER]: 'PM',
  [ROLE_PARTS_CLERK]: 'PCLK',
  [ROLE_FINANCE_MANAGER]: 'FM',
  [ROLE_SERVICE_ADVISOR]: 'SA',
  [ROLE_SERVICE_RECEPTIONIST]: 'SR',
  [ROLE_SENIOR_SERVICE_RECEPTIONIST]: 'SSR',
  [ROLE_OPERATIONS_MANAGER]: 'OM',
  [ROLE_STORE_MANAGER]: 'SM',
  [ROLE_CASHIER]: 'CASH',
  [ROLE_STORES_CLERK]: 'SCLK',
};

const PATH_PORTALS = [
  { prefix: '/gm/fte', portal: PORTAL_SERVICE },
  { prefix: '/gm', portal: PORTAL_GM },
  { prefix: '/admin', portal: PORTAL_GM },
  { prefix: '/finance', portal: PORTAL_GM },
  { prefix: '/api/finance', portal: PORTAL_GM },
  { prefix: '/api/dashboard', portal: PORTAL_GM },
  { prefix: '/api/gm', portal: PORTAL_GM },
  { prefix: '/stm', portal: PORTAL_SERVICE },
  { prefix: '/api/stm', portal: PORTAL_SERVICE },
  { prefix: '/service', portal: PORTAL_SERVICE },
  { prefix: '/service-receptionist', portal: PORTAL_SERVICE },
  { prefix: '/api/service-receptionist', portal: PORTAL_SERVICE },
  { prefix: '/technician', portal: PORTAL_SERVICE },
  { prefix: '/work-orders', portal: PORTAL_SERVICE },
  { prefix: '/work-order-transactions', portal: PORTAL_SERVICE },
  { prefix: '/customers', portal: PORTAL_SERVICE },
  { prefix: '/vehicles', portal: PORTAL_SERVICE },
  { prefix: '/kpi', portal: PORTAL_SERVICE },
  { prefix: '/api/kpi', portal: PORTAL_SERVICE },
  { prefix: '/pricing', portal: PORTAL_SERVICE },
  { prefix: '/parts-manager', portal: PORTAL_PARTS },
  { prefix: '/parts-portal', portal: PORTAL_PARTS },
  { prefix: '/parts', portal: PORTAL_PARTS },
  { prefix: '/branch-parts', portal: PORTAL_PARTS },
  { prefix: '/api/reports', portal: PORTAL_PARTS },
  { prefix: '/stores', portal: PORTAL_STORES },
  { prefix: '/hr', portal: PORTAL_HR },
  { prefix: '/employees', portal: PORTAL_HR },
];

function normalizeRole(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'pm') return ROLE_PARTS_MANAGER;
  if (raw === 'fm' || raw === 'finance manager') return ROLE_FINANCE_MANAGER;
  if (raw === 'stm' || raw === 'service & technical manager') return ROLE_STM;
  if (raw === 'sa') return ROLE_SERVICE_ADVISOR;
  if (raw === 'sr') return ROLE_SERVICE_RECEPTIONIST;
  if (raw === 'ssr' || raw === 'senior_sr') return ROLE_SENIOR_SERVICE_RECEPTIONIST;
  if (raw === 'om') return ROLE_OPERATIONS_MANAGER;
  if (raw === 'sm') return ROLE_STORE_MANAGER;
  if (raw === 'hm' || raw === 'hr manager') return ROLE_HR_MANAGER;
  if (raw === 'pclk' || raw === 'parts clerk') return ROLE_PARTS_CLERK;
  if (raw === 'sclk' || raw === 'stores clerk' || raw === 'store clerk') return ROLE_STORES_CLERK;
  if (raw === 'hrc' || raw === 'hr clerk') return ROLE_HR_CLERK;
  if (raw === 'gen' || raw === 'generalist') return ROLE_HR_GENERALIST;
  if (raw === 'pay') return ROLE_PAYROLL;
  if (raw === 'cash') return ROLE_CASHIER;
  return raw;
}

function normalizeDepartment(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'service') return PORTAL_SERVICE;
  if (raw === 'parts') return PORTAL_PARTS;
  if (raw === 'stores' || raw === 'store') return PORTAL_STORES;
  if (raw === 'hr' || raw === 'human resources') return PORTAL_HR;
  if (raw === 'gm' || raw === 'general_manager' || raw === 'enterprise') return PORTAL_GM;
  return '';
}

function departmentForRole(role) {
  const normalized = normalizeRole(role);
  if (normalized === ROLE_GENERAL_MANAGER || normalized === ROLE_ADMIN || normalized === ROLE_FINANCE_MANAGER) {
    return PORTAL_GM;
  }
  if (normalized === ROLE_STM || isFrontlineRole(normalized) || normalized === ROLE_TECHNICIAN) {
    return PORTAL_SERVICE;
  }
  if (normalized === ROLE_PARTS_MANAGER || normalized === ROLE_PARTS_CLERK) return PORTAL_PARTS;
  if (
    normalized === ROLE_OPERATIONS_MANAGER
    || normalized === ROLE_STORE_MANAGER
    || normalized === ROLE_CASHIER
    || normalized === ROLE_STORES_CLERK
  ) {
    return PORTAL_STORES;
  }
  if (
    normalized === ROLE_HR
    || normalized === ROLE_HR_MANAGER
    || normalized === ROLE_HR_GENERALIST
    || normalized === ROLE_PAYROLL
    || normalized === ROLE_HR_CLERK
  ) {
    return PORTAL_HR;
  }
  return PORTAL_SERVICE;
}

function grantsForRole(role, portal) {
  const normalized = normalizeRole(role);
  const table = ROLE_GRANTS[normalized] || {};
  return Array.isArray(table[portal]) ? table[portal].slice() : [];
}

function hasGrant(userOrRole, portal, grant) {
  const role = typeof userOrRole === 'string'
    ? userOrRole
    : (userOrRole && userOrRole.role);
  const normalized = normalizeRole(role);
  if (normalized === ROLE_GENERAL_MANAGER) return true;
  const grants = grantsForRole(normalized, portal);
  if (grants.includes(GRANT.modify_level_of_use) && grant !== GRANT.modify_level_of_use) return true;
  return grants.includes(grant);
}

function canEnterPortal(userOrRole, portal, method) {
  const role = typeof userOrRole === 'string'
    ? userOrRole
    : (userOrRole && userOrRole.role);
  const normalized = normalizeRole(role);
  if (normalized === ROLE_GENERAL_MANAGER) return true;
  const grants = grantsForRole(normalized, portal);
  if (!grants.length) return false;
  if (grants.includes(GRANT.access) || grants.includes(GRANT.view) || grants.includes(GRANT.modify_level_of_use)) {
    return true;
  }
  if (grants.includes(GRANT.limited_view)) {
    const verb = String(method || 'GET').toUpperCase();
    return verb === 'GET' || verb === 'HEAD';
  }
  return false;
}

function portalLabel(portal) {
  return PORTAL_LABELS[portal] || '';
}

function roleShortLabel(role) {
  return ROLE_SHORT_LABELS[normalizeRole(role)] || 'USER';
}

function homePathForRole(role) {
  const normalized = normalizeRole(role);
  if (isFrontlineRole(normalized)) return frontlineHomePath(normalized);
  return HOME_BY_ROLE[normalized] || '/';
}

function portalForPath(pathname) {
  const path = String(pathname || '').split('?')[0];
  if (path === '/helper' || path.indexOf('/helper') === 0) return '';
  if (path === '/approvals' || path.indexOf('/approvals') === 0) return '';
  if (path === '/transactions' || path.indexOf('/transactions') === 0) return '';
  let matched = '';
  let matchedLen = -1;
  PATH_PORTALS.forEach((entry) => {
    if (path === entry.prefix || path.indexOf(`${entry.prefix}/`) === 0) {
      if (entry.prefix.length > matchedLen) {
        matched = entry.portal;
        matchedLen = entry.prefix.length;
      }
    }
  });
  return matched;
}

function locationsForDepartment(department) {
  const key = normalizeDepartment(department);
  return (LOCATIONS_BY_DEPARTMENT[key] || []).slice();
}

function rolesForDepartment(department) {
  const key = normalizeDepartment(department);
  return (ROLES_BY_DEPARTMENT[key] || []).slice();
}

function normalizeJobText(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
}

function employeeMatchesPortalRole(employee, role) {
  const normalized = normalizeRole(role);
  const codes = JOB_CODES_BY_ROLE[normalized];
  if (!codes) return false;
  const text = [employee && employee.job_code, employee && employee.job_title]
    .map(normalizeJobText)
    .filter(Boolean)
    .join(' ');
  if (!text) return false;
  return codes.some((code) => {
    const token = normalizeJobText(code);
    if (!token) return false;
    if (text === token) return true;
    return new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(text);
  });
}

function loginPayloadExtras() {
  return {
    departments: DEPARTMENTS,
    rolesByDepartment: ROLES_BY_DEPARTMENT,
    locationsByDepartment: LOCATIONS_BY_DEPARTMENT,
    groceryStores: GROCERY_STORES,
    serviceBays: DEFAULT_OPERATIONAL_BRANCHES.slice(),
    primaryBranch: PRIMARY_BRANCH_NAME,
    warehouseName: WAREHOUSE_1,
  };
}

function canonicalizeLocation(department, value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const dept = normalizeDepartment(department);
  if (dept === PORTAL_SERVICE || dept === PORTAL_HR || dept === PORTAL_PARTS) {
    if (raw === WAREHOUSE_1 || raw.toLowerCase() === 'warehouse 1') return WAREHOUSE_1;
    if (raw === 'Enterprise HQ') return 'Enterprise HQ';
    return canonicalizeBranchName(raw);
  }
  const stores = GROCERY_STORES;
  const hit = stores.find((name) => name.toLowerCase() === raw.toLowerCase());
  return hit || raw;
}

function accountRoleMatches(accountRole, selectedRole) {
  const left = normalizeRole(accountRole);
  const right = normalizeRole(selectedRole);
  if (left === right) return true;
  if (right === ROLE_HR_MANAGER && left === ROLE_HR) return true;
  if (right === ROLE_HR && left === ROLE_HR_MANAGER) return true;
  if (right === ROLE_PARTS_MANAGER && left === 'pm') return true;
  return false;
}

function isHrFamily(role) {
  const normalized = normalizeRole(role);
  return (
    normalized === ROLE_HR
    || normalized === ROLE_HR_MANAGER
    || normalized === ROLE_HR_GENERALIST
    || normalized === ROLE_PAYROLL
    || normalized === ROLE_HR_CLERK
  );
}

function isStoresFamily(role) {
  const normalized = normalizeRole(role);
  return (
    normalized === ROLE_OPERATIONS_MANAGER
    || normalized === ROLE_STORE_MANAGER
    || normalized === ROLE_CASHIER
    || normalized === ROLE_STORES_CLERK
  );
}

function isPartsFamily(role) {
  const normalized = normalizeRole(role);
  return normalized === ROLE_PARTS_MANAGER || normalized === ROLE_PARTS_CLERK;
}

function accessiblePortals(role) {
  return [PORTAL_SERVICE, PORTAL_PARTS, PORTAL_STORES, PORTAL_HR]
    .filter((portal) => canEnterPortal(role, portal, 'GET'))
    .map((portal) => ({ key: portal, label: portalLabel(portal), href: portalHome(portal) }));
}

function portalHome(portal) {
  if (portal === PORTAL_SERVICE) return '/service';
  if (portal === PORTAL_PARTS) return '/parts-portal';
  if (portal === PORTAL_STORES) return '/stores';
  if (portal === PORTAL_HR) return '/hr';
  return '/gm';
}

module.exports = {
  PORTAL_SERVICE,
  PORTAL_PARTS,
  PORTAL_STORES,
  PORTAL_HR,
  PORTAL_GM,
  ROLE_GENERAL_MANAGER,
  ROLE_ADMIN,
  ROLE_HR,
  ROLE_STM,
  ROLE_PARTS_MANAGER,
  ROLE_FINANCE_MANAGER,
  ROLE_TECHNICIAN,
  ROLE_PARTS_CLERK,
  ROLE_OPERATIONS_MANAGER,
  ROLE_STORE_MANAGER,
  ROLE_CASHIER,
  ROLE_STORES_CLERK,
  ROLE_HR_MANAGER,
  ROLE_HR_GENERALIST,
  ROLE_PAYROLL,
  ROLE_HR_CLERK,
  GRANT,
  ALL_GRANTS,
  GROCERY_STORES,
  DEPARTMENTS,
  ROLES_BY_DEPARTMENT,
  LOCATIONS_BY_DEPARTMENT,
  normalizeRole,
  normalizeDepartment,
  departmentForRole,
  grantsForRole,
  hasGrant,
  canEnterPortal,
  portalLabel,
  roleShortLabel,
  homePathForRole,
  portalForPath,
  locationsForDepartment,
  rolesForDepartment,
  employeeMatchesPortalRole,
  loginPayloadExtras,
  canonicalizeLocation,
  accountRoleMatches,
  isHrFamily,
  isStoresFamily,
  isPartsFamily,
  accessiblePortals,
  portalHome,
  DEFAULT_OPERATIONAL_BRANCHES,
};
