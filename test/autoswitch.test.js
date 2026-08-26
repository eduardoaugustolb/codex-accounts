const { test } = require('node:test');
const assert = require('node:assert');
const as = require('../src/autoswitch.js');

const CFG = { enabled: true, primary: 'P', secondary: 'S', armAt: 95, forceAt: 99, recoverBelow: 50 };

test('decide: disabled or unconfigured -> off, never swaps', () => {
  assert.deepStrictEqual(as.decide({ enabled: false }, { active: 'P', trigger: 'tick' }).swap, null);
  assert.strictEqual(as.decide({ enabled: false }, { active: 'P', trigger: 'tick' }).phase, 'off');
  const noSecondary = { ...CFG, secondary: null };
  assert.strictEqual(as.decide(noSecondary, { active: 'P', trigger: 'tick' }).phase, 'off');
});

test('decide: a manual switch to a third account pauses autoswitch', () => {
  const d = as.decide(CFG, { active: 'other', trigger: 'tick', activePct: 100 });
  assert.strictEqual(d.phase, 'paused');
  assert.strictEqual(d.swap, null);
});

test('decide: on primary below arm threshold is quiet', () => {
  const d = as.decide(CFG, { active: 'P', trigger: 'tick', activePct: 80 });
  assert.strictEqual(d.phase, 'normal');
  assert.strictEqual(d.swap, null);
  assert.strictEqual(d.note, '');
});

test('decide: armed at 95..99 on a tick warns but does not swap', () => {
  const d = as.decide(CFG, { active: 'P', trigger: 'tick', activePct: 96 });
  assert.strictEqual(d.phase, 'armed');
  assert.strictEqual(d.swap, null);
  assert.match(d.note, /S/);
});

test('decide: armed at 95..99 swaps gracefully when idle (Stop)', () => {
  const d = as.decide(CFG, { active: 'P', trigger: 'idle', activePct: 96 });
  assert.deepStrictEqual(d.swap, { to: 'S', force: false });
});

test('decide: at 99+ forces a live swap even on a tick', () => {
  const d = as.decide(CFG, { active: 'P', trigger: 'tick', activePct: 99 });
  assert.deepStrictEqual(d.swap, { to: 'S', force: true });
});

test('decide: at 99+ still forces on idle', () => {
  const d = as.decide(CFG, { active: 'P', trigger: 'idle', activePct: 100 });
  assert.deepStrictEqual(d.swap, { to: 'S', force: true });
});

test('decide: on secondary, primary still high -> stay, no swap', () => {
  const d = as.decide(CFG, { active: 'S', trigger: 'idle', primaryPct: 80, primaryReset: Date.now() + 3600_000 });
  assert.strictEqual(d.phase, 'on_secondary');
  assert.strictEqual(d.swap, null);
});

test('decide: on secondary, primary recovered -> arm on tick, swap on idle', () => {
  const armed = as.decide(CFG, { active: 'S', trigger: 'tick', primaryPct: 20 });
  assert.strictEqual(armed.phase, 'recover_armed');
  assert.strictEqual(armed.swap, null);
  const back = as.decide(CFG, { active: 'S', trigger: 'idle', primaryPct: 20 });
  assert.deepStrictEqual(back.swap, { to: 'P', force: false });
});

test('decide: missing primaryPct on secondary keeps you put (no false recovery)', () => {
  const d = as.decide(CFG, { active: 'S', trigger: 'idle', primaryPct: null });
  assert.strictEqual(d.swap, null);
  assert.strictEqual(d.phase, 'on_secondary');
});

test('bindingFromStatusline picks the closest-to-cap window and converts secs->ms', () => {
  const b = as.bindingFromStatusline({
    five_hour: { used_percentage: 40, resets_at: 1000 },
    seven_day: { used_percentage: 88, resets_at: 2000 },
  });
  assert.strictEqual(b.pct, 88);
  assert.strictEqual(b.resetsAt, 2000 * 1000);
});

test('bindingFromUsage picks the max of session/week', () => {
  const b = as.bindingFromUsage({ session: { pct: 12, resetsAt: 5 }, week: { pct: 71, resetsAt: 9 } });
  assert.strictEqual(b.pct, 71);
  assert.strictEqual(b.resetsAt, 9);
});

test('bindings degrade to null when no window data', () => {
  assert.strictEqual(as.bindingFromStatusline({}).pct, null);
  assert.strictEqual(as.bindingFromUsage({}).pct, null);
});
