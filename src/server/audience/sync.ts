import "server-only";
import { decryptSecret } from "@/server/crypto";
import { isDemoMode } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { instagramGateway } from "@/server/instagram";
import { findOwnedInstagramConnection } from "@/server/instagram/owned-connection";

export async function syncAudienceData(ownerId: string, connectionId?: string | null) {
  if (isDemoMode) return { commentsImported: 184, reelsSynced: 3 };
  const supabase = createSupabaseAdminClient();
  const connection = await findOwnedInstagramConnection(ownerId, connectionId);
  if (!connection || connection.status !== "connected") throw new Error("Conexão do Instagram indisponível.");
  const { data: mediaRows } = await supabase.from("instagram_media").select("*").eq("connection_id", connection.id).order("published_at", { ascending: false }).limit(20);
  const media = mediaRows ?? [];
  const accessToken = decryptSecret({ ciphertext: connection.token_ciphertext, iv: connection.token_iv, tag: connection.token_tag });
  const gateway = instagramGateway();
  const since = new Date(Date.now() - 90 * 86_400_000);
  let remaining = 2000;
  let imported = 0;
  for (const reel of media) {
    if (remaining <= 0) break;
    const [comments, insights] = await Promise.all([
      gateway.listComments(reel.external_id, accessToken, since, remaining),
      gateway.getMediaInsights(reel.external_id, accessToken),
    ]);
    const rows = comments.filter(({ commenterScopedId }) => commenterScopedId !== connection.instagram_user_id).map((comment) => ({
      owner_id: ownerId, connection_id: connection.id, comment_id: comment.commentId, media_external_id: reel.external_id,
      commenter_scoped_id: comment.commenterScopedId, commenter_username: comment.commenterUsername.slice(0, 80), comment_text: comment.text.slice(0, 2200),
      payload_minimal: {}, source: "backfill", published_at: comment.publishedAt, outcome: "received", analysis_status: "pending",
    }));
    if (rows.length) {
      const { data, error } = await supabase.from("comment_events").upsert(rows, { onConflict: "connection_id,comment_id", ignoreDuplicates: true }).select("id");
      if (error) throw new Error("Falha ao importar comentários.");
      imported += data?.length ?? 0;
    }
    const { error: insightError } = await supabase.from("media_insight_snapshots").upsert({ owner_id: ownerId, media_id: reel.id, comments: insights.comments, views: insights.views, reach: insights.reach, shares: insights.shares, saved: insights.saved, total_interactions: insights.totalInteractions, raw_metrics: insights.raw }, { onConflict: "media_id,captured_on" });
    if (insightError) throw new Error("Falha ao sincronizar métricas do Reel.");
    remaining -= comments.length;
  }
  await supabase.from("instagram_connections").update({ last_sync_at: new Date().toISOString(), last_success_at: new Date().toISOString(), last_error: null }).eq("id", connection.id);
  return { commentsImported: imported, reelsSynced: media.length };
}

export async function syncConnectedAudienceAccounts() {
  if (isDemoMode) return { accountsSynced: 0, accountsFailed: 0 };
  const supabase = createSupabaseAdminClient();
  const { data: connections } = await supabase.from("instagram_connections").select("id,owner_id").eq("status", "connected");
  let accountsSynced = 0;
  let accountsFailed = 0;
  for (const connection of connections ?? []) {
    try { await syncAudienceData(connection.owner_id, connection.id); accountsSynced += 1; }
    catch { accountsFailed += 1; }
  }
  return { accountsSynced, accountsFailed };
}
