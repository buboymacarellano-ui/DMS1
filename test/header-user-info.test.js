const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');
const { DEFAULT_OPERATIONAL_BRANCHES } = require('../lib/branches');

const filename = path.join(__dirname, '..', 'views', 'partials', 'header.ejs');
const template = fs.readFileSync(filename, 'utf8');
const userInfoPartial = fs.readFileSync(
  path.join(__dirname, '..', 'views', 'partials', 'header-user-info.ejs'),
  'utf8'
);

function render(role, branch, signedInBranch) {
  return ejs.render(template, {
    currentUser: role ? { role, username: 'Test user', branch } : null,
    signedInBranch, currentPath: '/parts', currentQuery: { location: 'Bogo' },
    canApproveRequests: false, pendingApprovalCount: 0,
    globalError: '', canCreatePo: false, canManagePo: false,
  }, {
    filename,
    includer: (name) => (name === 'header-user-info'
      ? { template: userInfoPartial }
      : { template: ' ' }),
  });
}

test('all seven branch names appear once in the header branch lettering', () => {
  for (const branch of DEFAULT_OPERATIONAL_BRANCHES) {
    const html = render('service_advisor', branch, branch);
    assert.equal((html.match(/Branch ID:/g) || []).length, 1);
    assert.ok(html.includes(`<span class="header-user-info__value">${branch}</span>`));
    assert.ok(!html.includes('id="signed-in-branch"'));
  }
});

test('clean and standard portal headers show name, role and branch lettering', () => {
  for (const role of ['technician', 'service_technical_manager', 'parts_clerk', 'store_manager']) {
    const html = render(role, 'Carmen', 'Carmen');
    assert.match(html, /User Name:<\/span>\s*<span class="header-user-info__value">Test user<\/span>/);
    assert.match(html, /Role:<\/span>\s*<span class="header-user-info__value">[A-Z]+<\/span>/);
    assert.match(html, /Branch ID:<\/span>\s*<span class="header-user-info__value">Carmen<\/span>/);
  }
});

test('warehouse, unassigned and signed-out headers do not invent a branch', () => {
  for (const [role, branch] of [['parts_manager', 'Warehouse 1'], ['general_manager', ''], ['', '']]) {
    const html = render(role, branch, '');
    assert.ok(!html.includes('Branch ID:'));
  }
});

test('the old name and branch badges are gone from the header', () => {
  const html = render('general_manager', 'Carmen', 'Carmen');
  assert.ok(!html.includes('header-user-badge'));
  assert.ok(!html.includes('signed-in-branch'));
});

test('header lettering uses white text', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');
  const rule = css.match(/\.header-user-info\{([^}]+)\}/)[1];
  assert.match(rule, /color:#ffffff/);
  assert.ok(!css.includes('#signed-in-branch'));
});
