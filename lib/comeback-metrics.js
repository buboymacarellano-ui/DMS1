function parseDateSafe(value) {
  const dt = new Date(value || 0);
  return Number.isFinite(dt.getTime()) ? dt : null;
}

function safePercent(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return 0;
  return (numerator / denominator) * 100;
}

function isBackJobText(value) {
  return String(value || '').trim().toLowerCase().includes('back job');
}

function workOrderHasBackJob(wo) {
  const orderType = String(wo && (wo.job_type || wo.transaction_type || wo.status) || '').toLowerCase();
  if (orderType.includes('back job')) return true;
  return (wo && wo.service_items || []).some((item) => (
    isBackJobText(item.reason)
    || isBackJobText(item.service_type)
    || isBackJobText(item.description)
  ));
}

function transactionRecordHasBackJob(record) {
  if (!record) return false;
  const statusField = record['Job Type'] || record['Transaction Type'] || record['Status'] || '';
  if (isBackJobText(statusField)) return true;
  for (let slot = 1; slot <= 15; slot += 1) {
    if (isBackJobText(record[`Service${slot}`])) return true;
  }
  return false;
}

function buildLatestTransactionByWorkOrderId(transactionRecords) {
  const map = new Map();
  for (const record of transactionRecords || []) {
    const woId = String(record.work_order_id || '').trim();
    if (!woId) continue;
    const when = parseDateSafe(record.created_at || record['Transaction date']);
    if (!when) continue;
    const prev = map.get(woId);
    if (!prev || when.getTime() > prev.when.getTime()) {
      map.set(woId, { record, when });
    }
  }
  return map;
}

function buildComebackWorkOrderIdSet(workOrders, transactionRecords) {
  const comebackSet = new Set();
  const latestTxByWo = buildLatestTransactionByWorkOrderId(transactionRecords);

  const sortedAll = [...(workOrders || [])].sort((a, b) => {
    const ta = parseDateSafe(a && a.created_at);
    const tb = parseDateSafe(b && b.created_at);
    return (ta ? ta.getTime() : 0) - (tb ? tb.getTime() : 0);
  });

  const lastByVehicleKey = new Map();
  for (const wo of sortedAll) {
    const createdAt = parseDateSafe(wo && wo.created_at);
    if (!createdAt) continue;
    const customerKey = String(wo.customer_id || '').trim();
    const vehicleKey = String(wo.vehicle_id || wo.plate_number || '').trim();
    if (!customerKey && !vehicleKey) continue;
    const key = `${customerKey}::${vehicleKey}`;
    const prev = lastByVehicleKey.get(key);
    if (prev) {
      const daysGap = Math.floor((createdAt.getTime() - prev.getTime()) / 86400000);
      if (daysGap >= 0 && daysGap <= 30) {
        comebackSet.add(String(wo.id || ''));
      }
    }
    lastByVehicleKey.set(key, createdAt);
  }

  for (const wo of workOrders || []) {
    const woId = String(wo.id || '').trim();
    if (!woId) continue;
    if (workOrderHasBackJob(wo)) {
      comebackSet.add(woId);
    }
    const latestTx = latestTxByWo.get(woId);
    if (latestTx && transactionRecordHasBackJob(latestTx.record)) {
      comebackSet.add(woId);
    }
  }

  return comebackSet;
}

function isActiveWorkOrder(wo) {
  const status = String(wo && wo.status || '').trim().toLowerCase();
  return status === 'open' || status === 'in-progress';
}

function isClosedWorkOrder(wo) {
  return String(wo && wo.status || '').trim().toLowerCase() === 'closed';
}

function computeQualityMetrics(workOrdersMtd, comebackSet) {
  const closedMtd = workOrdersMtd.filter(isClosedWorkOrder);
  const activeMtd = workOrdersMtd.filter(isActiveWorkOrder);
  const performanceEligibleMtd = [...closedMtd, ...activeMtd];
  const mtdComebacks = performanceEligibleMtd.filter((wo) => comebackSet.has(String(wo.id || ''))).length;
  const eligibleCount = performanceEligibleMtd.length;

  return {
    firstTimeFixRatePct: eligibleCount ? safePercent(eligibleCount - mtdComebacks, eligibleCount) : 0,
    comebackRatePct: eligibleCount ? safePercent(mtdComebacks, eligibleCount) : 0,
    comebackCount: mtdComebacks,
    closedRoCount: closedMtd.length,
    activeRoCount: activeMtd.length,
    performanceEligibleCount: eligibleCount,
  };
}

function buildTechnicianComebackStats(workOrders, transactionRecords, canonicalNameFn) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const comebackSet = buildComebackWorkOrderIdSet(workOrders, transactionRecords);
  const stats = new Map();

  for (const wo of workOrders || []) {
    const createdAt = parseDateSafe(wo.created_at);
    if (!createdAt || createdAt < monthStart) continue;

    const technician = String(wo.technician || '').trim();
    if (!technician) continue;

    const key = canonicalNameFn(technician);
    if (!stats.has(key)) {
      stats.set(key, { eligibleCount: 0, comebackCount: 0 });
    }

    const entry = stats.get(key);
    if (!isClosedWorkOrder(wo) && !isActiveWorkOrder(wo)) continue;

    entry.eligibleCount += 1;
    if (comebackSet.has(String(wo.id || ''))) {
      entry.comebackCount += 1;
    }
  }

  const result = new Map();
  for (const [key, entry] of stats.entries()) {
    result.set(key, {
      comebackCountMtd: entry.comebackCount,
      comebackRateMtdPct: entry.eligibleCount ? safePercent(entry.comebackCount, entry.eligibleCount) : 0,
      performanceEligibleMtd: entry.eligibleCount,
    });
  }
  return result;
}

module.exports = {
  buildComebackWorkOrderIdSet,
  buildTechnicianComebackStats,
  computeQualityMetrics,
  isActiveWorkOrder,
  isClosedWorkOrder,
  transactionRecordHasBackJob,
  workOrderHasBackJob,
};
