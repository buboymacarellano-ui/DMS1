'use strict';

// Asserts which stylesheet a route serves. Usage:
//   node scripts/check-skin.js legacy /auth/login /stores
//   node scripts/check-skin.js v2 /auth/login
const BASE = process.env.BASE_URL || 'http://127.0.0.1:3000';
const V2_HREF = '/css/app.css';
const LEGACY_HREF = '/styles.css';

async function main() {
  const [expected, ...routes] = process.argv.slice(2);
  if (expected !== 'legacy' && expected !== 'v2') {
    console.error('Usage: check-skin.js <legacy|v2> <route...>');
    process.exit(2);
  }
  if (!routes.length) {
    console.error('No routes given.');
    process.exit(2);
  }

  let failed = 0;
  for (const route of routes) {
    const response = await fetch(`${BASE}${route}`, { redirect: 'follow' });
    const html = await response.text();
    const hasV2 = html.includes(V2_HREF);
    const hasLegacy = html.includes(LEGACY_HREF);
    const ok = expected === 'v2' ? (hasV2 && !hasLegacy) : (hasLegacy && !hasV2);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${route}  v2=${hasV2} legacy=${hasLegacy}`);
    if (!ok) failed += 1;
  }
  if (failed) {
    console.error(`\n${failed} route(s) served the wrong stylesheet.`);
    process.exit(1);
  }
  console.log(`\nAll ${routes.length} route(s) served the ${expected} stylesheet.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
