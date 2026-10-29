const store = require('../data/store');
(async () => {
  const wo = await store.getAll('work_orders');
  const tr = await store.getAll('transaction_records');
  console.log('wo', wo.length, 'tr', tr.length);
  const closed = wo.filter(w => String(w.status || '').toLowerCase() === 'closed');
  console.log('closed wo', closed.length);
  const ids = new Set(tr.map(r => r.work_order_id).filter(Boolean));
  const missing = closed.filter(w => !ids.has(w.id));
  console.log('closed wo missing tr', missing.length);
  const branches = new Set(missing.map(w => w.branch));
  console.log('missing branches', [...branches]);
})();
