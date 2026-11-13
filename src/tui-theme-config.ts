import { binary, codexHome } from "./native-paths";
import { Rpc } from "./rpc";
import { resolveTuiTheme, terminalTheme } from "./tui-theme";

/** Ask the official loader to resolve trusted config layers; never log config. */
export async function readTuiTheme() {
  const rpc = new Rpc(binary, ["app-server"], { ...process.env, CODEX_HOME: codexHome });
  try {
    await rpc.initialize();
    const result = await rpc.call(
      "config/read",
      { cwd: process.cwd(), includeLayers: false },
      3000,
    );
    const name = result.config?.tui?.theme;
    if (name !== undefined && name !== null && typeof name !== "string") throw new Error();
    return await resolveTuiTheme(codexHome, name ?? undefined);
  } catch {
    return { ...terminalTheme(), notice: "Codex theme unavailable; using terminal colors." };
  } finally {
    await rpc.close();
  }
}
