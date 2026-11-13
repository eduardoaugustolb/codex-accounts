import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

export interface UpdateInstallation {
  binDir: string;
  dataDir: string;
  cliOnly: boolean;
}
export async function readUpdateInstallation(moduleDir: string): Promise<UpdateInstallation> {
  const release = resolve(moduleDir, "../../..");
  const metadata = JSON.parse(await readFile(join(release, "installation.json"), "utf8"));
  if (
    typeof metadata.binDir !== "string" ||
    typeof metadata.dataDir !== "string" ||
    typeof metadata.cliOnly !== "boolean" ||
    !metadata.binDir.startsWith("/") ||
    !metadata.dataDir.startsWith("/") ||
    dirname(release) !== join(resolve(metadata.dataDir), "releases")
  )
    throw new Error("Invalid installation metadata. Reinstall with ./install.sh before updating.");
  return metadata;
}
export async function updateApplication(moduleDir: string, run = runUpdateCommand) {
  let installation: UpdateInstallation;
  try {
    installation = await readUpdateInstallation(moduleDir);
  } catch {
    throw new Error(
      "This command requires a managed installation. Run ./install.sh once from the project checkout, then use codex-accounts update.",
    );
  }
  const temporary = await mkdtemp(join(tmpdir(), "ca-update-"));
  try {
    const checkout = join(temporary, "source");
    console.log(
      "Downloading the latest Codex Accounts version from the official project repository...",
    );
    await run([
      "git",
      "clone",
      "--depth",
      "1",
      "--single-branch",
      "--branch",
      "main",
      "https://github.com/eduardoaugustolb/codex-accounts.git",
      checkout,
    ]);
    await run([
      process.execPath,
      join(checkout, "tools/install-cli.ts"),
      "--bin-dir",
      installation.binDir,
      "--data-dir",
      installation.dataDir,
      ...(installation.cliOnly ? ["--cli-only"] : []),
    ]);
    console.log(
      "Update installed. Existing conversations and running backends are preserved. Run codex-accounts restart when ready to load the updated backend, then review changed hooks in Codex /hooks.",
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
async function runUpdateCommand(args: string[]) {
  const child = Bun.spawn(args, { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
  if ((await child.exited) !== 0)
    throw new Error(
      "Update failed. Check the preceding command output and retry. Git and Bun must be installed.",
    );
}
