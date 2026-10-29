const express = require('express');
const store = require('../data/store');

const router = express.Router();

function normalizeText(value) {
  return String(value || '').trim();
}

function resolveTechnicianId(req) {
  const session = (req && req.session) || {};
  const user = session.user || {};
  return normalizeText(
    session.technicianId ||
    session.employeeId ||
    user.technician_employee_id ||
    user.employee_id ||
    user.id
  );
}

router.post('/scan', async (req, res) => {
  const workOrderNo = normalizeText(req.body && req.body.workOrderNo);
  const technicianId = resolveTechnicianId(req);

  if (!workOrderNo) {
    return res.status(400).json({ success: false, message: 'Work Order number is required.' });
  }

  if (!technicianId) {
    return res.status(401).json({ success: false, message: 'Technician session is required.' });
  }

  const nowIso = new Date().toISOString();
  const logs = await store.getAll('timecard_logs');
  const activeLogForWorkOrder = (logs || []).find((row) => (
    normalizeText(row.work_order_id) === workOrderNo
    && normalizeText(row.status).toLowerCase() === 'active'
  ));

  if (activeLogForWorkOrder) {
    if (normalizeText(activeLogForWorkOrder.technician_id) !== technicianId) {
      return res.status(400).json({
        success: false,
        message: 'This Work Order is locked by another technician.',
      });
    }

    const updated = await store.update('timecard_logs', activeLogForWorkOrder.id, {
      end_time: nowIso,
      status: 'completed',
      updated_at: nowIso,
    });

    return res.json({
      success: true,
      action: 'stopped',
      message: 'Job stopped.',
      log: updated,
    });
  }

  const activeLogForTechnician = (logs || []).find((row) => (
    normalizeText(row.technician_id) === technicianId
    && normalizeText(row.status).toLowerCase() === 'active'
    && normalizeText(row.work_order_id) !== workOrderNo
  ));

  if (activeLogForTechnician) {
    return res.status(400).json({
      success: false,
      message: 'You are already active on another job.',
    });
  }

  const created = await store.create('timecard_logs', {
    work_order_id: workOrderNo,
    technician_id: technicianId,
    start_time: nowIso,
    end_time: null,
    status: 'active',
  });

  return res.json({
    success: true,
    action: 'started',
    message: 'Job started.',
    log: created,
  });
});

module.exports = router;
