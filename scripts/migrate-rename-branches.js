/**
 * Rewrite stored branch fields using the numbered 1-7 mapping:
 * 1 MJcarreta → Carx2
 * 2 Banilad → Carmen
 * 3 Escario → CebuCity
 * 4 Good Year → Lapux2
 * 5 SRP 1 → Bogo
 * 6 Pusok → Toledo
 * 7 Naga → ITPark
 *
 * Usage: node scripts/migrate-rename-branches.js
 */
const fs = require('fs');
const path = require('path');
const {
  DEFAULT_OPERATIONAL_BRANCHES,
  canonicalizeBranchName,
  defaultBranchCatalog,
} = require('../lib/branches');

const DATA_FILE = path.join(__dirname, '..', 'data', 'data.json');
const BACKUP_FILE = path.join(__dirname, '..', 'data', 'data.backup.branches-migration.2026-08-13T02-55-49-660Z.json');
const BRANCH_KEYS = new Set([
  'branch',
  'Branch',
  'Branch_Name',
  'branch_name',
  'requesting_branch',
  'work_location_branch_id',
  'assigned_branch',
  'target_branch',
  'current_branch',
  'from_branch',
  'to_branch',
  'source_branch',
  'destination_branch',
]);

function recordKey(row) {
  if (!row || typeof row !== 'object') return '';
  return String(
    row.id
    || row.employee_id
    || row.Transaction_ID
    || row['Transaction ID']
    || row.work_order_number
    || ''
  );
}

const FROM_PREVIOUS_PASS = {
  car2: 'Lapux2',
  carmen: 'Carx2',
  lapu2: 'Toledo',
  toledo: 'Carmen',
};

function remapValue(value, originalHint) {
  const source = originalHint || value;
  if (typeof source !== 'string' || !source.trim()) return { value, changed: false };
  const key = source.toLowerCase().replace(/[^a-z0-9]/g, '');
  const next = originalHint
    ? canonicalizeBranchName(originalHint)
    : (FROM_PREVIOUS_PASS[key] || canonicalizeBranchName(source));
  if (!next || next === value) return { value, changed: false };
  return { value: next, changed: true };
}

function originalBranchFromRow(row) {
  if (!row || typeof row !== 'object') return '';
  return String(
    row.branch
    || row.Branch
    || row.Branch_Name
    || row.work_location_branch_id
    || row.requesting_branch
    || ''
  );
}

function indexOriginalBranches(backup) {
  const byId = new Map();
  if (!backup || typeof backup !== 'object') return byId;
  Object.keys(backup).forEach((collection) => {
    if (collection === 'branches') return;
    const rows = backup[collection];
    if (!Array.isArray(rows)) return;
    rows.forEach((row) => {
      const id = recordKey(row);
      const original = originalBranchFromRow(row);
      if (id && original) byId.set(`${collection}:${id}`, original);
    });
  });
  return byId;
}

function remapValue(value, originalHint) {
  const source = originalHint || value;
  if (typeof source !== 'string') return { value, changed: false };
  const next = canonicalizeBranchName(source);
  if (!next || next === value) return { value, changed: next !== value };
  return { value: next, changed: true };
}

function walk(node, stats, originalById, collection) {
  if (Array.isArray(node)) {
    node.forEach((item) => walk(item, stats, originalById, collection));
    return;
  }
  if (!node || typeof node !== 'object') return;

  const id = recordKey(node);
  const originalHint = id ? originalById.get(`${collection}:${id}`) : '';

  Object.keys(node).forEach((key) => {
    const current = node[key];
    if (BRANCH_KEYS.has(key) && typeof current === 'string') {
      const result = remapValue(current, originalHint);
      if (result.changed) {
        node[key] = result.value;
        stats.fields += 1;
      }
      return;
    }
    if (current && typeof current === 'object') {
      walk(current, stats, originalById, collection);
    }
  });
}

function main() {
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  let originalById = new Map();
  if (fs.existsSync(BACKUP_FILE)) {
    try {
      originalById = indexOriginalBranches(JSON.parse(fs.readFileSync(BACKUP_FILE, 'utf8')));
    } catch (err) {
      console.warn('Could not read original-branch backup:', err.message);
    }
  }

  const stats = { fields: 0 };
  Object.keys(data).forEach((collection) => {
    if (collection === 'branches') return;
    walk(data[collection], stats, originalById, collection);
  });

  const now = new Date().toISOString();
  data.branches = defaultBranchCatalog().map((row, index) => ({
    ...row,
    created_at: row.created_at || now,
    updated_at: now,
    sort_order: index + 1,
  }));

  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
  console.log(`Rewrote branch fields: ${stats.fields}`);
  console.log(`Catalog: ${DEFAULT_OPERATIONAL_BRANCHES.join(', ')}`);
}

main();
