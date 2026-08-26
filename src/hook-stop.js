#!/usr/bin/env node
'use strict';
// Claude Code Stop hook: fires when Claude finishes a turn (goes idle). This is
// the graceful-swap moment — if the primary is armed (>= armAt) we move the live
// login to the secondary now, between turns, so a switch never lands mid-response
// unless it was already forced at the 99% threshold by the statusline.
//
// Silent and best-effort: reads and drains stdin, prints nothing, never blocks
// Claude from stopping, always exits 0. A hook that errors or emits decision JSON
// could stall the session, so every path here swallows and exits clean.
function run() {
  let input = '';
  const timeout = setTimeout(() => process.exit(0), 8000);
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => { input += c; });
  process.stdin.on('end', () => {
    clearTimeout(timeout);
    Promise.resolve()
      .then(() => require('./autoswitch.js').onIdle())
      .then(() => process.exit(0))
      .catch(() => process.exit(0));
  });
  process.stdin.on('error', () => process.exit(0));
}

if (require.main === module) run();
