'use strict';
// Autoswitch engine. Keeps you on the PRIMARY account until its rate limit runs
// out, then moves the live login to the SECONDARY; when the primary recovers it
// moves back. The running Claude picks up the swapped credentials in place (a
// mid-request swap costs at most one API error), so the switch is live.
//
// Split in two layers:
//   decide(cfg, obs, state)  -> pure: {swap, phase, note}. All the threshold /
//                               idle / recovery logic, unit-tested without IO.
//   tick(rateLimits) / onIdle() -> effectful: gather the observation (reading the
//                               statusline payload or polling usage), call decide,
//                               perform the swap via switch.js, persist state.
//
// tick() runs from the statusline on every render (the live 99% force happens
// here); onIdle() runs from the Stop hook when Claude finishes a turn (the
// graceful 95% swap happens there, so a swap never lands mid-turn unless forced).
const p = require('./paths.js');
const config = require('./config.js');
const { atomicWrite, readJson } = require('./fsutil.js');
const { t } = require('./i18n.js');
const log = require('./log.js');

const POLL_MS = 45_000;        // throttle for polling the primary while on secondary
const SWAP_COOLDOWN_MS = 15_000; // never swap twice within this window (anti-thrash)
const STATE_FRESH_MS = 120_000;  // trust state.primaryUsage if written this recently

// --- observation normalization -------------------------------------------------

// The binding window is whichever of the 5h / 7d windows is closest to its cap:
// if either is exhausted, the account is effectively out.
function bindingFromStatusline(rate) {
  const wins = [];
  for (const key of ['five_hour', 'seven_day']) {
    const w = rate && rate[key];
    if (w && typeof w.used_percentage === 'number') {
      wins.push({ pct: w.used_percentage, resetsAt: w.resets_at ? w.resets_at * 1000 : null });
    }
  }
  return pickBinding(wins);
}

function bindingFromUsage(u) {
  const wins = [];
  for (const lim of [u && u.session, u && u.week]) {
    if (lim && typeof lim.pct === 'number') wins.push({ pct: lim.pct, resetsAt: lim.resetsAt || null });
  }
  return pickBinding(wins);
}

function pickBinding(wins) {
  if (!wins.length) return { pct: null, resetsAt: null };
  return wins.reduce((a, b) => (b.pct > a.pct ? b : a));
}

