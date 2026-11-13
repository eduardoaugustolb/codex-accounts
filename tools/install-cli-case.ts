import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const temporary = await mkdtemp(join(tmpdir(), "ca-install-"));
const bin = join(temporary, "bin ' with spaces");
const data = join(temporary, "data ' with spaces");
const codexHome = join(temporary, "codex");
const service = join(
  tmpdir(),
  `codex-accounts-${process.getuid?.() ?? "user"}-${createHash("sha256").update(codexHome).digest("hex").slice(0, 12)}`,
);
const env = {
  ...process.env,
  CODEX_HOME: codexHome,
  CODEX_ACCOUNTS_HOME: join(temporary, "vault"),
  CODEX_ACCOUNTS_NO_BROWSER: "1",
};
const launcher = join(bin, "codex-accounts");
let server: ReturnType<typeof Bun.serve> | undefined;
let child: Bun.Subprocess | undefined;

async function run(args: string[], expected = 0, cwd = temporary) {
  const process = Bun.spawn(args, { cwd, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [output, error, code] = await Promise.all([
    process.stdout.text(),
    process.stderr.text(),
    process.exited,
  ]);
  if (code !== expected) throw new Error(`Unexpected exit ${code}: ${error}`);
  return output + error;
}

try {
  const install = [
    "sh",
    join(root, "install.sh"),
    "--cli-only",
    "--bin-dir",
    bin,
    "--data-dir",
    data,
  ];
  await run(install);
  if (!(await run([launcher, "--help"])).includes("Usage: codex-accounts"))
    throw new Error("Installed command did not show help");
  if (!(await run([launcher])).includes("Usage: codex-accounts"))
    throw new Error("Redirected invocation did not show help");
  if (!(await run([launcher, "tui"], 1)).includes("interactive terminal"))
    throw new Error("TUI did not reject redirected input");
  await run([launcher, "list"]);
  if (((await stat(launcher)).mode & 0o111) === 0) throw new Error("Launcher is not executable");
  const before = await readFile(launcher, "utf8");
  await run(install);
  if ((await readFile(launcher, "utf8")) === before)
    throw new Error("Update did not select a new release");

  const unmanaged = join(temporary, "unmanaged");
  await mkdir(unmanaged);
  const unrelated = join(unmanaged, "codex-accounts");
  await writeFile(unrelated, "#!/bin/sh\necho unrelated\n");
  await chmod(unrelated, 0o755);
  await run(["sh", join(root, "install.sh"), "--bin-dir", unmanaged, "--data-dir", data], 1);
  if (!(await readFile(unrelated, "utf8")).includes("unrelated"))
    throw new Error("Installer overwrote an unmanaged command");

  const fakeCodex = join(temporary, "fake-codex");
  const calls = join(temporary, "install-calls.jsonl");
  await writeFile(
    fakeCodex,
    [
      "#!/usr/bin/env bun",
      "const args = process.argv.slice(2);",
      "const file = process.env.INSTALL_CALLS;",
      'await Bun.write(file, (await Bun.file(file).text().catch(() => "")) + JSON.stringify(args) + "\\n");',
      'const stateFile = file + ".state";',
      'const root = await Bun.file(stateFile).text().catch(() => "");',
      'if (args.slice(0,3).join(" ") === "plugin marketplace list") console.log(JSON.stringify({ marketplaces: root ? [{name:"codex-accounts-local",root,marketplaceSource:{sourceType:"local",source:root}}] : [] }));',
      'if (args.slice(0,3).join(" ") === "plugin marketplace remove") await Bun.write(stateFile, "");',
      'if (args.slice(0,3).join(" ") === "plugin marketplace add") { if(root && root !== args[3]) process.exit(1); await Bun.write(stateFile, args[3]); }',
    ].join("\n"),
  );
  await chmod(fakeCodex, 0o755);
  Object.assign(env, { CODEX_ACCOUNTS_CODEX: fakeCodex, INSTALL_CALLS: calls });
  try {
    await run(["sh", join(root, "install.sh"), "--bin-dir", bin, "--data-dir", data]);
    const recorded = (await readFile(calls, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
      .filter((args) => args.slice(0, 3).join(" ") !== "plugin marketplace list");
    if (
      recorded.length !== 3 ||
      recorded[0].slice(0, 3).join(" ") !== "plugin marketplace add" ||
      !recorded[0][3].startsWith(data) ||
      recorded[1].join(" ") !== "plugin add codex-accounts@codex-accounts-local" ||
      recorded[2].join(" ") !== "app-server daemon start"
    )
      throw new Error("Full install did not register the installed plugin and start the daemon");
    if (!(await run([launcher, "status"])).includes("http://"))
      throw new Error("Full install did not start the backend");
    await run(["sh", join(root, "install.sh"), "--bin-dir", bin, "--data-dir", data]);
    const updates = (await readFile(calls, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    if (
      !updates.some((args) => args.join(" ") === "plugin marketplace remove codex-accounts-local")
    )
      throw new Error("Full reinstall did not migrate the old marketplace source");
    await run(["sh", join(root, "install.sh"), "--update", "--bin-dir", bin, "--data-dir", data]);
    const afterUpdate = (await readFile(calls, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const updateCalls = afterUpdate.slice(updates.length);
    if (
      !updateCalls.some(
        (args) => args.join(" ") === "plugin add codex-accounts@codex-accounts-local",
      ) ||
      updateCalls.some((args) => args[0] === "app-server")
    )
      throw new Error("Update must register the plugin without starting the daemon");
  } finally {
    await run([launcher, "stop"]);
  }

  await mkdir(service, { recursive: true, mode: 0o700 });
  const state = {
    accounts: [{ name: "fixture", current: true }],
    autoSwitch: false,
    autoContinue: false,
    resumeAfterReset: false,
  };
  server = Bun.serve({
    unix: join(service, "backend.sock"),
    fetch(request) {
      return Response.json(request.method === "GET" ? state : { accounts: state.accounts });
    },
  });
  let output = "";
  child = Bun.spawn([launcher], {
    cwd: temporary,
    env,
    terminal: {
      cols: 100,
      rows: 30,
      data(_terminal, bytes) {
        output += new TextDecoder().decode(bytes);
      },
    },
  });
  const deadline = Date.now() + 5000;
  while (!output.includes("Ready. Quotas refreshed.")) {
    if (Date.now() > deadline) throw new Error("Installed command did not open the TUI");
    await Bun.sleep(20);
  }
  child.terminal!.write("q");
  if ((await child.exited) !== 0) throw new Error("Installed TUI did not exit cleanly");
  if (!output.includes("\x1b[?25h") || !output.includes("\x1b[?1049l"))
    throw new Error("Installed TUI did not restore the terminal");
  console.log(
    "Installed CLI/TUI: paths with quotes/spaces, independent cwd, update, collision protection, help, list and PTY startup/exit: OK",
  );
} finally {
  if (child?.exitCode === null) {
    child.kill("SIGTERM");
    await child.exited;
  }
  child?.terminal?.close();
  server?.stop(true);
  await rm(service, { recursive: true, force: true });
  await rm(temporary, { recursive: true, force: true });
}
