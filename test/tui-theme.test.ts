import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { colorEscape, parseTmTheme, resolveTuiTheme } from "../src/tui-theme";

const xml = (color: string) =>
  `<?xml version="1.0"?><!DOCTYPE plist PUBLIC "fixture" "https://invalid.example/no-network"><plist version="1.0"><dict><key>settings</key><array><dict><key>scope</key><string>codex.accent</string><key>settings</key><dict><key>foreground</key><string>${color}</string></dict></dict></array></dict></plist>`;
const env = { TERM: "xterm-256color", COLORTERM: "truecolor" };
test("custom theme edits are reloaded and unsafe/malformed themes fail honestly", async () => {
  const home = await mkdtemp(join(tmpdir(), "ca-theme-"));
  try {
    await mkdir(join(home, "themes"));
    const file = join(home, "themes", "fixture.tmTheme");
    await writeFile(file, xml("#123456"));
    expect((await resolveTuiTheme(home, "fixture", env)).accent).toBe("\x1b[38;2;18;52;86m");
    await writeFile(file, xml("#abcdef"));
    expect((await resolveTuiTheme(home, "fixture", env)).accent).toBe("\x1b[38;2;171;205;239m");
    expect((await resolveTuiTheme(home, "../escape", env)).notice).toContain("unavailable");
    await writeFile(
      file,
      xml("#123456").replace("<plist", '<!ENTITY secret SYSTEM "file:///fixture"><plist'),
    );
    expect((await resolveTuiTheme(home, "fixture", env)).notice).toContain("unavailable");
    expect(() => parseTmTheme("<plist><dict></plist>")).toThrow();
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
test("upstream themes use their real definitions and respect terminal color depth", async () => {
  expect((await resolveTuiTheme("/unused", "ada", env)).accent).toBe("\x1b[38;2;95;175;255m");
  expect((await resolveTuiTheme("/unused", "dali", env)).name).toBe("dali");
  expect((await resolveTuiTheme("/unused", "catppuccin-latte", env)).name).toBe("catppuccin-latte");
  expect((await resolveTuiTheme("/unused", "nord", env)).name).toBe("nord");
  expect(colorEscape("#01000000", 3)).toBe("\x1b[31m");
  expect(colorEscape("#00000001", 3)).toBe("\x1b[39m");
  expect(colorEscape("#5fafff", 2).startsWith("\x1b[38;5;")).toBe(true);
  expect(colorEscape("#5fafff", 1)).not.toContain("38;");
  expect((await resolveTuiTheme("/unused", "ada", { NO_COLOR: "1" })).accent).toBe("");
});
