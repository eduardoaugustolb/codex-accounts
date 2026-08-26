'use strict';
const { t } = require('./i18n.js');

// Claude-ish terracotta accent (truecolor). Falls back gracefully on terminals
// that ignore SGR — text still readable, just uncolored.
const ACCENT = '\x1b[38;2;215;119;87m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

function accent(s) { return `${ACCENT}${s}${RESET}`; }
function accentBold(s) { return `${ACCENT}${BOLD}${s}${RESET}`; }
function dim(s) { return `${DIM}${s}${RESET}`; }
function red(s) { return `${RED}${s}${RESET}`; }

// Two-tone bar: accent for the filled portion, dim for the rest. Claude's /usage
// look, scaled to fit beside an account row.
function bar(pct, width = 10) {
  const filled = Math.max(0, Math.min(width, Math.round((pct / 100) * width)));
  return `${ACCENT}${'█'.repeat(filled)}${RESET}${DIM}${'░'.repeat(width - filled)}${RESET}`;
}

// Compact relative reset, e.g. "42m", "3h09m", "5d 4h". Returns t('usageNow')
// once the window has rolled over.
function fmtReset(ms) {
  if (!ms) return '';
  const d = ms - Date.now();
  if (d <= 0) return t('usageNow');
  const mins = Math.floor(d / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h${String(mins % 60).padStart(2, '0')}m`;
  const days = Math.floor(hrs / 24);
  const remH = hrs % 24;
  return `${days}d${remH ? ` ${remH}h` : ''}`;
}

// Inline usage segment drawn on the SAME line as the account, e.g.
//   5h ██████░░ 62% ·3h08m   7d █░░░░░░░ 6% ·6d
// `u` is the per-account result from usage.getAll; missing/failed accounts get a
// dim placeholder so the column stays aligned.
function usageInline(u) {
  if (!u) return '';
  if (!u.ok) return dim(t('usageUnavailable'));
  const seg = (label, lim) => {
    if (!lim) return '';
    const pct = Math.round(lim.pct);
    const pctStr = `${pct}%`.padStart(4);
    const pctCol = pct >= 90 ? red(pctStr) : accent(pctStr);
    const reset = lim.resetsAt ? ` ${dim(`·${fmtReset(lim.resetsAt)}`)}` : '';
    return `${dim(label)} ${bar(lim.pct, 8)} ${pctCol}${reset}`;
  };
  return [seg('5h', u.session), seg('7d', u.week)].filter(Boolean).join('   ');
}

function buildItems(names, current, emails = {}, withActions = true) {
  const accounts = names.map((n) => ({
    label: n, value: n, current: n === current, email: emails[n] || '',
  }));
  if (!withActions) return accounts;
  return [
    ...accounts,
    { label: t('menuAutoswitch'), value: '__autoswitch__', current: false, email: '' },
    { label: t('menuAdd'), value: '__add__', current: false, email: '' },
    { label: t('menuRemove'), value: '__remove__', current: false, email: '' },
  ];
}

function reduceKey(state, key) {
  const { idx, n } = state;
  if (key === 'up') return { ...state, idx: (idx - 1 + n) % n };
  if (key === 'down') return { ...state, idx: (idx + 1) % n };
  if (key === 'enter') return { ...state, done: 'select' };
  if (key === 'escape') return { ...state, done: 'cancel' };
  return state;
}

function renderLines(items, idx, opts = {}) {
  const title = opts.title || t('menuTitle');
  const hint = opts.hint || t('menuHint');
  const danger = !!opts.danger;
  const usage = opts.usage || null;
  const as = opts.autoswitch || null; // { primary, secondary, enabled }
  const names = items.filter((it) => !it.value.startsWith('__'));
  const labelW = names.reduce((m, it) => Math.max(m, it.label.length), 0);
  const mailW = names.reduce((m, it) => Math.max(m, (it.email || '').length), 0);
  // Reserve a fixed-width column for the active tag so the usage bars line up
  // whether or not a given row carries the "● active" badge.
  const tagPlain = `● ${t('menuActive')}`;
  // The autoswitch role tag (primary/secondary): accent when autoswitch is on,
  // dim when the pair is set but off. Reserved to a fixed column so bars align.
  const roleLabel = (v) => {
    if (!as) return '';
    if (as.primary === v) return t('asRolePrimary');
    if (as.secondary === v) return t('asRoleSecondary');
    return '';
  };
  const roleW = names.reduce((m, it) => Math.max(m, roleLabel(it.value).length), 0);
  const roleStyle = as && as.enabled ? accent : dim;
  const roleCell = (v) => {
    if (!roleW) return '';
    const r = roleLabel(v);
    const pad = ' '.repeat(roleW - r.length);
    return `   ${r ? roleStyle(r) + pad : ' '.repeat(roleW)}`;
  };
  // Use the padded (column) layout for ALL rows whenever ANY account has usage or
  // a role tag, so a row without either doesn't fall back to a narrower layout.
  const anyUsage = !!usage && names.some((it) => usageInline(usage[it.value]) !== '');
  const useCols = anyUsage || roleW > 0;
  const lines = ['', `  ${danger ? red(title) : accentBold(title)}`, ''];

  items.forEach((it, i) => {
    const isAction = it.value.startsWith('__');
    // One blank line separates the account list from the action group, before
    // whichever action row comes first (autoswitch/add/remove).
    if (isAction && !(i > 0 && items[i - 1].value.startsWith('__'))) lines.push('');
    const selected = i === idx;
    const pointer = selected ? (danger ? red('❯') : accent('❯')) : ' ';
    if (isAction) {
      let lbl = it.label;
      // Show autoswitch state inline on its row (no glyph, matches +/- rows).
      if (it.value === '__autoswitch__' && as && as.primary && as.secondary) {
        lbl = `${it.label}  ${as.enabled ? t('asOn') : t('asOff')}`;
      }
      const text = selected ? accent(lbl) : dim(lbl);
      lines.push(`  ${pointer} ${text}`);
    } else {
      const padded = it.label.padEnd(labelW);
      const label = selected ? (danger ? red(padded) : accentBold(padded)) : padded;
      const usageStr = usage ? usageInline(usage[it.value]) : '';
      if (useCols) {
        const mailCell = mailW ? `  ${dim((it.email || '').padEnd(mailW))}` : '';
        const tagCell = `   ${it.current ? accent(tagPlain) : ' '.repeat(tagPlain.length)}`;
        const uCell = usageStr ? `   ${usageStr}` : '';
        lines.push(`  ${pointer} ${label}${mailCell}${roleCell(it.value)}${tagCell}${uCell}`);
      } else {
        const mail = it.email ? `  ${dim(it.email)}` : '';
        const tag = it.current ? `   ${accent(tagPlain)}` : '';
        lines.push(`  ${pointer} ${label}${mail}${tag}`);
      }
    }
  });

  lines.push('');
  lines.push(`  ${dim(hint)}`);
  return lines;
}

function keyOf(s) {
  if (s === '\x1b[A' || s === 'k') return 'up';
  if (s === '\x1b[B' || s === 'j') return 'down';
  if (s === '\r' || s === '\n') return 'enter';
  if (s === '\x1b' || s === '\x03') return 'escape';
  return null;
}

// Shared raw-mode interactive loop. `view()` returns the lines to draw; `onKey`
// returns { value } to finish (resolving with value) or a falsy value to keep
// going. On exit it drains any buffered keystrokes and restores the terminal,
// so a fast keypress can't leak an echoed escape sequence between two views.
function interact(view, onKey) {
  return new Promise((resolve) => {
    const out = process.stdout;
    const stdin = process.stdin;
    let height = 0;

    const draw = () => {
      const lines = view();
      if (height > 0) out.write(`\x1b[${height}A`); // back to top of previous draw
      out.write(lines.map((l) => `\r\x1b[2K${l}`).join('\n'));
      height = lines.length - 1;
    };

    const cleanup = () => {
      stdin.removeListener('data', onData);
      stdin.pause();
      try { while (stdin.read() !== null) { /* drain buffered input */ } } catch (_) {}
      stdin.setRawMode(false);
      out.write(`\x1b[${height + 1}B\r\x1b[?25h\n`);
    };

    const onData = (buf) => {
      const key = keyOf(buf.toString());
      if (!key) return;
      const r = onKey(key);
      if (r && 'value' in r) { cleanup(); resolve(r.value); return; }
      draw();
    };

    out.write('\x1b[?25l');
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
    draw();
  });
}

// Account picker. opts: { title, hint, danger, withActions }. Defaults render the
// switch menu; pass withActions:false + danger:true for the remove picker.
function runMenu(names, current, emails = {}, opts = {}) {
  const items = buildItems(names, current, emails, opts.withActions !== false);
  let state = { idx: Math.max(0, names.indexOf(current)), n: items.length };
  return interact(
    () => renderLines(items, state.idx, opts),
    (key) => {
      state = reduceKey(state, key);
      if (state.done === 'select') return { value: items[state.idx].value };
      if (state.done === 'cancel') return { value: null };
      return null;
    },
  );
}

// Yes/no confirmation. Defaults to "no" and destructive (red) styling. Resolves
// true only on an explicit Yes; esc/ctrl-c resolve false.
function confirm(message, opts = {}) {
  const danger = opts.danger !== false;
  const labels = [t('confirmNo'), t('confirmYes')];
  let state = { idx: 0, n: labels.length }; // default to the safe choice
  const view = () => {
    const lines = ['', `  ${danger ? red(message) : accentBold(message)}`, ''];
    labels.forEach((label, i) => {
      const selected = i === state.idx;
      const pointer = selected ? (danger && i === 1 ? red('❯') : accent('❯')) : ' ';
      const text = !selected ? dim(label) : ((danger && i === 1) ? red(label) : accentBold(label));
      lines.push(`  ${pointer} ${text}`);
    });
    lines.push('');
    lines.push(`  ${dim(t('confirmHint'))}`);
    return lines;
  };
  // Same reducer the account menu uses; for a two-item list up/down just toggle.
  return interact(view, (key) => {
    state = reduceKey(state, key);
    if (state.done === 'select') return { value: state.idx === 1 };
    if (state.done === 'cancel') return { value: false };
    return null;
  });
}

function cycleValue(arr, cur, dir) {
  if (!arr.length) return cur;
  const i = Math.max(0, arr.indexOf(cur));
  return arr[(i + dir + arr.length) % arr.length];
}

// Pure reducer for the autoswitch setup panel (mirrors reduceKey). Fields are
// stepped 0=primary, 1=secondary, 2=enable. up/down cycles the active field;
// enter advances then confirms; esc steps back then cancels. On finish it sets
// { finished:true, result } where result is { primary, secondary, enabled } or
// null (cancel). Keeps secondary != primary as primary changes.
function reduceAutoswitchSetup(state, key, names) {
  const secOptions = names.filter((n) => n !== state.primary);
  if (key === 'up' || key === 'down') {
    const dir = key === 'down' ? 1 : -1;
    if (state.step === 0) {
      const primary = cycleValue(names, state.primary, dir);
      const so = names.filter((n) => n !== primary);
      const secondary = so.includes(state.secondary) ? state.secondary : so[0];
      return { ...state, primary, secondary };
    }
    if (state.step === 1) return { ...state, secondary: cycleValue(secOptions, state.secondary, dir) };
    return { ...state, enabled: !state.enabled };
  }
  if (key === 'enter') {
    if (state.step < 2) return { ...state, step: state.step + 1 };
    return { ...state, finished: true, result: { primary: state.primary, secondary: state.secondary, enabled: state.enabled } };
  }
  if (key === 'escape') {
    if (state.step > 0) return { ...state, step: state.step - 1 };
    return { ...state, finished: true, result: null };
  }
  return state;
}

// Seed the panel state from the stored config (or sensible defaults).
function autoswitchSetupInit(names, current, cfg = {}) {
  const primary = cfg.primary && names.includes(cfg.primary) ? cfg.primary
    : (current && names.includes(current) ? current : names[0]);
  const so = names.filter((n) => n !== primary);
  const secondary = cfg.secondary && so.includes(cfg.secondary) ? cfg.secondary : so[0];
  return { step: 0, primary, secondary, enabled: cfg.enabled !== false };
}

// Single fixed-panel autoswitch setup: a 3-field form that redraws in place
// instead of stacking a new menu per choice. Resolves { primary, secondary,
// enabled } or null on cancel.
function runAutoswitchSetup(names, current, cfg = {}) {
  let state = autoswitchSetupInit(names, current, cfg);
  const view = () => {
    const rows = [
      { label: t('asFieldPrimary'), value: state.primary },
      { label: t('asFieldSecondary'), value: state.secondary },
      { label: t('asFieldEnable'), value: state.enabled ? t('asYes') : t('asNo') },
    ];
    const fw = rows.reduce((m, r) => Math.max(m, r.label.length), 0);
    const lines = ['', `  ${accentBold(t('asSetupTitle'))}`, ''];
    rows.forEach((r, i) => {
      const active = i === state.step;
      const pointer = active ? accent('❯') : ' ';
      const label = (active ? accentBold : dim)(r.label.padEnd(fw));
      const value = active ? accent(r.value) : dim(r.value);
      lines.push(`  ${pointer} ${label}   ${value}`);
    });
    lines.push('');
    lines.push(`  ${dim(t('asSetupHint'))}`);
    return lines;
  };
  return interact(view, (key) => {
    state = reduceAutoswitchSetup(state, key, names);
    if (state.finished) return { value: state.result };
    return null;
  });
}

module.exports = {
  buildItems, reduceKey, renderLines, runMenu, confirm, runAutoswitchSetup,
  reduceAutoswitchSetup, autoswitchSetupInit, bar, fmtReset, usageInline,
};
