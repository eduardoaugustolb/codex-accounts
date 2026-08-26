const { test } = require('node:test');
const assert = require('node:assert');
const {
  buildItems, reduceKey, renderLines, runMenu, confirm,
  reduceAutoswitchSetup, autoswitchSetupInit,
} = require('../src/menu.js');
const { t } = require('../src/i18n.js');

test('buildItems lists accounts then autoswitch/add/remove actions', () => {
  const items = buildItems(['work', 'home'], 'work');
  assert.deepStrictEqual(items.map((i) => i.value), ['work', 'home', '__autoswitch__', '__add__', '__remove__']);
  assert.strictEqual(items[0].current, true);
  assert.strictEqual(items[1].current, false);
});

test('buildItems without actions lists only accounts (remove picker)', () => {
  const items = buildItems(['work', 'home'], 'work', {}, false);
  assert.deepStrictEqual(items.map((i) => i.value), ['work', 'home']);
});

test('renderLines honors a custom title and hint for the remove picker', () => {
  const items = buildItems(['work'], 'work', {}, false);
  const out = renderLines(items, 0, { title: 'Remover conta', hint: 'enter remover', danger: true }).join('\n');
  assert.match(out, /Remover conta/);
  assert.match(out, /enter remover/);
  assert.doesNotMatch(out, /Claude Accounts/);
});

test('runMenu and confirm are exported callables', () => {
  assert.strictEqual(typeof runMenu, 'function');
  assert.strictEqual(typeof confirm, 'function');
});

test('renderLines draws a usage bar when usage data is provided', () => {
  const items = buildItems(['work'], 'work', { work: 'w@x.com' });
  const out = renderLines(items, 0, {
    usage: { work: { ok: true, session: { pct: 50, resetsAt: null }, week: null } },
  }).join('\n');
  assert.match(out, /█/);    // filled bar segment
  assert.match(out, /50%/);  // percentage label
});

test('renderLines keeps every row on the bar layout when ANY account has usage (alignment)', () => {
  const items = buildItems(['aa', 'bb'], 'aa', { aa: 'aa@x.com', bb: 'bb@x.com' });
  const usage = {
    aa: { ok: true, session: { pct: 50, resetsAt: null }, week: null },
    bb: { ok: true, session: null, week: null }, // ok but empty -> usageInline ''
  };
  const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
  const lines = renderLines(items, 0, { usage }).map(strip);
  const colA = lines.find((l) => l.includes('aa@x.com')).indexOf('aa@x.com');
  const colB = lines.find((l) => l.includes('bb@x.com')).indexOf('bb@x.com');
  assert.strictEqual(colA, colB, 'email column must align across data and empty-usage rows');
});

test('buildItems attaches emails when provided', () => {
  const items = buildItems(['work'], 'work', { work: 'w@x.com' });
  assert.strictEqual(items[0].email, 'w@x.com');
});

test('renderLines shows title, email, active tag and pointer', () => {
  const items = buildItems(['work'], 'work', { work: 'w@x.com' });
  const out = renderLines(items, 0).join('\n');
  assert.match(out, /Claude Accounts/);
  assert.match(out, /w@x\.com/);
  assert.match(out, /●/); // active marker, language-independent
  assert.match(out, /❯/);
});

test('autoswitchSetupInit seeds from config and keeps secondary != primary', () => {
  const s = autoswitchSetupInit(['a', 'b', 'c'], 'b', { primary: 'a', secondary: 'a', enabled: true });
  assert.strictEqual(s.primary, 'a');
  assert.notStrictEqual(s.secondary, 'a');
  assert.strictEqual(s.step, 0);
});

test('reduceAutoswitchSetup cycling primary re-validates secondary', () => {
  let s = { step: 0, primary: 'a', secondary: 'b', enabled: true };
  s = reduceAutoswitchSetup(s, 'down', ['a', 'b', 'c']); // primary a -> b
  assert.strictEqual(s.primary, 'b');
  assert.notStrictEqual(s.secondary, 'b'); // secondary must move off the new primary
});

test('reduceAutoswitchSetup: enter advances then confirms; esc steps back then cancels', () => {
  const names = ['a', 'b', 'c'];
  let s = { step: 0, primary: 'a', secondary: 'b', enabled: true };
  s = reduceAutoswitchSetup(s, 'enter', names);
  assert.strictEqual(s.step, 1);
  s = reduceAutoswitchSetup(s, 'escape', names);
  assert.strictEqual(s.step, 0);
  s = reduceAutoswitchSetup(s, 'escape', names); // cancel on the first field
  assert.strictEqual(s.finished, true);
  assert.strictEqual(s.result, null);
});

test('reduceAutoswitchSetup: toggling enable and confirming returns the pair', () => {
  const names = ['a', 'b'];
  let s = { step: 2, primary: 'a', secondary: 'b', enabled: true };
  s = reduceAutoswitchSetup(s, 'down', names); // toggle enable off
  assert.strictEqual(s.enabled, false);
  s = reduceAutoswitchSetup(s, 'enter', names);
  assert.deepStrictEqual(s.result, { primary: 'a', secondary: 'b', enabled: false });
});

test('renderLines shows primary/secondary role tags and the autoswitch state', () => {
  const items = buildItems(['work', 'home'], 'work', { work: 'w@x.com', home: 'h@x.com' });
  const out = renderLines(items, 0, { autoswitch: { primary: 'home', secondary: 'work', enabled: true } }).join('\n');
  assert.match(out, new RegExp(t('asRolePrimary')));
  assert.match(out, new RegExp(t('asRoleSecondary')));
  assert.match(out, new RegExp(`autoswitch  ${t('asOn')}`));
});

test('reduceKey moves selection and wraps', () => {
  const n = 4;
  assert.strictEqual(reduceKey({ idx: 0, n }, 'up').idx, 3);
  assert.strictEqual(reduceKey({ idx: 3, n }, 'down').idx, 0);
  assert.strictEqual(reduceKey({ idx: 1, n }, 'up').idx, 0);
  assert.deepStrictEqual(reduceKey({ idx: 2, n }, 'enter'), { idx: 2, n, done: 'select' });
  assert.deepStrictEqual(reduceKey({ idx: 2, n }, 'escape'), { idx: 2, n, done: 'cancel' });
});
