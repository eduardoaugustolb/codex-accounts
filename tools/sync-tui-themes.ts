import { rename } from "node:fs/promises";
import { join } from "node:path";
import sources from "../src/themes/sources.json";
import { parseTmTheme } from "../src/tui-theme";

const results = await Promise.allSettled(
  Object.entries(sources).map(async ([name, source]) => {
    const path = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/blob\/(.+)$/.exec(source);
    if (!path) throw new Error(`Invalid public theme source: ${name}`);
    const response = await fetch(`https://raw.githubusercontent.com/${path[1]}/${path[2]}`, {
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error(`Could not fetch theme: ${name}`);
    return [name, parseTmTheme(await response.text())] as const;
  }),
);
const definitions = [];
for (const result of results) {
  if (result.status === "rejected") throw result.reason;
  definitions.push(result.value);
}
const file = join(import.meta.dir, "../src/themes/bundled.json");
const temporary = `${file}.${crypto.randomUUID()}.tmp`;
await Bun.write(temporary, `${JSON.stringify(Object.fromEntries(definitions), null, 2)}\n`);
await rename(temporary, file);
console.log(`Updated ${definitions.length} themes from pinned public sources.`);
