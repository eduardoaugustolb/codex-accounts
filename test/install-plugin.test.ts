import { expect, test } from "bun:test";
import { installPlugin } from "../src/install-plugin";

test("reinstall migrates only the local marketplace source", async () => {
  const calls: string[][] = [];
  await installPlugin("/new/marketplace", async (args) => {
    calls.push(args);
    return args[2] === "list"
      ? JSON.stringify({
          marketplaces: [
            {
              name: "codex-accounts-local",
              root: "/old/marketplace",
              marketplaceSource: { sourceType: "local", source: "/old/marketplace" },
            },
          ],
        })
      : "";
  });
  expect(calls.map((args) => args.join(" "))).toEqual([
    "plugin marketplace list --json",
    "plugin marketplace remove codex-accounts-local",
    "plugin marketplace add /new/marketplace",
    "plugin add codex-accounts@codex-accounts-local",
    "app-server daemon start",
  ]);
});
test("registration failure restores the prior source and never starts the daemon", async () => {
  const calls: string[][] = [];
  await expect(
    installPlugin("/new", async (args) => {
      calls.push(args);
      if (args[2] === "list")
        return JSON.stringify({
          marketplaces: [
            {
              name: "codex-accounts-local",
              root: "/old",
              marketplaceSource: { sourceType: "local", source: "/old" },
            },
          ],
        });
      if (args[3] === "/new") throw new Error("fixture failure");
      return "";
    }),
  ).rejects.toThrow("fixture failure");
  expect(calls.at(-1)).toEqual(["plugin", "marketplace", "add", "/old"]);
  expect(calls.some((args) => args[0] === "app-server")).toBe(false);
});
test("nonlocal marketplaces and invalid inventories are left untouched", async () => {
  for (const inventory of [
    {
      marketplaces: [
        {
          name: "codex-accounts-local",
          root: "/old",
          marketplaceSource: { sourceType: "git", source: "fixture" },
        },
      ],
    },
    {},
  ]) {
    const calls: string[][] = [];
    await expect(
      installPlugin("/new", async (args) => {
        calls.push(args);
        return JSON.stringify(inventory);
      }),
    ).rejects.toThrow();
    expect(calls).toHaveLength(1);
  }
});
