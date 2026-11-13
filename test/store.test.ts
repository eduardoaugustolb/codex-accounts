import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store";
import { identity } from "../src/native-paths";
import { fakeAuth } from "../tools/fixtures/fake-auth";

const dirs: string[] = [];
async function temporary() { const d = await mkdtemp(join(tmpdir(), "codex-accounts-test-")); dirs.push(d); return d; }
afterEach(async () => { for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true }); });
const auth = (account: string, generation = 0) => JSON.stringify(fakeAuth(account, generation));

test("account isolation and refreshed credentials keep private permissions", async () => {
  const store = new Store(await temporary()); await store.init();
  await store.saveAuth(store.account("one"), auth("first"));
  await store.saveAuth(store.account("two"), auth("second"));
  await store.saveAuth(store.account("one"), auth("first", 1));
  expect(identity(await store.auth(store.account("one"))).accountId).toBe("first");
  expect(JSON.parse(await store.auth(store.account("one"))).tokens.refresh_token).toBe("fake-refresh-first-1");
  expect(identity(await store.auth(store.account("two"))).accountId).toBe("second");
  expect((await stat(join(store.account("one"), "auth.json"))).mode & 0o777).toBe(0o600);
  expect((await stat(store.account("one"))).mode & 0o777).toBe(0o700);
  expect(await store.names()).toEqual(["one", "two"]);
  expect(() => store.account("../escape")).toThrow();
});

test("concurrent account mutations cannot overwrite refreshed credentials", async () => {
  const root = await temporary(); const a = new Store(root); const b = new Store(root);
  const unlock = await a.lock();
  await expect(b.lock()).rejects.toThrow("Outro codex-accounts");
  await unlock(); const unlockB = await b.lock(); await unlockB();
});

test("vault lock excludes another process and is released after SIGKILL", async () => {
  const root = await temporary();
  const module = Bun.fileURLToPath(new URL("../src/store.ts", import.meta.url));
  const child = Bun.spawn([process.execPath, "--eval", `
    import { Store } from ${JSON.stringify(module)};
    await new Store(process.env.TEST_VAULT_PATH).lock();
    process.stdout.write("ready");
    setInterval(() => {}, 1000);
  `], { env: { ...process.env, TEST_VAULT_PATH: root }, stdout: "pipe", stderr: "pipe" });
  try {
    const reader = child.stdout.getReader();
    const ready = await reader.read();
    reader.releaseLock();
    expect(new TextDecoder().decode(ready.value)).toBe("ready");
    const store = new Store(root);
    await expect(store.lock()).rejects.toThrow("Outro codex-accounts");
    child.kill("SIGKILL");
    await child.exited;
    const unlock = await store.lock();
    expect((await stat(join(root, "mutation-lock.sqlite"))).mode & 0o777).toBe(0o600);
    await unlock();
    await unlock();
  } finally { child.kill(); await child.exited; }
});

test("invalid auth never includes secret content in error", async () => {
  const s = new Store(await temporary()); await s.init();
  await s.saveAuth(s.account("broken"), "TOP_SECRET_MALFORMED");
  await expect(s.auth(s.account("broken"))).rejects.toThrow("Cache de autenticação inválido.");
  expect(() => identity("TOP_SECRET_MALFORMED")).toThrow("Credenciais ChatGPT sem identidade válida.");
});

test("workspace routing respects the explicit selected workspace over JWT default", () => {
  const a = fakeAuth("default-workspace"); a.tokens.account_id = "selected-workspace";
  expect(identity(JSON.stringify(a)).accountId).toBe("selected-workspace");
});

test("removing one account preserves others and rejects path traversal", async () => {
  const store = new Store(await temporary()); await store.init();
  await store.saveAuth(store.account("one"), auth("first"));
  await store.saveAuth(store.account("two"), auth("second"));
  const unlock = await store.lock();
  try {
    await expect(store.remove("../two")).rejects.toThrow("Nome inválido");
    await store.remove("one");
    expect(await Bun.file(join(store.account("one"), "auth.json")).exists()).toBe(false);
    expect(await store.names()).toEqual(["two"]);
    expect(identity(await store.auth(store.account("two"))).accountId).toBe("second");
    await expect(store.remove("one")).rejects.toThrow("não cadastrada");
  } finally { await unlock(); }
});
