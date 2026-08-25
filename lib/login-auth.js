const store = require('../data/store');

let cachedStoreDisabled = false;
let loaded = false;

function envLoginDisabled() {
  return String(process.env.DISABLE_LOGIN || '0').trim() === '1';
}

function isLoginAuthDisabled() {
  return envLoginDisabled() || cachedStoreDisabled;
}

function isOpenLoginEnabled() {
  return cachedStoreDisabled === true;
}

async function loadLoginAuthState() {
  try {
    cachedStoreDisabled = await store.isLoginAuthDisabled();
  } catch (_error) {
    cachedStoreDisabled = false;
  }
  loaded = true;
  return isLoginAuthDisabled();
}

async function setOpenLoginEnabled(disabled) {
  cachedStoreDisabled = Boolean(disabled);
  loaded = true;
  await store.setLoginAuthDisabled(cachedStoreDisabled);
  return isLoginAuthDisabled();
}

function ensureLoginAuthLoaded(next) {
  if (loaded) return next();
  loadLoginAuthState().then(() => next()).catch(() => next());
}

module.exports = {
  envLoginDisabled,
  isLoginAuthDisabled,
  isOpenLoginEnabled,
  loadLoginAuthState,
  setOpenLoginEnabled,
  ensureLoginAuthLoaded,
};
