import { rename, open, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { RpcError } from "./rpc";

export async function atomicJson(path: string, value: unknown) {
  const temp = `${path}.${crypto.randomUUID()}.tmp`;
  try {
    const file = await open(temp, "wx", 0o600);
    try {
      await file.writeFile(JSON.stringify(value));
      await file.sync();
    } finally { await file.close(); }
    await rename(temp, path);
    const directory = await open(dirname(path), "r");
    try { await directory.sync(); } finally { await directory.close(); }
  } finally {
    await rm(temp, { force: true });
  }
}

/** Missing state is safe; unreadable or corrupt state must disable automation. */
export class ContinuationClaims {
  private constructor(private readonly path: string, private readonly keys: Set<string>) {}

  static async load(path: string) {
    let value: unknown;
    try { value = await Bun.file(path).json(); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Continuation claims unavailable; repair the state before enabling automation.");
      value = [];
    }
    if (!Array.isArray(value) || !value.every(key => typeof key === "string")) {
      throw new Error("Invalid continuation claims; automation cannot start safely.");
    }
    return new ContinuationClaims(path, new Set(value));
  }

  has(key: string) { return this.keys.has(key); }

  async claim(key: string) {
    if (this.keys.has(key)) return;
    const next = new Set(this.keys);
    next.add(key);
    await atomicJson(this.path, [...next]);
    this.keys.add(key);
  }
}

/** Track accepted requests and background jobs so shutdown can drain mutations. */
export class BackendLifecycle {
  private readonly work = new Set<Promise<unknown>>();
  closing = false;

  run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closing) return Promise.reject(new Error("Backend is shutting down."));
    const task = Promise.resolve().then(operation);
    this.work.add(task);
    void task.finally(() => this.work.delete(task)).catch(() => {});
    return task;
  }

  async drain() {
    this.closing = true;
    while (this.work.size) await Promise.allSettled([...this.work]);
  }
}

export type AccountOperation = "quota" | "switch" | "refresh" | "remove" | "logout";

/** One local credential operation at a time; the vault lock protects other processes. */
export class OperationCoordinator {
  private current: AccountOperation | undefined;
  get busy() { return this.current !== undefined; }
  get operation() { return this.current ?? null; }

  begin(operation: AccountOperation) {
    if (this.current) throw new Error("Another account operation is in progress.");
    this.current = operation;
  }

  end() { this.current = undefined; }
}

export class BackendDiagnostics {
  private readonly events: { operation: AccountOperation | "monitor" | "panel"; category: string; at: number }[] = [];

  record(operation: AccountOperation | "monitor" | "panel", error: unknown) {
    this.events.push({ operation, category: error instanceof RpcError ? error.kind : "localFailure", at: Date.now() });
    if (this.events.length > 50) this.events.shift();
  }

  snapshot() { return this.events.map(event => ({ ...event })); }
}
