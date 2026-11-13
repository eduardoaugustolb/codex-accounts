import { chmod, cp, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const marker = "# codex-accounts managed launcher";
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

async function main() {
  const rawArgs = process.argv.slice(2);
  const cliOnly = rawArgs.includes("--cli-only");
  const args = rawArgs.filter(arg => arg !== "--cli-only");
  if (args.includes("--help") || args.includes("-h")) {
    console.log("Usage: ./install.sh [--cli-only] [--bin-dir PATH] [--data-dir PATH]\nInstall CLI, TUI, plugin, official daemon, and local backend. Use --cli-only for the manager command alone.\nDefaults: ~/.local/bin and $XDG_DATA_HOME/codex-accounts/cli (or ~/.local/share/codex-accounts/cli).");
    return;
  }
  let binDir = join(homedir(), ".local", "bin");
  let dataDir = join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "codex-accounts", "cli");
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    const value = args[index + 1];
    if (!["--bin-dir", "--data-dir"].includes(option!) || !value || value.startsWith("--")) throw new Error("Invalid arguments. Run ./install.sh --help.");
    if (option === "--bin-dir") binDir = resolve(value);
    else dataDir = resolve(value);
  }
  binDir = resolve(binDir);
  dataDir = resolve(dataDir);
  const target = join(binDir, "codex-accounts");
  const existing = await lstat(target).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (existing && (!existing.isFile() || !(await readFile(target, "utf8")).startsWith(`#!/bin/sh\n${marker}\n`))) {
    throw new Error("An unmanaged codex-accounts command already exists in the target directory; choose another --bin-dir.");
  }
  const dependencies = Bun.spawn([process.execPath, "install", "--frozen-lockfile"], { cwd: root, stdin: "ignore", stdout: "inherit", stderr: "inherit" });
  if (await dependencies.exited !== 0) throw new Error("Dependency installation failed.");
  const build = Bun.spawn([process.execPath, "run", "build"], { cwd: root, stdin: "ignore", stdout: "inherit", stderr: "inherit" });
  if (await build.exited !== 0) throw new Error("Build failed. Run bun install --frozen-lockfile and retry.");

  await mkdir(binDir, { recursive: true });
  const releases = join(dataDir, "releases");
  await mkdir(releases, { recursive: true, mode: 0o700 });
  const release = join(releases, crypto.randomUUID());
  const temporary = join(binDir, `.codex-accounts-${crypto.randomUUID()}.tmp`);
  let installed = false;
  try {
    await mkdir(release, { mode: 0o700 });
    await cp(join(root, "marketplace"), join(release, "marketplace"), { recursive: true, dereference: false });
    const cli = join(release, "marketplace", "plugin", "bin", "native-cli.js");
    const launcher = `#!/bin/sh\n${marker}\nexec ${quote(process.execPath)} ${quote(cli)} "$@"\n`;
    await writeFile(temporary, launcher, { flag: "wx", mode: 0o755 });
    await chmod(temporary, 0o755);
    await rename(temporary, target);
    installed = true;
  } finally {
    await rm(temporary, { force: true });
    if (!installed) await rm(release, { recursive: true, force: true });
  }
  if (!cliOnly) {
    for (const command of ["install", "start"]) {
      const child = Bun.spawn([target, command], { stdin: "inherit", stdout: command === "start" ? "ignore" : "inherit", stderr: "inherit" });
      if (await child.exited !== 0) throw new Error(`Full installation failed during ${command}. The manager is installed; rerun ./install.sh to retry.`);
    }
    console.log("Plugin, official daemon, and local backend are ready. Review and trust all four hooks in Codex /hooks, then start a new conversation.");
  }
  console.log(`Installed: ${target}\nRun codex-accounts to open the TUI, or codex-accounts --help for CLI commands.`);
  const onPath = (process.env.PATH ?? "").split(delimiter).some(entry => resolve(entry) === binDir);
  if (!onPath) console.log(`Add this directory to your shell PATH:\nexport PATH=${quote(binDir)}:"$PATH"`);
}

if (import.meta.main) main().catch(error => {
  console.error(error instanceof Error ? error.message : "CLI installation failed.");
  process.exitCode = 1;
});
