function collectPartNumbers(data) {
  const rows = [
    ...((data && data.parts) || []),
    ...((data && data.parts_inventory) || []),
    ...((data && data.transactions) || []),
  ];
  return rows.map((row) => String((row && row.part_number) || '').trim()).filter(Boolean);
}

function maxCreatedPartSequence(data) {
  const pattern = /^AEP-(\d{6})$/i;
  let maxSeq = 0;
  collectPartNumbers(data).forEach((partNumber) => {
    const match = partNumber.match(pattern);
    if (!match) return;
    const seq = Number(match[1]);
    if (Number.isFinite(seq) && seq > maxSeq) maxSeq = seq;
  });
  return maxSeq;
}

function allocateCreatePartNumber(data) {
  return `AEP-${String(maxCreatedPartSequence(data) + 1).padStart(6, '0')}`;
}

module.exports = {
  allocateCreatePartNumber,
};
