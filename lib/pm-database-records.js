const inventory = require('./parts-inventory-controller');
const { normalizePartsTransactionType } = require('./parts-request');

const DATABASE_TYPES = [
  { value: 'new', label: 'New' },
  { value: 'restock', label: 'Stock' },
  { value: 'stock-transfer', label: 'Stock Transfer' },
  { value: 'edited', label: 'Edited' },
  { value: 'removed', label: 'Removed' },
];

function recordPartOperation(data, record, action, editor) {
  if (!Array.isArray(data.transactions_made)) data.transactions_made = [];
  const stamp = new Date().toISOString();
  data.transactions_made.push({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    kind: 'part',
    status: action,
    ref_id: record.id,
    reference_number: record.transaction_number || record.id,
    recorded_by: String(editor || '').trim(),
    recorded_at: stamp,
    snapshot: JSON.parse(JSON.stringify(record)),
  });
}

function operationRow(record, id, type, stamp, editor) {
  return Object.assign({}, record, {
    id,
    source_record_id: record.id,
    database_type: type,
    database_label: DATABASE_TYPES.find((entry) => entry.value === type).label,
    activity_log: true,
    transaction_date: String(stamp || '').slice(0, 10),
    created_at: stamp || '',
    editor: editor || record.editor || '',
    qty: inventory.transactionQty(record) ?? record.qty,
  });
}

function buildDatabaseRecords(data) {
  const transferIds = new Set((data.parts_transfers || []).map((row) => String(row.id)));
  const rows = inventory.getDashboardLogs(data, { includeHistory: true })
    .filter((row) => normalizePartsTransactionType(row.transaction_type) !== 'transfer request'
      || !transferIds.has(String(row.linked_transfer_id)))
    .map((row) => {
    const type = normalizePartsTransactionType(row.transaction_type);
    const databaseType = type === 'priceedit' ? 'edited'
      : (type === 'transfer request' ? 'stock-transfer' : type);
    return Object.assign({}, row, {
      database_type: databaseType,
      database_label: DATABASE_TYPES.find((entry) => entry.value === databaseType)?.label
        || inventory.displayPartsTransactionType(type),
      });
  });

  for (const transfer of data.parts_transfers || []) {
    const lines = Array.isArray(transfer.lines) && transfer.lines.length ? transfer.lines : [transfer];
    lines.forEach((line, index) => {
      rows.push(operationRow(Object.assign({}, transfer, line, {
        present_location: transfer.from_branch,
        branch: transfer.from_branch,
      }), `transfer:${transfer.id}:${index}`, 'stock-transfer',
      transfer.created_at || transfer.stamped_at, transfer.editor));
    });
  }

  for (const entry of data.transactions_made || []) {
    const type = ['edit', 'edited', 'update'].includes(entry.status) ? 'edited'
      : (['remove', 'removed', 'delete'].includes(entry.status) ? 'removed' : '');
    if (!type) continue;
    if (entry.kind === 'part' && entry.snapshot) {
      rows.push(operationRow(entry.snapshot, `operation:${entry.id}`, type, entry.recorded_at, entry.recorded_by));
    } else if (entry.kind === 'transfer') {
      (entry.lines || []).forEach((line, index) => {
        rows.push(operationRow(Object.assign({}, line, {
          transaction_number: entry.reference_number,
          present_location: entry.from_branch,
        }), `operation:${entry.id}:${index}`, type, entry.recorded_at, entry.recorded_by));
      });
    }
  }
  return inventory.sortChronological(rows, 'desc');
}

module.exports = { DATABASE_TYPES, recordPartOperation, buildDatabaseRecords };
