const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');
const { DEFAULT_OPERATIONAL_BRANCHES } = require('../lib/branches');

const filename = path.join(__dirname, '..', 'views', 'partials', 'header.ejs');
const template = fs.readFileSync(filename, 'utf8');

function render(role, branch, signedInBranch) {
  return ejs.render(template, {
    currentUser: role ? { role, username: 'Test user', branch } : null,
    signedInBranch, currentPath: '/parts', currentQuery: { location: 'Bogo' },
    canApproveRequests: false, pendingApprovalCount: 0,
    globalError: '', canCreatePo: false, canManagePo: false,
  }, { filename, includer: () => ({ template: ' ' }) });
}

test('all seven branch names appear once in a separate permanent-header badge', () => {
  for (const branch of DEFAULT_OPERATIONAL_BRANCHES) {
    const html = render('service_advisor', branch, branch);
    assert.equal((html.match(/id="signed-in-branch"/g) || []).length, 1);
    assert.ok(html.includes(`aria-label="Signed-in branch: ${branch}"`));
    assert.ok(html.includes(`title="Signed-in branch">${branch}</span>`));
    assert.ok(html.indexOf('id="signed-in-branch"') < html.indexOf('</header>'));
    assert.ok(html.includes('SA: Test user'));
    assert.ok(html.includes('A&amp;E Auto Service'));
  }
});

test('both clean and standard portal headers display the badge', () => {
  for (const role of ['technician', 'service_technical_manager', 'parts_clerk', 'store_manager']) {
    assert.match(render(role, 'Carmen', 'Carmen'), /title="Signed-in branch">Carmen<\/span>/);
  }
});

test('warehouse, unassigned and signed-out headers do not invent a branch badge', () => {
  for (const [role, branch] of [['parts_manager', 'Warehouse 1'], ['general_manager', ''], ['', '']]) {
    assert.ok(!render(role, branch, '').includes('id="signed-in-branch"'));
  }
});

test('badge background is exactly 50 percent red and does not fade the text', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');
  const rule = css.match(/html body \.site-header #signed-in-branch\{([^}]+)\}/)[1];
  assert.match(rule, /background:rgba\(220, 38, 38, 0\.5\)/);
  assert.match(rule, /color:#fff !important/);
  assert.ok(!rule.includes('opacity:'));
});
