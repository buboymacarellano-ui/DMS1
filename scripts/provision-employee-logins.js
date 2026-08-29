/**
 * Import employee-db-all.csv into the live store and create login
 * accounts authorized by Department / Role / Employee ID / Location.
 * Shop password: PW123456
 *
 * Usage: node scripts/provision-employee-logins.js
 */
const store = require('../data/store');
const { loadLoginAuthState } = require('../lib/login-auth');
const { provisionEmployeeLogins } = require('../lib/employee-login');

async function main() {
  const result = await provisionEmployeeLogins(store);
  await loadLoginAuthState();
  console.log(JSON.stringify({
    login_auth: 'enabled',
    password: 'PW123456',
    fields: ['department', 'role', 'employee_id', 'location'],
    csv_rows: result.csv_rows,
    employees: result.employees,
    accounts_created: result.accounts_created,
    accounts_updated: result.accounts_updated,
    passwords_reset: result.passwords_reset,
    by_role: result.by_role,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
