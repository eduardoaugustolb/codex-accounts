#!/usr/bin/env node
'use strict';
// Composer statusline. Runs whatever statusline you already had (captured at
// wiring time as config.wrappedStatusline) with the SAME stdin, then appends the
// autoswitch segment on the right. Your usage bar stays intact; the switch state
// shows only when relevant. Never throws: on any failure it prints the wrapped
// output alone (or nothing), so it can't break your status bar.
const config = require('./config.js');

const ACCENT = '\x1b[38;2;215;119;87m';
const DIM = '\x1b[2m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

function colorFor(note) {
  return /reinicie|restart|failed|falhou/.test(note) ? RED : ACCENT;
}

// Run the previously-configured statusline as a child, feeding it the payload and
// capturing its stdout. A guard skips it if it somehow points back at us (no
// recursion). Bounded so a hung child can't hang the bar.
function runWrapped(cmd, input) {
  return new Promise((resolve) => {
    if (!cmd || String(cmd).includes('statusline.js')) return resolve('');
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    try {
      const child = require('node:child_process').spawn(cmd, { shell: true, windowsHide: true });
      let out = '';
      const timer = setTimeout(() => { try { child.kill(); } catch {} finish(out); }, 2800);
      child.stdout.on('data', (d) => { out += d.toString(); });
      child.on('error', () => { clearTimeout(timer); finish(''); });
      child.on('close', () => { clearTimeout(timer); finish(out); });
      child.stdin.on('error', () => {});
      child.stdin.write(input);
      child.stdin.end();
    } catch { finish(''); }
  });
}

async function main(input) {
  let data = {};
  try { data = JSON.parse(input); } catch { /* keep {} */ }
  const cfg = config.read();

  const wrapped = await runWrapped(cfg.wrappedStatusline, input);

  let segment = '';
  try {
    const { note } = await require('./autoswitch.js').tick(data.rate_limits || null);
    if (note) segment = ` ${DIM}│${RESET} ${colorFor(note)}${note}${RESET}`;
  } catch { /* an autoswitch fault must never blank the usage bar */ }

  process.stdout.write((wrapped || '') + segment);
}

function run() {
  let input = '';
  const timeout = setTimeout(() => process.exit(0), 4000);
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => { input += c; });
  process.stdin.on('end', () => {
    clearTimeout(timeout);
    main(input).then(() => process.exit(0)).catch(() => process.exit(0));
  });
  process.stdin.on('error', () => process.exit(0));
}

if (require.main === module) run();
module.exports = { main, runWrapped, colorFor };
