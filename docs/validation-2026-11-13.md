# Backend hardening validation

Environment: Linux, Bun 1.4.4, and the official Codex CLI 0.167.2.
All integration accounts, tokens, OAuth responses, and model endpoints were local
fixtures. No real account login or external quota was used.

## Final results

`bun run test:all` completed all ten stages in 84.8 seconds:

- TypeScript checking.
- 29 unit tests across nine files, with 177 assertions.
- Generated plugin bundles.
- Isolated terminal interaction and terminal restoration.
- Official authentication and preserved conversation history.
- Manual switching, preferences, security, lifecycle, and logout.
- Autoswitch without continuation.
- Autoswitch with continuation in the same CLI process and conversation.
- Early/token reset continuation.
- Weekly reset waiting for five-hour capacity.

The manual integration now also seeds an uncertain authentication transition,
restarts the backend, verifies that another switch returns HTTP 409, and confirms
that explicit logout clears the transition marker. The fake-account vault is
preserved throughout this recovery.

New unit regressions cover login rejection versus uncertain outcomes, confirmed
identity reconciliation, corrupt claims, failed persistence without an in-memory
claim, draining accepted jobs, operation exclusion, sanitized bounded diagnostics,
invalid daemon response shapes, repeated pagination cursors, and cross-process
lock recovery after SIGKILL. The SQLite lock file retains mode 0600.

`bun run check`, the final `bun run build`, and `git diff --check` also passed.
The generated bundles under `marketplace/plugin/bin` are included in the changes.

## Observed intermittent failure

An earlier complete run failed the weekly-reset assertion because another model
request appeared before five-hour capacity was enabled. An isolated reproduction
passed, and the subsequent complete run passed. The root cause has not been
established; this is not reported as a fixed defect. The assertion remains in
place and now reports request counts, durable claim count, and turn count to
distinguish native-client retries from backend continuation on a future failure.

## Scope and limitations

The runtime was already Bun with TypeScript; these changes harden and modularize
that implementation. There is no new production dependency. SQLite is Bun's
built-in module and is used for mutation locking, not credential storage.

The installed personal plugin was not updated and the user's live daemon was not
restarted. Deployment requires the normal setup and hook-trust review procedure.
Stop older clients before changing the vault locking protocol.

No manual browser visual review, dynamic Codex-theme implementation, standalone
binary packaging, or macOS/Windows validation was performed. The daemon-side
idle-check/login race remains a protocol limitation; see `architecture.md`.

## Installed CLI and TUI command

The subsequent installer change adds `./install.sh` and `bun run install:cli`.
`bun run setup` now also installs the manager command before registering the
plugin. The installed command uses a copied marketplace release and an executable
launcher; it does not depend on the source checkout's location or alter `codex`.

The final `bun run test:all` completed all eleven stages in 85.7 seconds, including
the new installed-command stage and the same 29 unit tests. `sh -n install.sh`
and `git diff --check` passed. The installer has executable mode 0755.

The new integration installs into temporary paths containing spaces and apostrophes,
runs help and list from another working directory, updates a managed launcher,
refuses to overwrite an unrelated executable, checks redirected-input behavior,
and opens/exits the installed command's default TUI through a PTY and fake IPC
backend. No personal installation, shell startup file, or real account was changed.
