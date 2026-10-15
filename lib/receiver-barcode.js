const { normalizeEmployeeBarcode, normalizeEmployeeId } = require('./frontline-roles');

function expectedReceiverIdentifiers(user) {
  const identifiers = new Set();
  const employeeId = normalizeEmployeeId(user && user.employee_id);
  const barcode = normalizeEmployeeBarcode(user && user.barcode);
  if (employeeId) identifiers.add(employeeId);
  if (barcode) identifiers.add(barcode);
  return identifiers;
}

function verifyReceiverBarcode(user, rawScan) {
  const scanned = normalizeEmployeeBarcode(rawScan);
  if (!scanned) {
    return { ok: false, error: 'Receiver barcode is required. Swipe your own ID barcode to continue.' };
  }

  const expected = expectedReceiverIdentifiers(user);
  if (!expected.size) {
    return { ok: false, error: 'Your account has no employee ID / barcode on file. Please log in again.' };
  }

  if (!expected.has(scanned)) {
    return { ok: false, error: 'Receiver barcode does not match the logged-in user.' };
  }

  return { ok: true, barcode: scanned };
}

module.exports = {
  expectedReceiverIdentifiers,
  verifyReceiverBarcode,
};
