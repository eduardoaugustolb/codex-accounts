import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const temporary = await mkdtemp(join(tmpdir(), "ca-style-"));
const checker = resolve(import.meta.dir, "check-staged.ts");
async function run(args: string[], expected = 0) {
  const child = Bun.spawn(args, { cwd: temporary, stdout: "pipe", stderr: "pipe" });
  const [out, error, code] = await Promise.all([
    child.stdout.text(),
    child.stderr.text(),
    child.exited,
  ]);
  if (code !== expected) throw new Error(`Style fixture failed (${code}): ${out} ${error}`);
}
try {
  await run(["git", "init", "--quiet"]);
  const path = join(temporary, "fixture.ts");
  const good = 'export const fixture = "formatted";\n';
  const bad = "export const fixture='unformatted'\n";
  await writeFile(path, good);
  await run(["git", "add", "fixture.ts"]);
  await writeFile(path, bad);
  await run([process.execPath, checker]);
  if ((await readFile(path, "utf8")) !== bad) throw new Error("Hook rewrote unstaged changes");
  await run(["git", "add", "fixture.ts"]);
  await writeFile(path, good);
  await run([process.execPath, checker], 1);
  if ((await readFile(path, "utf8")) !== good) throw new Error("Hook rewrote the working tree");
  console.log(
    "Staged style hook: checks index content, rejects unformatted index, preserves unstaged changes: OK",
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
