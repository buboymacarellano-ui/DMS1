const { DEFAULT_OPERATIONAL_BRANCHES } = require('./branches');

const OCPD_COLUMNS = [
  { key: 'branch', header: 'Branch' },
  { key: 'date', header: 'Date' },
  { key: 'totalJo', header: 'Total JO' },
  { key: 'walkIn', header: 'Walk-In' },
  { key: 'pendingJo', header: 'Pending-JO' },
  { key: 'carOcpd', header: 'Car OCPD' },
  { key: 'motorOcpd', header: 'Motor OCPD' },
  { key: 'oilVolumes', header: 'Oil-Volumes' },
  { key: 'electrical', header: 'Electrical' },
  { key: 'mechanical', header: 'Mechanical' },
  { key: 'washing', header: 'Washing' },
  { key: 'ocpdLaborOnly', header: 'OCPD Labor Only' },
  { key: 'tireWorks', header: 'Tire Works' },
  { key: 'alignments', header: 'Alignments' },
  { key: 'ac', header: 'AC' },
  { key: 'serviceCall', header: 'Service Call' },
  { key: 'fluidWorks', header: 'Fluid Works' },
  { key: 'engineScan', header: 'Engine Scan' },
];

const NUMERIC_KEYS = OCPD_COLUMNS
  .map((column) => column.key)
  .filter((key) => key !== 'branch' && key !== 'date');

function pad2(value) {
  return String(value).padStart(2, '0');
}

function manilaTodayKey() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function isDateKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim());
}

function shiftDateKey(dateKey, days) {
  const [year, month, day] = String(dateKey).split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + Number(days || 0)));
  return `${next.getUTCFullYear()}-${pad2(next.getUTCMonth() + 1)}-${pad2(next.getUTCDate())}`;
}

function formatOcpdDateLabel(dateKey) {
  const [year, month, day] = String(dateKey).split('-');
  if (!year || !month || !day) return dateKey;
  return `${month}/${day}/${year}`;
}

function emptyMetrics() {
  return NUMERIC_KEYS.reduce((acc, key) => {
    acc[key] = 0;
    return acc;
  }, {});
}

function buildOcpdReport(dateValue) {
  const today = manilaTodayKey();
  let date = isDateKey(dateValue) ? String(dateValue).trim() : today;
  if (date > today) date = today;
  const rows = DEFAULT_OPERATIONAL_BRANCHES.map((branch) => Object.assign({
    branch,
    date,
  }, emptyMetrics()));
  return {
    date,
    today,
    dateLabel: formatOcpdDateLabel(date),
    prevDate: shiftDateKey(date, -1),
    nextDate: shiftDateKey(date, 1),
    canGoNext: date < today,
    columns: OCPD_COLUMNS,
    rows,
  };
}

module.exports = {
  OCPD_COLUMNS,
  NUMERIC_KEYS,
  manilaTodayKey,
  shiftDateKey,
  formatOcpdDateLabel,
  buildOcpdReport,
};
