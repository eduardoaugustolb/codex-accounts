#!/usr/bin/env node
'use strict';
const vault = require('./vault.js');
const { switchAccount } = require('./switch.js');
const config = require('./config.js');
const { t } = require('./i18n.js');
const log = require('./log.js');
const audit = require('./audit.js');

// Commands that may mutate the vault. Read-only commands (list/current/doctor)
// must not, so they skip the first-run adoptCurrent (which would write a slot).
const MUTATING = new Set(['switch', 'add', 'remove', 'menu']);

async function main(argv) {
  const [cmd, ...rest] = argv;
  if (MUTATING.has(cmd)) {
    const adopted = vault.adoptCurrent();
    if (adopted) log.info(t('adopted', adopted)); // stderr: visible, doesn't pollute results
  }
  switch (cmd) {
    case 'list': {
      const cur = vault.getCurrent();
      for (const n of vault.list()) log.result(n === cur ? `* ${n}` : `  ${n}`);
      return 0;
    }
    case 'current': {
      const cur = vault.getCurrent();
      if (cur) { log.result(cur); return 0; }
      // No marker yet: report a live-but-unregistered login read-only (no mutation),
      // so a fresh user isn't told '(none)' while actually logged in.
      const live = vault.captureOAuthFromLive();
      log.result(live && live.emailAddress ? `(${t('unregistered')}: ${live.emailAddress})` : '(nenhuma)');
      return 0;
    }
    case 'switch': {
      if (!rest[0]) { log.error(t('usageSwitch')); return 2; }
      reportSwitch(switchAccount(rest[0]));
      return 0;
    }
    case 'remove': {
      if (!rest[0]) { log.error(t('usageRemove')); return 2; }
      const r = vault.removeAccount(rest[0]);
      if (!r.removed) { log.result(t('notFound', rest[0])); return 1; } // no false "removed"
      log.result(t('removed', rest[0]));
      return 0;
    }
    case 'add': {
      const { addAccount } = require('./login.js');
      const name = rest[0] || await prompt(t('promptName'));
      const r = await addAccount(name, {});
      if (r.added) { log.result(r.email ? t('addedEmail', name, r.email) : t('added', name)); return 0; }
      log.result(addFailMessage(r));
      return 1;
    }
    case 'menu': {
      return runInteractiveMenu();
    }
    case 'doctor':
    case 'status': {
      const doctor = require('./doctor.js');
      const report = doctor.collect();
      if (rest.includes('--json')) log.result(JSON.stringify(report, null, 2));
      else process.stdout.write(doctor.render(report));
      return doctor.exitCode(report);
    }
    case 'log': {
      return showAudit(rest);
    }
    case 'autoswitch': {
      return autoswitchCmd(rest);
    }
    default:
      log.error(t('unknown', cmd || '(vazio)'));
      return 2;
  }
}

function prompt(q) {
  return new Promise((resolve) => {
    process.stdout.write(q);
    process.stdin.resume();
    process.stdin.once('data', (d) => { process.stdin.pause(); resolve(d.toString().trim()); });
  });
}

function emailMap(names = vault.list()) {
  const m = {};
  for (const n of names) m[n] = vault.email(n);
  return m;
}

// Read-only audit reader: `log [N] [--json] [--fails]`. Reads the rotated
// generation then the live log so order is chronological.
function showAudit(rest) {
  const p = require('./paths.js');
  const fs = require('node:fs');
  let lines = [];
  for (const f of [p.auditLog() + '.1', p.auditLog()]) {
    try { lines = lines.concat(fs.readFileSync(f, 'utf8').split('\n').filter(Boolean)); } catch { /* absent */ }
  }
  if (!lines.length) { log.result(t('noAuditYet')); return 0; }
  const n = Number((rest.find((a) => /^\d+$/.test(a))) || 50);
  const recs = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const shown = (rest.includes('--fails') ? recs.filter((r) => r.outcome === 'fail') : recs).slice(-n);
  if (rest.includes('--json')) { for (const r of shown) log.result(JSON.stringify(r)); return 0; }
  for (const r of shown) {
    const who = (r.from || r.to) ? `${r.from || '?'} -> ${r.to || r.account || '?'}` : (r.account || '');
    log.result(`${r.ts}  ${String(r.action).padEnd(11)} ${String(r.outcome).padEnd(5)} ${who}${r.dur_ms ? `  (${r.dur_ms}ms)` : ''}`);
    if (r.outcome === 'fail') log.result(`    ${r.reason || ''} ${(r.err && r.err.message) || ''}`.trimEnd());
  }
  return 0;
}

