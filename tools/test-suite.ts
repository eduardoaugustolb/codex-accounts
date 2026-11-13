import { readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const minimumFreeBytes = 512 * 1024 * 1024;

async function freeBytes(path: string): Promise<number | undefined> {
  const proc = Bun.spawn(["df", "-Pk", path], { stdout: "pipe", stderr: "ignore" });
  const out = await proc.stdout.text();
  await proc.exited;
  const lines = out.trim().split("\n");
  if (lines.length < 2) return undefined;
  const columns = lines[lines.length - 1].trim().split(/\s+/);
  const available = Number(columns[3]);
  if (!Number.isFinite(available)) return undefined;
  return available * 1024;
}

// "codex app-server daemon stop" leaves the managed pid-update-loop helper
// running. When a scenario deletes its temporary CODEX_HOME, that helper keeps
// the deleted runtime open and fills the temporary filesystem, which breaks the
// Codex startup of the user machine. Detect the leak instead of ignoring it.
async function leakedDaemonHelpers(): Promise<number[]> {
  const leaked: number[] = [];
  let entries: string[] = [];
  try {
    entries = await readdir("/proc");
  } catch {
    return leaked;
  }
  const temporary = tmpdir();
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    let cmdline = "";
    try {
      cmdline = await readFile(`/proc/${entry}/cmdline`, "utf8");
    } catch {
      continue;
    }
    if (!cmdline.includes("app-server daemon pid-update-loop")) continue;
    if (!cmdline.includes(temporary)) continue;
    leaked.push(Number(entry));
  }
  return leaked;
}
const steps = [
  { name: "Formatting and lint", args: ["run", "check:style"] },
  { name: "Staged hook isolation", args: ["tools/style-hook-case.ts"] },
  { name: "TypeScript", args: ["run", "check"] },
  { name: "Testes unitários", args: ["test"] },
  { name: "Build do plugin", args: ["run", "build"] },
  {
    name: "Installed CLI/TUI command in isolated directories",
    args: ["tools/install-cli-case.ts"],
  },
  { name: "Terminal UI with isolated fake client", args: ["tools/tui-case.ts"] },
  { name: "Autenticação e histórico", args: ["tools/auth-hook-case.ts"] },
  {
    name: "CLI: troca manual, segurança, preferências e ciclo de vida",
    args: ["tools/native-cli-case.ts"],
  },
  {
    name: "CLI: autoswitch sem continuação",
    args: ["tools/native-cli-case.ts"],
    env: { AUTO_SWITCH_CASE: "1" },
  },
  {
    name: "CLI: autoswitch com continuação",
    args: ["tools/native-cli-case.ts"],
    env: { AUTO_SWITCH_CASE: "1", AUTO_CONTINUE_CASE: "1" },
  },
  {
    name: "CLI: early/token quota reset continuation",
    args: ["tools/native-cli-case.ts"],
    env: { RESET_CASE: "token" },
  },
  {
    name: "CLI: weekly reset waits for 5h capacity",
    args: ["tools/native-cli-case.ts"],
    env: { RESET_CASE: "weekly" },
  },
];
const started = Date.now();
const temporaryRoot = tmpdir();
const freeBefore = await freeBytes(temporaryRoot);
if (freeBefore !== undefined && freeBefore < minimumFreeBytes) {
  console.error(
    `\nEspaço insuficiente em ${temporaryRoot}: ${(freeBefore / 1024 / 1024).toFixed(0)} MB livres. ` +
      `A suíte precisa de pelo menos ${minimumFreeBytes / 1024 / 1024} MB e de um daemon do App Server.`,
  );
  process.exit(1);
}
for (const [i, step] of steps.entries()) {
  console.log(`\n[${i + 1}/${steps.length}] ${step.name}`);
  const proc = Bun.spawn([process.execPath, ...step.args], {
    cwd: root,
    env: {
      ...process.env,
      AUTO_SWITCH_CASE: "0",
      AUTO_CONTINUE_CASE: "0",
      RESET_CASE: "",
      KEEP_CASE: "",
      ...step.env,
    },
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    console.error(`\nSuíte interrompida: ${step.name} (código ${exitCode}).`);
    process.exit(exitCode || 1);
  }
  const leaked = await leakedDaemonHelpers();
  if (leaked.length > 0) {
    console.error(
      `\nVazamento de daemon do App Server após ${step.name}: PIDs ${leaked.join(", ")}. ` +
        `O helper "app-server daemon pid-update-loop" sobrevive a "daemon stop" e mantém o runtime temporário aberto. ` +
        `Encerre-os com: kill ${leaked.join(" ")}`,
    );
    process.exit(1);
  }
}
console.log(
  `\nSuíte concluída: ${steps.length} etapas em ${((Date.now() - started) / 1000).toFixed(1)}s.`,
);
