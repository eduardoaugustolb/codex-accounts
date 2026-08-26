'use strict';
// Read/update ~/.claude-accounts/config.json without clobbering unrelated keys.
// The file is shared with the installer (which writes {lang}) and the autoswitch
// UI (which writes {autoswitch, wrappedStatusline}); every writer must merge, so
// enabling autoswitch can never drop the language and vice-versa.
const p = require('./paths.js');
const { atomicWrite } = require('./fsutil.js');
const { withLock } = require('./lock.js');

// Defaults for the autoswitch block. `armAt`/`forceAt` are the primary-account
// utilization thresholds (%); `recoverBelow` is how far the primary must fall,
// while you are on the secondary, before switching back (hysteresis vs. armAt).
const AUTOSWITCH_DEFAULTS = {
  enabled: false,
  primary: null,
  secondary: null,
  armAt: 95,
  forceAt: 99,
  recoverBelow: 50,
};

// Tolerant whole-file read: a missing or corrupt config must never crash the
// statusline/hook path, so callers degrade to defaults instead.
function read() {
  try {
    const fs = require('node:fs');
    if (!fs.existsSync(p.configPath())) return {};
    return JSON.parse(fs.readFileSync(p.configPath(), 'utf8')) || {};
  } catch {
    return {};
  }
}

function autoswitch() {
  return { ...AUTOSWITCH_DEFAULTS, ...(read().autoswitch || {}) };
}

// Merge-write under the vault lock. `mutator` receives the current whole config
// (a shallow copy) and returns the next one; returning nothing keeps the copy.
function update(mutator) {
  return withLock(p.lockPath(), () => {
    const cur = read();
    const next = mutator({ ...cur }) || cur;
    atomicWrite(p.configPath(), JSON.stringify(next, null, 2));
    return next;
  });
}

module.exports = { read, autoswitch, update, AUTOSWITCH_DEFAULTS };
