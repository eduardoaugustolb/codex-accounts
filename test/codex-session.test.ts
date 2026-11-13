import { expect, test } from "bun:test";
import { loadedThreadIds, readThread, latestTurn, type CodexClient } from "../src/codex-session";

test("daemon response validation fails closed for unknown states and malformed turns", async () => {
  const client: CodexClient = { async call(method) {
    return method === "thread/read" ? { thread: { status: { type: "newActiveState" } } } : { data: [{ status: "failed" }] };
  } };
  await expect(readThread(client, "thread")).rejects.toThrow("Unsupported");
  await expect(latestTurn(client, "thread")).rejects.toThrow("Invalid");
});

test("repeated pagination cursors stop instead of looping forever", async () => {
  const client: CodexClient = { async call() { return { data: ["thread"], nextCursor: "repeated" }; } };
  const collect = async () => { for await (const id of loadedThreadIds(client)) void id; };
  await expect(collect()).rejects.toThrow("Repeated");
});
