const { allocatePartsTransactionNumber } = require('./parts-transaction-number');

const PREFIX = {
  packing: 'PL',
  transmittal: 'TM',
  purchase_order: 'PO',
};

function stampNow(date = new Date()) {
  const safe = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  return {
    iso: safe.toISOString(),
    date: safe.toISOString().slice(0, 10),
    label: safe.toLocaleString('en-PH', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }),
  };
}

function serialPattern(prefix) {
  return new RegExp(`^${prefix}-(\\d{8})-(\\d+)$`, 'i');
}

function collectSerialSources(data) {
  const transfers = Array.isArray(data?.parts_transfers) ? data.parts_transfers : [];
  const orders = Array.isArray(data?.parts_purchase_orders) ? data.parts_purchase_orders : [];
  const docs = Array.isArray(data?.parts_documents) ? data.parts_documents : [];
  return [...transfers, ...orders, ...docs];
}

function maxSequence(rows, prefix) {
  const pattern = serialPattern(prefix);
  let maxSeq = 0;
  rows.forEach((row) => {
    const candidates = [
      row?.serial,
      row?.document_number,
      row?.packing_list_number,
      row?.transmittal_number,
      row?.po_number,
    ];
    candidates.forEach((value) => {
      const match = String(value || '').trim().match(pattern);
      if (!match) return;
      const seq = Number(match[2]);
      if (Number.isFinite(seq) && seq > maxSeq) maxSeq = seq;
    });
  });
  return maxSeq;
}

function formatDocumentSerial(prefix, sequence, date = new Date()) {
  const stamp = stampNow(date);
  return `${prefix}-${stamp.date.replace(/-/g, '')}-${String(sequence).padStart(6, '0')}`;
}

function allocateDocumentSerial(data, kind, date = new Date()) {
  const prefix = PREFIX[kind] || String(kind || 'DOC').toUpperCase().slice(0, 3);
  const nextSeq = maxSequence(collectSerialSources(data), prefix) + 1;
  return formatDocumentSerial(prefix, nextSeq, date);
}

function ensureArray(data, key) {
  if (!data || typeof data !== 'object') return [];
  if (!Array.isArray(data[key])) data[key] = [];
  return data[key];
}

function rememberDocument(data, payload) {
  const docs = ensureArray(data, 'parts_documents');
  const stamp = stampNow();
  const record = Object.assign({
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    created_at: stamp.iso,
    stamped_at: stamp.iso,
    stamped_label: stamp.label,
  }, payload);
  docs.push(record);
  return record;
}

function allocateTransferNumbers(data, date = new Date()) {
  return {
    transaction_number: allocatePartsTransactionNumber(data, date),
    packing_list_number: allocateDocumentSerial(data, 'packing', date),
    transmittal_number: allocateDocumentSerial(data, 'transmittal', date),
  };
}

function allocatePurchaseOrderNumbers(data, date = new Date()) {
  return {
    transaction_number: allocatePartsTransactionNumber(data, date),
    po_number: allocateDocumentSerial(data, 'purchase_order', date),
  };
}

module.exports = {
  PREFIX,
  stampNow,
  allocateDocumentSerial,
  allocateTransferNumbers,
  allocatePurchaseOrderNumbers,
  rememberDocument,
};
