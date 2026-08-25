const crypto = require('crypto');
const express = require('express');
const store = require('../data/store');

const router = express.Router();

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(String(password || ''), salt, 120000, 64, 'sha512').toString('hex');
}

function hasPassword(user) {
  return Boolean(String((user && user.password_hash) || '').trim() && String((user && user.password_salt) || '').trim());
}

function isPasswordEnabled(user) {
  return user && user.password_enabled !== false;
}

function emptyRoleCounts() {
  return {
    service_advisor: 0,
    service_receptionist: 0,
    senior_service_receptionist: 0,
    general_manager: 0,
    admin: 0,
    hr: 0,
    service_technical_manager: 0,
    parts_manager: 0,
    finance_manager: 0,
    technician: 0,
  };
}

async function renderDirectory(res, extra) {
  const users = await store.getAll('users');
  const roleCounts = users.reduce((counts, user) => {
    let role = String(user.role || '').trim().toLowerCase();
    if (role === 'fm') role = 'finance_manager';
    if (role === 'pm') role = 'parts_manager';
    counts[role] = (counts[role] || 0) + 1;
    return counts;
  }, emptyRoleCounts());

  return res.render('hr/index', Object.assign({
    users,
    roleCounts,
    totalUsers: users.length,
    success: '',
    error: '',
  }, extra || {}));
}

function redirectWithMessage(res, type, message) {
  const query = `${type}=${encodeURIComponent(message)}`;
  return res.redirect(`/hr?${query}`);
}

router.get('/', async (req, res) => {
  return renderDirectory(res, {
    success: String(req.query.success || ''),
    error: String(req.query.error || ''),
  });
});

router.post('/users/:id/set-password', async (req, res) => {
  const user = await store.getById('users', req.params.id);
  if (!user) return redirectWithMessage(res, 'error', 'Account was not found.');
  if (hasPassword(user)) {
    return redirectWithMessage(res, 'error', 'This account already has a password. Use Edit Password.');
  }

  const password = String(req.body.password || '');
  const confirmPassword = String(req.body.confirm_password || '');
  if (password.length < 6) {
    return redirectWithMessage(res, 'error', 'Password must be at least 6 characters.');
  }
  if (password !== confirmPassword) {
    return redirectWithMessage(res, 'error', 'Password confirmation does not match.');
  }

  const salt = crypto.randomBytes(16).toString('hex');
  await store.update('users', user.id, {
    password_salt: salt,
    password_hash: hashPassword(password, salt),
    password_enabled: true,
  });
  return redirectWithMessage(res, 'success', `Password set for ${user.username}.`);
});

router.post('/users/:id/edit-password', async (req, res) => {
  const user = await store.getById('users', req.params.id);
  if (!user) return redirectWithMessage(res, 'error', 'Account was not found.');
  if (!hasPassword(user)) {
    return redirectWithMessage(res, 'error', 'This account has no password yet. Use Set Password.');
  }

  const password = String(req.body.password || '');
  const confirmPassword = String(req.body.confirm_password || '');
  if (password.length < 6) {
    return redirectWithMessage(res, 'error', 'Password must be at least 6 characters.');
  }
  if (password !== confirmPassword) {
    return redirectWithMessage(res, 'error', 'Password confirmation does not match.');
  }

  const salt = crypto.randomBytes(16).toString('hex');
  await store.update('users', user.id, {
    password_salt: salt,
    password_hash: hashPassword(password, salt),
  });
  return redirectWithMessage(res, 'success', `Password updated for ${user.username}.`);
});

router.post('/users/:id/password-enabled', async (req, res) => {
  const user = await store.getById('users', req.params.id);
  if (!user) return redirectWithMessage(res, 'error', 'Account was not found.');

  const sessionUser = (req.session && req.session.user) || {};
  if (String(sessionUser.id || '') === String(user.id || '')) {
    return redirectWithMessage(res, 'error', 'You cannot disable the password on your own signed-in account.');
  }

  const enabled = String(req.body.enabled || '') === '1';
  await store.update('users', user.id, { password_enabled: enabled });
  return redirectWithMessage(
    res,
    'success',
    `Password ${enabled ? 'enabled' : 'disabled'} for ${user.username}.`
  );
});

module.exports = router;
