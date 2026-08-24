const DEFAULT_OPERATIONAL_BRANCHES = [
  'Carx2',
  'Carmen',
  'CebuCity',
  'Lapux2',
  'Bogo',
  'Toledo',
  'ITPark',
];

/** Flagship shop used for SA/SR FTE lock. */
const PRIMARY_BRANCH_NAME = 'CebuCity';

const PROPOSED_LOCATION_NAME = 'Proposed Location';
const BRANCH_STATUS_OPERATIONAL = 'operational';
const BRANCH_STATUS_PIPELINE = 'pipeline';
const BRANCH_TYPE_OPERATIONAL = 'operational';
const BRANCH_TYPE_PRE_OPERATIONAL = 'pre-operational';

/**
 * Numbered 1-7 rename:
 * 1 MJcarreta → Carx2
 * 2 Banilad → Carmen
 * 3 Escario → CebuCity
 * 4 Good Year → Lapux2
 * 5 SRP 1 → Bogo
 * 6 Pusok → Toledo
 * 7 Naga → ITPark
 *
 * Also maps leftover names from the previous 6-branch pass.
 */
const LEGACY_BRANCH_RENAMES = {
  mjcarreta: 'Carx2',
  mjcareta: 'Carx2',
  carreta: 'Carx2',
  banilad: 'Carmen',
  baniladbranch: 'Carmen',
  escario: 'CebuCity',
  goodyear: 'Lapux2',
  srp1: 'Bogo',
  srp01: 'Bogo',
  srp: 'Bogo',
  pusok: 'Toledo',
  pusokmain: 'Toledo',
  putok: 'Toledo',
  naga: 'ITPark',
  proposedlocation: 'ITPark',
  car2: 'Lapux2',
  lapu2: 'Toledo',
  lapulapu: 'Lapux2',
};

function text(value) {
  return String(value || '').trim();
}

function normalizeBranchKey(value) {
  const key = text(value).toLowerCase().replace(/[^a-z0-9]/g, '');
  const aliases = {
    carx2: 'carx2',
    car2: 'lapux2',
    carcar: 'carx2',
    carmen: 'carmen',
    cebucity: 'cebucity',
    cebu: 'cebucity',
    lapux2: 'lapux2',
    lapu2: 'toledo',
    lapulapu: 'lapux2',
    bogo: 'bogo',
    toledo: 'toledo',
    itpark: 'itpark',
    mjcarreta: 'carx2',
    mjcareta: 'carx2',
    carreta: 'carx2',
    banilad: 'carmen',
    baniladbranch: 'carmen',
    escario: 'cebucity',
    goodyear: 'lapux2',
    srp1: 'bogo',
    srp01: 'bogo',
    pusok: 'toledo',
    pusokmain: 'toledo',
    putok: 'toledo',
    naga: 'itpark',
    proposedlocation: 'itpark',
  };
  return aliases[key] || key;
}

function canonicalizeBranchName(value) {
  const raw = text(value);
  if (!raw || raw.toUpperCase() === 'ALL') return raw;
  const key = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (LEGACY_BRANCH_RENAMES[key]) return LEGACY_BRANCH_RENAMES[key];
  const current = DEFAULT_OPERATIONAL_BRANCHES.find((name) => (
    name.toLowerCase().replace(/[^a-z0-9]/g, '') === key
  ));
  if (current) return current;
  const aliased = normalizeBranchKey(raw);
  const fromAlias = DEFAULT_OPERATIONAL_BRANCHES.find((name) => (
    name.toLowerCase().replace(/[^a-z0-9]/g, '') === aliased
  ));
  return fromAlias || raw;
}

function isPipelineBranch(branch) {
  const status = text(branch && branch.status).toLowerCase();
  const type = text(branch && (branch.type || branch.branch_type)).toLowerCase();
  return (
    status === BRANCH_STATUS_PIPELINE
    || status === BRANCH_TYPE_PRE_OPERATIONAL
    || type === BRANCH_STATUS_PIPELINE
    || type === BRANCH_TYPE_PRE_OPERATIONAL
  );
}

function isOperationalBranch(branch) {
  return !isPipelineBranch(branch);
}

function buildBranchRecord(name, options = {}) {
  const status = text(options.status) || BRANCH_STATUS_OPERATIONAL;
  const type = text(options.type) || (
    status === BRANCH_STATUS_PIPELINE ? BRANCH_TYPE_PRE_OPERATIONAL : BRANCH_TYPE_OPERATIONAL
  );
  return {
    id: text(options.id) || `branch-${normalizeBranchKey(name)}`,
    name: text(name),
    status,
    type,
    sort_order: Number.isFinite(Number(options.sort_order)) ? Number(options.sort_order) : 0,
    created_at: options.created_at || new Date().toISOString(),
    updated_at: options.updated_at || new Date().toISOString(),
  };
}

function defaultBranchCatalog() {
  return DEFAULT_OPERATIONAL_BRANCHES.map((name, index) =>
    buildBranchRecord(name, {
      status: BRANCH_STATUS_OPERATIONAL,
      type: BRANCH_TYPE_OPERATIONAL,
      sort_order: index + 1,
    })
  );
}

function resolveBranchCatalog(storedBranches) {
  const rows = Array.isArray(storedBranches) ? storedBranches : [];
  if (!rows.length) return defaultBranchCatalog();

  const seen = new Set();
  const mapped = rows
    .map((row, index) => buildBranchRecord(canonicalizeBranchName(row.name || row.branch || row.label), {
      id: row.id,
      status: row.status,
      type: row.type || row.branch_type,
      sort_order: row.sort_order != null ? row.sort_order : index + 1,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }))
    .filter((row) => {
      if (!row.name) return false;
      const key = normalizeBranchKey(row.name);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  DEFAULT_OPERATIONAL_BRANCHES.forEach((name, index) => {
    const key = normalizeBranchKey(name);
    if (seen.has(key)) return;
    seen.add(key);
    mapped.push(buildBranchRecord(name, { sort_order: index + 1 }));
  });

  return mapped.sort((a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name));
}

function getOperationalBranches(catalog) {
  return resolveBranchCatalog(catalog).filter(isOperationalBranch);
}

function getDisplayBranches(catalog) {
  return resolveBranchCatalog(catalog);
}

/**
 * Average a branch metric while excluding pipeline / pre-operational branches
 * and empty/zero values so company-wide averages stay meaningful.
 */
function averageOperationalBranchMetric(branchRows, valueSelector) {
  const rows = Array.isArray(branchRows) ? branchRows : [];
  let total = 0;
  let count = 0;

  rows.forEach((row) => {
    if (isPipelineBranch(row)) return;
    const value = Number(typeof valueSelector === 'function' ? valueSelector(row) : row[valueSelector]);
    if (!Number.isFinite(value) || value === 0) return;
    total += value;
    count += 1;
  });

  return count > 0 ? total / count : 0;
}

module.exports = {
  DEFAULT_OPERATIONAL_BRANCHES,
  PRIMARY_BRANCH_NAME,
  PROPOSED_LOCATION_NAME,
  BRANCH_STATUS_OPERATIONAL,
  BRANCH_STATUS_PIPELINE,
  BRANCH_TYPE_OPERATIONAL,
  BRANCH_TYPE_PRE_OPERATIONAL,
  LEGACY_BRANCH_RENAMES,
  normalizeBranchKey,
  canonicalizeBranchName,
  isPipelineBranch,
  isOperationalBranch,
  buildBranchRecord,
  defaultBranchCatalog,
  resolveBranchCatalog,
  getOperationalBranches,
  getDisplayBranches,
  averageOperationalBranchMetric,
};
