const HOLD_STATUSES = ['waiting-parts', 'break', 'on-other-priority'];

const STATUS_LABELS = {
  open: 'Open',
  'in-progress': 'In Progress',
  'waiting-parts': 'Waiting Parts',
  break: 'Break',
  'on-other-priority': 'On Other Priority',
  completed: 'Completed',
  closed: 'Closed',
  deleted: 'Deleted',
};

function statusKey(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizeWorkOrderStatus(value) {
  const map = {
    open: 'open',
    inprogress: 'in-progress',
    waitingparts: 'waiting-parts',
    break: 'break',
    onotherpriority: 'on-other-priority',
    completed: 'completed',
    closed: 'closed',
    deleted: 'deleted',
  };
  return map[statusKey(value)] || '';
}

function isHoldStatus(value) {
  return HOLD_STATUSES.includes(normalizeWorkOrderStatus(value));
}

function isActiveWorkOrderStatus(value) {
  const status = normalizeWorkOrderStatus(value);
  return status === 'open' || status === 'in-progress' || isHoldStatus(status);
}

function formatWorkOrderStatusLabel(value) {
  const status = normalizeWorkOrderStatus(value);
  return STATUS_LABELS[status] || String(value || '').trim() || 'Open';
}

function workOrderStatusOptions() {
  return [
    { value: 'open', label: STATUS_LABELS.open, source: 'auto' },
    { value: 'in-progress', label: STATUS_LABELS['in-progress'], source: 'auto' },
    { value: 'waiting-parts', label: STATUS_LABELS['waiting-parts'], source: 'manual' },
    { value: 'break', label: STATUS_LABELS.break, source: 'manual' },
    { value: 'on-other-priority', label: STATUS_LABELS['on-other-priority'], source: 'manual' },
    { value: 'completed', label: STATUS_LABELS.completed, source: 'auto' },
  ];
}

function resolveWorkOrderLifecycleStatus({ hasTechnician, postedStatus, currentStatus } = {}) {
  const current = normalizeWorkOrderStatus(currentStatus);
  const posted = normalizeWorkOrderStatus(postedStatus);

  if (current === 'closed' || current === 'deleted') return current;
  if (current === 'completed') return 'completed';
  if (!hasTechnician) return 'open';
  if (isHoldStatus(posted)) return posted;
  return 'in-progress';
}

module.exports = {
  HOLD_STATUSES,
  STATUS_LABELS,
  normalizeWorkOrderStatus,
  isHoldStatus,
  isActiveWorkOrderStatus,
  formatWorkOrderStatusLabel,
  workOrderStatusOptions,
  resolveWorkOrderLifecycleStatus,
};
