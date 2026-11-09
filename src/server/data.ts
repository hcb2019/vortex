import "server-only";
import { cookies } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDemoMode } from "@/lib/env";
import {
  SELECTED_CONNECTION_COOKIE,
  isConnectionId,
  resolveSelectedConnectionId,
} from "@/lib/instagram-accounts";
import { demoStore } from "@/server/demo-store";
import { readConversationFlow } from "@/lib/domain";
import type { Automation, AutomationRun, DashboardMetrics, InstagramConnection, InstagramMedia, InstagramMediaProductType, InstagramMediaType } from "@/types/domain";

function readMediaProductType(value: unknown): InstagramMediaProductType {
  return value === "FEED" ? "FEED" : "REELS";
}

function readMediaType(value: unknown, productType: InstagramMediaProductType): InstagramMediaType {
  if (value === "CAROUSEL_ALBUM" || value === "IMAGE" || value === "VIDEO") return value;
  return productType === "REELS" ? "VIDEO" : "IMAGE";
}

function mapConnection(row: Record<string, unknown>): InstagramConnection {
  return {
    id: String(row.id),
    ownerId: String(row.owner_id),
    instagramUserId: String(row.instagram_user_id),
    username: String(row.username),
    status: row.status as InstagramConnection["status"],
    tokenExpiresAt: row.token_expires_at ? String(row.token_expires_at) : null,
    tokenRefreshedAt: row.token_refreshed_at ? String(row.token_refreshed_at) : null,
    lastSyncAt: row.last_sync_at ? String(row.last_sync_at) : null,
    lastError: row.last_error ? String(row.last_error) : null,
  };
}

function mapAutomation(row: Record<string, unknown>): Automation {
  return {
    id: String(row.id), ownerId: String(row.owner_id), connectionId: String(row.connection_id),
    mediaId: row.media_id ? String(row.media_id) : null, name: String(row.name), keyword: String(row.keyword),
    keywordNormalized: String(row.keyword_normalized),
    keywordVariants: Array.isArray(row.keyword_variants) ? row.keyword_variants.map(String) : [],
    publicReply: String(row.public_reply),
    publicReplyVariants: Array.isArray(row.public_reply_variants)
      ? row.public_reply_variants.map(String)
      : [String(row.public_reply)],
    dmMessage: String(row.dm_message),
    dmMessageVariants: Array.isArray(row.dm_message_variants)
      ? row.dm_message_variants.map(String)
      : [String(row.dm_message)],
    destinationUrl: String(row.destination_url),
    conversationFlow: readConversationFlow(row.dm_conversation_flow),
    appendUtmToButtons: row.append_utm_to_buttons !== false,
    requireFollow: Boolean(row.require_follow),
    followGateMessage: String(row.follow_gate_message ?? ""), notFollowingMessage: String(row.not_following_message ?? ""),
    status: row.status as Automation["status"], version: Number(row.version),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at), deletedAt: row.deleted_at ? String(row.deleted_at) : null,
  };
}

function mapMedia(row: Record<string, unknown>): InstagramMedia {
  const mediaProductType = readMediaProductType(row.media_product_type);
  return {
    id: String(row.id),
    connectionId: String(row.connection_id),
    externalId: String(row.external_id),
    mediaProductType,
    mediaType: readMediaType(row.media_type, mediaProductType),
    caption: String(row.caption ?? ""),
    permalink: String(row.permalink),
    thumbnailUrl: row.thumbnail_url ? String(row.thumbnail_url) : null,
    publishedAt: String(row.published_at),
  };
}

async function readSelectedConnectionCookie() {
  try {
    const store = await cookies();
    const value = store.get(SELECTED_CONNECTION_COOKIE)?.value;
    return isConnectionId(value) ? value : null;
  } catch {
    return null;
  }
}

export async function listConnections(): Promise<InstagramConnection[]> {
  if (isDemoMode) return [demoStore().connection];
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("instagram_connections").select("*").order("created_at", { ascending: true });
  return (data ?? []).map((row) => mapConnection(row as Record<string, unknown>));
}

