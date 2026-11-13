/** Validate daemon data at the boundary before making lifecycle decisions. */
export interface CodexClient {
  call(method: string, params?: unknown): Promise<unknown>;
}
export interface ThreadState {
  ephemeral: boolean;
  active: boolean;
}
export interface LatestTurn {
  id: string;
  status: string;
  error?: unknown;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid daemon response.");
  return value as Record<string, unknown>;
}

export async function* loadedThreadIds(client: CodexClient) {
  let cursor: string | undefined;
  const cursors = new Set<string>();
  do {
    const response = object(await client.call("thread/loaded/list", { cursor }));
    if (!Array.isArray(response.data) || !response.data.every((id) => typeof id === "string"))
      throw new Error("Invalid loaded thread list.");
    for (const id of response.data as string[]) yield id;
    if (response.nextCursor != null && typeof response.nextCursor !== "string")
      throw new Error("Invalid thread cursor.");
    cursor = response.nextCursor as string | undefined;
    if (cursor) {
      if (cursors.has(cursor)) throw new Error("Repeated daemon pagination cursor.");
      cursors.add(cursor);
    }
  } while (cursor);
}

export async function readThread(client: CodexClient, threadId: string): Promise<ThreadState> {
  const thread = object(object(await client.call("thread/read", { threadId })).thread);
  const status = object(thread.status).type;
  if (
    typeof status !== "string" ||
    !["notLoaded", "idle", "systemError", "active"].includes(status)
  )
    throw new Error("Unsupported daemon thread status.");
  if (thread.ephemeral !== undefined && typeof thread.ephemeral !== "boolean")
    throw new Error("Invalid ephemeral thread flag.");
  return { ephemeral: thread.ephemeral === true, active: status === "active" };
}

export async function latestTurn(
  client: CodexClient,
  threadId: string,
): Promise<LatestTurn | undefined> {
  const response = object(
    await client.call("thread/turns/list", { threadId, limit: 1, sortDirection: "desc" }),
  );
  if (!Array.isArray(response.data)) throw new Error("Invalid daemon turn list.");
  if (!response.data.length) return undefined;
  const turn = object(response.data[0]);
  if (typeof turn.id !== "string" || typeof turn.status !== "string")
    throw new Error("Invalid daemon turn.");
  return { id: turn.id, status: turn.status, error: turn.error };
}
