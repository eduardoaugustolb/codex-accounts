import { loadedThreadIds, readThread, latestTurn, type CodexClient, type LatestTurn } from "./codex-session";
interface InterruptedTurn { threadId: string; turnId: string }

function quotaFailure(turn: LatestTurn | undefined) {
  return turn?.status === "failed" && /usage.?limit|usage_limit_reached|quota.{0,30}exceed/i.test(JSON.stringify(turn.error ?? ""));
}

/** Capture only loaded conversations whose latest turn failed because of quota. */
export async function interruptedTurns(client: CodexClient): Promise<InterruptedTurn[]> {
  const interrupted: InterruptedTurn[] = [];
  for await (const threadId of loadedThreadIds(client)) {
    const thread = await readThread(client, threadId);
    if (thread.ephemeral || thread.active) continue;
    const last = await latestTurn(client, threadId);
    if (last && quotaFailure(last)) interrupted.push({ threadId, turnId: last.id });
  }
  return interrupted;
}

export async function continueTurns(client: CodexClient, interrupted: InterruptedTurn[], enabled = () => true) {
  let count = 0;
  for (const { threadId, turnId } of interrupted) {
    if (!enabled()) break;
    const thread = await readThread(client, threadId);
    if (thread.ephemeral || thread.active) continue;
    const last = await latestTurn(client, threadId);
    // A user may have continued, cancelled, or started another turn during login.
    if (!enabled() || thread.active || last?.id !== turnId || !quotaFailure(last)) continue;
    // Do not retry this RPC on timeout: the server may already have accepted it.
    await client.call("turn/start", { threadId, input: [{ type: "text", text: "continue" }] });
    count++;
  }
  return count;
}
