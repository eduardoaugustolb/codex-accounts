import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readUpdateInstallation, updateApplication } from "../src/update";

test("update preserves installation paths/mode and cleans its temporary checkout", async () => {
  const home = await mkdtemp(join(tmpdir(), "ca-update-test-"));
  try {
    const dataDir = join(home, "data with spaces");
    const release = join(dataDir, "releases", "fixture");
    const moduleDir = join(release, "marketplace/plugin/bin");
    await mkdir(moduleDir, { recursive: true });
    const metadata = { binDir: join(home, "bin with spaces"), dataDir, cliOnly: true };
    await writeFile(join(release, "installation.json"), JSON.stringify(metadata));
    expect(await readUpdateInstallation(moduleDir)).toEqual(metadata);
    const calls: string[][] = [];
    await updateApplication(moduleDir, async (args) => {
      calls.push(args);
      if (args[0] === "git") await mkdir(args.at(-1)!, { recursive: true });
    });
    expect(calls[0]!.slice(0, 3)).toEqual(["git", "clone", "--depth"]);
    expect(calls[0]).toContain("https://github.com/eduardoaugustolb/codex-accounts.git");
    expect(calls[0]!.at(-1)!.startsWith(join(dataDir, ".ca-update-"))).toBe(true);
    expect(calls[1]!.slice(2)).toEqual([
      "--bin-dir",
      metadata.binDir,
      "--data-dir",
      dataDir,
      "--update",
      "--cli-only",
    ]);
    expect(
      await stat(calls[0]!.at(-1)!).then(
        () => true,
        () => false,
      ),
    ).toBe(false);
    let failedCheckout = "";
    await expect(
      updateApplication(moduleDir, async (args) => {
        failedCheckout = args.at(-1)!;
        throw new Error("fixture network failure");
      }),
    ).rejects.toThrow("fixture network failure");
    expect(
      await stat(join(failedCheckout, "..")).then(
        () => true,
        () => false,
      ),
    ).toBe(false);
    await writeFile(
      join(release, "installation.json"),
      JSON.stringify({ ...metadata, dataDir: "/unrelated" }),
    );
    await expect(readUpdateInstallation(moduleDir)).rejects.toThrow("Invalid installation");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
test("unmanaged invocations do not download or mutate an installation", async () => {
  let calls = 0;
  await expect(
    updateApplication("/nonexistent", async () => {
      calls++;
    }),
  ).rejects.toThrow("managed installation");
  expect(calls).toBe(0);
});
