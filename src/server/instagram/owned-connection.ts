import "server-only";
import { cookies } from "next/headers";
import {
  SELECTED_CONNECTION_COOKIE,
  isConnectionId,
  resolveSelectedConnectionId,
  selectedConnectionCookieOptions,
} from "@/lib/instagram-accounts";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type InstagramConnectionRow = Record<string, unknown> & {
  id: string;
  owner_id: string;
  instagram_user_id: string;
  username: string;
  status: string;
  token_ciphertext: string;
  token_iv: string;
  token_tag: string;
  token_expires_at: string | null;
  last_sync_at?: string | null;
};

async function readSelectedConnectionCookie() {
  try {
    const value = (await cookies()).get(SELECTED_CONNECTION_COOKIE)?.value;
    return isConnectionId(value) ? value : null;
  } catch {
    return null;
  }
}

export async function persistSelectedConnection(ownerId: string, connectionId: string | null) {
  const supabase = createSupabaseAdminClient();
  await supabase.from("owner_settings").upsert({
    owner_id: ownerId,
    selected_connection_id: connectionId,
    updated_at: new Date().toISOString(),
  });
}

export function applySelectedConnectionCookie(response: { cookies: { set: (name: string, value: string, options: ReturnType<typeof selectedConnectionCookieOptions>) => unknown } }, connectionId: string) {
  response.cookies.set(SELECTED_CONNECTION_COOKIE, connectionId, selectedConnectionCookieOptions());
}

export async function writeSelectedConnectionCookie(connectionId: string) {
  const store = await cookies();
  store.set(SELECTED_CONNECTION_COOKIE, connectionId, selectedConnectionCookieOptions());
}

export async function findOwnedInstagramConnection(ownerId: string, requestedId?: string | null): Promise<InstagramConnectionRow | null> {
  const supabase = createSupabaseAdminClient();
  const { data: rows } = await supabase
    .from("instagram_connections")
    .select("*")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: true });
  if (!rows?.length) return null;
  const { data: settings } = await supabase
    .from("owner_settings")
    .select("selected_connection_id")
    .eq("owner_id", ownerId)
    .maybeSingle();
  const selectedId = resolveSelectedConnectionId(
    rows.map((row) => ({ id: String(row.id), status: String(row.status) })),
    {
      requestedId: isConnectionId(requestedId) ? requestedId : null,
      cookieId: await readSelectedConnectionCookie(),
      preferredId: settings?.selected_connection_id ? String(settings.selected_connection_id) : null,
    },
  );
  return (rows.find((row) => row.id === selectedId) ?? null) as InstagramConnectionRow | null;
}

export async function readRequestedConnectionId(request: Request) {
  try {
    const form = await request.clone().formData();
    const value = String(form.get("connectionId") ?? "");
    return isConnectionId(value) ? value : null;
  } catch {
    return null;
  }
}
