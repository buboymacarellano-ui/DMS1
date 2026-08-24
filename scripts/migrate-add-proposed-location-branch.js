#!/usr/bin/env node
/**
 * Migration: add branches catalog + 8th branch "Proposed Location".
 *
 * Usage:
 *   node scripts/migrate-add-proposed-location-branch.js
 *   node scripts/migrate-add-proposed-location-branch.js --dry-run
 *
 * Adds / updates data.branches with:
 *   - existing 7 operational GM branches (seeded if catalog missing)
 *   - "Proposed Location" with status=pipeline, type=pre-operational
 *
 * Backend aggregation helpers exclude pipeline / pre-operational branches
 * (and empty/zero values) from company-wide performance averages.
 */

const fs = require('fs').promises;
const path = require('path');
const {
  DEFAULT_OPERATIONAL_BRANCHES,
  PROPOSED_LOCATION_NAME,
  BRANCH_STATUS_OPERATIONAL,
  BRANCH_STATUS_PIPELINE,
  BRANCH_TYPE_OPERATIONAL,
  BRANCH_TYPE_PRE_OPERATIONAL,
  normalizeBranchKey,
  buildBranchRecord,
} = require('../lib/branches');

const DATA_FILE = path.join(__dirname, '..', 'data', 'data.json');
const dryRun = process.argv.includes('--dry-run');

async function loadData() {
  const txt = await fs.readFile(DATA_FILE, 'utf8');
  return JSON.parse(txt);
}

async function saveData(data) {
  const stamp = new Date().toISOString().replace(/[.:]/g, '-');
  const backupPath = path.join(__dirname, '..', 'data', `data.backup.branches-migration.${stamp}.json`);
  await fs.writeFile(backupPath, JSON.stringify(data, null, 2), 'utf8');
  await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
  return backupPath;
}

function upsertBranch(catalog, name, options) {
  const key = normalizeBranchKey(name);
  const idx = catalog.findIndex((row) => normalizeBranchKey(row.name || row.branch) === key);
  const next = buildBranchRecord(name, {
    ...(idx >= 0 ? catalog[idx] : {}),
    ...options,
    updated_at: new Date().toISOString(),
  });

  if (idx >= 0) {
    catalog[idx] = Object.assign({}, catalog[idx], next);
    return { action: 'updated', record: catalog[idx] };
  }

  catalog.push(next);
  return { action: 'created', record: next };
}

async function main() {
  const data = await loadData();
  if (!Array.isArray(data.branches)) data.branches = [];

  const beforeCount = data.branches.length;
  const changes = [];

  DEFAULT_OPERATIONAL_BRANCHES.forEach((name, index) => {
    const result = upsertBranch(data.branches, name, {
      status: BRANCH_STATUS_OPERATIONAL,
      type: BRANCH_TYPE_OPERATIONAL,
      sort_order: index + 1,
      created_at: data.branches.find((row) => normalizeBranchKey(row.name) === normalizeBranchKey(name))?.created_at,
    });
    changes.push(result);
  });

  const proposed = upsertBranch(data.branches, PROPOSED_LOCATION_NAME, {
    status: BRANCH_STATUS_PIPELINE,
    type: BRANCH_TYPE_PRE_OPERATIONAL,
    sort_order: DEFAULT_OPERATIONAL_BRANCHES.length + 1,
    created_at: data.branches.find((row) => normalizeBranchKey(row.name) === normalizeBranchKey(PROPOSED_LOCATION_NAME))?.created_at,
  });
  changes.push(proposed);

  data.branches.sort((a, b) => (Number(a.sort_order || 0) - Number(b.sort_order || 0)) || String(a.name).localeCompare(String(b.name)));

  console.log(`Branches before: ${beforeCount}`);
  console.log(`Branches after:  ${data.branches.length}`);
  changes.forEach((change) => {
    console.log(`- ${change.action}: ${change.record.name} [status=${change.record.status}, type=${change.record.type}]`);
  });

  if (dryRun) {
    console.log('Dry run only — data.json was not written.');
    return;
  }

  const backupPath = await saveData(data);
  console.log(`Backup written: ${backupPath}`);
  console.log('Migration complete: Proposed Location is flagged as pipeline / pre-operational.');
}

main().catch((error) => {
  console.error('Migration failed:', error.message || error);
  process.exitCode = 1;
});
