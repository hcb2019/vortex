import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { decryptSecret } from "@/server/crypto";
import { instagramGateway } from "@/server/instagram";
import { MetaApiError } from "@/server/instagram/meta-gateway";
import { findOwnedInstagramConnection } from "@/server/instagram/owned-connection";

export const MEDIA_SYNC_MIN_INTERVAL_MS = 2 * 60 * 1000;
export const MEDIA_AUTO_SYNC_STALE_MS = 5 * 60 * 1000;

export class MediaSyncError extends Error {
  constructor(
    message: string,
    readonly code = "SYNC_ERROR",
  ) {
    super(message);
  }
}

export function isMediaSyncStale(lastSyncAt: string | null | undefined, staleAfterMs = MEDIA_AUTO_SYNC_STALE_MS) {
  if (!lastSyncAt) return true;
  return Date.now() - new Date(lastSyncAt).getTime() >= staleAfterMs;
}

export async function syncInstagramMediaForOwner(ownerId: string, minimumIntervalMs = MEDIA_SYNC_MIN_INTERVAL_MS, connectionId?: string | null) {
  const supabase = createSupabaseAdminClient();
  const connection = await findOwnedInstagramConnection(ownerId, connectionId);
  if (!connection) throw new MediaSyncError("Não foi possível ler a conexão.", "CONNECTION_UNAVAILABLE");

  if (!isMediaSyncStale(connection.last_sync_at, minimumIntervalMs)) {
    return { synced: 0, skipped: true, message: "As publicações já foram atualizadas há poucos minutos." };
  }

  try {
    const accessToken = decryptSecret({
      ciphertext: connection.token_ciphertext,
      iv: connection.token_iv,
      tag: connection.token_tag,
    });
    const media = await instagramGateway().listPublishedMedia(connection.instagram_user_id, accessToken);
    const syncedAt = new Date().toISOString();
    if (media.length) {
      const { error: mediaError } = await supabase.from("instagram_media").upsert(media.map((item) => ({
        owner_id: ownerId,
        connection_id: connection.id,
        external_id: item.externalId,
        media_product_type: item.mediaProductType,
        media_type: item.mediaType,
        caption: item.caption,
        permalink: item.permalink,
        thumbnail_url: item.thumbnailUrl,
        published_at: item.publishedAt,
        synced_at: syncedAt,
      })), { onConflict: "connection_id,external_id" });
      if (mediaError) throw new Error("O banco de dados recusou a gravação das publicações.");
    }
    const { error: updateError } = await supabase.from("instagram_connections").update({
      status: "connected",
      last_sync_at: syncedAt,
      last_success_at: syncedAt,
      last_error: null,
    }).eq("id", connection.id);
    if (updateError) throw new Error("Não foi possível atualizar o estado da conexão.");
    return { synced: media.length, skipped: false, message: "Publicações atualizadas." };
  } catch (error) {
    const unsupportedMedia = error instanceof MetaApiError
      && error.code === "2500"
      && error.message.toLowerCase().includes("/media");
    const diagnostic = unsupportedMedia
      ? "A Meta autenticou a conta, mas não expôs a coleção de mídias para este token. Confira se o Client ID configurado abaixo é o “ID do app do Instagram” — e não o ID principal do app Meta — e então reautorize a conta."
      : error instanceof MetaApiError
        ? `Meta (${error.code ?? error.status}): ${error.message}`
        : error instanceof Error
          ? error.message
          : "Falha desconhecida.";
    await supabase.from("instagram_connections").update({
      status: "error",
      last_error: diagnostic.slice(0, 400),
    }).eq("id", connection.id);
    throw new MediaSyncError("Não foi possível sincronizar as publicações.", error instanceof MetaApiError ? error.code ?? "META_ERROR" : "SYNC_ERROR");
  }
}
