# Dynamic Codex theme inheritance

Status: **required behavior; not implemented yet**. The current TUI uses generic
ANSI bold, dim, and reverse-video styles. That does not resolve or dynamically
follow the theme selected in Codex, and it must not be described as doing so.

## Required behavior

The terminal account manager must follow the active Codex theme dynamically.
There must be no separate default palette or independently selected account-manager
theme that drifts from Codex.

- Resolve the theme selected by Codex from `tui.theme` in the effective
  configuration for the same `CODEX_HOME` as the managed session.
- Reuse the selected theme's definitions, including supported built-in themes and
  custom `.tmTheme` files. Do not hard-code one theme or a small set of lookalike
  palettes and call that inheritance.
- Follow changes while the manager is open. Selecting another theme with Codex's
  `/theme` picker, or changing the selected custom theme file, must refresh the
  manager without restarting the backend or the TUI.
- Distinguish Codex's syntax theme from the terminal's base UI palette. Preserve
  the terminal colors where Codex itself uses them; do not assume a syntax theme
  replaces every UI foreground and background.
- Apply resolved semantic colors consistently to headings, account selection,
  quotas, secondary text, statuses, and confirmation prompts. Generic reverse
  video and dimming alone do not satisfy this requirement.
- If no explicit Codex theme can be resolved, use the terminal's actual defaults
  and palette. An unsupported theme must have a visible, honest fallback rather
  than silently claiming to match Codex.
- Respect no-color environments, light and dark themes, and terminal color
  capabilities. Theme handling must not modify Codex or terminal configuration.
- Restore terminal styles, raw mode, cursor visibility, and the previous screen on
  exit. Treat theme files as data, never executable content, and never expose
  unrelated private configuration when reporting a theme error.

## Acceptance checks

1. Compare the manager with Codex in the same terminal using a dark theme and a
   light theme; verify actual resolved colors rather than only matching labels.
2. Change the Codex theme while the manager remains open and verify that its
   styles update without a restart.
3. Edit a selected custom `.tmTheme` file and verify that its updated colors are
   reflected.
4. With terminal defaults in use, change the terminal palette and verify that the
   manager does not impose stale RGB values or an unrelated selection fill.
5. Exercise missing, invalid, unsupported, and no-color cases, including cleanup
   after cancellation, errors, and external login.

The official [CLI customization documentation](https://learn.chatgpt.com/docs/cli-customization)
describes `/theme`, persistence in `tui.theme`, and custom themes under
`$CODEX_HOME/themes`. The [Codex UI style implementation](https://github.com/openai/codex/blob/rust-v0.167.2/codex-rs/tui/src/style.rs)
also distinguishes terminal UI colors from syntax-theme settings.
