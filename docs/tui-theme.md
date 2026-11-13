# Dynamic Codex theme inheritance

The terminal manager now resolves `tui.theme` through the official App Server's `config/read` loader for the current working directory and `CODEX_HOME`. This preserves the official configuration layering and project-trust rules instead of guessing from a single TOML file. Theme resolution uses an isolated helper and never submits model turns or reads account credentials for diagnostics.

While the TUI is open, it polls the effective selection and custom theme contents every two seconds without restarting the shared backend. Definitions for all 38 Codex CLI 0.167.2 built-in themes are included as data derived from the upstream TextMate sources. Custom `.tmTheme` files are loaded from `$CODEX_HOME/themes/NAME.tmTheme`. Sources are recorded in `src/themes/sources.json`, and licenses are retained in `src/themes/ACKNOWLEDGEMENTS.md`.

## Terminal colors and syntax colors

Headings and emphasis use resolved `codex.accent`, heading, or keyword colors. Quota values and enabled preferences use semantic success/warning/failure colors derived from the theme's insertion, string, numeric, deletion, and invalid scopes. Terminal-owned backgrounds and selection remain terminal-owned; the syntax theme's background does not repaint the entire interface. With no configured theme, semantic ANSI palette colors follow the terminal's own palette rather than imposing an independent RGB theme.

The renderer supports truecolor, 256-color, and 16-color output; recognizes upstream ANSI/default-color encodings; and honors `NO_COLOR` and `TERM=dumb`. Unavailable, invalid, or unsupported selections display an explicit fallback notice. Theme files are treated as bounded data, with no external-entity expansion or executable content. Labels and backend messages are sanitized before adding trusted styles.

## Validation

Unit tests verify actual upstream accent colors, custom-file edits, malformed/unsafe file rejection, no-color output, and color-depth conversion. The isolated PTY integration exercises a live theme change while the manager stays open, followed by navigation, confirmation, preference changes, error recovery, and terminal cleanup. Raw mode, cursor visibility, styles, and the alternate screen are restored on exit.

Visual comparison with the user's terminal and Codex `/theme` picker remains a manual check. When updating supported Codex versions, review their theme inventory, scope behavior, and terminal-owned UI colors before refreshing the snapshot with `bun tools/sync-tui-themes.ts`.

Sources: [Codex theme picker](https://github.com/openai/codex/blob/rust-v0.167.2/codex-rs/tui/src/theme_picker.rs), [theme resolver](https://github.com/openai/codex/blob/rust-v0.167.2/codex-rs/tui/src/render/highlight.rs), and [UI styles](https://github.com/openai/codex/blob/rust-v0.167.2/codex-rs/tui/src/style.rs).
