# Managed application update

`codex-accounts update` reads private installation metadata from its copied release, clones the official repository's latest `main` into a temporary directory, and invokes the frozen-dependency installer with the original binary/data paths and manager-only mode. It never mutates the user's source checkout. Git and Bun remain required. The temporary directory is cleaned on both success and failure. Unmanaged/source invocations and invalid installation metadata are rejected before downloading.

The installer writes metadata with mode 0600 inside its private release. Existing installations require one run of the current installer before update can discover their destination. Running backends and conversations are preserved; the command explicitly asks the user to restart the backend when ready and review changed hooks. The current source channel is `main`, not tagged-release distribution. Installer failures retain their existing recovery behavior.

Unit fixtures verify destination/mode preservation, exact public source, failure propagation, temporary checkout cleanup, and rejection of unmanaged/invalid installations. The documentation build passed. No update was applied to a real account installation during validation.

Final validation: `TMPDIR=/var/tmp bun run test:all` passed all 13 stages in 96.2 seconds, including 38 unit tests and the isolated installed-command/official-daemon integrations. The update-specific unit fixtures were rerun after tightening the cleanup assertion. Formatting/lint, TypeScript, and `git diff --check` passed. Marketplace bundles were regenerated.
