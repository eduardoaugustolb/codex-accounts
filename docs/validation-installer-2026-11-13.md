# Complete installer and documentation navigation

`./install.sh` and `bun run setup` now use the same installer. Both install frozen Bun dependencies, build the marketplace, copy it to a durable release, install the CLI/TUI launcher, register the copied plugin, start the official daemon, and start the local backend. Backend startup output is suppressed because it contains a private panel URL. Hook trust remains an explicit step in the official client. `bun run install:cli` and `./install.sh --cli-only` retain manager-only installation.

The isolated installer integration checks complete installation with a fake Codex executable, verifies registration uses the copied release, checks backend availability, and shuts down its backend. Existing launcher, update, collision, and PTY checks remain in place. No real login or inference request is used.

The documentation header no longer duplicates the category navigation. Footer links provide previous and next pages, omitting unavailable directions at the ends.

Validation: TypeScript, isolated installer integration, and the seven-page documentation build passed. The initial complete suite stopped at stage 9 because `/tmp` ran out of space while installing a test daemon; validation was rerun with `TMPDIR=/var/tmp`.

The rerun completed successfully: all 11 stages passed in 88 seconds with `TMPDIR=/var/tmp bun run test:all`. Static output checks also confirmed a single header, previous/next links, and valid internal routes across all seven pages. Browser visual verification was not performed.
