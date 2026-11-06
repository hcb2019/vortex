"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { isDemoMode } from "@/lib/env";
import { isConnectionId } from "@/lib/instagram-accounts";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { encryptSecret, hashPipelineApiKey } from "@/server/crypto";
import {
  persistSelectedConnection,
  writeSelectedConnectionCookie,
} from "@/server/instagram/owned-connection";
import { createPipelineApiKeySecret } from "@/server/pipeline";

export interface PipelineApiKeyActionState {
  error?: string;
  secret?: string;
  prefix?: string;
}

export async function createPipelineApiKey(_state: PipelineApiKeyActionState, formData: FormData): Promise<PipelineApiKeyActionState> {
  const owner = await requireOwner();
  const name = String(formData.get("name") ?? "").trim();
  if (name.length < 2 || name.length > 80) return { error: "Informe um nome entre 2 e 80 caracteres." };
  const secret = createPipelineApiKeySecret();
  const prefix = secret.slice(0, 12);
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("pipeline_api_keys").insert({
    owner_id: owner.id,
    name,
    key_hash: hashPipelineApiKey(secret),
    prefix,
  });
  if (error) return { error: "Não foi possível criar a chave. Rode a migration do pipeline antes de usar este recurso." };
  revalidatePath("/settings");
  return { secret, prefix };
}

export async function revokePipelineApiKey(formData: FormData) {
  await requireOwner();
  const id = String(formData.get("id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return;
  const supabase = await createSupabaseServerClient();
  await supabase
    .from("pipeline_api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id);
  revalidatePath("/settings");
}

export async function selectInstagramConnection(formData: FormData) {
  const owner = await requireOwner();
  const connectionId = String(formData.get("connectionId") ?? "");
  if (!isConnectionId(connectionId) || isDemoMode) return;
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("instagram_connections").select("id").eq("id", connectionId).eq("owner_id", owner.id).maybeSingle();
  if (!data) return;
  await persistSelectedConnection(owner.id, data.id);
  await writeSelectedConnectionCookie(data.id);
  revalidatePath("/", "layout");
}

export async function disconnectInstagramConnection(formData: FormData) {
  const owner = await requireOwner();
  const connectionId = String(formData.get("connectionId") ?? "");
  if (!isConnectionId(connectionId) || isDemoMode) return;
  const supabase = await createSupabaseServerClient();
  const { data: connection } = await supabase
    .from("instagram_connections")
    .select("id")
    .eq("id", connectionId)
    .eq("owner_id", owner.id)
    .maybeSingle();
  if (!connection) return;
  const revoked = encryptSecret("disconnected");
  await supabase.from("instagram_connections").update({
    status: "disconnected",
    token_ciphertext: revoked.ciphertext,
    token_iv: revoked.iv,
    token_tag: revoked.tag,
    token_expires_at: null,
    last_error: "Conta desconectada no painel. Reautorize para reativar.",
    updated_at: new Date().toISOString(),
  }).eq("id", connection.id).eq("owner_id", owner.id);

  const { data: remaining } = await supabase
    .from("instagram_connections")
    .select("id,status")
    .eq("owner_id", owner.id)
    .neq("id", connection.id)
    .order("created_at", { ascending: true });
  const next = (remaining ?? []).find((item) => item.status === "connected" || item.status === "expiring") ?? remaining?.[0] ?? null;
  await persistSelectedConnection(owner.id, next?.id ?? null);
  if (next) await writeSelectedConnectionCookie(next.id);
  revalidatePath("/", "layout");
}
