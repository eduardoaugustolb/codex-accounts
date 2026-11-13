import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commitLogin } from "../src/auth-transition";
import {
  BackendDiagnostics,
  BackendLifecycle,
  ContinuationClaims,
  OperationCoordinator,
} from "../src/backend-state";
import { RpcError } from "../src/rpc";

test("claims reject corruption and failed writes do not claim in memory", async () => {
  const root = await mkdtemp(join(tmpdir(), "claims-"));
  const path = join(root, "claims.json");
  try {
    const claims = await ContinuationClaims.load(path);
    await claims.claim("first");
    expect((await ContinuationClaims.load(path)).has("first")).toBe(true);
    await writeFile(path, "{");
    await expect(ContinuationClaims.load(path)).rejects.toThrow("unavailable");
    await writeFile(path, "{}");
    await expect(ContinuationClaims.load(path)).rejects.toThrow("Invalid");
    await rm(root, { recursive: true });
    await expect(claims.claim("second")).rejects.toThrow();
    expect(claims.has("second")).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("shutdown drains accepted jobs and refuses new work", async () => {
  const lifecycle = new BackendLifecycle();
  let release!: () => void;
  let drained = false;
  const job = lifecycle.run(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  await Promise.resolve();
  const drain = lifecycle.drain().then(() => {
    drained = true;
  });
  await expect(lifecycle.run(async () => {})).rejects.toThrow("shutting down");
  expect(drained).toBe(false);
  release();
  await job;
  await drain;
  expect(drained).toBe(true);
});

test("operations exclude competing mutations and diagnostics never retain error content", () => {
  const operations = new OperationCoordinator();
  operations.begin("refresh");
  expect(operations.operation).toBe("refresh");
  expect(() => operations.begin("switch")).toThrow("in progress");
  operations.end();
  expect(operations.busy).toBe(false);
  const diagnostics = new BackendDiagnostics();
  for (let index = 0; index < 60; index++)
    diagnostics.record("quota", new Error("PRIVATE_CREDENTIAL"));
  expect(diagnostics.snapshot()).toHaveLength(50);
  expect(JSON.stringify(diagnostics.snapshot())).not.toContain("PRIVATE_CREDENTIAL");
});

test("login accepted before timeout is reconciled without rollback", async () => {
  let rolledBack = false;
  await commitLogin(
    async () => {
      throw new RpcError("outcomeUnknown", "account/login/start");
    },
    async () => {
      rolledBack = true;
    },
    async () => "selected",
  );
  expect(rolledBack).toBe(false);
});

test("unconfirmed login is not rolled back or resubmitted", async () => {
  let calls = 0;
  let rollbacks = 0;
  await expect(
    commitLogin(
      async () => {
        calls++;
        throw new RpcError("outcomeUnknown", "account/login/start");
      },
      async () => {
        rollbacks++;
      },
      async () => "unknown",
    ),
  ).rejects.toThrow("outcome unknown");
  expect(calls).toBe(1);
  expect(rollbacks).toBe(0);
});

test("definitive login rejection restores previous credentials", async () => {
  let rollbacks = 0;
  await expect(
    commitLogin(
      async () => {
        throw new RpcError("rejected", "account/login/start");
      },
      async () => {
        rollbacks++;
      },
      async () => {
        throw new Error("Reconciliation unnecessary");
      },
    ),
  ).rejects.toThrow("rejected");
  expect(rollbacks).toBe(1);
});

test("uncertain login rolls back only after the previous identity is confirmed", async () => {
  let rollbacks = 0;
  await expect(
    commitLogin(
      async () => {
        throw new RpcError("outcomeUnknown", "account/login/start");
      },
      async () => {
        rollbacks++;
      },
      async () => "previous",
    ),
  ).rejects.toThrow("outcomeUnknown");
  expect(rollbacks).toBe(1);
});
