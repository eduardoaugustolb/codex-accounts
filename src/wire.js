'use strict';
// Wire (and unwire) the autoswitch statusline + Stop hook into
// ~/.claude/settings.json. Cooperates with any statusline you already run: the
// previous statusLine.command is captured into config.wrappedStatusline and the
// composer replays it, so there is no hard dependency on XClaudeUsage or any
// specific tool. Commands point at the scripts next to THIS file (__dirname), so
// wiring works both from a dev checkout and from the installed core.
const fs = require('node:fs');
const path = require('node:path');
const p = require('./paths.js');
const config = require('./config.js');
const { atomicWrite } = require('./fsutil.js');

function settingsPath() { return path.join(p.claudeDir(), 'settings.json'); }
function scriptCmd(file) { return `node "${path.join(__dirname, file).replace(/\\/g, '/')}"`; }
function statuslineCmd() { return scriptCmd('statusline.js'); }
function stopHookCmd() { return scriptCmd('hook-stop.js'); }

function isOurStatusline(cmd) { return typeof cmd === 'string' && cmd.includes('statusline.js'); }
function isOurStopHook(cmd) { return typeof cmd === 'string' && cmd.includes('hook-stop.js'); }

function readSettings() {
  try { return JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) || {}; } catch { return {}; }
}
function backupThenWrite(file, obj) {
  if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak-${Date.now()}`);
  atomicWrite(file, JSON.stringify(obj, null, 2));
}

// Install the composer as the statusline (capturing whatever was there) and add a
// Stop-hook group if absent. Idempotent: re-running never nests our command or
// clobbers the captured original with our own composer.
function wire() {
  const file = settingsPath();
  const s = readSettings();

  const prev = s.statusLine && s.statusLine.command;
  if (prev && !isOurStatusline(prev)) {
    config.update((c) => ({ ...c, wrappedStatusline: prev }));
  }
  s.statusLine = { type: 'command', command: statuslineCmd() };

  s.hooks = s.hooks || {};
  const stop = Array.isArray(s.hooks.Stop) ? s.hooks.Stop : [];
  const already = stop.some((g) => (g.hooks || []).some((h) => isOurStopHook(h.command)));
  if (!already) stop.push({ hooks: [{ type: 'command', command: stopHookCmd(), timeout: 12 }] });
  s.hooks.Stop = stop;

  backupThenWrite(file, s);
  return { statusline: statuslineCmd(), wrapped: config.read().wrappedStatusline || null };
}

// Restore the captured statusline and drop our Stop-hook group. Leaves everyone
// else's hooks untouched.
function unwire() {
  const file = settingsPath();
  const s = readSettings();
  const wrapped = config.read().wrappedStatusline;

  if (s.statusLine && isOurStatusline(s.statusLine.command)) {
    if (wrapped) s.statusLine = { type: 'command', command: wrapped };
    else delete s.statusLine;
  }
  if (s.hooks && Array.isArray(s.hooks.Stop)) {
    s.hooks.Stop = s.hooks.Stop
      .map((g) => ({ ...g, hooks: (g.hooks || []).filter((h) => !isOurStopHook(h.command)) }))
      .filter((g) => (g.hooks || []).length > 0);
    if (!s.hooks.Stop.length) delete s.hooks.Stop;
  }
  backupThenWrite(file, s);
  return { restored: wrapped || null };
}

function status() {
  const s = readSettings();
  const stopWired = !!(s.hooks && Array.isArray(s.hooks.Stop)
    && s.hooks.Stop.some((g) => (g.hooks || []).some((h) => isOurStopHook(h.command))));
  return {
    statuslineWired: !!(s.statusLine && isOurStatusline(s.statusLine.command)),
    stopHookWired: stopWired,
    wrapped: config.read().wrappedStatusline || null,
  };
}

module.exports = {
  wire, unwire, status, settingsPath,
  statuslineCmd, stopHookCmd, isOurStatusline, isOurStopHook,
};
