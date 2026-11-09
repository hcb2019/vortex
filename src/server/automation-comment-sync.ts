import "server-only";
import { isDemoMode } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { decryptSecret } from "@/server/crypto";
import { ingestEvents, processQueueBatch } from "@/server/jobs";
import { instagramGateway } from "@/server/instagram";
import { findOwnedInstagramConnection } from "@/server/instagram/owned-connection";

export async function syncRecentAutomationComments(ownerId: string, connectionId?: string | null) {
  if (isDemoMode) return { found: 1, queued: 1, processed: 1 };

  const connection = await findOwnedInstagramConnection(ownerId, connectionId);
  if (!connection || connection.status !== "connected") {
    throw new Error("Conexão do Instagram indisponível.");
  }
  const supabase = createSupabaseAdminClient();
  const { data: automations } = await supabase
    .from("automations")
    .select("media_id")
    .eq("owner_id", ownerId)
    .eq("connection_id", connection.id)
    .eq("status", "active")
    .is("deleted_at", null);

  const mediaIds = [...new Set((automations ?? []).flatMap(({ media_id }) => media_id ? [media_id] : []))];
  if (!mediaIds.length) return { found: 0, queued: 0, processed: 0 };

  const { data: mediaRows } = await supabase
    .from("instagram_media")
    .select("external_id,media_product_type")
    .eq("connection_id", connection.id)
    .in("id", mediaIds);
  const accessToken = decryptSecret({
    ciphertext: connection.token_ciphertext,
    iv: connection.token_iv,
    tag: connection.token_tag,
  });
  const gateway = instagramGateway();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  let found = 0;
  let queued = 0;

  for (const media of mediaRows ?? []) {
    const comments = await gateway.listComments(media.external_id, accessToken, since, 100);
    const events = comments
      .filter((comment) => comment.commenterScopedId !== connection.instagram_user_id)
      .map((comment) => ({
        instagramUserId: connection.instagram_user_id,
        commentId: comment.commentId,
        mediaId: media.external_id,
        mediaProductType: media.media_product_type || "UNKNOWN",
        commenterScopedId: comment.commenterScopedId,
        commenterUsername: comment.commenterUsername,
        text: comment.text,
        isSelf: false,
      }));
    found += events.length;
    if (events.length) {
      const result = await ingestEvents(events);
      queued += result.queued;
    }
  }

  let processed = 0;
  for (let batch = 0; batch < 10; batch += 1) {
    const result = await processQueueBatch(25);
    processed += result.processed;
    if (result.processed === 0) break;
  }
  return { found, queued, processed };
}