// Map an addAccount failure to the most specific reason the user can act on,
// instead of the old blanket "Nothing captured".
function addFailMessage(r) {
  if (r.keyringSuspected || r.reason === 'keyring') return t('addKeyring');
  if (r.reason === 'timeout') return t('addTimeout');
  return t('nothingCaptured');
}

function reportSwitch(r) {
  if (r.savedFrom && r.savedFrom !== r.account) log.debug('switch.saved-prev', { account: r.savedFrom });
  if (!r.switched) { log.result(t('already', r.account)); return; }
  // Surface the identity so the user can confirm WHO is now live; warn if unknown.
  if (!r.email) log.warn('switch.no-identity', { account: r.account });
  log.result(r.email ? t('activeNowEmail', r.account, r.email) : t('activeNow', r.account));
}

// Fetch per-account usage once up front (refreshes + persists expired tokens) so
// the menu can show bars without stalling on each redraw. Offline -> no bars.
async function loadUsage() {
  if (process.env.CLAUDE_ACCOUNTS_NO_USAGE) return {};
  const names = vault.list();
  if (!names.length) return {};
  const usage = require('./usage.js');
  process.stdout.write(`  ${t('usageLoading')}`);
  let map = {};
  try { map = await usage.getAll(names, vault.getCurrent()); } catch { /* offline -> no bars */ }
  process.stdout.write('\r\x1b[2K');
  return map;
}

async function runInteractiveMenu() {
  const { runMenu, confirm } = require('./menu.js');
  // Fetch usage once up front (refreshes expired tokens, persists them) so the
  // menu can show per-account bars without stalling on each redraw.
  const usage = await loadUsage();
  // Loop so management actions (add/remove) return to the menu. Only an explicit
  // account switch (or add+switch) returns 0, which is what makes the wrapper
  // launch claude afterwards; remove and cancel return without launching.
  for (;;) {
    const names = vault.list();
    const current = vault.getCurrent();
    const emails = emailMap(names);
    const choice = await runMenu(names, current, emails, { usage, autoswitch: config.autoswitch() });
    if (choice === null) { log.result(t('cancelled')); return 1; }
    if (choice === '__add__') {
      const { addAccount } = require('./login.js');
      const name = await prompt(t('promptName'));
      const r = await addAccount(name, {});
      if (!r.added) { log.result(addFailMessage(r)); return 1; }
      reportSwitch(switchAccount(name));
      return 0;
    }
    if (choice === '__autoswitch__') {
      await configureAutoswitch(names, current);
      continue;
    }
    if (choice === '__remove__') {
      if (!names.length) { log.result(t('nothingToRemove')); continue; }
      // Distinct destructive picker (no add/remove rows, red styling) so it can't
      // be mistaken for the switch menu, plus an explicit confirmation.
      const sub = await runMenu(names, current, emails, {
        title: t('removeTitle'), hint: t('removeHint'), withActions: false, danger: true, usage,
      });
      if (sub && await confirm(t('confirmRemove', sub))) {
        const r = vault.removeAccount(sub);
        log.result(r.removed ? t('removed', sub) : t('notFound', sub));
      }
      continue; // back to the main menu; never launch claude from a remove
    }
    reportSwitch(switchAccount(choice));
    return 0;
  }
}

