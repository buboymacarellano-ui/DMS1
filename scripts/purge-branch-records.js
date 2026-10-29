#!/usr/bin/env node

const store = require('../data/store');
const { normalizeBranchKey } = require('../lib/branches');

function parseArgs(argv) {
  const args = {
    branch: 'Bogo',
    collections: ['expense_logs', 'cash_flow_records'],
    apply: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--help' || token === '-h') {
      args.help = true;
    } else if (token === '--apply' || token === '--yes') {
      args.apply = true;
    } else if (token === '--branch' && argv[i + 1]) {
      args.branch = String(argv[i + 1]);
      i += 1;
    } else if (token === '--collections' && argv[i + 1]) {
      args.collections = String(argv[i + 1])
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
      i += 1;
    }
  }

  return args;
}

function printUsage() {
  console.log('Purge records for a branch (with backup).');
  console.log('');
  console.log('Dry run (no changes):');
  console.log('  node scripts/purge-branch-records.js --branch "Bogo"');
  console.log('');
  console.log('Apply changes (writes to the database + makes backup):');
  console.log('  node scripts/purge-branch-records.js --branch "Bogo" --apply');
  console.log('');
  console.log('Optional: choose collections (comma-separated):');
  console.log('  --collections expense_logs,cash_flow_records');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  const targetKey = normalizeBranchKey(args.branch);
  if (!targetKey) {
    console.error('Invalid branch name.');
    process.exitCode = 1;
    return;
  }

  const data = await store.getRawData();
  const summary = [];

  for (const name of args.collections) {
    const rows = Array.isArray(data[name]) ? data[name] : [];
    const before = rows.length;
    const kept = rows.filter((row) => normalizeBranchKey(row && row.branch) !== targetKey);
    const after = kept.length;
    const removed = before - after;
    data[name] = kept;
    summary.push({ collection: name, before, removed, after });
  }

  const removedTotal = summary.reduce((sum, row) => sum + row.removed, 0);

  console.log('Branch:', args.branch, `(key=${targetKey})`);
  summary.forEach((row) => {
    console.log(`- ${row.collection}: removed ${row.removed} (from ${row.before} -> ${row.after})`);
  });

  if (!args.apply) {
    console.log('');
    console.log('Dry run only (no data was changed).');
    console.log('Re-run with --apply to write changes.');
    return;
  }

  if (!removedTotal) {
    console.log('');
    console.log('Nothing to delete. Exiting.');
    return;
  }

  const backupPath = await store.backupData();
  await store.replaceData(data);

  console.log('');
  console.log('Backup created:', backupPath);
  console.log('Done.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});