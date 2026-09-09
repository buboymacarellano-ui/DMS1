#!/usr/bin/env node
/**
 * Export current local database to data.json for seeding Render
 * This ensures Render gets all imported data on restart
 */

const fs = require('fs').promises;
const path = require('path');
const store = require('../data/store');

const DATA_FILE = path.join(__dirname, '..', 'data', 'data.json');

async function exportToSeed() {
  try {
    console.log('📤 Exporting local database to data.json...');
    
    // Get all current data from local store
    const data = await store.getRawData();
    
    console.log('📊 Collections found:');
    Object.keys(data).forEach(key => {
      const count = Array.isArray(data[key]) ? data[key].length : 1;
      console.log(`  - ${key}: ${count}`);
    });

    // Write to data.json
    const json = JSON.stringify(data, null, 2);
    await fs.writeFile(DATA_FILE, json, 'utf8');
    
    console.log(`\n✅ Exported ${DATA_FILE}`);
    console.log(`📦 File size: ${(json.length / 1024).toFixed(2)} KB`);
    console.log('\n📝 Next steps:');
    console.log('  1. git add data/data.json');
    console.log('  2. git commit -m "Sync local database to seed file"');
    console.log('  3. git push (Render will auto-redeploy with new data)');
    
  } catch (err) {
    console.error('❌ Export failed:', err.message);
    process.exit(1);
  }
}

exportToSeed();
