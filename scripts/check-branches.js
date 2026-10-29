const store = require('../data/store');
(async () => {
  const wo = await store.getAll('work_orders');
  const tr = await store.getAll('transaction_records');
  console.log('WO branches:', [...new Set(wo.map(w => w.branch))]);
  console.log('TR branches:', [...new Set(tr.map(r => r.Branch))]);
})();
