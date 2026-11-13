# Managed application update

Lifecycle fix: the updater now passes `--update` to the installer. Full-mode updates register the new copied plugin through `install --no-start`, skipping daemon startup and backend startup. Fresh installs retain their existing startup behavior. The isolated installer scenario verifies that an update registers the plugin without issuing any app-server command. No live daemon was restarted for validation.

Validation of both fixes: `TMPDIR=/var/tmp bun run test:all` passed all 13 stages in 93.1 seconds, including 38 unit tests, installer/PTY coverage, authentication, switching, and both reset-continuation scenarios. Formatting/lint and `git diff --check` passed. Marketplace bundles were regenerated.

Space handling fix: the update checkout now lives in a private temporary directory on the installation data filesystem instead of the system temporary filesystem. This avoids dependency-copy failures when `/tmp` is a nearly full tmpfs. Fixtures verify the checkout location and cleanup after both success and failure. Update tests, all unit tests, TypeScript, and bundle regeneration passed for this change; the full integration suite was not rerun.

`codex-accounts update` reads private installation metadata from its copied release, clones the official repository's latest `main` into a temporary directory, and invokes the frozen-dependency installer with the original binary/data paths and manager-only mode. It never mutates the user's source checkout. Git and Bun remain required. The temporary directory is cleaned on both success and failure. Unmanaged/source invocations and invalid installation metadata are rejected before downloading.

The installer writes metadata with mode 0600 inside its private release. Existing installations require one run of the current installer before update can discover their destination. Running backends and conversations are preserved; the command explicitly asks the user to restart the backend when ready and review changed hooks. The current source channel is `main`, not tagged-release distribution. Installer failures retain their existing recovery behavior.

Unit fixtures verify destination/mode preservation, exact public source, failure propagation, temporary checkout cleanup, and rejection of unmanaged/invalid installations. The documentation build passed. No update was applied to a real account installation during validation.

Final validation: `TMPDIR=/var/tmp bun run test:all` passed all 13 stages in 96.2 seconds, including 38 unit tests and the isolated installed-command/official-daemon integrations. The update-specific unit fixtures were rerun after tightening the cleanup assertion. Formatting/lint, TypeScript, and `git diff --check` passed. Marketplace bundles were regenerated.
