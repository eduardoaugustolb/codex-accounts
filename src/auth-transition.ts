import { RpcError } from "./rpc";

/** Only a definitive rejection permits rollback. A timeout may mean success. */
export async function commitLogin(
  login: () => Promise<unknown>,
  rollback: () => Promise<void>,
  reconcile: () => Promise<"selected" | "previous" | "unknown">,
) {
  try { await login(); }
  catch (error) {
    if (error instanceof RpcError && error.kind !== "outcomeUnknown") {
      await rollback();
      throw error;
    }
    const state = await reconcile().catch(() => "unknown" as const);
    if (state === "selected") return;
    if (state === "previous") {
      await rollback();
      throw error;
    }
    throw new Error("Authentication outcome unknown. Account mutations are blocked until reconciliation or daemon recovery.");
  }
}
