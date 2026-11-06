import "server-only";
import {
  upsertOwnedInstagramConnection,
  type InstagramConnectionWritePayload,
  type InstagramConnectionWriteStore,
} from "@/lib/instagram-accounts";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

function rowFromPayload(payload: InstagramConnectionWritePayload) {
  return {
    owner_id: payload.ownerId,
    instagram_user_id: payload.instagramUserId,
    username: payload.username,
    token_ciphertext: payload.tokenCiphertext,
    token_iv: payload.tokenIv,
    token_tag: payload.tokenTag,
    token_expires_at: payload.tokenExpiresAt,
    api_version: payload.apiVersion,
    status: "connected",
    last_error: null,
    updated_at: new Date().toISOString(),
  };
}

export function createAdminInstagramConnectionStore(
  supabase = createSupabaseAdminClient(),
): InstagramConnectionWriteStore {
  return {
    async findByInstagramUserId(instagramUserId) {
      const { data, error } = await supabase
        .from("instagram_connections")
        .select("id,owner_id,instagram_user_id")
        .eq("instagram_user_id", instagramUserId)
        .maybeSingle();
      if (error) throw error;
      return data
        ? { id: data.id, ownerId: data.owner_id, instagramUserId: data.instagram_user_id }
        : null;
    },
    async insert(payload) {
      const { data, error } = await supabase
        .from("instagram_connections")
        .insert(rowFromPayload(payload))
        .select("id")
        .single();
      if (error || !data) throw error ?? new Error("insert_failed");
      return { id: data.id };
    },
    async updateById(id, ownerId, payload) {
      const { data, error } = await supabase
        .from("instagram_connections")
        .update(rowFromPayload(payload))
        .eq("id", id)
        .eq("owner_id", ownerId)
        .eq("instagram_user_id", payload.instagramUserId)
        .select("id")
        .single();
      if (error || !data) return null;
      return { id: data.id };
    },
  };
}

export async function saveOwnedInstagramConnection(payload: InstagramConnectionWritePayload) {
  return upsertOwnedInstagramConnection(
    createAdminInstagramConnectionStore(),
    payload.ownerId,
    payload,
  );
}
