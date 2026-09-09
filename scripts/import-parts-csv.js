const fs = require('fs');
const path = require('path');
const store = require('../data/store');

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const fileArg = args.find(a => a.startsWith('--file='));
const csvFile = fileArg ? fileArg.split('=')[1] : null;

async function parseCSVData(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l);
  if (lines.length < 2) {
    throw new Error('CSV must have header + data rows');
  }

  // Parse header
  const headers = lines[0].split('\t').map(h => h.trim());
  console.log('Headers detected:', headers);

  // Parse data rows
  const records = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split('\t');
    const row = {};
    headers.forEach((header, idx) => {
      row[header.toLowerCase().replace(/\s+/g, '_')] = (values[idx] || '').trim();
    });
    records.push(row);
  }

  return records;
}

function normalizeRecord(row) {
  // Map CSV fields to database schema
  const normalized = {
    transaction_date: row.transaction_date || '',
    transaction_type: row.transaction_type || 'General Inventory',
    present_location: row.present_location || row.editor || '',
    editor: row.editor || '',
    barcode: row.barcode || '',
    part_number: row.part_number || '',
    part_name: row.part_number || '', // Use part number as name if not provided
    sub_id: row.sub_id || row.sub || '',
    generic: row.generic || '',
    supplier: row.supplier || '',
    receiving_receipt_number: row.receiving_receipt || row.receiving_receipt_number || '',
    qty: isNaN(parseInt(row.qty)) ? 0 : parseInt(row.qty),
    on_hand: isNaN(parseInt(row.on_hand)) ? 0 : parseInt(row.on_hand),
    cost_price: parseFloat(row.cost_price) || 0,
    markup: parseFloat(row.markup) || 0,
    retail_price: parseFloat(row.retail_price) || 0,
    sold_to: row.sold_to || ''
  };

  return normalized;
}

async function importData() {
  try {
    console.log('🔄 Starting parts CSV import...');
    
    // Read input file
    let csvText;
    if (csvFile && fs.existsSync(csvFile)) {
      console.log(`📖 Reading file: ${csvFile}`);
      csvText = fs.readFileSync(csvFile, 'utf8');
    } else {
      // Read from stdin if available
      console.log('📖 Reading from stdin (paste CSV data, then press Ctrl+D)...');
      csvText = fs.readFileSync(0, 'utf8');
    }

    // Parse CSV
    console.log('⚙️  Parsing CSV data...');
    const records = await parseCSVData(csvText);
    console.log(`✅ Parsed ${records.length} rows`);

    // Normalize records
    console.log('🔄 Normalizing records...');
    const normalized = records.map(normalizeRecord);

    // Validate
    const valid = normalized.filter(r => r.part_number && r.part_number.trim());
    const invalid = normalized.filter(r => !r.part_number || !r.part_number.trim());
    
    console.log(`✅ Valid records: ${valid.length}`);
    if (invalid.length > 0) {
      console.log(`⚠️  Skipping ${invalid.length} records with missing part numbers`);
    }

    if (isDryRun) {
      console.log('\n📋 DRY RUN: Sample of first 5 records:');
      console.table(valid.slice(0, 5));
      console.log(`\n✅ Would import ${valid.length} records (--dry-run mode)`);
      return;
    }

    // Load store and import
    console.log('\n💾 Importing to database...');
    let imported = 0;
    let errors = 0;

    for (const record of valid) {
      try {
        // Use part_number as unique key
        const existingId = record.part_number.replace(/[^a-z0-9-]/gi, '_').toLowerCase();
        
        // Create parts_inventory record
        const partRecord = {
          id: existingId,
          ...record,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };

        await store.create('parts_inventory', partRecord);
        imported++;
        if (imported % 100 === 0) {
          process.stdout.write(`\r  Imported: ${imported}/${valid.length}`);
        }
      } catch (err) {
        errors++;
        console.error(`\n❌ Error importing ${record.part_number}: ${err.message}`);
      }
    }

    console.log(`\n\n✅ Import complete!`);
    console.log(`📊 Imported: ${imported}`);
    console.log(`❌ Errors: ${errors}`);
    console.log(`📁 Collection: parts_inventory`);

  } catch (err) {
    console.error('❌ Import failed:', err.message);
    process.exit(1);
  }
}

// Run
importData().then(() => {
  console.log('\n✨ Done!');
  process.exit(0);
}).catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
