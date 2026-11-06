import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env, isDemoMode } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

interface MetaSignedPayload { algorithm?: string; user_id?: string; issued_at?: number }

function decodeBase64Url(value: string) {
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

export function verifyMetaSignedRequest(signedRequest: string): MetaSignedPayload | null {
  const secret = env.META_WEBHOOK_APP_SECRET
    ?? env.META_APP_SECRET
    ?? (isDemoMode ? "demo-meta-secret" : "");
  if (!secret || signedRequest.length > 10_000) return null;
  const [encodedSignature, encodedPayload, ...rest] = signedRequest.split(".");
  if (!encodedSignature || !encodedPayload || rest.length) return null;
  const provided = decodeBase64Url(encodedSignature);
  const expected = createHmac("sha256", secret).update(encodedPayload).digest();
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;
  try {
    const payload = JSON.parse(decodeBase64Url(encodedPayload).toString("utf8")) as MetaSignedPayload;
    if (payload.algorithm?.toUpperCase() !== "HMAC-SHA256" || !payload.user_id || payload.user_id.length > 100) return null;
    return payload;
  } catch { return null; }
}

export async function deleteMetaDerivedData(instagramUserId: string) {
  if (isDemoMode) return;
  const supabase = createSupabaseAdminClient();
  const { data: connection } = await supabase.from("instagram_connections").select("id,owner_id").eq("instagram_user_id", instagramUserId).maybeSingle();
  if (!connection) return;
  const { error: analysisError } = await supabase.from("audience_analysis_runs").delete().eq("connection_id", connection.id);
  if (analysisError) throw new Error("Não foi possível remover os dados de audiência.");
  const { error: connectionError } = await supabase.from("instagram_connections").delete().eq("id", connection.id);
  if (connectionError) throw new Error("Não foi possível remover a conexão do Instagram.");
}

export function createDeletionConfirmation() {
  return randomBytes(16).toString("hex");
}
