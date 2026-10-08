// Decided (approved / rejected) request tickets routed back to the user who filed them.
const store = require('../data/store');

const DEFAULT_WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

function text(value) {
  return String(value == null ? '' : value).trim();
}

function lower(value) {
  return text(value).toLowerCase();
}

function sameUser(user, { userId, username }) {
  if (userId && text(user.id) && text(user.id) === text(userId)) return true;
  return Boolean(username) && Boolean(text(user.username)) && lower(user.username) === lower(username);
}

function lineCount(row) {
  return Array.isArray(row.lines) && row.lines.length ? row.lines.length : 1;
}

function fromTransfers(rows, user) {
  return rows
    .filter((row) => lower(row.status) !== 'pending' && row.approved_at)
    .filter((row) => sameUser(user, { username: row.editor || row.created_by }))
    .map((row) => ({
      key: `transfer:${row.id}`,
      kind: 'Stock Transfer',
      number: text(row.transaction_number) || text(row.id),
      status: 'approved',
      decided_at: row.approved_at,
      decided_by: text(row.approved_by),
      detail: `${text(row.from_branch) || '-'} → ${text(row.to_branch) || '-'} · ${lineCount(row)} line(s)`,
      remarks: '',
      href: '',
    }));
}

function fromPartsPurchaseOrders(rows, user) {
  const tickets = [];
  rows.forEach((row) => {
    const status = lower(row.status);
    if (status !== 'approved' && status !== 'rejected') return;
    if (!sameUser(user, { username: row.created_by || row.sent_for_approval_by })) return;
    const approved = status === 'approved';
    tickets.push({
      key: `parts-po:${row.id}`,
      kind: 'Purchase Order',
      number: text(row.po_number) || text(row.transaction_number) || text(row.id),
      status,
      decided_at: approved ? row.approved_at : row.rejected_at,
      decided_by: text(approved ? row.approved_by : row.rejected_by),
      detail: `${text(row.supplier) || '-'} · ${text(row.branch) || '-'} · ${lineCount(row)} line(s)`,
      remarks: approved ? '' : text(row.rejection_reason),
      href: '',
    });
  });
  return tickets;
}

function fromPoOrders(rows, user) {
  const tickets = [];
  rows.forEach((row) => {
    const status = lower(row.status);
    if (status !== 'approved' && status !== 'rejected') return;
    if (!sameUser(user, { userId: row.created_by_user_id, username: row.created_by })) return;
    const decision = (row.history || []).slice().reverse().find((entry) => entry.action === status) || {};
    tickets.push({
      key: `po:${row.id}`,
      kind: 'Purchase Order',
      number: text(row.po_number) || text(row.id),
      status,
      decided_at: decision.at || (status === 'approved' ? row.approved_at : row.rejected_at),
      decided_by: text(decision.by),
      detail: [text(row.supplier), text(row.department)].filter(Boolean).join(' · ') || '-',
      remarks: text(decision.remarks),
      href: `/po/${encodeURIComponent(row.id)}`,
    });
  });
  return tickets;
}

function fromApprovalRequests(rows, user) {
  const tickets = [];
  rows.forEach((row) => {
    const status = lower(row.status);
    if (status !== 'approved' && status !== 'rejected') return;
    if (!sameUser(user, { userId: row.requested_by_user_id })) return;
    const detail = row.type === 'CBD'
      ? `${text(row.employee_name || row.employee_id)}: ${text(row.current_branch) || '-'} → ${text(row.target_branch)}`
      : `WO ${text(row.work_order_number)} · ${text(row.branch) || '-'}`;
    tickets.push({
      key: `request:${row.id}`,
      kind: row.type === 'CBD' ? 'Change Branch Duty' : row.type === 'RWO' ? 'Remove Work Order' : text(row.type),
      number: text(row.work_order_number || row.employee_id || row.id),
      status,
      decided_at: row.resolved_at,
      decided_by: text(row.resolved_by),
      detail,
      remarks: '',
      href: '/approvals',
    });
  });
  return tickets;
}

async function listDecidedTickets(user, options = {}) {
  if (!user) return [];
  const windowDays = Number(options.windowDays) > 0 ? Number(options.windowDays) : DEFAULT_WINDOW_DAYS;
  const cutoff = Date.now() - windowDays * DAY_MS;
  const [transfers, partsPos, poOrders, requests] = await Promise.all([
    store.getAll('parts_transfers'),
    store.getAll('parts_purchase_orders'),
    store.getAll('po_orders'),
    store.getAll('approval_requests'),
  ]);
  const tickets = [
    ...fromTransfers(transfers || [], user),
    ...fromPartsPurchaseOrders(partsPos || [], user),
    ...fromPoOrders(poOrders || [], user),
    ...fromApprovalRequests(requests || [], user),
  ]
    .filter((ticket) => new Date(ticket.decided_at || 0).getTime() >= cutoff)
    .sort((a, b) => new Date(b.decided_at || 0) - new Date(a.decided_at || 0));
  return Number(options.limit) > 0 ? tickets.slice(0, Number(options.limit)) : tickets;
}

module.exports = { listDecidedTickets };
