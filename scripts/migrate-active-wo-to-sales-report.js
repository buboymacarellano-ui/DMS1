const store = require('../data/store');
const { normalizeWorkOrderStatus, isActiveWorkOrderStatus } = require('../lib/work-order-status');

(async () => {
  const workOrders = await store.getAll('work_orders');
  let count = 0;
  for (const wo of workOrders) {
    if (isActiveWorkOrderStatus(wo.status)) {
      await store.update('work_orders', wo.id, {
        status: 'closed',
        paymentStatus: 'Paid',
        payment_status: 'Paid',
      });
      count++;
    }
  }
  console.log(`Updated ${count} active work orders to Sales Report (closed/paid).`);
})();
