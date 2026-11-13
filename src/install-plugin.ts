import { resolve } from "node:path";

export type InstallCommand = (args: string[]) => Promise<string>;

/** Repoint only our local marketplace, restoring its old source if registration fails. */
export async function installPlugin(root: string, run: InstallCommand) {
  const listing = JSON.parse(await run(["plugin", "marketplace", "list", "--json"]));
  if (!Array.isArray(listing.marketplaces))
    throw new Error("Invalid marketplace inventory; no registration changed.");
  const existing = listing.marketplaces.find((entry: any) => entry.name === "codex-accounts-local");
  let previous: string | undefined;
  if (existing && resolve(existing.root) !== resolve(root)) {
    if (
      existing.marketplaceSource?.sourceType !== "local" ||
      typeof existing.marketplaceSource.source !== "string"
    ) {
      throw new Error(
        "The codex-accounts-local marketplace is not a managed local source. Resolve its configuration before installing.",
      );
    }
    previous = existing.marketplaceSource.source;
    await run(["plugin", "marketplace", "remove", "codex-accounts-local"]);
  }
  try {
    await run(["plugin", "marketplace", "add", root]);
  } catch (error) {
    if (previous) {
      try {
        await run(["plugin", "marketplace", "add", previous]);
      } catch {
        throw new Error(
          "Marketplace registration failed and the previous source could not be restored. Rerun installation to recover.",
        );
      }
    }
    throw error;
  }
  await run(["plugin", "add", "codex-accounts@codex-accounts-local"]);
  await run(["app-server", "daemon", "start"]);
}