// Autoswitch setup reached from the main menu: one fixed panel (primary,
// secondary, enable) that redraws in place. Persists the choice and wires the
// statusline + Stop hook when enabling.
async function configureAutoswitch(names, current) {
  const { runAutoswitchSetup } = require('./menu.js');
  if (names.length < 2) { log.result(t('asNeedTwo')); return; }
  const res = await runAutoswitchSetup(names, current, config.autoswitch());
  if (!res) return; // cancelled
  config.update((c) => ({
    ...c,
    autoswitch: {
      ...config.AUTOSWITCH_DEFAULTS, ...(c.autoswitch || {}),
      primary: res.primary, secondary: res.secondary, enabled: res.enabled,
    },
  }));
  if (res.enabled) {
    try { require('./wire.js').wire(); }
    catch (e) { log.warn('autoswitch.wire.failed', { err: e.message }); }
  }
  log.result(res.enabled ? t('asOnMsg', res.primary, res.secondary) : t('asOffMsg'));
}

// Non-interactive control: `autoswitch [status|wire|unwire|on|off]`.
function autoswitchCmd(rest) {
  const wire = require('./wire.js');
  const sub = rest[0] || 'status';
  if (sub === 'wire') {
    const r = wire.wire();
    log.result(`statusline wired: ${r.statusline}`);
    if (r.wrapped) log.result(`wrapping: ${r.wrapped}`);
    return 0;
  }
  if (sub === 'unwire') {
    const r = wire.unwire();
    log.result(r.restored ? `restored: ${r.restored}` : 'unwired');
    return 0;
  }
  if (sub === 'set') {
    const [primary, secondary] = rest.slice(1);
    const names = vault.list();
    if (!primary || !secondary) { log.result('usage: autoswitch set <primary> <secondary> [on]'); return 2; }
    if (!names.includes(primary)) { log.result(t('unknownVault', primary)); return 1; }
    if (!names.includes(secondary)) { log.result(t('unknownVault', secondary)); return 1; }
    if (primary === secondary) { log.result('primary and secondary must differ'); return 2; }
    const enable = rest.includes('on');
    config.update((c) => ({
      ...c,
      autoswitch: {
        ...config.AUTOSWITCH_DEFAULTS, ...(c.autoswitch || {}),
        primary, secondary,
        enabled: enable ? true : !!(c.autoswitch && c.autoswitch.enabled),
      },
    }));
    if (enable) { try { wire.wire(); } catch (e) { log.warn('autoswitch.wire.failed', { err: e.message }); } }
    const a = config.autoswitch();
    log.result(a.enabled ? t('asOnMsg', a.primary, a.secondary) : t('asStatus', a.primary, a.secondary, false));
    return 0;
  }
  if (sub === 'on' || sub === 'off') {
    config.update((c) => ({
      ...c,
      autoswitch: { ...config.AUTOSWITCH_DEFAULTS, ...(c.autoswitch || {}), enabled: sub === 'on' },
    }));
    if (sub === 'on') { try { wire.wire(); } catch (e) { log.warn('autoswitch.wire.failed', { err: e.message }); } }
    const a = config.autoswitch();
    log.result(a.enabled ? t('asOnMsg', a.primary, a.secondary) : t('asOffMsg'));
    return 0;
  }
  const a = config.autoswitch();
  const w = wire.status();
  log.result(t('asStatus', a.primary, a.secondary, a.enabled));
  log.result(`statusline: ${w.statuslineWired ? 'wired' : 'no'}   stop-hook: ${w.stopHookWired ? 'wired' : 'no'}`);
  const st = require('./autoswitch.js').readState();
  if (st && st.phase) log.result(`state: ${st.phase}${st.note ? '  ' + st.note : ''}`);
  return 0;
}

const cliArgv = log.stripFlags(process.argv.slice(2));
main(cliArgv)
  .then((code) => process.exit(code))
  .catch((e) => {
    const op = e.caStep ? ` (${e.caStep})` : '';
    process.stderr.write(`[claude-accounts]${op} ${e.message}\n`);
    if (log.level() >= log.LEVELS.DEBUG) {
      if (e.stack) process.stderr.write(e.stack + '\n');
      if (e.cause) process.stderr.write(`caused by: ${e.cause.stack || e.cause}\n`);
    }
    audit.fail('fatal', e, { reason: cliArgv[0] || null });
    process.exit(e.caExit || 1);
  });
