// GM "My Record": one ledger of every approval-related request/transaction in the app,
// whatever its status (pending, approved, rejected, removed, draft, closed...).
const { isPartsRequestType } = require('./parts-request');

function text(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

function lineAmount(lines) {
  return (Array.isArray(lines) ? lines : []).reduce(
    (sum, line) => sum + (Number(line.qty) || 0) * (Number(line.cost_price) || 0),
    0,
  );
}

function decision(row) {
  if (row.rejected_at) return { at: row.rejected_at, by: row.rejected_by };
  if (row.removed_at) return { at: row.removed_at, by: row.removed_by };
  if (row.closed_at) return { at: row.closed_at, by: row.closed_by };
  if (row.approved_at) return { at: row.approved_at, by: row.approved_by };
  if (row.resolved_at) return { at: row.resolved_at, by: row.resolved_by };
  return { at: '', by: '' };
}

function make(fields) {
  const status = text(fields.status || 'pending').toLowerCase().replace(/\s+/g, '_');
  return {
    ref: text(fields.ref) || '-',
    refs: (fields.refs || []).map(text).filter(Boolean),
    type: fields.type,
    status,
    requester: text(fields.requester) || '-',
    details: text(fields.details),
    amount: fields.amount === null || fields.amount === undefined ? null : Number(fields.amount) || 0,
    requested_at: fields.requested_at || '',
    decided_at: fields.decided_at || '',
    decided_by: text(fields.decided_by),
    auto_approved: Boolean(fields.auto_approved),
    link: fields.link || '',
  };
}

function shortId(id) {
  return text(id).slice(-6).toUpperCase();
}

function buildRecords(data) {
  const records = [];

  (data.approval_requests || []).forEach((row) => {
    const d = decision(row);
    records.push(make({
      ref: `${text(row.type) || 'REQ'}-${shortId(row.id)}`,
      type: text(row.type) === 'CBD' ? 'Change of Branch (CBD)' : 'Work Order Removal (RWO)',
      status: row.status,
      requester: row.requested_by,
      details: text(row.type) === 'CBD'
        ? `${text(row.employee_name || row.employee_id)}: ${text(row.current_branch) || '-'} → ${text(row.target_branch)}`
        : `WO ${text(row.work_order_number)} | ${text(row.branch) || '-'}${row.reason ? ` | ${text(row.reason)}` : ''}`,
      amount: null,
      requested_at: row.created_at,
      decided_at: d.at,
      decided_by: d.by,
      auto_approved: row.auto_approved,
    }));
  });

  (data.parts_purchase_orders || []).forEach((row) => {
    const d = decision(row);
    records.push(make({
      ref: row.po_number || row.transaction_number || row.id,
      refs: [row.transaction_number],
      type: 'Parts Purchase Order',
      status: row.status || 'draft',
      requester: row.sent_for_approval_by || row.created_by,
      details: [text(row.supplier), text(row.branch), `${(row.lines || []).length || 1} line(s)`, row.rejection_reason ? `Reason: ${text(row.rejection_reason)}` : '']
        .filter(Boolean).join(' | '),
      amount: Number(row.total_amount) || lineAmount(row.lines),
      requested_at: row.sent_for_approval_at || row.created_at,
      decided_at: d.at,
      decided_by: d.by,
      auto_approved: row.auto_approved,
      link: `/parts-manager/print/po/${encodeURIComponent(row.id)}?print=1`,
    }));
  });

  (data.parts_transfers || []).forEach((row) => {
    const d = decision(row);
    const lines = Array.isArray(row.lines) && row.lines.length ? row.lines : [row];
    records.push(make({
      ref: row.transaction_number || row.id,
      refs: [row.packing_list_number, row.transmittal_number],
      type: 'Stock Transfer',
      status: row.status,
      requester: row.editor,
      details: `${text(row.from_branch) || '-'} → ${text(row.to_branch) || '-'} | ${lines.length} line(s)`,
      amount: lineAmount(lines),
      requested_at: row.created_at,
      decided_at: d.at,
      decided_by: d.by,
      auto_approved: row.auto_approved,
      link: `/parts-manager/transfers/${encodeURIComponent(row.id)}/preview`,
    }));
  });

  const partsRequests = [
    ...(data.parts_inventory || []).filter((row) => isPartsRequestType(row.transaction_type)),
    ...(data.parts_requests || []),
  ];
  partsRequests.forEach((row) => {
    const d = decision(row);
    const unit = Number(row.cost_price) || Number(row.retail_price) || 0;
    records.push(make({
      ref: row.transaction_number || `PR-${shortId(row.id)}`,
      type: 'Parts Request',
      status: row.request_status || row.status || 'pending',
      requester: row.editor || row.requested_by,
      details: [text(row.part_number), text(row.part_name), `Qty ${Number(row.qty) || 0}`, row.work_order_number ? `WO ${text(row.work_order_number)}` : '', text(row.requesting_branch || row.branch)]
        .filter(Boolean).join(' | '),
      amount: (Number(row.qty) || 0) * unit,
      requested_at: row.created_at || row.transaction_date,
      decided_at: d.at,
      decided_by: d.by,
      auto_approved: row.auto_approved,
    }));
  });

  (data.po_orders || []).forEach((row) => {
    const d = decision(row);
    const history = Array.isArray(row.history) ? row.history : [];
    const last = history.length ? history[history.length - 1] : null;
    records.push(make({
      ref: row.po_number || row.id,
      type: 'PO Module Order',
      status: row.status,
      requester: row.created_by,
      details: [text(row.supplier || row.supplier_name), text(row.department)].filter(Boolean).join(' | '),
      amount: row.grand_total,
      requested_at: row.submitted_at || row.created_at,
      decided_at: d.at || (last && row.status !== 'pending' && row.status !== 'draft' ? last.at : ''),
      decided_by: d.by || (last && row.status !== 'pending' && row.status !== 'draft' ? last.by : ''),
      auto_approved: row.auto_approved,
      link: `/po/${encodeURIComponent(row.id)}`,
    }));
  });

  // GM footprints (e.g. FTE approvals) that are not already covered by a source record above.
  const known = new Set();
  records.forEach((r) => { known.add(r.ref); r.refs.forEach((x) => known.add(x)); });
  (data.gm_transaction_records || []).forEach((row) => {
    if (known.has(text(row.transaction_number))) return;
    known.add(text(row.transaction_number));
    records.push(make({
      ref: row.transaction_number || row.id,
      type: text(row.type) || 'GM Approval',
      status: 'approved',
      requester: row.requester_name,
      amount: row.amount,
      requested_at: row.requested_at,
      decided_at: row.approved_at,
      decided_by: row.approved_by,
    }));
  });

  return records.sort((a, b) => (
    new Date(b.decided_at || b.requested_at || 0) - new Date(a.decided_at || a.requested_at || 0)
  ));
}

function filterRecords(records, query) {
  const q = text(query.q).toLowerCase();
  const type = text(query.type);
  const status = text(query.status).toLowerCase();
  const start = text(query.start);
  const end = text(query.end);
  return records.filter((r) => {
    if (type && r.type !== type) return false;
    if (status && r.status !== status) return false;
    const day = text(r.requested_at).slice(0, 10);
    if (start && (!day || day < start)) return false;
    if (end && (!day || day > end)) return false;
    if (q) {
      const hay = [r.ref, ...r.refs, r.type, r.status, r.requester, r.details, r.decided_by].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

module.exports = { buildRecords, filterRecords };