export async function getConnection(requestedId?: string | null): Promise<InstagramConnection | null> {
  const connections = await listConnections();
  if (isDemoMode) return connections[0] ?? null;
  const supabase = await createSupabaseServerClient();
  const { data: settings } = await supabase.from("owner_settings").select("selected_connection_id").maybeSingle();
  const selectedId = resolveSelectedConnectionId(connections, {
    requestedId: isConnectionId(requestedId) ? requestedId : null,
    cookieId: await readSelectedConnectionCookie(),
    preferredId: settings?.selected_connection_id ? String(settings.selected_connection_id) : null,
  });
  return connections.find((item) => item.id === selectedId) ?? null;
}

async function scopedConnectionId(connectionId?: string | null) {
  if (isConnectionId(connectionId)) return connectionId;
  return (await getConnection())?.id ?? null;
}

export async function listMedia(connectionId?: string | null): Promise<InstagramMedia[]> {
  if (isDemoMode) return demoStore().media;
  const scope = await scopedConnectionId(connectionId);
  if (!scope) return [];
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("instagram_media").select("*").eq("connection_id", scope).order("published_at", { ascending: false });
  return (data ?? []).map((row) => mapMedia(row as Record<string, unknown>));
}

export async function listAllMedia(): Promise<InstagramMedia[]> {
  if (isDemoMode) return demoStore().media;
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("instagram_media").select("*").order("published_at", { ascending: false });
  return (data ?? []).map((row) => mapMedia(row as Record<string, unknown>));
}

export async function listAutomations(connectionId?: string | null): Promise<Automation[]> {
  if (isDemoMode) return demoStore().automations.filter((item) => item.status !== "deleted");
  const scope = await scopedConnectionId(connectionId);
  if (!scope) return [];
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("automations").select("*").eq("connection_id", scope).is("deleted_at", null).order("updated_at", { ascending: false });
  return (data ?? []).map(mapAutomation);
}

export async function getAutomation(id: string): Promise<Automation | null> {
  if (isDemoMode) return demoStore().automations.find((item) => item.id === id && item.status !== "deleted") ?? null;
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("automations").select("*").eq("id", id).is("deleted_at", null).maybeSingle();
  return data ? mapAutomation(data as Record<string, unknown>) : null;
}

export async function listRuns(connectionId?: string | null): Promise<AutomationRun[]> {
  if (isDemoMode) return demoStore().runs;
  const scope = await scopedConnectionId(connectionId);
  if (!scope) return [];
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("automation_runs")
    .select("*, automations!inner(name, connection_id)")
    .eq("automations.connection_id", scope)
    .order("created_at", { ascending: false })
    .limit(250);
  return (data ?? []).map((row) => ({
    id: row.id, automationId: row.automation_id, automationName: (row.automations as { name?: string } | null)?.name ?? row.automation_name_snapshot,
    mediaExternalId: row.media_external_id, commentId: row.comment_id, commenterScopedId: row.commenter_scoped_id,
    commenterUsername: row.commenter_username, commentText: row.comment_text, status: row.status,
    publicReplyStatus: row.public_reply_status, dmStatus: row.dm_status, publicReplyAttempts: row.public_reply_attempts,
    dmAttempts: row.dm_attempts, requireFollow: Boolean(row.require_follow_snapshot),
    followStatus: row.follow_status,
    conversationAnswers: Array.isArray(row.conversation_answers) ? row.conversation_answers.map((answer: unknown) => {
      const record = answer && typeof answer === "object" ? answer as Record<string, unknown> : {};
      return {
        stepId: String(record.stepId ?? ""),
        stepText: String(record.stepText ?? ""),
        buttonId: String(record.buttonId ?? ""),
        label: String(record.label ?? ""),
        answeredAt: String(record.answeredAt ?? row.created_at),
      };
    }) : [],
    contentDeliveredAt: row.content_delivered_at,
    errorCode: row.error_code, errorMessage: row.error_message,
    firstClickedAt: row.first_clicked_at, createdAt: row.created_at,
  })) as AutomationRun[];
}

export async function getDashboardMetrics(): Promise<DashboardMetrics> {
  const [automations, runs] = await Promise.all([listAutomations(), listRuns()]);
  return {
    activeAutomations: automations.filter((item) => item.status === "active").length,
    matchedComments: runs.length,
    eligibleRecipients: runs.length,
    sentDms: runs.filter((item) => item.contentDeliveredAt).length,
    uniqueClicks: runs.filter((item) => item.firstClickedAt).length,
    failures: runs.filter((item) => ["failed", "partial", "ambiguous"].includes(item.status)).length,
    duplicates: 0,
    lastRunAt: runs[0]?.createdAt ?? null,
  };
}
