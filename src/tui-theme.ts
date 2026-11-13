import { resolve, sep } from "node:path";
import bundled from "./themes/bundled.json";

export interface ThemeDefinition {
  settings: Record<string, string>;
  rules: { scope: string; foreground?: string }[];
}
export interface TuiTheme {
  name: string;
  accent: string;
  muted: string;
  success: string;
  warning: string;
  failure: string;
  selection: string;
  enabled: boolean;
  notice?: string;
}

// Minimal data-only XML plist reader. Never expands DTDs/entities or evaluates code.
export function parseTmTheme(xml: string): ThemeDefinition {
  if (xml.length > 1024 * 1024 || /<!ENTITY/i.test(xml)) throw new Error("Invalid theme");
  type Element = { tag: string; text: string; children: Element[] };
  const root: Element = { tag: "root", text: "", children: [] },
    stack = [root];
  const source = xml
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\?[\s\S]*?\?>/g, "")
    .replace(/<!DOCTYPE[^>]*>/gi, "");
  for (const token of source.match(/<[^>]*>|[^<]+/g) ?? []) {
    if (!token.startsWith("<")) {
      stack.at(-1)!.text += token;
      continue;
    }
    const close = /^<\/([\w]+)\s*>$/.exec(token);
    if (close) {
      if (stack.length < 2 || stack.pop()!.tag !== close[1]) throw new Error("Invalid theme");
      continue;
    }
    const open = /^<([\w]+)(?:\s[^>]*)?\s*\/?\s*>$/.exec(token);
    if (!open || stack.length > 64) throw new Error("Invalid theme");
    const node = { tag: open[1]!, text: "", children: [] };
    stack.at(-1)!.children.push(node);
    if (!token.endsWith("/>")) stack.push(node);
  }
  if (stack.length !== 1) throw new Error("Invalid theme");
  const value = (node: Element): any => {
    if (node.tag === "dict") {
      const result = Object.create(null);
      for (let i = 0; i < node.children.length; i += 2) {
        if (node.children[i]?.tag !== "key" || !node.children[i + 1])
          throw new Error("Invalid theme");
        result[node.children[i]!.text.trim()] = value(node.children[i + 1]!);
      }
      return result;
    }
    if (node.tag === "array") return node.children.map(value);
    return node.text.trim();
  };
  const plist = root.children[0];
  if (plist?.tag !== "plist" || plist.children[0]?.tag !== "dict") throw new Error("Invalid theme");
  const data = value(plist.children[0]);
  if (!Array.isArray(data.settings)) throw new Error("Invalid theme");
  const definition: ThemeDefinition = { settings: {}, rules: [] };
  for (const entry of data.settings) {
    if (!entry.settings || typeof entry.settings !== "object") continue;
    if (typeof entry.scope === "string")
      definition.rules.push({ scope: entry.scope, foreground: entry.settings.foreground });
    else Object.assign(definition.settings, entry.settings);
  }
  return definition;
}

export function colorEscape(value: string | undefined, level: number, background = false): string {
  if (!value || !level || !/^#[a-f\d]{6}(?:[a-f\d]{2})?$/i.test(value)) return "";
  const rgb = [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16));
  if (value.length === 9 && value.slice(7).toLowerCase() === "01")
    return `\x1b[${background ? 49 : 39}m`;
  let index: number | undefined =
    value.length === 9 && value.slice(7) === "00" ? rgb[0] : undefined;
  if (index === undefined && level === 3) return `\x1b[${background ? 48 : 38};2;${rgb.join(";")}m`;
  if (index === undefined && level === 2) {
    let best = Infinity;
    for (let i = 16; i < 256; i++) {
      const steps = [0, 95, 135, 175, 215, 255];
      const c =
        i < 232
          ? [
              steps[Math.floor((i - 16) / 36)]!,
              steps[Math.floor((i - 16) / 6) % 6]!,
              steps[(i - 16) % 6]!,
            ]
          : [8 + (i - 232) * 10, 8 + (i - 232) * 10, 8 + (i - 232) * 10];
      const distance = c.reduce((total, v, j) => total + (v - rgb[j]!) ** 2, 0);
      if (distance < best) {
        best = distance;
        index = i;
      }
    }
  }
  if (index !== undefined && level >= 2 && index >= 16)
    return `\x1b[${background ? 48 : 38};5;${index}m`;
  if (index === undefined || index >= 16) {
    const max = Math.max(...rgb),
      min = Math.min(...rgb);
    index =
      max - min < 35
        ? max > 150
          ? 7
          : 0
        : (rgb[0]! > 100 ? 1 : 0) + (rgb[1]! > 100 ? 2 : 0) + (rgb[2]! > 100 ? 4 : 0);
  }
  return `\x1b[${(background ? 40 : 30) + (index % 8) + (index >= 8 ? 60 : 0)}m`;
}
export function terminalTheme(env: Record<string, string | undefined> = process.env): TuiTheme {
  const enabled = env.NO_COLOR === undefined && env.TERM !== "dumb";
  return {
    name: "terminal",
    enabled,
    accent: enabled ? "\x1b[34m" : "",
    muted: enabled ? "\x1b[2m" : "",
    success: enabled ? "\x1b[32m" : "",
    warning: enabled ? "\x1b[33m" : "",
    failure: enabled ? "\x1b[31m" : "",
    selection: enabled ? "\x1b[7m" : "",
  };
}
export async function resolveTuiTheme(
  home: string,
  name?: string,
  env: Record<string, string | undefined> = process.env,
): Promise<TuiTheme> {
  const theme = terminalTheme(env);
  if (!name || !theme.enabled) return theme;
  const level = /truecolor|24bit/i.test(env.COLORTERM ?? "")
    ? 3
    : /256color/.test(env.TERM ?? "")
      ? 2
      : 1;
  try {
    let definition = (bundled as Record<string, ThemeDefinition>)[name];
    if (!definition) {
      const dir = resolve(home, "themes");
      const path = resolve(dir, `${name}.tmTheme`);
      if (!path.startsWith(dir + sep)) throw new Error();
      const file = Bun.file(path);
      if (file.size > 1024 * 1024) throw new Error();
      definition = parseTmTheme(await file.text());
    }
    const scope = (query: string) =>
      definition.rules.find((rule) => rule.scope.split(",").some((part) => part.trim() === query))
        ?.foreground;
    theme.name = name;
    theme.accent =
      colorEscape(scope("codex.accent") ?? scope("markup.heading") ?? scope("keyword"), level) ||
      theme.accent;
    theme.muted = colorEscape(scope("comment"), level) || theme.muted;
    theme.success =
      colorEscape(scope("markup.inserted") ?? scope("string"), level) || theme.success;
    theme.failure =
      colorEscape(scope("markup.deleted") ?? scope("invalid"), level) || theme.failure;
    theme.warning =
      colorEscape(scope("constant.numeric") ?? scope("constant"), level) || theme.warning;
    // Preserve terminal-owned UI backgrounds, as Codex does; never paint the syntax background.
    return theme;
  } catch {
    theme.notice = "Selected Codex theme unavailable; using terminal colors.";
    return theme;
  }
}
