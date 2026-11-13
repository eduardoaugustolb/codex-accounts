# Troubleshooting

## Codex opens but the startup never finishes

**Symptom.** The Codex terminal interface appears and then stops loading. After the
alternate screen is cleared, the CLI prints:

```
Error: app server did not become ready on
/home/<user>/.codex/app-server-control/app-server-control.sock
```

The same failure blocks the plugin hooks, because every hook event needs the shared
App Server.

**Root cause.** The App Server is started by the managed daemon
(`codex app-server daemon start`). The daemon publishes its control socket at
`~/.codex/app-server-control/app-server-control.sock`, a symlink into
`$TMPDIR/codex-daemon-<uid>/`. The daemon also spawns a long-lived
`codex app-server daemon pid-update-loop` helper that keeps the managed runtime
(open file descriptors) alive.

`codex app-server daemon stop` stops the daemon but **does not stop the
`pid-update-loop` helper**. Every integration scenario in this repository starts a
managed daemon inside a temporary `CODEX_HOME` and then deletes that directory.
If the helper survives, it keeps the deleted runtime open, so the temporary
filesystem still holds the whole runtime (~130 MB per leaked helper).

When the temporary filesystem fills up, the daemon can no longer create and publish
its socket. The published symlink then points to a socket file that no longer
exists, the CLI cannot reach the App Server, and startup never completes. The
symptom looks like a broken CLI, but the CLI and the daemon are fine.

**Diagnosis.**

```bash
df -h /tmp                 # the temporary filesystem must be far from 100%
ps -eo pid,cmd | grep pid-update-loop
ls -l ~/.codex/app-server-control/app-server-control.sock
readlink -f ~/.codex/app-server-control/app-server-control.sock   # target must exist
```

A healthy control socket resolves to an existing path. A dangling symlink, or a
`pid-update-loop` helper whose command line points to a deleted temporary
directory, confirms the leak.

**Recovery.**

```bash
# 1. Stop the leaked helpers of previous test runs.
pkill -f "codex-native-account-case"

# 2. Remove the stale symlink and the daemon pid files so the daemon republishes them.
rm -f ~/.codex/app-server-control/app-server-control.sock \
      ~/.codex/app-server-daemon/daemon.pid \
      ~/.codex/app-server-daemon/daemon-updater.pid

# 3. Start Codex again; it starts a fresh daemon and republishes the socket.
codex
```

If the temporary filesystem is still full, find the deleted-but-open files that
consume it:

```bash
lsof +L1 | awk '$7 > 100000 {print $1, $2, $7, $9}' | sort -k3 -n | tail
```

**Prevention in this repository.**

- `tools/native-cli-case.ts` stops the managed daemon _and_ the
  `pid-update-loop` helper. `stopManagedDaemon()` reads `daemon-updater.pid` and
  `daemon.pid` from the isolated `CODEX_HOME`, confirms through
  `/proc/<pid>/cmdline` that the process belongs to that isolated home, and then
  terminates it with `SIGTERM`, escalating to `SIGKILL`.
- `tools/test-suite.ts` fails the suite when a managed daemon helper survives a
  scenario or when the temporary filesystem has less than 512 MB free before the
  run. Leaked helpers are a defect in the scenario, not something to ignore.
- Prefer `TMPDIR` on a filesystem with real free space when running the suite on
  a machine with a small tmpfs.

**Do not** work around this by deleting `~/.codex` or the App Server runtime
directory while the daemon is running. Restart the daemon through the documented
flow instead; the runtime is downloaded again on demand.
