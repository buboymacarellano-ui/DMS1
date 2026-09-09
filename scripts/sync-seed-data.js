#!/usr/bin/env node
/**
 * Force reimport of data.json to current database
 * Use when seed data changes and Render database needs sync
 * Usage: node scripts/sync-seed-data.js
 */

const fs = require('fs').promises;
const path = require('path');
const store = require('../data/store');

const DATA_FILE = path.join(__dirname, '..', 'data', 'data.json');

async function syncSeedData() {
  try {
    console.log('🔄 Syncing seed data to database...');
    console.log(`📖 Reading: ${DATA_FILE}`);
    
    // Read seed data file
    const seedJson = await fs.readFile(DATA_FILE, 'utf8');
    const seedData = JSON.parse(seedJson);
    
    console.log('\n✅ Seed file loaded');
    console.log('📊 Collections to import:');
    Object.keys(seedData).forEach(key => {
      const count = Array.isArray(seedData[key]) ? seedData[key].length : 1;
      console.log(`  - ${key}: ${count}`);
    });

    // Replace current database with seed data
    console.log('\n💾 Replacing database...');
    await store.replaceData(seedData);
    
    console.log('\n✅ Database sync complete!');
    console.log('\n🎯 All collections reimported from seed file.');
    process.exit(0);
    
  } catch (err) {
    console.error('❌ Sync failed:', err.message);
    console.error('\n💡 Troubleshooting:');
    console.error('  - Ensure data/data.json exists');
    console.error('  - Ensure valid JSON format');
    console.error('  - Check database permissions');
    process.exit(1);
  }
}

console.log('⚠️  WARNING: This will REPLACE all database contents with seed data!');
console.log('   Current unsaved changes WILL BE LOST.');
console.log('\n   To proceed, set env: FORCE_SYNC=1');

if (process.env.FORCE_SYNC === '1') {
  syncSeedData();
} else {
  console.error('\n❌ Aborted. Run with: FORCE_SYNC=1 node scripts/sync-seed-data.js');
  process.exit(1);
}
