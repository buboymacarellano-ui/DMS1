// Footprint ledger for GM-approved transactions (PO, Stock Transfer, FTE Request).
const crypto = require('crypto');

const TYPES = {
  PO: 'PO',
  STOCK_TRANSFER: 'Stock Transfer',
  FTE_REQUEST: 'FTERequest',
};

function genId() {
  return crypto.randomBytes(6).toString('hex');
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Appends one row to data.gm_transaction_records. Caller is responsible for persisting `data`.
 */
function recordGmApproval(data, entry) {
  if (!data) return null;
  if (!Array.isArray(data.gm_transaction_records)) data.gm_transaction_records = [];
  const row = {
    id: genId(),
    transaction_number: String(entry.transaction_number || '').trim(),
    type: String(entry.type || '').trim(),
    requester_name: String(entry.requester_name || '').trim(),
    requested_at: entry.requested_at || '',
    amount: toNumber(entry.amount),
    approved_at: entry.approved_at || new Date().toISOString(),
    approved_by: String(entry.approved_by || '').trim(),
  };
  data.gm_transaction_records.push(row);
  return row;
}

module.exports = { recordGmApproval, TYPES };
