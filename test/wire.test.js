const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const { freshHome } = require('./helpers.js');
const wire = require('../src/wire.js');
const config = require('../src/config.js');

function writeSettings(obj) { fs.writeFileSync(wire.settingsPath(), JSON.stringify(obj, null, 2)); }
function readSettings() { return JSON.parse(fs.readFileSync(wire.settingsPath(), 'utf8')); }

test('wire captures an existing statusline and installs the composer + Stop hook', () => {
  freshHome();
  writeSettings({
    statusLine: { type: 'command', command: 'node other-usage.js' },
    hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node keep-me.js' }] }] },
  });

  wire.wire();

  const s = readSettings();
  assert.match(s.statusLine.command, /statusline\.js/, 'composer is now the statusline');
  assert.strictEqual(config.read().wrappedStatusline, 'node other-usage.js', 'original captured');

  const cmds = s.hooks.Stop.flatMap((g) => g.hooks.map((h) => h.command));
  assert.ok(cmds.some((c) => /hook-stop\.js/.test(c)), 'our Stop hook added');
  assert.ok(cmds.some((c) => /keep-me\.js/.test(c)), 'existing Stop hook preserved');

  const w = wire.status();
  assert.strictEqual(w.statuslineWired, true);
  assert.strictEqual(w.stopHookWired, true);
});

test('wire is idempotent: re-wiring never duplicates or overwrites the captured original', () => {
  freshHome();
  writeSettings({ statusLine: { type: 'command', command: 'node other-usage.js' } });
  wire.wire();
  wire.wire();

  const s = readSettings();
  const stopOurs = s.hooks.Stop.flatMap((g) => g.hooks).filter((h) => /hook-stop\.js/.test(h.command));
  assert.strictEqual(stopOurs.length, 1, 'no duplicate Stop hook');
  assert.strictEqual(config.read().wrappedStatusline, 'node other-usage.js', 'still the true original, not our composer');
});

test('unwire restores the captured statusline and removes only our Stop hook', () => {
  freshHome();
  writeSettings({
    statusLine: { type: 'command', command: 'node other-usage.js' },
    hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node keep-me.js' }] }] },
  });
  wire.wire();
  wire.unwire();

  const s = readSettings();
  assert.strictEqual(s.statusLine.command, 'node other-usage.js', 'original restored');
  const cmds = (s.hooks.Stop || []).flatMap((g) => g.hooks.map((h) => h.command));
  assert.ok(!cmds.some((c) => /hook-stop\.js/.test(c)), 'ours removed');
  assert.ok(cmds.some((c) => /keep-me\.js/.test(c)), 'other Stop hook kept');
});
