import { Database } from "bun:sqlite";
import { constants } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export class Store {
  readonly root: string;
  constructor(
    root = process.env.CODEX_ACCOUNTS_HOME ?? join(homedir(), ".local/share/codex-accounts"),
  ) {
    this.root = resolve(root);
  }
  account(name: string) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(name))
      throw new Error("Nome inválido: use letras, números, _ e - (até 64 caracteres).");
    return join(this.root, "accounts", name);
  }
  async init() {
    for (const path of [this.root, join(this.root, "accounts")]) {
      await mkdir(path, { recursive: true, mode: 0o700 });
      if ((await lstat(path)).isSymbolicLink())
        throw new Error("Diretório de dados não pode ser symlink.");
      await chmod(path, 0o700);
    }
  }
  async lock() {
    await this.init();
    // Older releases use a directory lock. Never overlap that protocol.
    if (
      (await Bun.file(join(this.root, "lock", "pid")).exists()) ||
      (await lstat(join(this.root, "lock")).then(
        () => true,
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return false;
          throw error;
        },
      ))
    )
      throw new Error(
        "Legacy vault lock detected. Stop all older clients before removing the abandoned lock directory.",
      );
    const path = join(this.root, "mutation-lock.sqlite");
    const file = await open(
      path,
      constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW,
      0o600,
    );
    await file.close();
    const entry = await lstat(path);
    if (
      !entry.isFile() ||
      entry.isSymbolicLink() ||
      (process.getuid && entry.uid !== process.getuid())
    ) {
      throw new Error("Unsafe vault lock file.");
    }
    await chmod(path, 0o600);
    const database = new Database(path);
    try {
      database.exec("PRAGMA busy_timeout = 0");
      // Keep the transaction open across awaited IO. transaction(async ...) would
      // commit early. Kernel locks disappear even after SIGKILL or a crash.
      database.exec("BEGIN IMMEDIATE");
    } catch (error) {
      database.close();
      if ((error as { code?: string }).code === "SQLITE_BUSY") {
        throw new Error(
          "Outro codex-accounts está usando estes dados. Tente novamente após a operação atual.",
        );
      }
      throw error;
    }
    let released = false;
    return async () => {
      if (released) return;
      released = true;
      try {
        database.exec("ROLLBACK");
      } finally {
        database.close();
      }
    };
  }
  async names() {
    const names = await readdir(join(this.root, "accounts"), { withFileTypes: true });
    const valid: string[] = [];
    for (const entry of names) {
      if (!entry.isDirectory()) continue;
      try {
        await this.auth(this.account(entry.name));
        valid.push(entry.name);
      } catch {}
    }
    return valid.sort();
  }
  // Caller holds the vault lock, shared with login, switching and refresh.
  async remove(name: string) {
    const home = this.account(name);
    const entry = await lstat(home).catch((e: NodeJS.ErrnoException) => {
      if (e.code === "ENOENT") throw new Error(`Conta ${name} não cadastrada.`);
      throw e;
    });
    if (!entry.isDirectory() || entry.isSymbolicLink())
      throw new Error("Diretório de conta inválido.");
    await rm(home, { recursive: true });
  }
  async auth(home: string) {
    const path = join(home, "auth.json");
    if (!(await lstat(path)).isFile()) throw new Error("Cache de autenticação inválido.");
    const raw = await readFile(path, "utf8");
    let auth;
    try {
      auth = JSON.parse(raw);
    } catch {
      throw new Error("Cache de autenticação inválido.");
    }
    if (auth.auth_mode !== "chatgpt" || !auth.tokens?.refresh_token || !auth.tokens?.access_token) {
      throw new Error("É necessário um login ChatGPT válido, feito pelo fluxo oficial.");
    }
    return raw;
  }
  async saveAuth(home: string, raw: string) {
    await mkdir(home, { recursive: true, mode: 0o700 });
    await chmod(home, 0o700);
    const temp = join(home, `.auth-${crypto.randomUUID()}.tmp`);
    await writeFile(temp, raw, { mode: 0o600, flag: "wx" });
    await rename(temp, join(home, "auth.json"));
  }
}
