const TRANSACTION_NUMBER_PREFIX = 'PTN';
const TRANSACTION_NUMBER_PATTERN = /^PTN-(\d{8})-(\d+)$/i;

function collectTransactionNumberSources(data) {
  const inventory = Array.isArray(data?.parts_inventory) ? data.parts_inventory : [];
  const requestTx = Array.isArray(data?.parts_request_transactions) ? data.parts_request_transactions : [];
  return [...inventory, ...requestTx];
}

function maxSequenceFromRows(rows) {
  let maxSeq = 0;
  rows.forEach((row) => {
    const match = String(row?.transaction_number || '').trim().match(TRANSACTION_NUMBER_PATTERN);
    if (!match) return;
    const seq = Number(match[2]);
    if (Number.isFinite(seq) && seq > maxSeq) maxSeq = seq;
  });
  return maxSeq;
}

function formatPartsTransactionNumber(sequence, date = new Date()) {
  const safeDate = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  const datePart = safeDate.toISOString().slice(0, 10).replace(/-/g, '');
  return `${TRANSACTION_NUMBER_PREFIX}-${datePart}-${String(sequence).padStart(6, '0')}`;
}

/**
 * Allocates the next Parts Transaction Number from current data.
 * Format: PTN-YYYYMMDD-###### (unique auth number for delivery forms, receipts, etc.)
 */
function allocatePartsTransactionNumber(data, date = new Date()) {
  const nextSeq = maxSequenceFromRows(collectTransactionNumberSources(data)) + 1;
  return formatPartsTransactionNumber(nextSeq, date);
}

function ensureRecordTransactionNumber(record, data, date = new Date()) {
  if (!record || typeof record !== 'object') return record;
  if (String(record.transaction_number || '').trim()) return record;
  record.transaction_number = allocatePartsTransactionNumber(data, date);
  return record;
}

/**
 * Backfills missing transaction numbers on inventory / request transaction rows.
 * Returns true if any record was updated.
 */
function backfillMissingTransactionNumbers(data) {
  if (!data || typeof data !== 'object') return false;
  if (!Array.isArray(data.parts_inventory)) data.parts_inventory = [];
  if (!Array.isArray(data.parts_request_transactions)) data.parts_request_transactions = [];

  let changed = false;
  let nextSeq = maxSequenceFromRows(collectTransactionNumberSources(data)) + 1;

  const assignIfMissing = (row) => {
    if (!row || String(row.transaction_number || '').trim()) return;
    row.transaction_number = formatPartsTransactionNumber(nextSeq, new Date(row.created_at || row.transaction_date || Date.now()));
    nextSeq += 1;
    changed = true;
  };

  data.parts_inventory.forEach(assignIfMissing);
  data.parts_request_transactions.forEach(assignIfMissing);
  return changed;
}

module.exports = {
  TRANSACTION_NUMBER_PREFIX,
  allocatePartsTransactionNumber,
  ensureRecordTransactionNumber,
  backfillMissingTransactionNumbers,
  formatPartsTransactionNumber,
};
