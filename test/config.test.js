const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { freshHome } = require('./helpers.js');
const config = require('../src/config.js');
const p = require('../src/paths.js');

test('autoswitch() returns defaults when unset', () => {
  freshHome();
  const a = config.autoswitch();
  assert.strictEqual(a.enabled, false);
  assert.strictEqual(a.armAt, 95);
  assert.strictEqual(a.forceAt, 99);
  assert.strictEqual(a.recoverBelow, 50);
});

test('update merges and never drops sibling keys (lang survives autoswitch write)', () => {
  freshHome();
  fs.mkdirSync(p.coreDir(), { recursive: true });
  fs.writeFileSync(p.configPath(), JSON.stringify({ lang: 'pt' }));

  config.update((c) => ({ ...c, autoswitch: { ...config.AUTOSWITCH_DEFAULTS, primary: 'a', secondary: 'b', enabled: true } }));

  const raw = JSON.parse(fs.readFileSync(p.configPath(), 'utf8'));
  assert.strictEqual(raw.lang, 'pt', 'lang must survive');
  assert.strictEqual(raw.autoswitch.primary, 'a');
  assert.strictEqual(raw.autoswitch.enabled, true);
});

test('read tolerates a missing or corrupt config', () => {
  freshHome();
  assert.deepStrictEqual(config.read(), {});
  fs.mkdirSync(p.coreDir(), { recursive: true });
  fs.writeFileSync(p.configPath(), '{ not json');
  assert.deepStrictEqual(config.read(), {});
});
