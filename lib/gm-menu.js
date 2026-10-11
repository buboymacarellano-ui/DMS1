// Single source for the GM sidebar and the Work Spaces / More hub pages.
const portals = require('./portals');

const GM_HUBS = {
  'work-spaces': {
    title: 'Work Spaces',
    href: '/gm/work-spaces',
    note: 'Pick a role to view its workspace.',
    groups: [
      {
        key: 'service',
        title: 'Service',
        roles: [
          { role: 'service_technical_manager', label: 'STM', full: 'Service & Technical Manager', href: '/stm', prefixes: ['/stm', '/api/stm'] },
          { role: 'service_advisor', label: 'SA', full: 'Service Advisor', href: '/service-receptionist', prefixes: ['/service-receptionist', '/service'] },
          { role: 'senior_service_receptionist', label: 'SSR', full: 'Senior Service Receptionist', href: '/service-receptionist', prefixes: [] },
          { role: 'service_receptionist', label: 'SR', full: 'Service Receptionist', href: '/service-receptionist', prefixes: [] },
          { role: 'technician', label: 'Tech', full: 'Technician', href: '/work-order-transactions/technicians', prefixes: ['/work-order-transactions/technicians', '/technician'] },
        ],
      },
      {
        key: 'parts',
        title: 'Parts',
        roles: [
          { role: 'parts_manager', label: 'PM', full: 'Parts Manager', href: '/parts-manager', prefixes: ['/parts-manager', '/parts', '/receiving'] },
          { role: 'parts_clerk', label: 'Clerk', full: 'Parts Clerk', href: '/parts-portal', prefixes: ['/parts-portal'] },
        ],
      },
      {
        key: 'admin_office',
        title: 'Admin & Office',
        roles: [
          { role: 'hr_manager', label: 'HM', full: 'HR Manager', href: '/hr', prefixes: ['/hr', '/employees'] },
          { role: 'accounting', label: 'Acct', full: 'Accounting', href: '/finance', prefixes: ['/finance'] },
          { role: 'finance_manager', label: 'FM', full: 'Finance Manager', href: '/finance', prefixes: [] },
          { role: 'admin', label: 'Admin', full: 'Admin', href: '/admin', prefixes: ['/admin'] },
        ],
      },
    ],
  },
  more: {
    title: 'More',
    href: '/gm/more',
    note: 'Other tools and reports.',
    items: [
      { label: 'FTE Workspace', href: '/gm/fte', icon: '&#128203;', desc: 'FTE tracking per branch', prefixes: ['/gm/fte'] },
      { label: 'Catalog', href: '/gm/catalog', icon: '&#128218;', desc: 'Service and parts catalog', prefixes: ['/gm/catalog'] },
      { label: 'Stores', href: '/stores', icon: '&#128722;', desc: 'POS sales, shelving and cashier control', prefixes: ['/stores'], portal: portals.PORTAL_STORES },
      { label: 'Finance', href: '/finance', icon: '&#128176;', desc: 'Finance monitor and EOD report', prefixes: ['/finance'] },
      { label: 'Billing Queue', href: '/transactions', icon: '&#129534;', desc: 'Transactions waiting for billing', prefixes: ['/transactions'] },
      { label: 'Work Orders', href: '/work-orders', icon: '&#128736;', desc: 'All work orders and technician transactions', prefixes: ['/work-orders', '/work-order-transactions'] },
      { label: 'Sales Reports / KPI', href: '/kpi', icon: '&#128200;', desc: 'Sales and KPI reports', prefixes: ['/kpi'] },
    ],
  },
};

function pathMatches(path, prefixes) {
  return prefixes.some((prefix) => path === prefix || path.indexOf(`${prefix}/`) === 0);
}

// Groups with only the roles that are enabled in the current setup.
function hubGroups(slug) {
  const hub = GM_HUBS[slug];
  if (!hub || !hub.groups) return [];
  return hub.groups
    .map((group) => ({ ...group, roles: group.roles.filter((item) => portals.isRoleEnabled(item.role)) }))
    .filter((group) => group.roles.length);
}

function hubItems(slug) {
  const hub = GM_HUBS[slug];
  if (!hub) return [];
  if (hub.groups) return hubGroups(slug).flatMap((group) => group.roles);
  return hub.items.filter((item) => !item.portal || portals.isPortalEnabled(item.portal));
}

function hubMatchesPath(slug, path) {
  const hub = GM_HUBS[slug];
  if (!hub) return false;
  const current = String(path || '');
  return current === hub.href || hubItems(slug).some((item) => pathMatches(current, item.prefixes));
}

module.exports = { GM_HUBS, hubGroups, hubItems, hubMatchesPath };
