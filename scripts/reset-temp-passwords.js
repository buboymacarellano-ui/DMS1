/**
 * Sets every login account password to the temporary shop password
 * and turns login auth back on so the login panel requires a full fill-out.
 *
 * Usage: node scripts/reset-temp-passwords.js
 */
const crypto = require('crypto');
const store = require('../data/store');
const { loadLoginAuthState } = require('../lib/login-auth');

const TEMP_PASSWORD = '123456';
const ITERATIONS = 120000;

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(String(password || ''), salt, ITERATIONS, 64, 'sha512').toString('hex');
}

async function main() {
  const data = await store.getRawData();
  const users = Array.isArray(data.users) ? data.users : [];
  let updated = 0;

  users.forEach((user) => {
    if (!user || typeof user !== 'object') return;
    const salt = crypto.randomBytes(16).toString('hex');
    user.password_salt = salt;
    user.password_hash = hashPassword(TEMP_PASSWORD, salt);
    user.password_enabled = true;
    updated += 1;
  });

  data.auth_settings = Object.assign({}, data.auth_settings || {}, {
    login_disabled: false,
    updated_at: new Date().toISOString(),
  });

  await store.replaceData(data);
  await loadLoginAuthState();

  console.log(JSON.stringify({
    accounts_updated: updated,
    login_auth: 'enabled',
    all_fields_required: true,
  }));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