// Compact relative reset, e.g. "42m", "3h09m", "5d". Local to keep the engine
// free of the menu/UI module.
function fmtReset(ms) {
  if (!ms) return '';
  const d = ms - Date.now();
  if (d <= 0) return t('usageNow');
  const mins = Math.floor(d / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h${String(mins % 60).padStart(2, '0')}m`;
  return `${Math.floor(hrs / 24)}d`;
}

// --- pure decision -------------------------------------------------------------

// cfg:   { enabled, primary, secondary, armAt, forceAt, recoverBelow }
// obs:   { active, trigger:'tick'|'idle', activePct?, activeReset?, primaryPct?, primaryReset? }
// state: last persisted state (only read here; never mutated)
// -> { swap: null | { to, force }, phase, note }
function decide(cfg, obs, state = {}) {
  if (!cfg || !cfg.enabled || !cfg.primary || !cfg.secondary) {
    return { swap: null, phase: 'off', note: '' };
  }
  const { primary: P, secondary: S, armAt, forceAt, recoverBelow } = cfg;
  const { active: A, trigger } = obs;

  // A manual switch to some third account pauses autoswitch: never fight the user.
  if (A !== P && A !== S) return { swap: null, phase: 'paused', note: '' };

  if (A === P) {
    const pct = Math.round(obs.activePct == null ? 0 : obs.activePct);
    if (pct >= forceAt) {
      return { swap: { to: S, force: true }, phase: 'switching', note: t('asForcing', P, S, pct) };
    }
    if (pct >= armAt) {
      // Armed: swap only when Claude goes idle (Stop hook). A tick just warns.
      if (trigger === 'idle') return { swap: { to: S, force: false }, phase: 'switching', note: t('asSwitched', S) };
      return { swap: null, phase: 'armed', note: t('asArmed', P, S, pct) };
    }
    return { swap: null, phase: 'normal', note: '' };
  }

  // A === S: watch the primary for recovery.
  const pp = obs.primaryPct;
  if (pp != null && pp < recoverBelow) {
    if (trigger === 'idle') return { swap: { to: P, force: false }, phase: 'switching', note: t('asBack', P) };
    return { swap: null, phase: 'recover_armed', note: t('asRecovered', P) };
  }
  const reset = obs.primaryReset ? fmtReset(obs.primaryReset) : '';
  return { swap: null, phase: 'on_secondary', note: t('asOnSecondary', S, P, reset) };
}

// --- persisted state -----------------------------------------------------------

function readState() {
  try { return readJson(p.autoswitchState()) || {}; } catch { return {}; }
}
function writeState(s) {
  try { atomicWrite(p.autoswitchState(), JSON.stringify(s, null, 2)); } catch { /* best effort */ }
}

// --- swap execution ------------------------------------------------------------

// Perform the swap decided above. Re-checks the live account under the vault lock
// so two parallel statuslines can't both swap, and honors a short cooldown so a
// burst of ticks can't thrash. On failure, leaves an error note for the bar.
// Mutates `state` (lastSwapAt/lastError/phase) and returns an override note or null.
function performSwap({ to, force }, state) {
  const now = Date.now();
  if (state.lastSwapAt && now - state.lastSwapAt < SWAP_COOLDOWN_MS) return null;
  try {
    const { withLock } = require('./lock.js');
    return withLock(p.lockPath(), () => {
      const vault = require('./vault.js');
      if (vault.getCurrent() === to) { state.lastSwapAt = now; return null; }
      require('./switch.js').switchAccount(to);
      state.lastSwapAt = now;
      state.lastError = null;
      log.info('autoswitch.swapped', { to, force: !!force });
      return null;
    });
  } catch (e) {
    state.lastError = e.message;
    state.phase = 'error';
    log.warn('autoswitch.swap.failed', { to, err: e.message });
    return t('asError');
  }
}

// --- effectful entry points ----------------------------------------------------

async function livePct(name, current) {
  try {
    const u = await require('./usage.js').accountUsage(name, current);
    if (u && u.ok) return bindingFromUsage(u);
  } catch { /* offline */ }
  return { pct: null, resetsAt: null };
}

// Bound a slow network poll so the statusline never stalls: the usage endpoint's
// own timeout is 6s, too long for a per-render call. On timeout we keep whatever
// cached value we had and try again next poll window.
function withTimeout(promise, ms, fallback) {
  return Promise.race([promise, new Promise((r) => setTimeout(() => r(fallback), ms))]);
}
const TICK_POLL_TIMEOUT_MS = 2000;

// Called from the statusline on every render. `rateLimits` is the payload's
// rate_limits object for the ACTIVE account. Returns { note } for the bar.
async function tick(rateLimits) {
  const cfg = config.autoswitch();
  const state = readState();
  const active = require('./vault.js').getCurrent();
  if (!cfg.enabled || !cfg.primary || !cfg.secondary) return finish(state, { phase: 'off', note: '' });

  const obs = { active, trigger: 'tick' };
  if (active === cfg.primary) {
    const b = bindingFromStatusline(rateLimits);
    obs.activePct = b.pct;
    obs.activeReset = b.resetsAt;
    state.primaryUsage = { pct: b.pct, resetsAt: b.resetsAt }; // cache for the Stop hook
  } else if (active === cfg.secondary) {
    const now = Date.now();
    if (!state.lastPoll || now - state.lastPoll > POLL_MS) {
      const b = await withTimeout(
        livePct(cfg.primary, active), TICK_POLL_TIMEOUT_MS, { pct: null, resetsAt: null },
      );
      if (b.pct != null) state.primaryUsage = { pct: b.pct, resetsAt: b.resetsAt };
      state.lastPoll = now;
    }
    obs.primaryPct = state.primaryUsage ? state.primaryUsage.pct : null;
    obs.primaryReset = state.primaryUsage ? state.primaryUsage.resetsAt : null;
  }

  const d = decide(cfg, obs, state);
  const note = d.swap ? (performSwap(d.swap, state) ?? d.note) : d.note;
  return finish(state, { phase: state.phase === 'error' ? 'error' : d.phase, note });
}

// Called from the Stop hook when Claude finishes a turn (idle). Performs the
// graceful swap. The hook payload lacks rate_limits, so use the statusline's
// cached usage when fresh, else fetch it live.
async function onIdle() {
  const cfg = config.autoswitch();
  const state = readState();
  const active = require('./vault.js').getCurrent();
  if (!cfg.enabled || !cfg.primary || !cfg.secondary) return finish(state, { phase: 'off', note: '' });

  const fresh = state.updatedAt && Date.now() - state.updatedAt < STATE_FRESH_MS && state.primaryUsage;
  const obs = { active, trigger: 'idle' };
  if (active === cfg.primary) {
    obs.activePct = fresh ? state.primaryUsage.pct : (await livePct(active, active)).pct;
  } else if (active === cfg.secondary) {
    const b = fresh ? state.primaryUsage : await livePct(cfg.primary, active);
    obs.primaryPct = b.pct;
    obs.primaryReset = b.resetsAt;
    state.primaryUsage = { pct: b.pct, resetsAt: b.resetsAt };
  }

  const d = decide(cfg, obs, state);
  const note = d.swap ? (performSwap(d.swap, state) ?? d.note) : d.note;
  return finish(state, { phase: state.phase === 'error' ? 'error' : d.phase, note });
}

function finish(state, { phase, note }) {
  state.phase = phase;
  state.note = note;
  state.updatedAt = Date.now();
  writeState(state);
  return { note };
}

module.exports = {
  decide, tick, onIdle, readState, writeState, performSwap,
  bindingFromStatusline, bindingFromUsage, fmtReset,
  POLL_MS, SWAP_COOLDOWN_MS, STATE_FRESH_MS,
};
