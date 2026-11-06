export const SELECTED_CONNECTION_COOKIE = "vortex_connection_id";
export const INSTAGRAM_CONNECTION_CONFLICT_TARGET = "instagram_user_id";

const CONNECTION_UUID = /^[0-9a-f-]{36}$/i;

export interface ConnectionChoice {
  id: string;
  status: string;
}

export function isConnectionId(value: string | null | undefined): value is string {
  return Boolean(value && CONNECTION_UUID.test(value));
}

export function selectedConnectionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 60 * 60 * 24 * 400,
  };
}

export function resolveSelectedConnectionId(
  connections: ConnectionChoice[],
  options: {
    requestedId?: string | null;
    cookieId?: string | null;
    preferredId?: string | null;
  } = {},
): string | null {
  if (!connections.length) return null;
  const ids = new Set(connections.map((item) => item.id));
  if (options.requestedId && ids.has(options.requestedId)) return options.requestedId;
  if (options.cookieId && ids.has(options.cookieId)) return options.cookieId;
  if (options.preferredId && ids.has(options.preferredId)) return options.preferredId;
  const live = connections.find((item) => item.status === "connected" || item.status === "expiring");
  return live?.id ?? connections[0]!.id;
}

export function planInstagramConnectionWrite(
  ownerId: string,
  existing: { id: string; ownerId: string } | null,
): { action: "insert" } | { action: "update"; id: string } | { action: "reject"; reason: "owned_by_other" } {
  if (!existing) return { action: "insert" };
  if (existing.ownerId !== ownerId) return { action: "reject", reason: "owned_by_other" };
  return { action: "update", id: existing.id };
}

export type InstagramOauthFailure = "owned_by_other" | "save_failed" | "meta";

export function instagramOauthErrorQuery(reason: InstagramOauthFailure) {
  return reason === "owned_by_other" ? "oauth_conflict" : "oauth";
}

export interface InstagramConnectionWritePayload {
  ownerId: string;
  instagramUserId: string;
  username: string;
  tokenCiphertext: string;
  tokenIv: string;
  tokenTag: string;
  tokenExpiresAt: string | null;
  apiVersion: string;
}

export interface InstagramConnectionWriteStore {
  findByInstagramUserId(instagramUserId: string): Promise<{ id: string; ownerId: string; instagramUserId: string } | null>;
  insert(payload: InstagramConnectionWritePayload): Promise<{ id: string }>;
  updateById(id: string, ownerId: string, payload: InstagramConnectionWritePayload): Promise<{ id: string } | null>;
}

export async function upsertOwnedInstagramConnection(
  store: InstagramConnectionWriteStore,
  ownerId: string,
  payload: InstagramConnectionWritePayload,
): Promise<
  | { ok: true; action: "insert" | "update"; id: string }
  | { ok: false; reason: "owned_by_other" | "save_failed" }
> {
  let existing: { id: string; ownerId: string; instagramUserId: string } | null;
  try {
    existing = await store.findByInstagramUserId(payload.instagramUserId);
  } catch {
    return { ok: false, reason: "save_failed" };
  }
  const plan = planInstagramConnectionWrite(ownerId, existing);
  if (plan.action === "reject") return { ok: false, reason: "owned_by_other" };
  try {
    if (plan.action === "update") {
      const saved = await store.updateById(plan.id, ownerId, payload);
      if (!saved) return { ok: false, reason: "save_failed" };
      return { ok: true, action: "update", id: saved.id };
    }
    const saved = await store.insert(payload);
    return { ok: true, action: "insert", id: saved.id };
  } catch {
    return { ok: false, reason: "save_failed" };
  }
}
