# Architecture

The project uses Bun and TypeScript throughout. No language or runtime migration
is necessary. The backend remains a single local process; services are separated
where independent tests and explicit failure contracts improve reliability.

## Boundaries

- `rpc.ts`: Unix WebSocket and isolated JSONL transports. RPC errors distinguish
  rejection, unavailable transport, and an unknown outcome after timeout/disconnect.
- `codex-session.ts`: validated conversation queries, pagination, thread states,
  and latest-turn data. Unsupported states fail closed.
- `auth-transition.ts`: login outcome policy, including reconciliation before
  rollback. An uncertain request is never automatically resubmitted.
- `backend-state.ts`: atomic, synced JSON persistence, continuation claims,
  named local operations, accepted-job draining, and bounded in-memory diagnostics.
- `store.ts`: credential vault and cross-process mutation exclusion using Bun's
  built-in SQLite. Credentials remain separate private files, not database rows.
- `native-backend.ts`: composition, daemon refresh ownership, automation,
  browser HTTP and private IPC adapters. Both adapters share preference persistence.
- `auto-continue.ts`: quota-specific eligibility and pre-submission revalidation.

## Failure behavior

Before submitting managed login, the backend persists `auth-transition.json`.
A definitive rejection restores the previous cache. A timeout/disconnect triggers
an identity query: a confirmed selected identity completes the transition; a
confirmed previous identity permits rollback. An absent or unrecognized identity
keeps the transition blocked, including after restart. Explicit successful logout
clears the marker and leaves refresh ownership with the official daemon.

The same login policy applies to periodic token refresh. The autoswitch loop stops
on an uncertain login instead of trying a second candidate.

Continuation claims are persisted before submission and only then added to memory.
Missing files initialize empty state; corruption and read errors stop startup.
JSON writes use unique private temporary files, file sync, atomic rename, and
directory sync. Claims are retained conservatively; they are not automatically
pruned because old failed turns can remain loaded.

Vault operations hold `BEGIN IMMEDIATE` on a private SQLite connection until their
asynchronous work completes. The code deliberately does not use an async callback
with SQLite's synchronous transaction wrapper. Process death releases the kernel
lock. A legacy directory lock prevents starting the new protocol; stop all older
clients before upgrading and inspect abandoned legacy locks manually.

Shutdown refuses new HTTP/IPC work, stops timers, drains accepted requests and
background jobs, and then closes transports. Closing is idempotent. RPC refresh
requests are included in the drain. External quota reads do not block browser
snapshot responses; subsequent polling displays their results.

Diagnostics retain at most 50 events in memory and are available in private IPC
state. Each contains only an operation, error category, and timestamp. No exception
messages, credentials, panel addresses, or conversation content are retained.

## Remaining limitations

The daemon has no plugin-side reservation protecting the interval between the
idle check and login. Rechecking immediately before mutation narrows the race but
cannot make it atomic with a new turn started by another client.

The official experimental authentication protocol and its version compatibility
remain external constraints. Transport types do not eliminate protocol drift.
Conversation lifecycle responses now have runtime validation; other RPC response
families still need incremental validation.

The TUI's dynamic Codex theme inheritance remains pending as specified in
`tui-theme.md`. This backend hardening does not implement theme resolution.
Standalone binary distribution and broader platform support remain separate work;
the plugin still distributes generated Bun JavaScript bundles.

## Validation

Run `bun run test:all` for the complete suite. Focused regression tests cover
accepted-but-timed-out login, unknown outcome, definitive rejection, failed claim
write, corrupt claims, operation exclusion, sanitized diagnostics, shutdown drain,
invalid daemon responses, pagination cycles, and lock release after SIGKILL.
All account fixtures use fake identities and isolated vaults.

## Hosted local-dashboard connector

The static interface at `https://ca.eduardoaugusto.work` is published from [codex-accounts-proxy](https://github.com/eduardoaugustolb/codex-accounts-proxy). The browser connects directly to the user's loopback backend; the hosting service does not relay requests or store credentials. The backend continues binding to `127.0.0.1` on a random port.

`codex-accounts panel` opens the hosted frontend with the private local panel URL in a fragment. The connector consumes and removes the fragment, keeps the capability in tab-scoped session storage, and reads the backend-rendered HTML through CORS. The only permitted cross-origin caller is exactly `https://ca.eduardoaugusto.work`; the capability path and form CSRF token remain required. OPTIONS supports loopback/private-network preflight, without cookie credentials or wildcard origins. The original local panel and private IPC remain available.

The hosted frontend is part of the trusted application: scripts published there can operate the paired panel. Publishing access to that repository must be protected. Browser local-network permission can block the connection; the user can use the local panel directly. Restarting the backend rotates the private URL and requires pairing again. Refreshes pause when the page loses focus or while the user interacts with a form.
