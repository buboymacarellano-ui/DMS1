/**
 * Run the SA/SR/SSR 10% branch-parts request → PM approve → branch receive flow.
 *
 * Usage:
 *   node scripts/run-branch-parts-10pct-flow.js
 *   node scripts/run-branch-parts-10pct-flow.js --dry-run
 *   node scripts/run-branch-parts-10pct-flow.js --force
 */
const { runBranchParts10pctFlow } = require('../lib/branch-parts-10pct-flow');

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const force = process.argv.includes('--force');
  const result = await runBranchParts10pctFlow({ dryRun, force });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
