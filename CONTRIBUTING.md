# Contributing

Use Bun as the runtime and package manager. The validated environment uses Linux, Bun 1.4.4, and Codex CLI 0.167.2.

```bash
bun install --frozen-lockfile
bun run test:all
```

The suite runs type checking, unit tests, build, and integrations with the official CLI, including the terminal UI, manual switching, autoswitch with continuation enabled and disabled, early/token reset continuation, and weekly reset waiting for five-hour capacity. It requires the `codex` binary on `PATH`, local sockets, a pseudoterminal, and space for temporary daemon installations. `CODEX_ACCOUNTS_CODEX` selects another binary. `TMPDIR` selects a temporary directory with available space; keep the path short because of Unix socket limits.

Scenarios isolate `CODEX_HOME`, use fake accounts, and stop their processes when finished. The suite stops at the first failed stage. Use `bun test` for a quick unit test feedback loop. Individual scripts remain available for troubleshooting a stage.

Open an issue describing the expected behavior and reproduction steps before making large changes. In pull requests, explain the problem, change, and validation. Protocol changes should include a reproducible test and the CLI version used. Update documentation when changing preferences or behavior. Keep Markdown documentation and repository metadata in US English (`en-US`).

Do not include credentials, personal configuration directories, or test artifacts. Follow [SECURITY.md](SECURITY.md) for vulnerabilities.

## Source map and documentation

- `src/tui.ts`: interactive terminal view and input lifecycle; backend operations
  go through the same private IPC as the CLI. Restore raw mode, cursor visibility,
  and the alternate screen on every exit path.
- `src/native-cli.ts`: command parsing, help, lifecycle, and terminal entry point.
- `src/native-backend.ts`: shared daemon integration, quotas, preferences, and jobs.
- `docs/cli.md`: user-facing command reference and terminal shortcuts.
- `docs/automation.md`: automation settings, scheduling, eligibility, and recovery.
- `docs/validation-2026-11-12.md`: tested environment and reproducible evidence.

The TUI must follow the active Codex theme dynamically; generic bold, dim, and
reverse-video styles do not satisfy theme inheritance. Effective configuration and theme definitions are resolved dynamically. Follow [the theme contract](docs/tui-theme.md), preserving terminal UI
colors where Codex uses them and resolving the selected theme where applicable.
Keep terminal control characters out of account labels and service messages.

When changing `src/`, run `bun run build` and commit the generated files in
`marketplace/plugin/bin`. Validate behavioral changes with `bun run test:all`.
Keep the upstream fork history and MIT attribution; configure `upstream` to point
to `https://github.com/SrDarf/claude-accounts.git` when working with the source fork.

## Formatting, linting, and Git hooks

`bun install` enables the repository's `.githooks/pre-commit` through the `prepare` script. Run `bun run hooks:install` to enable it explicitly. An existing custom `core.hooksPath` is preserved; add `bun run check:staged` to that hook instead. CI skips local hook installation.

```bash
bun run format        # Format supported source files
bun run lint          # Inspect lint diagnostics
bun run lint:fix      # Apply safe formatting, import, and lint fixes
bun run check:style   # Check formatting, imports, and lint without writing
bun run check:staged  # Check only the content currently staged in Git
```

The pre-commit hook checks index blobs through Biome's stdin mode. It never rewrites files, automatically stages changes, or incorporates unstaged edits into a commit. Fix reported files, review the diff, and stage only the intended changes. The isolated `tools/style-hook-case.ts` scenario verifies partial-staging behavior.

Biome uses two-space indentation, double-quoted JavaScript/TypeScript strings, semicolons, a 100-column target, and recommended lint rules. Existing dynamically typed RPC boundaries and asserted terminal handles remain permitted. Astro frontmatter disables unused-variable/import diagnostics because Biome does not resolve their template references; CSS selector specificity remains component-owned. Existing syntax-highlighter overrides carry local `!important` explanations. Generated marketplace bundles, build output, vendored icons, and third-party theme data are excluded. MDX content is validated by the documentation build.

`src/themes/sources.json` records pinned upstream theme definitions; `bun tools/sync-tui-themes.ts` rebuilds their data-only snapshot when intentionally updating theme sources. The runtime never downloads theme definitions. See `src/themes/ACKNOWLEDGEMENTS.md` for upstream licenses.
