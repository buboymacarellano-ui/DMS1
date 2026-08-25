const { DEFAULT_OPERATIONAL_BRANCHES, normalizeBranchKey } = require('./branches');

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

const SERVICE_COLUMN_RULES = [
  { key: 'oilVolumes', pattern: /\boil\b|lubricat|\bpms\b|preventive/i },
  { key: 'electrical', pattern: /electric|battery|alternator|starter|wiring|ignition/i },
  { key: 'mechanical', pattern: /mechanical|engine|brake|suspension|clutch|transmission|underchassis/i },
  { key: 'washing', pattern: /wash|detail|wax/i },
  { key: 'tireWorks', pattern: /tire|tyre|wheel/i },
  { key: 'alignments', pattern: /align/i },
  { key: 'ac', pattern: /\bac\b|a\/c|aircon|air con|air-con/i },
  { key: 'serviceCall', pattern: /service call|roadside|towing/i },
  { key: 'fluidWorks', pattern: /fluid|coolant|atf|brake fluid/i },
  { key: 'engineScan', pattern: /scan|diagnos|computer|obd/i },
];

function pad2(value) {
  return String(value).padStart(2, '0');
}

function manilaDateKey(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date instanceof Date ? date : new Date());
  const get = (type) => {
    const part = parts.find((entry) => entry.type === type);
    return part ? part.value : '';
  };
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function manilaTodayKey() {
  return manilaDateKey(new Date());
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

function unitTypeKey(workOrder, vehicle) {
  return String(
    (workOrder && (workOrder.vehicle_type || workOrder.unit_type))
    || (vehicle && vehicle.vehicle_type)
    || ''
  ).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isWalkIn(workOrder, vehicle) {
  return unitTypeKey(workOrder, vehicle) === 'walkin';
}

function isMotorUnit(workOrder, vehicle) {
  const key = unitTypeKey(workOrder, vehicle);
  return key.includes('motor') || key.includes('bike');
}

function isClosedJo(workOrder) {
  const status = String(workOrder && workOrder.status || '').trim().toLowerCase();
  return status === 'closed' || status === 'cancelled';
}

function serviceBlob(workOrder) {
  const items = Array.isArray(workOrder && workOrder.service_items) ? workOrder.service_items : [];
  return items.map((item) => [
    item && item.reason,
    item && item.service_type,
    item && item.description,
    item && item.parts,
  ].join(' ')).join(' ');
}

function bumpServiceColumns(metrics, workOrder) {
  const items = Array.isArray(workOrder && workOrder.service_items) ? workOrder.service_items : [];
  const blob = serviceBlob(workOrder);
  SERVICE_COLUMN_RULES.forEach((rule) => {
    if (rule.pattern.test(blob)) metrics[rule.key] += 1;
  });
  const hasParts = items.some((item) => (
    Number(item && item.parts_qty) > 0
    || Number(item && item.parts_price) > 0
    || String(item && item.parts || '').trim()
  ));
  const hasLabor = items.some((item) => Number(item && item.labor_price) > 0);
  if (hasLabor && !hasParts) metrics.ocpdLaborOnly += 1;
}

function buildOcpdReport(dateValue, workOrders, vehicles) {
  const today = manilaTodayKey();
  let date = isDateKey(dateValue) ? String(dateValue).trim() : today;
  if (date > today) date = today;

  const byKey = new Map(DEFAULT_OPERATIONAL_BRANCHES.map((branch) => [
    normalizeBranchKey(branch),
    Object.assign({ branch, date }, emptyMetrics()),
  ]));
  const vehicleById = new Map((vehicles || []).map((vehicle) => [String(vehicle && vehicle.id || ''), vehicle]));

  (workOrders || []).forEach((workOrder) => {
    const createdAt = new Date(workOrder && workOrder.created_at || 0);
    if (!Number.isFinite(createdAt.getTime())) return;
    if (manilaDateKey(createdAt) !== date) return;

    const entry = byKey.get(normalizeBranchKey(workOrder && workOrder.branch));
    if (!entry) return;

    const vehicle = vehicleById.get(String(workOrder.vehicle_id || ''));
    entry.totalJo += 1;
    if (!isClosedJo(workOrder)) entry.pendingJo += 1;
    if (isWalkIn(workOrder, vehicle)) {
      entry.walkIn += 1;
    } else if (isMotorUnit(workOrder, vehicle)) {
      entry.motorOcpd += 1;
    } else {
      entry.carOcpd += 1;
    }
    bumpServiceColumns(entry, workOrder);
  });

  const rows = DEFAULT_OPERATIONAL_BRANCHES.map((branch) => byKey.get(normalizeBranchKey(branch)));
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
