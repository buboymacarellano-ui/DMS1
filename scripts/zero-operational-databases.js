const store = require('../data/store');

async function main() {
  const backupPath = await store.backupData();
  const result = await store.zeroOperationalDatabases();
  console.log('Backup written to', backupPath);
  console.log('Emptied collections:', result.emptied.join(', '));
  console.log('Parts catalog rows zeroed:', result.partsZeroed);
}

main().catch((error) => {
  console.error('Failed to zero operational databases:', error);
  process.exit(1);
});
